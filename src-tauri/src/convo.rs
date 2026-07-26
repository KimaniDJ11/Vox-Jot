use base64::Engine;
use hound::{WavSpec, WavWriter};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;

const PERSONAPLEX_PORT: u16 = 8765;
const PERSONAPLEX_HEALTH_TIMEOUT_SECS: u64 = 5;
const PERSONAPLEX_RESPOND_TIMEOUT_SECS: u64 = 120;

/// Known locations to look for the speech-swift `audio-server` binary.
const AUDIO_SERVER_SEARCH_PATHS: &[&str] = &[
    // Homebrew-installed or local build
    "/usr/local/bin/audio-server",
    "/opt/homebrew/bin/audio-server",
    // Common dev checkout locations
    "speech-swift/.build/release/audio-server",
    "speech-swift/.build/debug/audio-server",
];

// ── Shared types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConvoMode {
    Selection,
    SettingsCoach,
    FilesContext,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ConvoTranscriptItem {
    pub id: String,
    pub role: String, // "user" or "assistant"
    pub text: String,
    pub timestamp_ms: u64,
    pub has_audio: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ConvoContextItem {
    pub id: String,
    pub label: String,
    pub source_type: String, // "selection", "pasted_text", "file", "folder", "settings_catalog"
    pub content: String,
    pub char_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ConvoActionSuggestion {
    pub action_type: String, // "open_setting", "copy_draft"
    pub label: String,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SettingsCatalogEntry {
    pub key: String,
    pub label: String,
    pub description: String,
    pub current_value: String,
    pub category: String,
    pub setting_section: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ConvoSessionState {
    pub session_id: String,
    pub mode: ConvoMode,
    pub transcript: Vec<ConvoTranscriptItem>,
    pub context_description: String,
    pub voice_id: String,
    pub speak_replies: bool,
    pub context_items: Vec<ConvoContextItem>,
    pub suggested_actions: Vec<ConvoActionSuggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ConvoTurnResponse {
    pub user_text: Option<String>,
    pub assistant_text: String,
    pub audio_base64: Option<String>,
    pub session_id: String,
    pub suggested_actions: Vec<ConvoActionSuggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ConvoAvailability {
    pub available: bool,
    pub reason: Option<String>,
    pub helper_running: bool,
}

/// Response from the speech-swift `/respond` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PersonaPlexResponse {
    pub audio_base64: Option<String>,
    pub transcript: Option<String>,
    pub duration: Option<f64>,
    pub text_tokens: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PersonaPlexTranscriptionResponse {
    pub text: String,
    pub duration: Option<f64>,
}

/// Status of the convo audio capture.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ConvoAudioCaptureStatus {
    pub capturing: bool,
}

// ── PersonaPlex helper manager ──────────────────────────────────────────────

pub struct PersonaPlexHelper {
    app_handle: AppHandle,
    child: Mutex<Option<std::process::Child>>,
}

impl PersonaPlexHelper {
    pub fn new(app_handle: &AppHandle) -> Self {
        Self {
            app_handle: app_handle.clone(),
            child: Mutex::new(None),
        }
    }

    pub fn is_available() -> bool {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            true
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            false
        }
    }

    pub fn base_url() -> String {
        format!("http://127.0.0.1:{}", PERSONAPLEX_PORT)
    }

    pub fn is_running(&self) -> bool {
        let client = match reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(PERSONAPLEX_HEALTH_TIMEOUT_SECS))
            .build()
        {
            Ok(c) => c,
            Err(_) => return false,
        };
        client
            .get(format!("{}/health", Self::base_url()))
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    fn candidate_audio_server_paths(&self) -> Vec<PathBuf> {
        let mut candidates = Vec::new();

        if let Ok(explicit_path) = std::env::var("VOX_JOT_PERSONAPLEX_HELPER") {
            let trimmed = explicit_path.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed));
            }
        }

        if let Ok(app_managed_path) =
            crate::storage_paths::personaplex_helper_path(&self.app_handle)
        {
            candidates.push(app_managed_path);
        }

        for candidate in AUDIO_SERVER_SEARCH_PATHS {
            candidates.push(PathBuf::from(candidate));
        }

        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join("Apps/speech-swift/.build/release/audio-server"));
            candidates.push(
                home.join("Apps/speech-swift/.build/arm64-apple-macosx/release/audio-server"),
            );
            candidates.push(home.join("Apps/speech-swift/.build/debug/audio-server"));
        }

        candidates
    }

    /// Locate the `audio-server` binary from known paths or the user's PATH.
    fn find_audio_server_binary(&self) -> Option<PathBuf> {
        for path in self.candidate_audio_server_paths() {
            if path.exists() {
                return Some(path);
            }
        }

        // Try `which audio-server`
        if let Ok(output) = std::process::Command::new("which")
            .arg("audio-server")
            .output()
        {
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path_str.is_empty() {
                    let path = PathBuf::from(&path_str);
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }
        None
    }

    /// Start the speech-swift audio-server if not already running.
    pub fn ensure_running(&self) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }

        // Try to auto-start the helper binary
        let binary = self.find_audio_server_binary().ok_or_else(|| {
            let mut searched = self
                .candidate_audio_server_paths()
                .into_iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>();
            searched.push("$PATH (via `which audio-server`)".to_string());
            format!(
                "PersonaPlex helper binary (audio-server) not found. Set VOX_JOT_PERSONAPLEX_HELPER \
                 to the built helper binary, or install/build speech-swift so one of these paths exists: {}",
                searched.join(", ")
            )
        })?;

        info!(
            "Starting PersonaPlex audio-server from: {}",
            binary.display()
        );

        let mut child = std::process::Command::new(&binary)
            .arg("--port")
            .arg(PERSONAPLEX_PORT.to_string())
            .env("PERSONAPLEX_MODEL_ID", "aufklarer/PersonaPlex-7B-MLX-8bit")
            .env(
                "QWEN3_CACHE_DIR",
                crate::storage_paths::qwen3_cache_dir(&self.app_handle)
                    .unwrap_or_else(|_| PathBuf::from(".")),
            )
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start audio-server: {}", e))?;

        // Drain stderr continuously so the server can never block on a full
        // pipe buffer once model loading / serving logs exceed ~64KB.
        let _stderr_tail = child
            .stderr
            .take()
            .map(|stderr| crate::utils::drain_child_stderr("personaplex", stderr))
            .unwrap_or_default();

        {
            let mut child_guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
            *child_guard = Some(child);
        }

        // Wait for the server to become healthy (up to 30 seconds for model loading)
        let max_attempts = 60;
        for attempt in 1..=max_attempts {
            std::thread::sleep(Duration::from_millis(500));
            if self.is_running() {
                info!(
                    "PersonaPlex audio-server is healthy after {} attempts",
                    attempt
                );
                return Ok(());
            }
            // Check if the child process died
            let mut child_guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(ref mut child) = *child_guard {
                if let Ok(Some(status)) = child.try_wait() {
                    let stderr = crate::utils::child_stderr_tail_snapshot(&_stderr_tail, 1000);
                    child_guard.take();
                    return Err(format!(
                        "audio-server exited with {}: {}",
                        status,
                        stderr.trim()
                    ));
                }
            }
        }

        warn!("PersonaPlex audio-server did not become healthy within timeout");
        Err("audio-server started but did not become healthy within 30 seconds.".to_string())
    }

    /// Send a WAV audio buffer to the PersonaPlex `/respond` endpoint.
    pub async fn send_audio_turn(
        &self,
        wav_bytes: Vec<u8>,
        voice: &str,
    ) -> Result<PersonaPlexResponse, String> {
        self.ensure_running()?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(PERSONAPLEX_RESPOND_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let request_payload = serde_json::json!({
            "audio_base64": base64::engine::general_purpose::STANDARD.encode(wav_bytes),
            "voice": voice,
            "max_steps": 200,
            "format": "json"
        });

        let resp = client
            .post(format!("{}/respond", Self::base_url()))
            .json(&request_payload)
            .send()
            .await
            .map_err(|e| format!("PersonaPlex request failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let error_text = resp
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!(
                "PersonaPlex returned status {}: {}",
                status, error_text
            ));
        }

        resp.json::<PersonaPlexResponse>()
            .await
            .map_err(|e| format!("Failed to parse PersonaPlex response: {}", e))
    }

    pub async fn transcribe_audio(
        &self,
        wav_bytes: Vec<u8>,
    ) -> Result<PersonaPlexTranscriptionResponse, String> {
        self.ensure_running()?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let resp = client
            .post(format!("{}/transcribe", Self::base_url()))
            .header("Content-Type", "audio/wav")
            .body(wav_bytes)
            .send()
            .await
            .map_err(|e| format!("Transcription request failed: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let error_text = resp
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!(
                "Transcription returned status {}: {}",
                status, error_text
            ));
        }

        resp.json::<PersonaPlexTranscriptionResponse>()
            .await
            .map_err(|e| format!("Failed to parse transcription response: {}", e))
    }

    pub fn stop(&self) {
        let mut child_guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut child) = child_guard.take() {
            info!("Stopping PersonaPlex audio-server");
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for PersonaPlexHelper {
    fn drop(&mut self) {
        self.stop();
    }
}

// ── Convo audio capture ─────────────────────────────────────────────────────
//
// A lightweight push-to-talk recorder separate from the main AudioRecordingManager.
// Uses a dedicated worker thread so cpal::Stream (which is !Send) never crosses
// thread boundaries.

enum CaptureCmd {
    Stop(std::sync::mpsc::Sender<CaptureResult>),
}

type CaptureResult = Result<(Vec<f32>, u32), String>;

pub struct ConvoAudioCapture {
    capturing: Mutex<bool>,
    cmd_tx: Mutex<Option<std::sync::mpsc::Sender<CaptureCmd>>>,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}

// Every field is a Mutex over a Send type — the `!Send` cpal::Stream lives
// entirely on the worker thread and is never stored here — so Send + Sync are
// derived automatically. Asserting them keeps that a compile error rather than a
// silent regression if a non-Send field is ever added.
const _: fn() = || {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<ConvoAudioCapture>();
};

impl ConvoAudioCapture {
    pub fn new() -> Self {
        Self {
            capturing: Mutex::new(false),
            cmd_tx: Mutex::new(None),
            worker: Mutex::new(None),
        }
    }

    /// Start capturing audio from the default input device.
    pub fn start(&self) -> Result<(), String> {
        let mut capturing = self.capturing.lock().unwrap_or_else(|e| e.into_inner());
        if *capturing {
            return Err("Already capturing".to_string());
        }

        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<CaptureCmd>();
        let (init_tx, init_rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);

        let worker = std::thread::spawn(move || {
            use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

            let init_result =
                (|| -> Result<(cpal::Stream, std::sync::Arc<Mutex<Vec<f32>>>, u32), String> {
                    let host = crate::audio_toolkit::get_cpal_host();
                    let device = host
                        .default_input_device()
                        .ok_or("No input device available")?;

                    let config = device
                        .default_input_config()
                        .map_err(|e| format!("Failed to get input config: {}", e))?;

                    let sample_rate = config.sample_rate().0;
                    let channels = config.channels() as usize;
                    let sample_format = config.sample_format();
                    let stream_config: cpal::StreamConfig = config.clone().into();

                    let buffer = std::sync::Arc::new(Mutex::new(Vec::<f32>::new()));
                    let buffer_clone = buffer.clone();

                    let stream = match sample_format {
                        cpal::SampleFormat::F32 => {
                            let buffer = buffer_clone.clone();
                            device.build_input_stream(
                                &stream_config,
                                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                                    push_mono_samples(data, channels, &buffer, |value| value);
                                },
                                |err| {
                                    error!("Convo audio capture error: {}", err);
                                },
                                None,
                            )
                        }
                        cpal::SampleFormat::I16 => {
                            let buffer = buffer_clone.clone();
                            device.build_input_stream(
                                &stream_config,
                                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                                    push_mono_samples(data, channels, &buffer, |value| {
                                        value as f32 / i16::MAX as f32
                                    });
                                },
                                |err| {
                                    error!("Convo audio capture error: {}", err);
                                },
                                None,
                            )
                        }
                        cpal::SampleFormat::U16 => {
                            let buffer = buffer_clone.clone();
                            device.build_input_stream(
                                &stream_config,
                                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                                    push_mono_samples(data, channels, &buffer, |value| {
                                        (value as f32 / u16::MAX as f32) * 2.0 - 1.0
                                    });
                                },
                                |err| {
                                    error!("Convo audio capture error: {}", err);
                                },
                                None,
                            )
                        }
                        other => {
                            return Err(format!("Unsupported input sample format: {:?}", other));
                        }
                    }
                    .map_err(|e| format!("Failed to build input stream: {}", e))?;

                    stream
                        .play()
                        .map_err(|e| format!("Failed to start capture: {}", e))?;

                    debug!(
                        "Convo audio capture started ({}Hz, {} ch)",
                        sample_rate, channels
                    );
                    Ok((stream, buffer, sample_rate))
                })();

            match init_result {
                Ok((_stream, buffer, sample_rate)) => {
                    let _ = init_tx.send(Ok(()));
                    // Keep stream alive, wait for stop command
                    if let Ok(CaptureCmd::Stop(reply)) = cmd_rx.recv() {
                        let samples = {
                            let buf = buffer.lock().unwrap_or_else(|e| e.into_inner());
                            buf.clone()
                        };
                        let _ = reply.send(Ok((samples, sample_rate)));
                    }
                    // stream is dropped here, stopping the capture
                }
                Err(e) => {
                    let _ = init_tx.send(Err(e));
                }
            }
        });

        // Wait for initialization
        match init_rx.recv() {
            Ok(Ok(())) => {
                *self.cmd_tx.lock().unwrap_or_else(|e| e.into_inner()) = Some(cmd_tx);
                *self.worker.lock().unwrap_or_else(|e| e.into_inner()) = Some(worker);
                *capturing = true;
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = worker.join();
                Err(e)
            }
            Err(e) => {
                let _ = worker.join();
                Err(format!("Worker init failed: {}", e))
            }
        }
    }

    /// Stop capturing and return the collected samples as a 16kHz mono WAV byte buffer.
    pub fn stop(&self) -> Result<Vec<u8>, String> {
        let mut capturing = self.capturing.lock().unwrap_or_else(|e| e.into_inner());
        if !*capturing {
            return Err("Not capturing".to_string());
        }

        let cmd_tx = self
            .cmd_tx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
            .ok_or("No command channel")?;

        let (reply_tx, reply_rx) = std::sync::mpsc::channel();
        cmd_tx
            .send(CaptureCmd::Stop(reply_tx))
            .map_err(|_| "Worker thread gone")?;

        let (raw_samples, native_rate) = reply_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Timeout waiting for capture data")?
            .map_err(|e| format!("Capture error: {}", e))?;

        // Join the worker thread
        if let Some(handle) = self.worker.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = handle.join();
        }

        *capturing = false;

        if raw_samples.is_empty() {
            return Err("No audio captured".to_string());
        }

        let samples_16k = if native_rate != 16000 {
            resample_to_16k(&raw_samples, native_rate)
        } else {
            raw_samples
        };

        debug!(
            "Convo audio capture stopped: {} samples at 16kHz ({:.1}s)",
            samples_16k.len(),
            samples_16k.len() as f64 / 16000.0
        );

        encode_wav_in_memory(&samples_16k)
    }

    pub fn is_capturing(&self) -> bool {
        *self.capturing.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Simple linear interpolation resampler from any rate to 16kHz.
fn resample_to_16k(samples: &[f32], source_rate: u32) -> Vec<f32> {
    let ratio = 16000.0 / source_rate as f64;
    let output_len = (samples.len() as f64 * ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_idx = i as f64 / ratio;
        let idx_floor = src_idx.floor() as usize;
        let idx_ceil = (idx_floor + 1).min(samples.len() - 1);
        let frac = (src_idx - idx_floor as f64) as f32;
        let sample = samples[idx_floor] * (1.0 - frac) + samples[idx_ceil] * frac;
        output.push(sample);
    }

    output
}

/// Encode f32 mono 16kHz samples as a WAV byte buffer in memory.
pub fn encode_wav_in_memory(samples: &[f32]) -> Result<Vec<u8>, String> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer =
            WavWriter::new(&mut cursor, spec).map_err(|e| format!("WAV writer error: {}", e))?;
        for &s in samples {
            let sample_i16 = (s * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
            writer
                .write_sample(sample_i16)
                .map_err(|e| format!("WAV write error: {}", e))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("WAV finalize error: {}", e))?;
    }

    Ok(cursor.into_inner())
}

fn push_mono_samples<T, F>(
    data: &[T],
    channels: usize,
    buffer: &std::sync::Arc<Mutex<Vec<f32>>>,
    convert: F,
) where
    T: Copy,
    F: Fn(T) -> f32,
{
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels)
            .map(|frame| frame.iter().copied().map(&convert).sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.iter().copied().map(convert).collect()
    };

    if let Ok(mut buf) = buffer.lock() {
        buf.extend_from_slice(&mono);
    }
}

/// Decode a base64-encoded WAV and play it through the configured output device.
pub fn play_audio_base64(app_handle: &AppHandle, audio_base64: &str) -> Result<(), String> {
    let wav_bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_base64)
        .map_err(|e| format!("Failed to decode audio base64: {}", e))?;

    let settings = crate::settings::get_settings(app_handle);
    let output_device = settings.selected_output_device.clone();
    let volume = settings.tts_volume.clamp(0.0, 1.0);

    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("voxjot_convo_reply_{}.wav", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, &wav_bytes)
        .map_err(|e| format!("Failed to write temp WAV: {}", e))?;

    crate::audio_playback::play_audio_file_blocking(&temp_path, output_device, volume)
        .map_err(|e| format!("Failed to play audio: {}", e))?;

    let _ = std::fs::remove_file(&temp_path);

    Ok(())
}
