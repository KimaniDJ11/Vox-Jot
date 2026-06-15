use crate::audio_toolkit::{apply_custom_words, filter_transcription_output};
use crate::helpers::subtitles::TimedSegment;
use crate::managers::apple_speech::{AppleSpeechEngine, AppleSpeechMode};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::continuous_cloning::ContinuousCloningManager;
use crate::managers::model::{model_is_available, EngineType, ModelInfo, ModelManager};
use crate::settings::{get_settings, AppSettings, ModelUnloadTimeout};
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Cursor;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use transcribe_rs::{
    onnx::{
        gigaam::GigaAMModel,
        moonshine::{MoonshineModel, MoonshineStreamingParams, MoonshineVariant, StreamingModel},
        parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity},
        sense_voice::{SenseVoiceModel, SenseVoiceParams},
        Quantization,
    },
    whisper_cpp::{WhisperEngine, WhisperInferenceParams, WhisperLoadParams},
    SpeechModel, TranscribeOptions, WhisperAccelerator,
};

/// Current Unix time in milliseconds, saturating to 0 if the system clock is
/// set before the epoch. Avoids panicking on clock regressions (NTP glitch,
/// dead RTC battery, VM snapshot rollback) on the transcription hot path.
fn current_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Debug, Serialize)]
pub struct ModelStateEvent {
    pub event_type: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub error: Option<String>,
}

struct MlxAudioSttEngine {
    base_url: String,
    model_source: String,
}

struct GemmaAudioSttEngine {
    base_url: String,
    model_source: String,
    backend: &'static str,
    child: Option<Child>,
    stderr_tail: crate::utils::ChildStderrTail,
}

const MLX_AUDIO_STT_REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
static MLX_AUDIO_STT_AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
    ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(MLX_AUDIO_STT_REQUEST_TIMEOUT))
            .build(),
    )
});
const GEMMA_AUDIO_STT_PORT: u16 = 8028;
const GEMMA_AUDIO_STT_SERVER_SOURCE: &str = include_str!("../../../scripts/gemma4_stt_server.py");
const GEMMA_AUDIO_STT_REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
static GEMMA_AUDIO_STT_CLIENT: LazyLock<reqwest::blocking::Client> = LazyLock::new(|| {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(GEMMA_AUDIO_STT_REQUEST_TIMEOUT)
        .build()
        .expect("failed to build Gemma audio STT client")
});

struct FinalTranscriptionPendingGuard {
    flag: Arc<AtomicBool>,
}

impl Drop for FinalTranscriptionPendingGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Deserialize)]
struct MlxAudioTranscriptionResponse {
    text: String,
}

enum LoadedEngine {
    Whisper(WhisperEngine),
    Parakeet(ParakeetModel),
    Moonshine(MoonshineModel),
    MoonshineStreaming(StreamingModel),
    SenseVoice(SenseVoiceModel),
    GigaAM(GigaAMModel),
    MlxAudioStt(MlxAudioSttEngine),
    GemmaAudioStt(GemmaAudioSttEngine),
    AppleSpeech(AppleSpeechEngine),
    AppleSpeechStreaming(AppleSpeechEngine),
}

#[derive(Clone, Debug)]
struct PartialProviderConfig {
    interval: Duration,
    min_samples: usize,
    min_growth: usize,
    max_samples: Option<usize>,
}

#[derive(Debug)]
struct PartialProviderSession {
    generation: u64,
    binding_id: String,
    cancel: Arc<AtomicBool>,
}

enum PartialTranscriptionOutcome {
    Success(String),
    Error(anyhow::Error),
    Panicked(String),
}

struct ModelLoadGuard {
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
}

impl ModelLoadGuard {
    fn new(is_loading: Arc<Mutex<bool>>, loading_condvar: Arc<Condvar>) -> Self {
        Self {
            is_loading,
            loading_condvar,
        }
    }
}

impl Drop for ModelLoadGuard {
    fn drop(&mut self) {
        let mut is_loading = self
            .is_loading
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *is_loading = false;
        self.loading_condvar.notify_all();
    }
}

impl MlxAudioSttEngine {
    fn transcribe_with_sidecar_recovery(
        &self,
        audio: Vec<f32>,
        sample_rate: u32,
        sidecar: Option<&crate::sidecar::SidecarManager>,
    ) -> Result<transcribe_rs::TranscriptionResult> {
        let wav_bytes = self.encode_wav(audio, sample_rate)?;
        let response_body = match self.send_wav_bytes(&wav_bytes) {
            Ok(body) => body,
            Err(first_err) => {
                if let Some(sidecar) = sidecar {
                    log::warn!(
                        "mlx-audio transcription request failed; ensuring sidecar is running before one retry: {}",
                        first_err
                    );
                    sidecar.ensure_running().map_err(|err| {
                        anyhow::anyhow!(
                            "Failed to restart mlx-audio sidecar after request failure: {err}"
                        )
                    })?;
                    self.send_wav_bytes(&wav_bytes).map_err(|retry_err| {
                        anyhow::anyhow!(
                            "mlx-audio transcription request failed after sidecar restart: {}",
                            retry_err
                        )
                    })?
                } else {
                    return Err(first_err);
                }
            }
        };
        let payload = Self::decode_transcription_response(&response_body)?;

        Ok(transcribe_rs::TranscriptionResult {
            text: payload.text,
            segments: None,
        })
    }

    fn send_wav_bytes(&self, wav_bytes: &[u8]) -> Result<String> {
        let file_part = ureq::unversioned::multipart::Part::bytes(wav_bytes)
            .file_name("vox-jot.wav")
            .mime_str("audio/wav")
            .map_err(|err| anyhow::anyhow!("Failed to prepare mlx-audio upload: {}", err))?;
        let form = ureq::unversioned::multipart::Form::new()
            .text("model", &self.model_source)
            .part("file", file_part);

        let mut response = MLX_AUDIO_STT_AGENT
            .post(&format!(
                "{}/v1/audio/transcriptions",
                self.base_url.trim_end_matches('/')
            ))
            .send(form)
            .map_err(|err| anyhow::anyhow!("mlx-audio transcription request failed: {}", err))?;
        let response_body = response
            .body_mut()
            .read_to_string()
            .map_err(|err| anyhow::anyhow!("Failed to read mlx-audio response: {}", err))?;
        Ok(response_body)
    }

    fn decode_transcription_response(body: &str) -> Result<MlxAudioTranscriptionResponse> {
        if let Ok(payload) = serde_json::from_str::<MlxAudioTranscriptionResponse>(body) {
            return Ok(payload);
        }

        let mut final_text = String::new();
        let mut accumulated_text = String::new();

        for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
            let value: Value = serde_json::from_str(line).map_err(|err| {
                anyhow::anyhow!("Failed to decode mlx-audio NDJSON response line: {}", err)
            })?;

            if let Some(accumulated) = value.get("accumulated").and_then(Value::as_str) {
                accumulated_text = accumulated.to_string();
                continue;
            }

            if let Some(text) = value.get("text").and_then(Value::as_str) {
                final_text.push_str(text);
                continue;
            }

            if let Some(text) = value.as_str() {
                final_text.push_str(text);
            }
        }

        let text = if accumulated_text.is_empty() {
            final_text
        } else {
            accumulated_text
        };

        Ok(MlxAudioTranscriptionResponse { text })
    }

    fn encode_wav(&self, audio: Vec<f32>, sample_rate: u32) -> Result<Vec<u8>> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec)
                .map_err(|err| anyhow::anyhow!("Failed to create WAV encoder: {}", err))?;
            for sample in audio {
                let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
                writer
                    .write_sample(value)
                    .map_err(|err| anyhow::anyhow!("Failed to encode WAV sample: {}", err))?;
            }
            writer
                .finalize()
                .map_err(|err| anyhow::anyhow!("Failed to finalize WAV output: {}", err))?;
        }
        Ok(cursor.into_inner())
    }
}

impl Drop for GemmaAudioSttEngine {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl GemmaAudioSttEngine {
    fn transcribe(
        &self,
        audio: Vec<f32>,
        sample_rate: u32,
    ) -> Result<transcribe_rs::TranscriptionResult> {
        let wav_bytes = encode_wav_bytes(audio, sample_rate)?;
        let response = GEMMA_AUDIO_STT_CLIENT
            .post(format!(
                "{}/v1/audio/transcriptions",
                self.base_url.trim_end_matches('/')
            ))
            .json(&serde_json::json!({
                "model": self.model_source,
                "audio_base64": BASE64_STANDARD.encode(wav_bytes),
            }))
            .send()
            .map_err(|err| anyhow::anyhow!("Gemma audio transcription request failed: {err}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Gemma audio transcription request failed with HTTP {status}: {body}"
            ));
        }
        let payload: MlxAudioTranscriptionResponse = response
            .json()
            .map_err(|err| anyhow::anyhow!("Failed to decode Gemma audio response: {err}"))?;
        Ok(transcribe_rs::TranscriptionResult {
            text: payload.text,
            segments: None,
        })
    }

    fn start(
        app_handle: &AppHandle,
        python: &Path,
        model_source: String,
        backend: &'static str,
        token: Option<String>,
    ) -> Result<Self> {
        let base_url = gemma_audio_base_url();
        if gemma_audio_server_matches(&base_url, &model_source, backend) {
            return Ok(Self {
                base_url,
                model_source,
                backend,
                child: None,
                stderr_tail: crate::utils::ChildStderrTail::default(),
            });
        }

        terminate_listeners_on_port(app_handle, GEMMA_AUDIO_STT_PORT)?;
        let server_path = gemma_audio_stt_server_path(app_handle)?;
        let mut command = Command::new(python);
        command
            .arg(&server_path)
            .arg("--model")
            .arg(&model_source)
            .arg("--backend")
            .arg(backend)
            .arg("--port")
            .arg(GEMMA_AUDIO_STT_PORT.to_string())
            .env("PYTHONUNBUFFERED", "1")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped());
        if let Some(token) = token {
            command.env("HF_TOKEN", token);
        }

        let mut child = command
            .spawn()
            .map_err(|err| anyhow::anyhow!("Failed to start Gemma audio sidecar: {err}"))?;
        // Drain stderr continuously: transformers/MLX warnings and download
        // progress would otherwise fill the pipe buffer and freeze the server.
        let stderr_tail = child
            .stderr
            .take()
            .map(|stderr| crate::utils::drain_child_stderr("gemma-stt", stderr))
            .unwrap_or_default();
        let mut engine = Self {
            base_url,
            model_source,
            backend,
            child: Some(child),
            stderr_tail,
        };
        engine.wait_until_ready()?;
        Ok(engine)
    }

    fn wait_until_ready(&mut self) -> Result<()> {
        for _ in 0..600 {
            if gemma_audio_server_matches(&self.base_url, &self.model_source, self.backend) {
                return Ok(());
            }
            if let Some(child) = self.child.as_mut() {
                if let Some(status) = child.try_wait()? {
                    let stderr = crate::utils::child_stderr_tail_snapshot(&self.stderr_tail, 1000);
                    return Err(anyhow::anyhow!(
                        "Gemma audio sidecar exited with {status}. Stderr: {stderr}"
                    ));
                }
            }
            thread::sleep(Duration::from_millis(500));
        }
        Err(anyhow::anyhow!(
            "Gemma audio sidecar did not become ready within 300 seconds."
        ))
    }
}

fn encode_wav_bytes(audio: Vec<f32>, sample_rate: u32) -> Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|err| anyhow::anyhow!("Failed to create WAV encoder: {}", err))?;
        for sample in audio {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            writer
                .write_sample(value)
                .map_err(|err| anyhow::anyhow!("Failed to encode WAV sample: {}", err))?;
        }
        writer
            .finalize()
            .map_err(|err| anyhow::anyhow!("Failed to finalize WAV output: {}", err))?;
    }
    Ok(cursor.into_inner())
}

fn gemma_audio_base_url() -> String {
    format!("http://127.0.0.1:{GEMMA_AUDIO_STT_PORT}")
}

fn gemma_audio_stt_server_path(app_handle: &AppHandle) -> Result<PathBuf> {
    if let Ok(path) = std::env::var("VOX_JOT_GEMMA4_STT_SERVER") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
    }

    let runtime_dir = crate::portable::app_data_dir(app_handle)
        .map_err(|err| anyhow::anyhow!("Failed to resolve app data dir for Gemma STT: {err}"))?
        .join("gemma4-stt-runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|err| anyhow::anyhow!("Failed to create Gemma STT runtime dir: {err}"))?;
    let server = runtime_dir.join("gemma4_stt_server.py");
    let should_write = fs::read_to_string(&server)
        .map(|existing| existing != GEMMA_AUDIO_STT_SERVER_SOURCE)
        .unwrap_or(true);
    if should_write {
        fs::write(&server, GEMMA_AUDIO_STT_SERVER_SOURCE)
            .map_err(|err| anyhow::anyhow!("Failed to write Gemma STT server: {err}"))?;
    }
    Ok(server)
}

fn gemma_audio_server_matches(base_url: &str, model_source: &str, backend: &str) -> bool {
    let Ok(response) = GEMMA_AUDIO_STT_CLIENT
        .get(format!("{}/health", base_url.trim_end_matches('/')))
        .send()
    else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    let Ok(value) = response.json::<Value>() else {
        return false;
    };
    let model_matches = value
        .get("model")
        .and_then(Value::as_str)
        .is_some_and(|model| model == model_source);
    let backend_matches = value
        .get("backend")
        .and_then(Value::as_str)
        .is_some_and(|reported_backend| reported_backend == backend);
    model_matches && backend_matches
}

fn gemma_audio_backend_for_model(model_id: &str) -> &'static str {
    match model_id {
        "gemma4-e2b-audio-mlx" => "mlx-vlm",
        _ => "transformers",
    }
}

fn listener_pids_on_port(port: u16) -> Vec<u32> {
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("lsof")
            .args(["-t", "-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
            .output();
        if let Ok(output) = output {
            return String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|line| line.trim().parse::<u32>().ok())
                .collect();
        }
    }
    Vec::new()
}

fn terminate_listeners_on_port(app_handle: &AppHandle, port: u16) -> Result<()> {
    let app_data_dir = crate::portable::app_data_dir(app_handle)
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_default();

    for pid in listener_pids_on_port(port) {
        // Only reclaim the port from our own (orphaned) Gemma runtime. The
        // port is in the common developer range, so anything we cannot
        // positively identify as ours must be left alone — killing it could
        // destroy a user's unrelated process.
        let command_line = crate::sidecar::process_command_line(pid);
        let is_ours = command_line
            .as_deref()
            .map(|line| crate::sidecar::command_line_is_vox_jot_runtime(line, &app_data_dir))
            .unwrap_or(false);
        if !is_ours {
            if !listener_pids_on_port(port).contains(&pid) {
                continue; // exited between enumeration and inspection
            }
            let mut shown = command_line.unwrap_or_else(|| "unknown process".to_string());
            if shown.chars().count() > 120 {
                shown = shown.chars().take(120).collect::<String>() + "…";
            }
            return Err(anyhow::anyhow!(
                "Port {port} is in use by another application (pid {pid}: {shown}). Quit that application and try loading the Gemma model again."
            ));
        }

        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|err| anyhow::anyhow!("Failed to stop Gemma sidecar process {pid}: {err}"))?;
        if !status.success() {
            return Err(anyhow::anyhow!(
                "Failed to stop existing Gemma sidecar process {pid}."
            ));
        }
    }
    for _ in 0..20 {
        if listener_pids_on_port(port).is_empty() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    // Escalate only for pids verified above as our own runtime.
    let escalation_app_data_dir = app_data_dir;
    for pid in listener_pids_on_port(port) {
        let is_ours = crate::sidecar::process_command_line(pid)
            .as_deref()
            .map(|line| {
                crate::sidecar::command_line_is_vox_jot_runtime(line, &escalation_app_data_dir)
            })
            .unwrap_or(false);
        if is_ours {
            let _ = Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .status();
        }
    }
    Ok(())
}

fn mlx_audio_stt_model_ref(model_id: &str) -> Option<&'static str> {
    if let Some(repo_id) = crate::shared_model_assets::shared_model_repo_id(model_id) {
        return Some(repo_id);
    }

    match model_id {
        "mlx-whisper-large-v3-turbo" => Some("mlx-community/whisper-large-v3-turbo-asr-fp16"),
        "mlx-distil-whisper-large-v3" => Some("distil-whisper/distil-large-v3"),
        "mlx-parakeet-v3" => Some("mlx-community/parakeet-tdt-0.6b-v3"),
        "mlx-parakeet-tdt-ctc-110m" => Some("mlx-community/parakeet-tdt_ctc-110m"),
        "mlx-parakeet-tdt-1.1b" => Some("mlx-community/parakeet-tdt-1.1b"),
        "mlx-parakeet-tdt-ctc-0.6b-ja" => Some("mlx-community/parakeet-tdt_ctc-0.6b-ja"),
        "mlx-voxtral-mini-3b" => Some("mlx-community/Voxtral-Mini-3B-2507-bf16"),
        "mlx-voxtral-mini-4b-realtime" => Some("mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit"),
        _ => None,
    }
}

fn mlx_audio_base_url() -> String {
    "http://127.0.0.1:8018".to_string()
}

fn mlx_audio_stt_model_dir_is_runnable(path: &std::path::Path) -> bool {
    path.join("config.json").is_file()
}

fn partial_provider_config_for_model(model_id: &str) -> PartialProviderConfig {
    let lower = model_id.to_ascii_lowercase();

    if lower.contains("moonshine") && lower.contains("stream") {
        return PartialProviderConfig {
            interval: Duration::from_millis(450),
            min_samples: 8_000,
            min_growth: 2_400,
            max_samples: Some(192_000),
        };
    }
    if lower.contains("moonshine") {
        return PartialProviderConfig {
            interval: Duration::from_millis(650),
            min_samples: 12_000,
            min_growth: 3_200,
            max_samples: Some(96_000),
        };
    }
    if lower.contains("whisper") {
        return PartialProviderConfig {
            interval: Duration::from_millis(1_200),
            min_samples: 20_000,
            min_growth: 6_400,
            max_samples: Some(128_000),
        };
    }
    if lower.contains("parakeet") {
        return PartialProviderConfig {
            interval: Duration::from_millis(900),
            min_samples: 16_000,
            min_growth: 4_800,
            max_samples: Some(112_000),
        };
    }

    PartialProviderConfig {
        interval: Duration::from_millis(900),
        min_samples: 16_000,
        min_growth: 4_800,
        max_samples: Some(96_000),
    }
}

fn supports_live_partial_provider(model_info: &ModelInfo) -> bool {
    !matches!(
        model_info.engine_type,
        EngineType::MlxAudioStt | EngineType::GemmaAudioStt
    )
}

fn whisper_gpu_available() -> bool {
    WhisperAccelerator::available()
        .into_iter()
        .any(|accelerator| accelerator == WhisperAccelerator::Gpu)
}

#[cfg(target_os = "macos")]
fn is_metal_backend_load_failure(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    [
        "metal",
        "ggml_metal",
        "backend_metal",
        "mtl",
        "gpu device",
        "shader",
    ]
    .iter()
    .any(|token| lower.contains(token))
}

#[cfg(not(target_os = "macos"))]
fn is_metal_backend_load_failure(_error: &str) -> bool {
    false
}

pub struct TranscriptionManager {
    engine: Arc<Mutex<Option<LoadedEngine>>>,
    /// Bumped whenever `load_model`/`unload_model` install or clear the
    /// engine. Partial workers capture it when they take the engine out and
    /// drop a stale engine instead of restoring it when it has advanced —
    /// otherwise a put-back after `unload_model` silently resurrects the
    /// model that the user (or the idle watcher) just unloaded.
    engine_epoch: Arc<AtomicU64>,
    transcribe_lock: Arc<Mutex<()>>,
    lifecycle_lock: Arc<Mutex<()>>,
    model_manager: Arc<ModelManager>,
    app_handle: AppHandle,
    current_model_id: Arc<Mutex<Option<String>>>,
    last_activity: Arc<AtomicU64>,
    shutdown_signal: Arc<AtomicBool>,
    shutdown_started: Arc<AtomicBool>,
    watcher_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    is_loading: Arc<Mutex<bool>>,
    loading_condvar: Arc<Condvar>,
    partial_session: Arc<Mutex<Option<PartialProviderSession>>>,
    partial_generation: Arc<AtomicU64>,
    processing_generation: Arc<AtomicU64>,
    canceled_processing_generation: Arc<AtomicU64>,
    final_transcription_pending: Arc<AtomicBool>,
    shutdown_on_drop: bool,
}

impl Clone for TranscriptionManager {
    fn clone(&self) -> Self {
        Self {
            engine: Arc::clone(&self.engine),
            engine_epoch: Arc::clone(&self.engine_epoch),
            transcribe_lock: Arc::clone(&self.transcribe_lock),
            lifecycle_lock: Arc::clone(&self.lifecycle_lock),
            model_manager: Arc::clone(&self.model_manager),
            app_handle: self.app_handle.clone(),
            current_model_id: Arc::clone(&self.current_model_id),
            last_activity: Arc::clone(&self.last_activity),
            shutdown_signal: Arc::clone(&self.shutdown_signal),
            shutdown_started: Arc::clone(&self.shutdown_started),
            watcher_handle: Arc::clone(&self.watcher_handle),
            is_loading: Arc::clone(&self.is_loading),
            loading_condvar: Arc::clone(&self.loading_condvar),
            partial_session: Arc::clone(&self.partial_session),
            partial_generation: Arc::clone(&self.partial_generation),
            processing_generation: Arc::clone(&self.processing_generation),
            canceled_processing_generation: Arc::clone(&self.canceled_processing_generation),
            final_transcription_pending: Arc::clone(&self.final_transcription_pending),
            shutdown_on_drop: false,
        }
    }
}

impl TranscriptionManager {
    pub fn new(app_handle: &AppHandle, model_manager: Arc<ModelManager>) -> Result<Self> {
        let manager = Self {
            engine: Arc::new(Mutex::new(None)),
            engine_epoch: Arc::new(AtomicU64::new(0)),
            transcribe_lock: Arc::new(Mutex::new(())),
            lifecycle_lock: Arc::new(Mutex::new(())),
            model_manager,
            app_handle: app_handle.clone(),
            current_model_id: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(AtomicU64::new(current_unix_millis())),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
            shutdown_started: Arc::new(AtomicBool::new(false)),
            watcher_handle: Arc::new(Mutex::new(None)),
            is_loading: Arc::new(Mutex::new(false)),
            loading_condvar: Arc::new(Condvar::new()),
            partial_session: Arc::new(Mutex::new(None)),
            partial_generation: Arc::new(AtomicU64::new(0)),
            processing_generation: Arc::new(AtomicU64::new(0)),
            canceled_processing_generation: Arc::new(AtomicU64::new(0)),
            final_transcription_pending: Arc::new(AtomicBool::new(false)),
            shutdown_on_drop: true,
        };

        // Start the idle watcher
        {
            let app_handle_cloned = app_handle.clone();
            let manager_cloned = manager.clone();
            let shutdown_signal = manager.shutdown_signal.clone();
            let handle = thread::spawn(move || {
                while !shutdown_signal.load(Ordering::Relaxed) {
                    // Sleep ~10s between checks, but wake every 100ms to observe the
                    // shutdown signal so `join()` on quit returns promptly instead of
                    // blocking for up to a full interval.
                    for _ in 0..100 {
                        if shutdown_signal.load(Ordering::Relaxed) {
                            break;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }

                    // Check shutdown signal again after sleep
                    if shutdown_signal.load(Ordering::Relaxed) {
                        break;
                    }

                    let settings = get_settings(&app_handle_cloned);
                    let timeout_seconds = settings.model_unload_timeout.to_seconds();

                    if let Some(limit_seconds) = timeout_seconds {
                        // Skip polling-based unloading for immediate timeout since it's handled directly in transcribe()
                        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately {
                            continue;
                        }

                        let last = manager_cloned.last_activity.load(Ordering::Relaxed);
                        let now_ms = current_unix_millis();

                        if now_ms.saturating_sub(last) > limit_seconds * 1000 {
                            // idle -> unload
                            if manager_cloned.is_model_loaded() {
                                let unload_start = std::time::Instant::now();
                                debug!("Starting to unload model due to inactivity");

                                if let Ok(()) = manager_cloned.unload_model() {
                                    let _ = app_handle_cloned.emit(
                                        "model-state-changed",
                                        ModelStateEvent {
                                            event_type: "unloaded".to_string(),
                                            model_id: None,
                                            model_name: None,
                                            error: None,
                                        },
                                    );
                                    let unload_duration = unload_start.elapsed();
                                    debug!(
                                        "Model unloaded due to inactivity (took {}ms)",
                                        unload_duration.as_millis()
                                    );
                                }
                            }
                        }
                    }
                }
                debug!("Idle watcher thread shutting down gracefully");
            });
            *manager
                .watcher_handle
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(handle);
        }

        Ok(manager)
    }

    /// Lock the engine mutex, recovering from poison if a previous transcription panicked.
    fn lock_engine(&self) -> MutexGuard<'_, Option<LoadedEngine>> {
        self.engine.lock().unwrap_or_else(|poisoned| {
            warn!("Engine mutex was poisoned by a previous panic, recovering");
            poisoned.into_inner()
        })
    }

    fn lock_lifecycle(&self) -> MutexGuard<'_, ()> {
        self.lifecycle_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn next_partial_generation(&self) -> u64 {
        self.partial_generation.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn partial_generation_is_current(&self, generation: u64) -> bool {
        self.partial_generation.load(Ordering::Relaxed) == generation
    }

    pub fn begin_processing_run(&self) -> u64 {
        self.processing_generation.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn cancel_active_processing(&self) {
        let active_generation = self.processing_generation.load(Ordering::Relaxed);
        self.canceled_processing_generation
            .store(active_generation, Ordering::Relaxed);
    }

    pub fn is_processing_cancelled(&self, generation: u64) -> bool {
        self.canceled_processing_generation.load(Ordering::Relaxed) >= generation
    }

    /// Release long-lived transcription resources before native runtime
    /// finalizers run during application quit.
    pub fn shutdown(&self) {
        if self.shutdown_started.swap(true, Ordering::SeqCst) {
            return;
        }

        self.shutdown_signal.store(true, Ordering::Relaxed);
        self.cancel_active_processing();
        self.stop_partial_session_internal();

        {
            let mut engine = self.lock_engine();
            *engine = None;
        }
        {
            let mut current_model = self
                .current_model_id
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *current_model = None;
        }

        let watcher_handle = self
            .watcher_handle
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();

        if let Some(handle) = watcher_handle {
            if handle.thread().id() == thread::current().id() {
                return;
            }
            if let Err(e) = handle.join() {
                warn!("Failed to join idle watcher thread: {:?}", e);
            } else {
                debug!("Idle watcher thread joined successfully");
            }
        }
    }

    fn stop_partial_session_internal(&self) {
        if let Some(session) = self
            .partial_session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            debug!(
                "Stopping partial transcription session {} for binding {}",
                session.generation, session.binding_id
            );
            session.cancel.store(true, Ordering::Relaxed);
        }
        self.next_partial_generation();
    }

    /// Return an engine a partial worker took out of the shared slot.
    ///
    /// Partial inference runs without the lifecycle lock, so `load_model` or
    /// `unload_model` on another thread may have replaced or cleared the
    /// engine while the worker held the old one. The engine epoch captured at
    /// take time detects both: restoring a stale engine would either clobber
    /// a freshly loaded replacement or silently resurrect a model the user
    /// (or the idle watcher) just unloaded.
    fn restore_partial_engine(&self, engine: LoadedEngine, taken_at_epoch: u64) {
        if self.engine_epoch.load(Ordering::SeqCst) != taken_at_epoch {
            debug!(
                "Discarding stale engine after partial inference; the engine was replaced or unloaded mid-flight"
            );
            return;
        }
        let mut engine_guard = self.lock_engine();
        if engine_guard.is_none() {
            *engine_guard = Some(engine);
            return;
        }
        drop(engine_guard);
        debug!(
            "Discarding stale engine after partial inference; a replacement was loaded mid-flight"
        );
        // `engine` drops here, after the lock is released.
    }

    fn create_loaded_engine(
        &self,
        model_id: &str,
        model_info: &ModelInfo,
        emit_state_events: bool,
    ) -> Result<LoadedEngine> {
        let emit_loading_failure = |error_msg: String| {
            if emit_state_events {
                let _ = self.app_handle.emit(
                    "model-state-changed",
                    ModelStateEvent {
                        event_type: "loading_failed".to_string(),
                        model_id: Some(model_id.to_string()),
                        model_name: Some(model_info.name.clone()),
                        error: Some(error_msg.clone()),
                    },
                );
            }
            anyhow::anyhow!(error_msg)
        };

        let loaded_engine = match model_info.engine_type {
            EngineType::Whisper => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let params = WhisperLoadParams {
                    use_gpu: whisper_gpu_available(),
                    ..Default::default()
                };
                let engine = match WhisperEngine::load_with_params(&model_path, params.clone()) {
                    Ok(engine) => engine,
                    Err(err)
                        if params.use_gpu && is_metal_backend_load_failure(&err.to_string()) =>
                    {
                        warn!(
                            "Whisper Metal load failed for '{}', retrying on CPU: {}",
                            model_id, err
                        );
                        WhisperEngine::load_with_params(
                            &model_path,
                            WhisperLoadParams {
                                use_gpu: false,
                                ..params
                            },
                        )
                        .map_err(|cpu_err| {
                            emit_loading_failure(format!(
                                "Failed to load whisper model {} with Metal ({}), then CPU fallback also failed: {}",
                                model_id, err, cpu_err
                            ))
                        })?
                    }
                    Err(err) => {
                        return Err(emit_loading_failure(format!(
                            "Failed to load whisper model {}: {}",
                            model_id, err
                        )));
                    }
                };
                LoadedEngine::Whisper(engine)
            }
            EngineType::Parakeet => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let engine =
                    ParakeetModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                        emit_loading_failure(format!(
                            "Failed to load parakeet model {}: {}",
                            model_id, e
                        ))
                    })?;
                LoadedEngine::Parakeet(engine)
            }
            EngineType::Moonshine => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let engine =
                    MoonshineModel::load(&model_path, MoonshineVariant::Base, &Quantization::FP32)
                        .map_err(|e| {
                            emit_loading_failure(format!(
                                "Failed to load moonshine model {}: {}",
                                model_id, e
                            ))
                        })?;
                LoadedEngine::Moonshine(engine)
            }
            EngineType::MoonshineStreaming => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let engine =
                    StreamingModel::load(&model_path, 1, &Quantization::FP32).map_err(|e| {
                        emit_loading_failure(format!(
                            "Failed to load moonshine streaming model {}: {}",
                            model_id, e
                        ))
                    })?;
                LoadedEngine::MoonshineStreaming(engine)
            }
            EngineType::SenseVoice => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let engine =
                    SenseVoiceModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                        emit_loading_failure(format!(
                            "Failed to load SenseVoice model {}: {}",
                            model_id, e
                        ))
                    })?;
                LoadedEngine::SenseVoice(engine)
            }
            EngineType::GigaAM => {
                let model_path = self.model_manager.get_model_path(model_id)?;
                let engine = GigaAMModel::load(&model_path, &Quantization::Int8).map_err(|e| {
                    emit_loading_failure(format!("Failed to load gigaam model {}: {}", model_id, e))
                })?;
                LoadedEngine::GigaAM(engine)
            }
            EngineType::MlxAudioStt => {
                let sidecar = self
                    .app_handle
                    .try_state::<Arc<crate::sidecar::SidecarManager>>()
                    .ok_or_else(|| anyhow::anyhow!("SidecarManager is not available."))?;
                sidecar
                    .ensure_running()
                    .map_err(|err| anyhow::anyhow!(err))?;
                let model_source = self
                    .model_manager
                    .get_model_path(model_id)
                    .ok()
                    .filter(|path| mlx_audio_stt_model_dir_is_runnable(path))
                    .map(|path| path.to_string_lossy().to_string())
                    .or_else(|| mlx_audio_stt_model_ref(model_id).map(str::to_string))
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "No runnable mlx-audio model mapping found for {}",
                            model_id
                        )
                    })?;
                LoadedEngine::MlxAudioStt(MlxAudioSttEngine {
                    base_url: mlx_audio_base_url(),
                    model_source,
                })
            }
            EngineType::GemmaAudioStt => {
                let sidecar = self
                    .app_handle
                    .try_state::<Arc<crate::sidecar::SidecarManager>>()
                    .ok_or_else(|| anyhow::anyhow!("SidecarManager is not available."))?;
                let python = sidecar
                    .ensure_gemma_audio_environment()
                    .map_err(|err| anyhow::anyhow!(err))?;
                let model_source = self
                    .model_manager
                    .get_model_path(model_id)?
                    .to_string_lossy()
                    .to_string();
                let backend = gemma_audio_backend_for_model(model_id);
                LoadedEngine::GemmaAudioStt(GemmaAudioSttEngine::start(
                    &self.app_handle,
                    &python,
                    model_source,
                    backend,
                    crate::speech_analysis::hugging_face_token_for_runtime(),
                )?)
            }
            EngineType::AppleSpeech => {
                LoadedEngine::AppleSpeech(AppleSpeechEngine::new(AppleSpeechMode::Offline)?)
            }
            EngineType::AppleSpeechStreaming => LoadedEngine::AppleSpeechStreaming(
                AppleSpeechEngine::new(AppleSpeechMode::Progressive)?,
            ),
        };

        Ok(loaded_engine)
    }

    /// Run the engine and return ONLY the final post-processed text.
    ///
    /// This is the dictation hot path — it must stay free of any extra
    /// allocations (e.g. segments) so per-recording latency does not change.
    /// File transcription that needs SRT/WebVTT calls
    /// `transcribe_with_loaded_engine_segments` instead.
    fn transcribe_with_loaded_engine(
        &self,
        engine: &mut LoadedEngine,
        audio: Vec<f32>,
        settings: &AppSettings,
    ) -> Result<String> {
        self.transcribe_with_loaded_engine_inner(engine, audio, settings, false)
            .map(|(text, _)| text)
    }

    /// Same as `transcribe_with_loaded_engine` but ALSO returns timed
    /// segments when the underlying engine produced any. Engines that do
    /// not expose timestamps (Moonshine, GigaAM, MLX sidecar today) return
    /// an empty `Vec`, in which case callers should fall back to text-only
    /// export with a UI hint.
    fn transcribe_with_loaded_engine_segments(
        &self,
        engine: &mut LoadedEngine,
        audio: Vec<f32>,
        settings: &AppSettings,
    ) -> Result<(String, Vec<TimedSegment>)> {
        self.transcribe_with_loaded_engine_inner(engine, audio, settings, true)
    }

    fn transcribe_with_loaded_engine_inner(
        &self,
        engine: &mut LoadedEngine,
        audio: Vec<f32>,
        settings: &AppSettings,
        want_segments: bool,
    ) -> Result<(String, Vec<TimedSegment>)> {
        // Helper to convert engine-side `TranscriptionSegment` (seconds)
        // to our shared `TimedSegment` (milliseconds). When the caller did
        // not request segments, returns an empty Vec so we never allocate
        // on the hot path.
        let convert_segments =
            |segs: Option<Vec<transcribe_rs::TranscriptionSegment>>| -> Vec<TimedSegment> {
                if !want_segments {
                    return Vec::new();
                }
                segs.unwrap_or_default()
                    .into_iter()
                    .map(|s| TimedSegment::from_seconds(s.start, s.end, s.text))
                    .collect()
            };

        let (result, segments) = match engine {
            LoadedEngine::Whisper(whisper_engine) => {
                let whisper_language = if settings.selected_language == "auto" {
                    None
                } else {
                    let normalized = if settings.selected_language == "zh-Hans"
                        || settings.selected_language == "zh-Hant"
                    {
                        "zh".to_string()
                    } else {
                        settings.selected_language.clone()
                    };
                    Some(normalized)
                };

                let whisper_translate_to_english = settings.translation_output_mode
                    == crate::settings::TranslationOutputMode::Translated
                    && settings.translation_target_language == "en"
                    && matches!(
                        settings.translation_route_preference,
                        crate::settings::TranslationRoutePreference::Auto
                            | crate::settings::TranslationRoutePreference::WhisperEnglish
                    );

                let params = WhisperInferenceParams {
                    language: whisper_language,
                    translate: whisper_translate_to_english,
                    ..Default::default()
                };

                let r = whisper_engine
                    .transcribe_with(&audio, &params)
                    .map_err(|e| anyhow::anyhow!("Whisper transcription failed: {}", e))?;
                let segs = convert_segments(r.segments);
                (r.text, segs)
            }
            LoadedEngine::Parakeet(parakeet_engine) => {
                let params = ParakeetParams {
                    timestamp_granularity: Some(TimestampGranularity::Segment),
                    ..Default::default()
                };
                let r = parakeet_engine
                    .transcribe_with(&audio, &params)
                    .map_err(|e| anyhow::anyhow!("Parakeet transcription failed: {}", e))?;
                let segs = convert_segments(r.segments);
                (r.text, segs)
            }
            LoadedEngine::Moonshine(moonshine_engine) => {
                let r = moonshine_engine
                    .transcribe(&audio, &TranscribeOptions::default())
                    .map_err(|e| anyhow::anyhow!("Moonshine transcription failed: {}", e))?;
                let segs = convert_segments(r.segments);
                (r.text, segs)
            }
            LoadedEngine::MoonshineStreaming(streaming_engine) => {
                let params = MoonshineStreamingParams::default();
                let r = streaming_engine
                    .transcribe_with(&audio, &params)
                    .map_err(|e| {
                        anyhow::anyhow!("Moonshine streaming transcription failed: {}", e)
                    })?;
                let segs = convert_segments(r.segments);
                (r.text, segs)
            }
            LoadedEngine::SenseVoice(sense_voice_engine) => {
                let language = match settings.selected_language.as_str() {
                    "zh" | "zh-Hans" | "zh-Hant" => Some("zh".to_string()),
                    "en" | "ja" | "ko" | "yue" => Some(settings.selected_language.clone()),
                    _ => None,
                };
                let params = SenseVoiceParams {
                    language,
                    use_itn: Some(true),
                };
                let r = sense_voice_engine
                    .transcribe_with(&audio, &params)
                    .map_err(|e| anyhow::anyhow!("SenseVoice transcription failed: {}", e))?;
                let segs = convert_segments(r.segments);
                (r.text, segs)
            }
            LoadedEngine::GigaAM(gigaam_engine) => {
                let r = gigaam_engine
                    .transcribe(&audio, &TranscribeOptions::default())
                    .map_err(|e| anyhow::anyhow!("GigaAM transcription failed: {}", e))?;
                let segs = convert_segments(r.segments);
                (r.text, segs)
            }
            LoadedEngine::MlxAudioStt(mlx_engine) => {
                let sidecar = self
                    .app_handle
                    .try_state::<Arc<crate::sidecar::SidecarManager>>();
                let r = mlx_engine
                    .transcribe_with_sidecar_recovery(
                        audio,
                        16_000,
                        sidecar.as_deref().map(Arc::as_ref),
                    )
                    .map_err(|e| anyhow::anyhow!("MLX transcription failed: {}", e))?;
                let segs = convert_segments(r.segments);
                (r.text, segs)
            }
            LoadedEngine::GemmaAudioStt(gemma_engine) => {
                let r = gemma_engine
                    .transcribe(audio, 16_000)
                    .map_err(|e| anyhow::anyhow!("Gemma audio transcription failed: {}", e))?;
                let segs = convert_segments(r.segments);
                (r.text, segs)
            }
            LoadedEngine::AppleSpeech(apple_engine)
            | LoadedEngine::AppleSpeechStreaming(apple_engine) => {
                let language = if settings.selected_language == "auto" {
                    None
                } else {
                    Some(settings.selected_language.as_str())
                };
                apple_engine
                    .transcribe(&audio, 16_000, language)
                    .map_err(|e| anyhow::anyhow!("Apple Speech transcription failed: {}", e))?
            }
        };

        let corrected_result = if !settings.custom_words.is_empty() {
            apply_custom_words(
                &result,
                &settings.custom_words,
                settings.word_correction_threshold,
            )
        } else {
            result
        };

        let filter_language = match settings.selected_language.as_str() {
            "auto" => "auto",
            "zh-Hans" | "zh-Hant" => "zh",
            lang => lang,
        };

        let cleaned = filter_transcription_output(
            &corrected_result,
            filter_language,
            &settings.custom_filler_words,
        );
        Ok((cleaned, segments))
    }

    fn transcribe_partial_snapshot(
        &self,
        engine: &mut LoadedEngine,
        audio: Vec<f32>,
        settings: &AppSettings,
    ) -> PartialTranscriptionOutcome {
        match catch_unwind(AssertUnwindSafe(|| {
            self.transcribe_with_loaded_engine(engine, audio, settings)
        })) {
            Ok(Ok(text)) => PartialTranscriptionOutcome::Success(text),
            Ok(Err(err)) => PartialTranscriptionOutcome::Error(err),
            Err(panic_payload) => {
                let panic_msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "unknown panic".to_string()
                };
                PartialTranscriptionOutcome::Panicked(panic_msg)
            }
        }
    }

    fn run_partial_provider(
        &self,
        generation: u64,
        binding_id: String,
        config: PartialProviderConfig,
        cancel: Arc<AtomicBool>,
        recording_manager: Arc<AudioRecordingManager>,
    ) {
        let mut last_snapshot_len = 0usize;
        let mut last_emitted = String::new();

        while !cancel.load(Ordering::Relaxed)
            && !self.shutdown_signal.load(Ordering::Relaxed)
            && self.partial_generation_is_current(generation)
        {
            thread::sleep(config.interval);

            if cancel.load(Ordering::Relaxed)
                || self.shutdown_signal.load(Ordering::Relaxed)
                || !self.partial_generation_is_current(generation)
                || self.final_transcription_pending.load(Ordering::Relaxed)
            {
                break;
            }

            // The snapshot is bounded at the recorder so each poll copies at
            // most `max_samples` (the window the engine sees anyway) instead
            // of the whole recording — full-buffer clones every few hundred
            // milliseconds grow O(recording length) and thrash memory on long
            // takes. `total_samples` still reports the full buffer length so
            // growth detection keeps working once the cap is hit.
            let Some(snapshot) = recording_manager.snapshot_recording(config.max_samples) else {
                break;
            };
            let snapshot_len = snapshot.total_samples;
            let growth = snapshot_len.saturating_sub(last_snapshot_len);
            if snapshot_len < config.min_samples || growth < config.min_growth {
                continue;
            }
            last_snapshot_len = snapshot_len;

            let settings = get_settings(&self.app_handle);
            let partial_audio = snapshot.samples;

            // Reuse the already-warmed main engine. Partials only proceed when
            // the engine is immediately available; a pending final transcription
            // must never queue behind fresh partial work.
            let partial_text = {
                let Ok(_transcribe_guard) = self.transcribe_lock.try_lock() else {
                    continue;
                };

                if cancel.load(Ordering::Relaxed)
                    || !self.partial_generation_is_current(generation)
                    || self.final_transcription_pending.load(Ordering::Relaxed)
                {
                    break;
                }

                let mut engine_guard = self.lock_engine();
                let Some(mut engine) = engine_guard.take() else {
                    // Model was unloaded mid-recording; stop emitting partials.
                    break;
                };
                drop(engine_guard);
                let taken_at_epoch = self.engine_epoch.load(Ordering::SeqCst);

                let inference_result =
                    self.transcribe_partial_snapshot(&mut engine, partial_audio, &settings);

                match inference_result {
                    PartialTranscriptionOutcome::Success(text) => {
                        self.restore_partial_engine(engine, taken_at_epoch);
                        text
                    }
                    PartialTranscriptionOutcome::Error(err) => {
                        self.restore_partial_engine(engine, taken_at_epoch);
                        warn!(
                            "Partial transcription failed for binding {}: {}",
                            binding_id, err
                        );
                        continue;
                    }
                    PartialTranscriptionOutcome::Panicked(panic_msg) => {
                        {
                            let mut current_model = self
                                .current_model_id
                                .lock()
                                .unwrap_or_else(|e| e.into_inner());
                            *current_model = None;
                        }
                        let _ = self.app_handle.emit(
                            "model-state-changed",
                            ModelStateEvent {
                                event_type: "unloaded".to_string(),
                                model_id: None,
                                model_name: None,
                                error: Some(format!(
                                    "Partial transcription engine panicked: {}",
                                    panic_msg
                                )),
                            },
                        );
                        warn!(
                            "Partial transcription engine panicked for binding {}; model has been unloaded: {}",
                            binding_id, panic_msg
                        );
                        break;
                    }
                }
            };

            if !self.partial_generation_is_current(generation) {
                break;
            }

            let trimmed = partial_text.trim();
            if trimmed.is_empty() || trimmed == last_emitted {
                continue;
            }

            last_emitted = trimmed.to_string();
            crate::overlay::emit_partial_transcription(&self.app_handle, trimmed);
        }
    }

    pub fn is_model_loaded(&self) -> bool {
        let engine = self.lock_engine();
        engine.is_some()
    }

    pub fn start_partial_provider(
        &self,
        binding_id: &str,
        recording_manager: Arc<AudioRecordingManager>,
    ) {
        self.stop_partial_session_internal();

        let settings = get_settings(&self.app_handle);
        let model_id = settings.selected_model.trim().to_string();
        if model_id.is_empty() {
            return;
        }

        let Some(model_info) = self.model_manager.get_model_info(&model_id) else {
            debug!(
                "Skipping partial transcription for binding {} because model {} is unknown",
                binding_id, model_id
            );
            return;
        };

        if !supports_live_partial_provider(&model_info) {
            debug!(
                "Skipping partial transcription for binding {} because model {} uses a sidecar runtime",
                binding_id, model_id
            );
            return;
        }

        let generation = self.next_partial_generation();
        let cancel = Arc::new(AtomicBool::new(false));
        *self
            .partial_session
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(PartialProviderSession {
            generation,
            binding_id: binding_id.to_string(),
            cancel: Arc::clone(&cancel),
        });

        let config = partial_provider_config_for_model(&model_id);
        let manager = self.clone();
        let binding_id = binding_id.to_string();
        let model_id = model_id.clone();
        thread::spawn(move || {
            if cancel.load(Ordering::Relaxed) {
                return;
            }

            // If the model is loading, wait for it to complete.
            {
                let mut is_loading = manager.is_loading.lock().unwrap_or_else(|e| e.into_inner());
                if *is_loading {
                    debug!(
                        "Partial transcription waiting for model {} to finish loading...",
                        model_id
                    );
                    let (guard, wait_result) = manager
                        .loading_condvar
                        .wait_timeout_while(is_loading, Duration::from_secs(120), |loading| {
                            *loading
                        })
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    is_loading = guard;
                    if *is_loading && wait_result.timed_out() {
                        warn!("Timed out waiting for the transcription model to finish loading inside partial provider.");
                        return;
                    }
                }
            }

            // Now check if the model is loaded and matches the requested model.
            if !manager.is_model_loaded() {
                debug!(
                    "Skipping partial transcription for binding {}: model {} is not loaded after waiting",
                    binding_id, model_id
                );
                return;
            }

            let current_model = manager.get_current_model();
            if current_model.as_deref() != Some(model_id.as_str()) {
                debug!(
                    "Skipping partial transcription for binding {} because loaded model {:?} does not match selected model {}",
                    binding_id, current_model, model_id
                );
                return;
            }

            if cancel.load(Ordering::Relaxed) {
                return;
            }
            manager.run_partial_provider(generation, binding_id, config, cancel, recording_manager);
        });
    }

    pub fn stop_partial_provider(&self) {
        self.stop_partial_session_internal();
    }

    pub fn unload_model(&self) -> Result<()> {
        let unload_start = std::time::Instant::now();
        debug!("Starting to unload model");
        self.stop_partial_session_internal();
        let _lifecycle_guard = self.lock_lifecycle();

        {
            let mut engine = self.lock_engine();
            *engine = None; // Drop the engine to free memory
        }
        self.engine_epoch.fetch_add(1, Ordering::SeqCst);
        {
            let mut current_model = self
                .current_model_id
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *current_model = None;
        }

        // Emit unloaded event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "unloaded".to_string(),
                model_id: None,
                model_name: None,
                error: None,
            },
        );

        let unload_duration = unload_start.elapsed();
        debug!(
            "Model unloaded manually (took {}ms)",
            unload_duration.as_millis()
        );
        Ok(())
    }

    /// Unloads the model immediately if the setting is enabled and the model is loaded
    pub fn maybe_unload_immediately(&self, context: &str) {
        let settings = get_settings(&self.app_handle);
        if settings.model_unload_timeout == ModelUnloadTimeout::Immediately
            && self.is_model_loaded()
        {
            info!("Immediately unloading model after {}", context);
            if let Err(e) = self.unload_model() {
                warn!("Failed to immediately unload model: {}", e);
            }
        }
    }

    pub fn load_model(&self, model_id: &str) -> Result<()> {
        let load_start = std::time::Instant::now();
        debug!("Starting to load model: {}", model_id);

        // Emit loading started event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_started".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: None,
                error: None,
            },
        );

        let model_info = self
            .model_manager
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_is_available(&model_info) {
            let error_msg = "Model not downloaded";
            let _ = self.app_handle.emit(
                "model-state-changed",
                ModelStateEvent {
                    event_type: "loading_failed".to_string(),
                    model_id: Some(model_id.to_string()),
                    model_name: Some(model_info.name.clone()),
                    error: Some(error_msg.to_string()),
                },
            );
            return Err(anyhow::anyhow!(error_msg));
        }

        let _lifecycle_guard = self.lock_lifecycle();

        // Drop any previously loaded engine BEFORE creating the replacement so
        // two models are never resident at once. Large engines hold multiple GB
        // of RAM/VRAM each; loading the new one alongside the old spikes memory
        // and makes Metal allocations fail, silently downgrading Whisper to the
        // CPU fallback. Keeping the old engine on load failure has no value
        // either: every call path keys off the selected model and reloads on
        // mismatch, so a stale engine never serves another request.
        self.stop_partial_session_internal();
        let had_engine = {
            let mut engine = self.lock_engine();
            engine.take().is_some()
        };
        if had_engine {
            let mut current_model = self
                .current_model_id
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *current_model = None;
        }

        let loaded_engine = self.create_loaded_engine(model_id, &model_info, true)?;

        // Update the current engine and model ID
        {
            let mut engine = self.lock_engine();
            *engine = Some(loaded_engine);
        }
        self.engine_epoch.fetch_add(1, Ordering::SeqCst);
        {
            let mut current_model = self
                .current_model_id
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *current_model = Some(model_id.to_string());
        }

        // Emit loading completed event
        let _ = self.app_handle.emit(
            "model-state-changed",
            ModelStateEvent {
                event_type: "loading_completed".to_string(),
                model_id: Some(model_id.to_string()),
                model_name: Some(model_info.name.clone()),
                error: None,
            },
        );

        let load_duration = load_start.elapsed();
        debug!(
            "Successfully loaded transcription model: {} (took {}ms)",
            model_id,
            load_duration.as_millis()
        );
        Ok(())
    }

    /// Kicks off the model loading in a background thread if it's not already loaded
    pub fn initiate_model_load(&self) {
        let settings = get_settings(&self.app_handle);
        self.initiate_model_load_for_model(settings.selected_model);
    }

    /// Kicks off loading a specific model without persisting it as the global selection.
    pub fn initiate_model_load_for_model(&self, model_id: String) {
        let selected_model = model_id.trim().to_string();
        if selected_model.is_empty() {
            return;
        }
        if self.get_current_model().as_deref() == Some(selected_model.as_str())
            && self.is_model_loaded()
        {
            return;
        }

        let mut is_loading = self.is_loading.lock().unwrap_or_else(|e| e.into_inner());
        if *is_loading {
            return;
        }

        *is_loading = true;
        let self_clone = self.clone();
        thread::spawn(move || {
            let _guard = ModelLoadGuard::new(
                Arc::clone(&self_clone.is_loading),
                Arc::clone(&self_clone.loading_condvar),
            );

            let load_result =
                catch_unwind(AssertUnwindSafe(|| self_clone.load_model(&selected_model)));

            match load_result {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    error!("Failed to load model '{}': {}", selected_model, error);
                }
                Err(panic_payload) => {
                    let panic_message = if let Some(message) = panic_payload.downcast_ref::<&str>()
                    {
                        (*message).to_string()
                    } else if let Some(message) = panic_payload.downcast_ref::<String>() {
                        message.clone()
                    } else {
                        "unknown panic".to_string()
                    };
                    error!(
                        "Model load panicked for '{}': {}",
                        selected_model, panic_message
                    );
                    let _ = self_clone.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "loading_failed".to_string(),
                            model_id: Some(selected_model.clone()),
                            model_name: None,
                            error: Some(format!("Model load panicked: {}", panic_message)),
                        },
                    );
                }
            }
        });
    }

    pub fn get_current_model(&self) -> Option<String> {
        let current_model = self
            .current_model_id
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        current_model.clone()
    }

    pub fn last_activity_ms(&self) -> u64 {
        self.last_activity.load(Ordering::Relaxed)
    }

    /// Run a one-shot file transcription and return text PLUS timed segments.
    ///
    /// This is intentionally separate from `transcribe()` so the dictation
    /// hot path stays untouched. It does not feed into continuous voice
    /// cloning (file imports aren't the user's live mic) and skips the
    /// "feed STT result back" branch.
    pub fn transcribe_with_segments(
        &self,
        audio: Arc<Vec<f32>>,
    ) -> Result<(String, Vec<TimedSegment>)> {
        let _transcribe_guard = self
            .transcribe_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        self.last_activity
            .store(current_unix_millis(), Ordering::Relaxed);

        if audio.is_empty() {
            return Ok((String::new(), Vec::new()));
        }

        // Wait for any in-progress load.
        {
            let mut is_loading = self.is_loading.lock().unwrap_or_else(|e| e.into_inner());
            if *is_loading {
                let (guard, wait_result) = self
                    .loading_condvar
                    .wait_timeout_while(is_loading, Duration::from_secs(120), |loading| *loading)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                is_loading = guard;
                if *is_loading && wait_result.timed_out() {
                    return Err(anyhow::anyhow!(
                        "Timed out waiting for the transcription model to finish loading."
                    ));
                }
            }

            let engine_guard = self.lock_engine();
            if engine_guard.is_none() {
                return Err(anyhow::anyhow!("Model is not loaded for transcription."));
            }
        }

        let settings = get_settings(&self.app_handle);

        let result = {
            let _lifecycle_guard = self.lock_lifecycle();
            let mut engine_guard = self.lock_engine();
            let mut engine = match engine_guard.take() {
                Some(e) => e,
                None => return Err(anyhow::anyhow!("Model failed to load.")),
            };
            drop(engine_guard);

            let audio_for_engine = (*audio).clone();
            drop(audio);

            let r = catch_unwind(AssertUnwindSafe(|| {
                self.transcribe_with_loaded_engine_segments(
                    &mut engine,
                    audio_for_engine,
                    &settings,
                )
            }));

            match r {
                Ok(inner) => {
                    let mut engine_guard = self.lock_engine();
                    *engine_guard = Some(engine);
                    inner?
                }
                Err(panic_payload) => {
                    let panic_msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "unknown panic".to_string()
                    };
                    error!("File transcription engine panicked: {}", panic_msg);
                    {
                        let mut current_model = self
                            .current_model_id
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        *current_model = None;
                    }
                    return Err(anyhow::anyhow!(
                        "Transcription engine panicked: {}",
                        panic_msg
                    ));
                }
            }
        };

        self.maybe_unload_immediately("file transcription");
        Ok(result)
    }

    pub fn transcribe(&self, audio: Arc<Vec<f32>>) -> Result<String> {
        let settings = get_settings(&self.app_handle);
        self.transcribe_with_settings(audio, settings)
    }

    pub fn transcribe_with_settings(
        &self,
        audio: Arc<Vec<f32>>,
        settings: AppSettings,
    ) -> Result<String> {
        // Live partials and the final stop-triggered transcription share one engine.
        // Serialize transcribe calls so a long-running partial cannot steal the engine
        // and cause the final full transcription to fail or return nothing.
        self.final_transcription_pending
            .store(true, Ordering::SeqCst);
        let _final_pending_guard = FinalTranscriptionPendingGuard {
            flag: Arc::clone(&self.final_transcription_pending),
        };
        let _transcribe_guard = self
            .transcribe_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        // Update last activity timestamp
        self.last_activity
            .store(current_unix_millis(), Ordering::Relaxed);

        let st = std::time::Instant::now();

        debug!("Audio vector length: {}", audio.len());

        if audio.is_empty() {
            debug!("Empty audio vector");
            self.maybe_unload_immediately("empty audio");
            return Ok(String::new());
        }

        // Retain a cheap ref to the same buffer for continuous voice cloning.
        // Arc clone is a refcount bump — no audio copy. The engine requires
        // owned samples, so only one Vec clone happens (at the engine call).
        let audio_for_cloning = Arc::clone(&audio);

        let selected_model = settings.selected_model.trim().to_string();
        if selected_model.is_empty() {
            return Err(anyhow::anyhow!("No transcription model is selected."));
        }

        // Check if the requested model is loaded, loading it if a rule selected
        // a different engine for this recording.
        {
            // If the model is loading, wait for it to complete.
            let mut is_loading = self.is_loading.lock().unwrap_or_else(|e| e.into_inner());
            if *is_loading {
                let (guard, wait_result) = self
                    .loading_condvar
                    .wait_timeout_while(is_loading, Duration::from_secs(120), |loading| *loading)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                is_loading = guard;
                if *is_loading && wait_result.timed_out() {
                    return Err(anyhow::anyhow!(
                        "Timed out waiting for the transcription model to finish loading."
                    ));
                }
            }

            let current_model = self.get_current_model();
            let engine_loaded = self.lock_engine().is_some();
            if !engine_loaded || current_model.as_deref() != Some(selected_model.as_str()) {
                drop(is_loading);
                self.load_model(&selected_model)?;
            }
        }

        // Perform transcription with the appropriate engine.
        // We use catch_unwind to prevent engine panics from poisoning the mutex,
        // which would make the app hang indefinitely on subsequent operations.
        let result = {
            let _lifecycle_guard = self.lock_lifecycle();
            let mut engine_guard = self.lock_engine();

            // Take the engine out so we own it during transcription.
            // If the engine panics, we simply don't put it back (effectively unloading it)
            // instead of poisoning the mutex.
            let mut engine = match engine_guard.take() {
                Some(e) => e,
                None => {
                    return Err(anyhow::anyhow!(
                        "Model failed to load after auto-load attempt. Please check your model settings."
                    ));
                }
            };

            // Release the lock before transcribing — no mutex held during the engine call
            drop(engine_guard);

            // The engine consumes `Vec<f32>` by value, so we pay exactly one
            // owned copy here. The caller and the voice-cloning thread keep
            // their cheap `Arc` handles to the original buffer.
            let audio_for_engine = (*audio).clone();
            drop(audio);
            let transcribe_result = catch_unwind(AssertUnwindSafe(|| {
                self.transcribe_with_loaded_engine(&mut engine, audio_for_engine, &settings)
            }));

            match transcribe_result {
                Ok(inner_result) => {
                    // Success or normal error — put the engine back
                    let mut engine_guard = self.lock_engine();
                    *engine_guard = Some(engine);
                    inner_result?
                }
                Err(panic_payload) => {
                    // Engine panicked — do NOT put it back (it's in an unknown state).
                    // The engine is dropped here, effectively unloading it.
                    let panic_msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "unknown panic".to_string()
                    };
                    error!(
                        "Transcription engine panicked: {}. Model has been unloaded.",
                        panic_msg
                    );

                    // Clear the model ID so it will be reloaded on next attempt
                    {
                        let mut current_model = self
                            .current_model_id
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        *current_model = None;
                    }

                    let _ = self.app_handle.emit(
                        "model-state-changed",
                        ModelStateEvent {
                            event_type: "unloaded".to_string(),
                            model_id: None,
                            model_name: None,
                            error: Some(format!("Engine panicked: {}", panic_msg)),
                        },
                    );

                    return Err(anyhow::anyhow!(
                        "Transcription engine panicked: {}. The model has been unloaded and will reload on next attempt.",
                        panic_msg
                    ));
                }
            }
        };

        let et = std::time::Instant::now();
        let translation_note = if settings.translation_output_mode
            == crate::settings::TranslationOutputMode::Translated
            && settings.translation_target_language == "en"
            && matches!(
                settings.translation_route_preference,
                crate::settings::TranslationRoutePreference::Auto
                    | crate::settings::TranslationRoutePreference::WhisperEnglish
            ) {
            " (translated)"
        } else {
            ""
        };
        info!(
            "Transcription completed in {}ms{}",
            (et - st).as_millis(),
            translation_note
        );

        let final_result = result;

        if final_result.is_empty() {
            info!("Transcription result is empty");
        } else {
            debug!(
                "Transcription produced {} chars after cleanup",
                final_result.len()
            );
        }

        self.maybe_unload_immediately("transcription");

        // Feed audio to continuous voice cloning (async, non-blocking).
        // `audio_for_cloning` is an Arc clone — the thread borrows a slice
        // from it; no Vec copy is made for this path.
        if !final_result.is_empty() {
            let app = self.app_handle.clone();
            let transcript_for_cloning = final_result.clone();
            thread::spawn(move || {
                use tauri::Manager;
                if let Some(cloning_manager) = app.try_state::<Arc<ContinuousCloningManager>>() {
                    cloning_manager
                        .process_stt_result(audio_for_cloning.as_slice(), &transcript_for_cloning);
                }
            });
        }

        Ok(final_result)
    }
}

impl Drop for TranscriptionManager {
    fn drop(&mut self) {
        if self.shutdown_on_drop {
            self.shutdown();
        }
    }
}
