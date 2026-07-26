use crate::audio_toolkit::{
    ducking::AudioDucker, list_input_devices, vad::SmoothedVad, AudioEnhancementConfig,
    AudioRecorder, SileroVad,
};
use crate::helpers::clamshell;
use crate::settings::{get_settings, AppSettings};
use crate::utils;
use log::{debug, error, info, warn};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager};

fn query_mute() -> Option<bool> {
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

            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let all_devices: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let default_device = all_devices
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .ok()?;
            let volume_interface = default_device
                .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                .ok()?;
            let mut muted = windows::Win32::Foundation::BOOL(0);
            volume_interface.GetMute(&mut muted).ok()?;
            Some(muted.as_bool())
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        if let Ok(output) = Command::new("wpctl")
            .args(["get-volume", "@DEFAULT_AUDIO_SINK@"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
                return Some(text.contains("[muted]"));
            }
        }

        if let Ok(output) = Command::new("pactl")
            .args(["get-sink-mute", "@DEFAULT_SINK@"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
                return Some(text.contains("yes"));
            }
        }

        if let Ok(output) = Command::new("amixer").args(["get", "Master"]).output() {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
                return Some(text.contains("[off]"));
            }
        }

        None
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("osascript")
            .args(["-e", "output muted of (get volume settings)"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let value = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_ascii_lowercase();
        match value.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        }
    }
}

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

/// How long an on-demand microphone stream lingers after a recording ends
/// before it is closed. Reopening a CoreAudio stream costs 150-200ms — the
/// bulk of the `recording_start` latency budget — and consecutive dictations
/// within a few seconds are the most common usage pattern. The stream-epoch
/// guard makes the delayed close a no-op when a new recording starts during
/// the linger, so back-to-back dictations skip the reopen entirely. Kept
/// short so the OS microphone indicator clears promptly when the user is
/// actually done.
const ON_DEMAND_STREAM_LINGER: std::time::Duration = std::time::Duration::from_secs(10);

/// Pending deferred close, coalesced into one long-lived worker thread.
///
/// Each dictation stop/cancel used to spawn its own thread that slept out the
/// linger window, so rapid dictation accumulated short-lived threads. The worker
/// waits on `signal` for the latest deadline instead, and a newer stop simply
/// moves the deadline.
#[derive(Default)]
struct StreamLinger {
    state: Mutex<StreamLingerState>,
    signal: Condvar,
}

#[derive(Default)]
struct StreamLingerState {
    /// Deadline plus the stream epoch the close applies to.
    pending: Option<(Instant, u64)>,
    worker_started: bool,
}

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
    stream_failed: Arc<AtomicBool>,
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
        })
        .with_error_callback({
            let app_handle = app_handle.clone();
            move |error_message| {
                stream_failed.store(true, Ordering::SeqCst);
                // The callback runs on the recorder worker thread; tearing the
                // stream down from here would self-join that thread, so hand
                // recovery to a detached thread.
                let app_handle = app_handle.clone();
                std::thread::spawn(move || {
                    handle_stream_failure(&app_handle, error_message);
                });
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

/// React to a fatal capture-stream error (e.g. the microphone disappeared).
///
/// If a recording is in flight, leave it intact: the recorder worker still
/// services stop/snapshot, so stopping normally salvages the audio captured
/// before the failure, and the stream is rebuilt on the next open via
/// `stream_failed`. If the stream died while idle (always-on mode), rebuild it
/// right away so always-on capture keeps its invariant.
fn handle_stream_failure(app_handle: &tauri::AppHandle, error_message: String) {
    let Some(manager) = app_handle.try_state::<Arc<AudioRecordingManager>>() else {
        warn!(
            "Microphone stream failed before the recording manager was available: {error_message}"
        );
        return;
    };
    let manager = manager.inner().clone();

    if manager.is_recording() {
        warn!("Microphone stream failed mid-recording: {error_message}");
        let _ = app_handle.emit(
            "recording-error",
            format!(
                "Microphone stopped delivering audio ({error_message}). Stop dictation to keep what was captured; the microphone is reconnected on the next recording."
            ),
        );
        return;
    }

    warn!("Microphone stream failed while idle: {error_message}");
    manager.stop_microphone_stream();

    let always_on = matches!(
        *manager.mode.lock().unwrap_or_else(|e| e.into_inner()),
        MicrophoneMode::AlwaysOn
    );
    if always_on {
        if let Err(error) = manager.start_microphone_stream() {
            let message = format!(
                "Failed to reopen the always-on microphone after a stream failure: {error}"
            );
            warn!("{message}");
            let _ = app_handle.emit("recording-error", message);
        }
    }
}

/* ──────────────────────────────────────────────────────────────── */

#[derive(Clone)]
pub struct AudioRecordingManager {
    state: Arc<Mutex<RecordingState>>,
    mode: Arc<Mutex<MicrophoneMode>>,
    app_handle: tauri::AppHandle,
    vad_model_path: Arc<Mutex<Option<PathBuf>>>,

    recorder: Arc<Mutex<Option<AudioRecorder>>>,
    is_open: Arc<AtomicBool>,
    is_recording: Arc<AtomicBool>,
    /// Set when the capture stream reports a fatal error (e.g. the device
    /// disappeared). The next open tears the dead stream down and rebuilds.
    stream_failed: Arc<AtomicBool>,
    stream_epoch: Arc<AtomicU64>,
    stream_linger: Arc<StreamLinger>,
    audio_ducker: AudioDucker,
    did_mute: Arc<AtomicBool>,
    mute_restore_state: Arc<Mutex<Option<bool>>>,
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
            vad_model_path: Arc::new(Mutex::new(None)),

            recorder: Arc::new(Mutex::new(None)),
            is_open: Arc::new(AtomicBool::new(false)),
            is_recording: Arc::new(AtomicBool::new(false)),
            stream_failed: Arc::new(AtomicBool::new(false)),
            stream_epoch: Arc::new(AtomicU64::new(0)),
            stream_linger: Arc::new(StreamLinger::default()),
            audio_ducker: AudioDucker::new(),
            did_mute: Arc::new(AtomicBool::new(false)),
            mute_restore_state: Arc::new(Mutex::new(None)),
            temporary_mute_override: Arc::new(Mutex::new(None)),
        };

        // Always-on?  Open immediately.
        if matches!(mode, MicrophoneMode::AlwaysOn) {
            if let Err(error) = manager.start_microphone_stream() {
                let message =
                    format!("Failed to open always-on microphone during startup: {error}");
                warn!("{message}");
                let _ = app.emit("recording-error", message);
            }
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

    fn get_vad_model_path(&self) -> Result<PathBuf, anyhow::Error> {
        let mut vad_model_path = self
            .vad_model_path
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(path) = vad_model_path.as_ref() {
            return Ok(path.clone());
        }

        let resolved = crate::portable::resolve_resource(
            &self.app_handle,
            "resources/models/silero_vad_v4.onnx",
        )
        .map_err(|e| anyhow::anyhow!("Failed to resolve VAD path: {}", e))?;
        *vad_model_path = Some(resolved.clone());
        Ok(resolved)
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
            *self
                .mute_restore_state
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = query_mute();
            set_mute(true);
            debug!("Mute applied");
        }
    }

    fn restore_recording_mute(&self) {
        if self.did_mute.swap(false, Ordering::SeqCst) {
            let previous = self
                .mute_restore_state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
            set_mute(previous.unwrap_or(false));
            debug!("Mute restored to previous state");
        }
    }

    /// Removes configured output effects if they were applied.
    pub fn remove_mute(&self) {
        *self
            .temporary_mute_override
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        self.audio_ducker.restore_async();

        self.restore_recording_mute();
    }

    pub fn set_temporary_mute_override(&self, enabled: Option<bool>) {
        *self
            .temporary_mute_override
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = enabled;
    }

    pub fn start_microphone_stream(&self) -> Result<(), anyhow::Error> {
        let start_time = Instant::now();

        let mut recorder_opt = self.recorder.lock().unwrap_or_else(|e| e.into_inner());

        if self.is_open.load(Ordering::SeqCst) {
            if self.stream_failed.load(Ordering::SeqCst) {
                warn!("Previous microphone stream failed; rebuilding it");
                if let Some(rec) = recorder_opt.as_mut() {
                    let _ = rec.close();
                }
                self.is_open.store(false, Ordering::SeqCst);
            } else {
                debug!("Microphone stream already active");
                return Ok(());
            }
        }

        // Don't mute immediately - caller will handle muting after audio feedback.
        self.did_mute.store(false, Ordering::SeqCst);
        *self
            .mute_restore_state
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;

        if recorder_opt.is_none() {
            let vad_model_path = self.get_vad_model_path()?;
            *recorder_opt = Some(create_audio_recorder(
                vad_model_path
                    .to_str()
                    .ok_or_else(|| anyhow::anyhow!("VAD path contains invalid UTF-8"))?,
                &self.app_handle,
                Arc::clone(&self.stream_failed),
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
        self.stream_failed.store(false, Ordering::SeqCst);
        info!(
            "Microphone stream initialized in {:?}",
            start_time.elapsed()
        );
        Ok(())
    }

    pub fn stop_microphone_stream(&self) {
        let mut recorder_guard = self.recorder.lock().unwrap_or_else(|e| e.into_inner());

        if !self.is_open.load(Ordering::SeqCst) {
            return;
        }

        self.audio_ducker.restore_async();

        self.restore_recording_mute();

        if let Some(rec) = recorder_guard.as_mut() {
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

    /// Queue the on-demand stream close for `ON_DEMAND_STREAM_LINGER` from now.
    ///
    /// Repeated calls just move the deadline, so back-to-back dictations keep the
    /// warm stream without spawning a thread each time.
    fn schedule_on_demand_stream_close(&self) {
        let deadline = Instant::now() + ON_DEMAND_STREAM_LINGER;
        let expected_epoch = self.stream_epoch.load(Ordering::SeqCst);

        let mut state = self
            .stream_linger
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        state.pending = Some((deadline, expected_epoch));

        if !state.worker_started {
            let manager = self.clone();
            match std::thread::Builder::new()
                .name("mic-stream-linger".to_string())
                .spawn(move || manager.run_stream_linger_worker())
            {
                Ok(_) => state.worker_started = true,
                Err(error) => {
                    // Leave `pending` set and the flag clear so the next stop
                    // retries; the epoch guard keeps a late close safe.
                    error!("Failed to start the microphone linger worker: {error}");
                }
            }
        }
        drop(state);

        self.stream_linger.signal.notify_all();
    }

    /// Single worker that performs whichever deferred close is currently queued.
    fn run_stream_linger_worker(&self) {
        let mut state = self
            .stream_linger
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        loop {
            let Some((deadline, expected_epoch)) = state.pending else {
                state = self
                    .stream_linger
                    .signal
                    .wait(state)
                    .unwrap_or_else(|e| e.into_inner());
                continue;
            };

            let now = Instant::now();
            if now < deadline {
                // A newer stop can move the deadline while we wait; re-read it.
                state = self
                    .stream_linger
                    .signal
                    .wait_timeout(state, deadline - now)
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
                continue;
            }

            state.pending = None;
            drop(state);
            self.stop_microphone_stream_if_epoch(expected_epoch);
            state = self
                .stream_linger
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner());
        }
    }

    fn stop_microphone_stream_if_epoch(&self, expected_epoch: u64) {
        if !matches!(
            *self.mode.lock().unwrap_or_else(|e| e.into_inner()),
            MicrophoneMode::OnDemand
        ) {
            return;
        }

        let mut recorder_guard = self.recorder.lock().unwrap_or_else(|e| e.into_inner());

        if self.stream_epoch.load(Ordering::SeqCst) != expected_epoch
            || self.is_recording.load(Ordering::SeqCst)
            || !self.is_open.load(Ordering::SeqCst)
        {
            return;
        }

        self.audio_ducker.restore_async();

        self.restore_recording_mute();

        if let Some(rec) = recorder_guard.as_mut() {
            let _ = rec.close();
        }

        self.is_open.store(false, Ordering::SeqCst);
        debug!("Microphone stream stopped for epoch {expected_epoch}");
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
        self.stream_epoch.fetch_add(1, Ordering::SeqCst);

        // Open the stream before taking the recording-state lock so start/mute
        // paths cannot deadlock on inverted lock ordering.
        // Also reopen in always-on mode when the previous stream failed
        // (device disconnect); start_microphone_stream rebuilds it.
        if matches!(
            *self.mode.lock().unwrap_or_else(|e| e.into_inner()),
            MicrophoneMode::OnDemand
        ) || self.stream_failed.load(Ordering::SeqCst)
        {
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

                // In on-demand mode turn the mic off again after returning
                // samples to the transcription task. Closing joins the audio
                // worker thread, so doing it inline adds stop-to-transcript
                // latency for every on-demand dictation. The close is also
                // delayed by a short linger so a follow-up dictation reuses
                // the warm stream instead of paying the reopen cost.
                if matches!(
                    *self.mode.lock().unwrap_or_else(|e| e.into_inner()),
                    MicrophoneMode::OnDemand
                ) {
                    self.schedule_on_demand_stream_close();
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

    #[cfg(not(feature = "ci-mock-transcription"))]
    pub fn snapshot_recording(
        &self,
        max_samples: Option<usize>,
    ) -> Option<crate::audio_toolkit::AudioSnapshot> {
        if !self.is_recording() {
            return None;
        }

        if let Some(rec) = self
            .recorder
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            match rec.snapshot(max_samples) {
                Ok(snapshot) => Some(snapshot),
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

            // In on-demand mode turn the mic off again (after the same
            // linger as stop_recording so a quick retry reuses the stream).
            if matches!(
                *self.mode.lock().unwrap_or_else(|e| e.into_inner()),
                MicrophoneMode::OnDemand
            ) {
                self.schedule_on_demand_stream_close();
            }
        }
    }
}
