use crate::audio_toolkit::{
    ducking::AudioDucker, list_input_devices, vad::SmoothedVad, AudioEnhancementConfig,
    AudioRecorder, SileroVad,
};
use crate::helpers::clamshell;
use crate::settings::{get_settings, AppSettings};
use crate::utils;
use log::{debug, error, info};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

fn set_mute(mute: bool) {
    // Expected behavior:
    // - Windows: works on most systems using standard audio drivers.
    // - Linux: works on many systems (PipeWire, PulseAudio, ALSA),
    //   but some distros may lack the tools used.
    // - macOS: works on most standard setups via AppleScript.
    // If unsupported, fails silently.

    #[cfg(target_os = "windows")]
    {
        unsafe {
            use windows::Win32::{
                Media::Audio::{
                    eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
                    MMDeviceEnumerator,
                },
                System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
            };

            macro_rules! unwrap_or_return {
                ($expr:expr) => {
                    match $expr {
                        Ok(val) => val,
                        Err(_) => return,
                    }
                };
            }

            // Initialize the COM library for this thread.
            // If already initialized (e.g., by another library like Tauri), this does nothing.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let all_devices: IMMDeviceEnumerator =
                unwrap_or_return!(CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL));
            let default_device =
                unwrap_or_return!(all_devices.GetDefaultAudioEndpoint(eRender, eMultimedia));
            let volume_interface = unwrap_or_return!(
                default_device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            );

            let _ = volume_interface.SetMute(mute, std::ptr::null());
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let mute_val = if mute { "1" } else { "0" };
        let amixer_state = if mute { "mute" } else { "unmute" };

        // Try multiple backends to increase compatibility
        // 1. PipeWire (wpctl)
        if Command::new("wpctl")
            .args(["set-mute", "@DEFAULT_AUDIO_SINK@", mute_val])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return;
        }

        // 2. PulseAudio (pactl)
        if Command::new("pactl")
            .args(["set-sink-mute", "@DEFAULT_SINK@", mute_val])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return;
        }

        // 3. ALSA (amixer)
        let _ = Command::new("amixer")
            .args(["set", "Master", amixer_state])
            .output();
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let script = format!(
            "set volume output muted {}",
            if mute { "true" } else { "false" }
        );
        let _ = Command::new("osascript").args(["-e", &script]).output();
    }
}

const WHISPER_SAMPLE_RATE: usize = 16000;

/* ──────────────────────────────────────────────────────────────── */

#[derive(Clone, Debug)]
pub enum RecordingState {
    Idle,
    Recording { binding_id: String },
}

#[derive(Clone, Debug)]
pub enum MicrophoneMode {
    AlwaysOn,
    OnDemand,
}

/* ──────────────────────────────────────────────────────────────── */

fn create_audio_recorder(
    vad_path: &str,
    app_handle: &tauri::AppHandle,
) -> Result<AudioRecorder, anyhow::Error> {
    let settings = get_settings(app_handle);
    let silero = SileroVad::new(vad_path, 0.3)
        .map_err(|e| anyhow::anyhow!("Failed to create SileroVad: {}", e))?;
    let smoothed_vad = SmoothedVad::new(Box::new(silero), 15, 15, 2);

    // Recorder with VAD plus a spectrum-level callback that forwards updates to
    // the frontend.
    let recorder = AudioRecorder::new()
        .map_err(|e| anyhow::anyhow!("Failed to create AudioRecorder: {}", e))?
        .with_vad(Box::new(smoothed_vad))
        .with_level_callback({
            let app_handle = app_handle.clone();
            move |levels| {
                utils::emit_levels(&app_handle, &levels);
            }
        });

    let recorder = if let Some(config) = AudioEnhancementConfig::from_settings(
        settings.audio_enhancement_enabled,
        &settings.audio_enhancement_model,
    ) {
        recorder.with_enhancement(config)
    } else {
        recorder
    };

    Ok(recorder)
}

/* ──────────────────────────────────────────────────────────────── */

#[derive(Clone)]
pub struct AudioRecordingManager {
    state: Arc<Mutex<RecordingState>>,
    mode: Arc<Mutex<MicrophoneMode>>,
    app_handle: tauri::AppHandle,

    recorder: Arc<Mutex<Option<AudioRecorder>>>,
    is_open: Arc<AtomicBool>,
    is_recording: Arc<AtomicBool>,
    audio_ducker: AudioDucker,
    did_mute: Arc<AtomicBool>,
    temporary_mute_override: Arc<Mutex<Option<bool>>>,
}

impl AudioRecordingManager {
    /* ---------- construction ------------------------------------------------ */

    pub fn new(app: &tauri::AppHandle) -> Result<Self, anyhow::Error> {
        let settings = get_settings(app);
        let mode = if settings.always_on_microphone {
            MicrophoneMode::AlwaysOn
        } else {
            MicrophoneMode::OnDemand
        };

        let manager = Self {
            state: Arc::new(Mutex::new(RecordingState::Idle)),
            mode: Arc::new(Mutex::new(mode.clone())),
            app_handle: app.clone(),

            recorder: Arc::new(Mutex::new(None)),
            is_open: Arc::new(AtomicBool::new(false)),
            is_recording: Arc::new(AtomicBool::new(false)),
            audio_ducker: AudioDucker::new(),
            did_mute: Arc::new(AtomicBool::new(false)),
            temporary_mute_override: Arc::new(Mutex::new(None)),
        };

        // Always-on?  Open immediately.
        if matches!(mode, MicrophoneMode::AlwaysOn) {
            manager.start_microphone_stream()?;
        }

        Ok(manager)
    }

    /* ---------- helper methods --------------------------------------------- */

    fn get_effective_microphone_device(&self, settings: &AppSettings) -> Option<cpal::Device> {
        // Check if we're in clamshell mode and have a clamshell microphone configured
        let use_clamshell_mic = if let Ok(is_clamshell) = clamshell::is_clamshell() {
            is_clamshell && settings.clamshell_microphone.is_some()
        } else {
            false
        };

        let device_name = if use_clamshell_mic {
            settings.clamshell_microphone.as_ref()?
        } else {
            settings.selected_microphone.as_ref()?
        };

        // Find the device by name
        match list_input_devices() {
            Ok(devices) => devices
                .into_iter()
                .find(|d| d.name == *device_name)
                .map(|d| d.device),
            Err(e) => {
                debug!("Failed to list devices, using default: {}", e);
                None
            }
        }
    }

    /* ---------- microphone life-cycle -------------------------------------- */

    /// Applies configured output effects if an active recording is still running.
    pub fn apply_mute(&self) {
        let settings = get_settings(&self.app_handle);
        let mute_while_recording = self
            .temporary_mute_override
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .unwrap_or(settings.mute_while_recording);

        if settings.audio_ducking_enabled
            && self.is_open.load(Ordering::SeqCst)
            && self.is_recording()
        {
            self.audio_ducker
                .duck_if_recording_async(Arc::clone(&self.is_recording));
        }

        if mute_while_recording
            && self.is_open.load(Ordering::SeqCst)
            && self.is_recording()
            && !self.did_mute.swap(true, Ordering::SeqCst)
        {
            set_mute(true);
            debug!("Mute applied");
        }
    }

    /// Removes configured output effects if they were applied.
    pub fn remove_mute(&self) {
        *self
            .temporary_mute_override
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        self.audio_ducker.restore_async();

        if self.did_mute.swap(false, Ordering::SeqCst) {
            set_mute(false);
            debug!("Mute removed");
        }
    }

    pub fn set_temporary_mute_override(&self, enabled: Option<bool>) {
        *self
            .temporary_mute_override
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = enabled;
    }

    pub fn start_microphone_stream(&self) -> Result<(), anyhow::Error> {
        if self.is_open.load(Ordering::SeqCst) {
            debug!("Microphone stream already active");
            return Ok(());
        }

        let start_time = Instant::now();

        // Don't mute immediately - caller will handle muting after audio feedback
        self.did_mute.store(false, Ordering::SeqCst);

        let vad_path = &self.app_handle;
        let vad_path =
            crate::portable::resolve_resource(vad_path, "resources/models/silero_vad_v4.onnx")
                .map_err(|e| anyhow::anyhow!("Failed to resolve VAD path: {}", e))?;
        let mut recorder_opt = self.recorder.lock().unwrap_or_else(|e| e.into_inner());

        if self.is_open.load(Ordering::SeqCst) {
            debug!("Microphone stream already active");
            return Ok(());
        }

        if recorder_opt.is_none() {
            *recorder_opt = Some(create_audio_recorder(
                vad_path
                    .to_str()
                    .ok_or_else(|| anyhow::anyhow!("VAD path contains invalid UTF-8"))?,
                &self.app_handle,
            )?);
        }

        // Get the selected device from settings, considering clamshell mode
        let settings = get_settings(&self.app_handle);
        let selected_device = self.get_effective_microphone_device(&settings);

        if let Some(rec) = recorder_opt.as_mut() {
            rec.open(selected_device)
                .map_err(|e| anyhow::anyhow!("Failed to open recorder: {}", e))?;
        }

        self.is_open.store(true, Ordering::SeqCst);
        info!(
            "Microphone stream initialized in {:?}",
            start_time.elapsed()
        );
        Ok(())
    }

    pub fn stop_microphone_stream(&self) {
        if !self.is_open.load(Ordering::SeqCst) {
            return;
        }

        self.audio_ducker.restore_async();

        if self.did_mute.swap(false, Ordering::SeqCst) {
            set_mute(false);
        }

        if let Some(rec) = self
            .recorder
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
        {
            // If still recording, stop first.
            if self.is_recording.load(Ordering::SeqCst) {
                let _ = rec.stop();
                self.is_recording.store(false, Ordering::SeqCst);
            }
            let _ = rec.close();
        }

        self.is_open.store(false, Ordering::SeqCst);
        debug!("Microphone stream stopped");
    }

    /* ---------- mode switching --------------------------------------------- */

    pub fn update_mode(&self, new_mode: MicrophoneMode) -> Result<(), anyhow::Error> {
        let mode_guard = self.mode.lock().unwrap_or_else(|e| e.into_inner());
        let cur_mode = mode_guard.clone();

        match (cur_mode, &new_mode) {
            (MicrophoneMode::AlwaysOn, MicrophoneMode::OnDemand) => {
                if !self.is_recording() {
                    drop(mode_guard);
                    self.stop_microphone_stream();
                }
            }
            (MicrophoneMode::OnDemand, MicrophoneMode::AlwaysOn) => {
                drop(mode_guard);
                self.start_microphone_stream()?;
            }
            _ => {}
        }

        *self.mode.lock().unwrap_or_else(|e| e.into_inner()) = new_mode;
        Ok(())
    }

    /* ---------- recording --------------------------------------------------- */

    pub fn try_start_recording(&self, binding_id: &str) -> Result<(), String> {
        // Open the stream before taking the recording-state lock so start/mute
        // paths cannot deadlock on inverted lock ordering.
        if matches!(
            *self.mode.lock().unwrap_or_else(|e| e.into_inner()),
            MicrophoneMode::OnDemand
        ) {
            if let Err(e) = self.start_microphone_stream() {
                let msg = format!("{e}");
                error!("Failed to open microphone stream: {msg}");
                return Err(msg);
            }
        }

        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());

        if let RecordingState::Idle = *state {
            if let Some(rec) = self
                .recorder
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
            {
                if rec.start().is_ok() {
                    self.is_recording.store(true, Ordering::SeqCst);
                    *state = RecordingState::Recording {
                        binding_id: binding_id.to_string(),
                    };
                    debug!("Recording started for binding {binding_id}");
                    return Ok(());
                }
            }
            Err("Recorder not available".to_string())
        } else {
            Err("Already recording".to_string())
        }
    }

    pub fn update_selected_device(&self) -> Result<(), anyhow::Error> {
        // If currently open, restart the microphone stream to use the new device
        if self.is_open.load(Ordering::SeqCst) {
            self.stop_microphone_stream();
            self.start_microphone_stream()?;
        } else {
            *self.recorder.lock().unwrap_or_else(|e| e.into_inner()) = None;
        }
        Ok(())
    }

    pub fn update_audio_enhancement(&self) -> Result<(), anyhow::Error> {
        let was_open = self.is_open.load(Ordering::SeqCst);

        if was_open {
            self.stop_microphone_stream();
        }

        *self.recorder.lock().unwrap_or_else(|e| e.into_inner()) = None;

        if was_open {
            self.start_microphone_stream()?;
        }
        Ok(())
    }

    pub fn stop_recording(&self, binding_id: &str) -> Option<Vec<f32>> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());

        match *state {
            RecordingState::Recording {
                binding_id: ref active,
            } if active == binding_id => {
                *state = RecordingState::Idle;
                drop(state);

                let samples = if let Some(rec) = self
                    .recorder
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_ref()
                {
                    match rec.stop() {
                        Ok(buf) => buf,
                        Err(e) => {
                            error!("stop() failed: {e}");
                            Vec::new()
                        }
                    }
                } else {
                    error!("Recorder not available");
                    Vec::new()
                };

                self.is_recording.store(false, Ordering::SeqCst);
                self.remove_mute();

                // In on-demand mode turn the mic off again
                if matches!(
                    *self.mode.lock().unwrap_or_else(|e| e.into_inner()),
                    MicrophoneMode::OnDemand
                ) {
                    self.stop_microphone_stream();
                }

                // Pad if very short
                let s_len = samples.len();
                // debug!("Got {} samples", s_len);
                if s_len < WHISPER_SAMPLE_RATE && s_len > 0 {
                    let mut padded = samples;
                    padded.resize(WHISPER_SAMPLE_RATE * 5 / 4, 0.0);
                    Some(padded)
                } else {
                    Some(samples)
                }
            }
            _ => None,
        }
    }

    pub fn snapshot_recording(&self) -> Option<Vec<f32>> {
        if !self.is_recording() {
            return None;
        }

        if let Some(rec) = self
            .recorder
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            match rec.snapshot() {
                Ok(samples) => Some(samples),
                Err(e) => {
                    error!("snapshot() failed: {e}");
                    None
                }
            }
        } else {
            error!("Recorder not available");
            None
        }
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    /// Cancel any ongoing recording without returning audio samples
    pub fn cancel_recording(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());

        if let RecordingState::Recording { .. } = *state {
            *state = RecordingState::Idle;
            drop(state);

            if let Some(rec) = self
                .recorder
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
            {
                let _ = rec.stop(); // Discard the result
            }

            self.is_recording.store(false, Ordering::SeqCst);
            self.remove_mute();

            // In on-demand mode turn the mic off again
            if matches!(
                *self.mode.lock().unwrap_or_else(|e| e.into_inner()),
                MicrophoneMode::OnDemand
            ) {
                self.stop_microphone_stream();
            }
        }
    }
}
