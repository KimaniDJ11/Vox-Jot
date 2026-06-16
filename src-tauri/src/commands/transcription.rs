use crate::audio_toolkit::{
    enhance_audio_samples, AudioEnhancementConfig, AudioEnhancementModel,
    DEFAULT_ENHANCEMENT_STRENGTH, FULL_BAND_SAMPLE_RATE,
};
use crate::correction_tracker::store::CorrectionStore;
use crate::helpers::subtitles::{to_srt, to_vtt, TimedSegment};
use crate::managers::transcription::TranscriptionManager;
use crate::managers::watch_folders::WatchFolderManager;
use crate::settings::{
    get_settings, write_settings, ModelUnloadTimeout, WatchFolderConfig, WatchFolderOutputFormat,
};
use crate::sidecar::SidecarManager;
use crate::speech_analysis::{
    self, EmotionResult, SpeakerLabeledSegment, SpeakerTurn, SpeechAnalysisSegment,
    CURRENT_DICTATION_ASR_ID,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

const SPEECH_ANALYSIS_SIDECAR_SOURCE: &str =
    include_str!("../../../scripts/speech_analysis_sidecar.py");

pub(crate) fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate {
        return samples.to_vec();
    }

    let ratio = target_rate as f64 / source_rate as f64;
    let output_len = ((samples.len() as f64) * ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_pos = (i as f64) / ratio;
        let left = src_pos.floor() as usize;
        let right = (left + 1).min(samples.len().saturating_sub(1));
        let frac = (src_pos - (left as f64)) as f32;

        let value = if left == right {
            samples[left]
        } else {
            samples[left] * (1.0 - frac) + samples[right] * frac
        };
        output.push(value);
    }

    output
}

pub(crate) fn read_wav_as_mono_f32(path: &str) -> Result<(Vec<f32>, u32), String> {
    crate::audio_toolkit::read_wav_file_as_mono_f32(Path::new(path))
}

#[derive(Serialize, Type)]
pub struct ModelLoadStatus {
    is_loaded: bool,
    current_model: Option<String>,
}

#[derive(Serialize, Type)]
pub struct RuntimeMemoryStatus {
    app_rss_mb: Option<f64>,
    sidecar_rss_mb: Option<f64>,
    sidecar_running: bool,
    sidecar_pid: Option<u32>,
}

fn process_rss_mb(pid: u32) -> Option<f64> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let output = Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let rss_kb = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<f64>()
            .ok()?;
        Some(rss_kb / 1024.0)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = pid;
        None
    }
}

#[tauri::command]
#[specta::specta]
pub fn set_model_unload_timeout(app: AppHandle, timeout: ModelUnloadTimeout) {
    let mut settings = get_settings(&app);
    settings.model_unload_timeout = timeout;
    write_settings(&app, settings);
}

#[tauri::command]
#[specta::specta]
pub fn get_model_load_status(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<ModelLoadStatus, String> {
    Ok(ModelLoadStatus {
        is_loaded: transcription_manager.is_model_loaded(),
        current_model: transcription_manager.get_current_model(),
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_runtime_memory_status(
    sidecar_manager: State<'_, Arc<SidecarManager>>,
) -> Result<RuntimeMemoryStatus, String> {
    let sidecar_pid = sidecar_manager.process_id();
    Ok(RuntimeMemoryStatus {
        app_rss_mb: process_rss_mb(std::process::id()),
        sidecar_rss_mb: sidecar_pid.and_then(process_rss_mb),
        sidecar_running: sidecar_manager.is_running(),
        sidecar_pid,
    })
}

#[tauri::command]
#[specta::specta]
pub fn unload_model_manually(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<(), String> {
    transcription_manager
        .unload_model()
        .map_err(|e| format!("Failed to unload model: {}", e))
}

fn target_triple_str() -> &'static str {
    if cfg!(all(target_arch = "x86_64", target_os = "macos")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_arch = "aarch64", target_os = "macos")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_arch = "x86_64", target_os = "linux")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_arch = "aarch64", target_os = "linux")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_arch = "x86_64", target_os = "windows")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_arch = "aarch64", target_os = "windows")) {
        "aarch64-pc-windows-msvc"
    } else {
        ""
    }
}

pub(crate) fn resolve_ffmpeg_exe() -> PathBuf {
    let exe_ext = if cfg!(windows) { ".exe" } else { "" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let triple = target_triple_str();
            for name in [
                format!("vox-jot-ffmpeg-{}{}", triple, exe_ext),
                format!("vox-jot-ffmpeg{}", exe_ext),
            ] {
                let candidate = dir.join(&name);
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }
    PathBuf::from(if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    })
}

pub(crate) fn decode_with_ffmpeg_blocking(
    ffmpeg_exe: &Path,
    input_path: &str,
) -> Result<Vec<f32>, String> {
    decode_with_ffmpeg_blocking_at(ffmpeg_exe, input_path, 16_000)
}

/// Decode any audio/video file to mono f32 PCM at `target_rate` Hz via ffmpeg.
/// The 16 kHz path feeds speech-to-text; the full-band path feeds Enhance Audio.
pub(crate) fn decode_with_ffmpeg_blocking_at(
    ffmpeg_exe: &Path,
    input_path: &str,
    target_rate: u32,
) -> Result<Vec<f32>, String> {
    let target_rate_arg = target_rate.to_string();
    let output = std::process::Command::new(ffmpeg_exe)
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            input_path,
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ac",
            "1",
            "-ar",
            &target_rate_arg,
            "-",
        ])
        .output()
        .map_err(|e| {
            format!(
                "Could not run ffmpeg ({}): {}. Install ffmpeg on your PATH or bundle the sidecar.",
                ffmpeg_exe.display(),
                e
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffmpeg exited with status {:?}: {}",
            output.status.code(),
            stderr.trim()
        ));
    }

    let bytes = output.stdout;
    if bytes.is_empty() {
        return Err("ffmpeg produced no audio data".into());
    }
    if bytes.len() % 4 != 0 {
        return Err(format!(
            "ffmpeg output byte length {} is not a multiple of 4 (f32le)",
            bytes.len()
        ));
    }
    let mut samples = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(samples)
}

pub(crate) fn write_wav(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| format!("Failed to write WAV '{}': {}", path.display(), e))?;
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        writer
            .write_sample(value)
            .map_err(|e| format!("Failed to encode WAV sample: {}", e))?;
    }
    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV '{}': {}", path.display(), e))?;
    Ok(())
}

pub(crate) fn write_wav_16k(path: &Path, samples: &[f32]) -> Result<(), String> {
    write_wav(path, samples, 16_000)
}

fn write_temp_wav_16k(samples: &[f32]) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!(
        "vox-jot-speech-analysis-{}.wav",
        uuid::Uuid::new_v4()
    ));
    write_wav_16k(&path, samples)?;
    Ok(path)
}

fn default_clean_audio_output_path(input_path: &str) -> PathBuf {
    let source = Path::new(input_path);
    let parent = source.parent().unwrap_or_else(|| Path::new("."));
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("audio");

    for index in 0..1000 {
        let file_name = if index == 0 {
            format!("{stem}-cleaned.wav")
        } else {
            format!("{stem}-cleaned-{}.wav", index + 1)
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    parent.join(format!("{}-cleaned-{}.wav", stem, uuid::Uuid::new_v4()))
}

fn decode_audio_file_for_cleanup(path: &str) -> Result<(Vec<f32>, u32), String> {
    if path.to_ascii_lowercase().ends_with(".wav") {
        read_wav_as_mono_f32(path)
    } else {
        let ffmpeg_exe = resolve_ffmpeg_exe();
        decode_with_ffmpeg_blocking(&ffmpeg_exe, path).map(|samples| (samples, 16_000))
    }
}

#[derive(Serialize, Type)]
pub struct CleanAudioFileResult {
    pub output_path: String,
    pub duration_ms: u64,
}

#[tauri::command]
#[specta::specta]
pub async fn clean_audio_file(
    path: String,
    output_path: Option<String>,
) -> Result<CleanAudioFileResult, String> {
    tokio::task::spawn_blocking(move || -> Result<CleanAudioFileResult, String> {
        let source_path = PathBuf::from(&path);
        if !source_path.is_file() {
            return Err(format!("Audio file not found: {}", source_path.display()));
        }

        let output_path = output_path
            .map(PathBuf::from)
            .unwrap_or_else(|| default_clean_audio_output_path(&path));
        if output_path == source_path {
            return Err("Choose a different output path for cleaned audio.".to_string());
        }
        if let Some(parent) = output_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|err| {
                    format!(
                        "Failed to create output folder '{}': {}",
                        parent.display(),
                        err
                    )
                })?;
            }
        }

        let (samples, sample_rate) = decode_audio_file_for_cleanup(&path)?;
        if samples.is_empty() {
            return Err("Audio file did not contain usable samples.".to_string());
        }

        // This path feeds speech-to-text, so it stays at 16 kHz.
        let cleaned = enhance_audio_samples(
            &samples,
            sample_rate,
            16_000,
            AudioEnhancementConfig::rnnoise(),
        )?;
        if cleaned.is_empty() {
            return Err("Noise reduction produced no audio.".to_string());
        }

        write_wav_16k(&output_path, &cleaned)?;

        Ok(CleanAudioFileResult {
            output_path: output_path.to_string_lossy().to_string(),
            duration_ms: ((cleaned.len() as f64 / 16_000.0) * 1000.0).round() as u64,
        })
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

// ── Enhance Audio: full-band, user-facing noise reduction ─────────────────────
// Unlike clean_audio_file (16 kHz, feeds STT), this produces a high-quality file
// the user keeps: full-band output (default 48 kHz), any input audio/video, and a
// selectable engine (RNNoise or spectral subtraction with adjustable strength).

fn default_enhanced_output_path(input_path: &str) -> PathBuf {
    let source = Path::new(input_path);
    let parent = source.parent().unwrap_or_else(|| Path::new("."));
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("audio");

    for index in 0..1000 {
        let file_name = if index == 0 {
            format!("{stem}-enhanced.wav")
        } else {
            format!("{stem}-enhanced-{}.wav", index + 1)
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    parent.join(format!("{}-enhanced-{}.wav", stem, uuid::Uuid::new_v4()))
}

fn decode_audio_file_at(path: &str, target_rate: u32) -> Result<(Vec<f32>, u32), String> {
    if path.to_ascii_lowercase().ends_with(".wav") {
        // WAV: keep the native rate; the enhancer resamples internally.
        read_wav_as_mono_f32(path)
    } else {
        let ffmpeg_exe = resolve_ffmpeg_exe();
        decode_with_ffmpeg_blocking_at(&ffmpeg_exe, path, target_rate).map(|s| (s, target_rate))
    }
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnhanceAudioOptions {
    /// Engine id: "rnnoise" (default), "spectral", or "deepfilternet".
    pub model: Option<String>,
    /// Output sample rate in Hz (default 48000). Ignored by DeepFilterNet.
    pub output_sample_rate: Option<u32>,
    /// Spectral-only strength in [0, 1] (default 0.75).
    pub strength: Option<f32>,
}

#[derive(Serialize, Type)]
pub struct EnhanceAudioFileResult {
    pub output_path: String,
    pub sample_rate: u32,
    pub duration_ms: u64,
    pub model: String,
}

fn requested_model_is_deepfilternet(model: Option<&str>) -> bool {
    matches!(
        model
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref(),
        Some("deepfilternet" | "deepfilter" | "deep-filter" | "df")
    )
}

fn requested_model_is_demucs(model: Option<&str>) -> bool {
    matches!(
        model
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref(),
        Some("demucs" | "htdemucs")
    )
}

const DEMUCS_DOWNLOAD_DOMAIN: &str = "audio_cleanup";
const DEMUCS_DOWNLOAD_ARTIFACT_ID: &str = "demucs";
const DEMUCS_RUNTIME_REPO_ID: &str = "IrieDinamik/vox-jot-models";
const DEMUCS_RUNTIME_REPO_PREFIX: &str = "audio-cleanup/demucs-mlx-swift-runtime/macos-arm64";
const DEMUCS_RUNTIME_BINARY: &str = "demucs-mlx-swift";
const DEMUCS_RUNTIME_BINARY_SHA256: &str =
    "9422ed9baee16f3af3c969b8055935c72b4d281e73494699da7b129e66e6f517";
const DEMUCS_RUNTIME_BINARY_BYTES: u64 = 55_348_832;
const DEMUCS_RUNTIME_METALLIB: &str = "mlx.metallib";
const DEMUCS_RUNTIME_METALLIB_SHA256: &str =
    "4b11cd850e3e6ad24898ba7a24745c057d7807b28193ab11beaa284475edf2bb";
const DEMUCS_RUNTIME_METALLIB_BYTES: u64 = 107_017_438;
const DEMUCS_MODEL_REPO_ID: &str = "mlx-community/demucs-mlx-fp16";
const DEMUCS_MODEL_REQUIRED_FILES: &[&str] = &["htdemucs.safetensors", "htdemucs_config.json"];
static ACTIVE_DEMUCS_SETUP: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

struct DemucsSetupGuard;

impl Drop for DemucsSetupGuard {
    fn drop(&mut self) {
        crate::artifact_download::clear_download_cancel_flag(
            DEMUCS_DOWNLOAD_DOMAIN,
            DEMUCS_DOWNLOAD_ARTIFACT_ID,
        );
        let mut active = ACTIVE_DEMUCS_SETUP
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        *active = false;
    }
}

fn begin_demucs_setup() -> Result<(Arc<AtomicBool>, DemucsSetupGuard), String> {
    let mut active = ACTIVE_DEMUCS_SETUP
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if *active {
        return Err("Demucs setup is already running.".to_string());
    }
    *active = true;
    let cancel_flag = crate::artifact_download::register_download_cancel_flag(
        DEMUCS_DOWNLOAD_DOMAIN,
        DEMUCS_DOWNLOAD_ARTIFACT_ID,
    );
    Ok((cancel_flag, DemucsSetupGuard))
}

fn emit_demucs_download_progress(
    app: &AppHandle,
    phase: &str,
    percentage: Option<f64>,
    error: Option<&str>,
) {
    let total = if percentage.is_some() { 100 } else { 0 };
    let downloaded = percentage
        .map(|value| value.clamp(0.0, 100.0).round() as u64)
        .unwrap_or(0);
    crate::artifact_download::emit_artifact_progress(
        app,
        crate::artifact_download::progress(
            DEMUCS_DOWNLOAD_DOMAIN,
            DEMUCS_DOWNLOAD_ARTIFACT_ID,
            phase,
            None,
            None,
            None,
            downloaded,
            total,
            error,
        ),
    );
}

fn demucs_runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    crate::storage_paths::audio_cleanup_models_dir(app)
        .ok()
        .map(|root| root.join("runtime"))
}

fn demucs_weights_root(app: &AppHandle) -> Option<PathBuf> {
    crate::storage_paths::audio_cleanup_models_dir(app)
        .ok()
        .map(|root| {
            root.join("MLX")
                .join("mlx-community")
                .join("demucs-mlx-fp16")
        })
}

fn demucs_runtime_ready(runtime_dir: &Path) -> bool {
    let binary = runtime_dir.join(DEMUCS_RUNTIME_BINARY);
    let metallib = runtime_dir.join(DEMUCS_RUNTIME_METALLIB);
    file_sha256_matches(&binary, DEMUCS_RUNTIME_BINARY_SHA256).unwrap_or(false)
        && file_sha256_matches(&metallib, DEMUCS_RUNTIME_METALLIB_SHA256).unwrap_or(false)
        && demucs_binary_is_executable(&binary)
}

fn demucs_weights_ready(weights_dir: &Path) -> bool {
    DEMUCS_MODEL_REQUIRED_FILES
        .iter()
        .all(|rel_path| required_model_file_ready(&weights_dir.join(rel_path)))
}

fn required_model_file_ready(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
}

#[cfg(unix)]
fn demucs_binary_is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn demucs_binary_is_executable(path: &Path) -> bool {
    path.is_file()
}

/// Resolve the Demucs (MLX, Swift) separation binary. It ships as a downloaded
/// runtime under `<app data>/models/audio-cleanup/runtime/` (binary +
/// co-located `mlx.metallib`), mirroring the OCR/creative-audio runtimes — the
/// 160 MB+ binary + Metal library are too large to bundle in-tree. Apple
/// Silicon only.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn demucs_runtime_binary(app: &AppHandle) -> Option<PathBuf> {
    let runtime_dir = demucs_runtime_dir(app)?;
    demucs_runtime_ready(&runtime_dir).then_some(runtime_dir.join(DEMUCS_RUNTIME_BINARY))
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn demucs_runtime_binary(_app: &AppHandle) -> Option<PathBuf> {
    None
}

/// Resolve the Demucs MLX weights directory. The Swift binary loads the
/// `htdemucs` variant from `<dir>/htdemucs.safetensors` + `htdemucs_config.json`.
fn demucs_weights_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = demucs_weights_root(app)?;
    demucs_weights_ready(&dir).then_some(dir)
}

/// Run Demucs stem separation on `input`, writing only the isolated `vocals`
/// stem (speech, music/background removed) to `output`. The binary decodes the
/// source itself (AVFoundation) and writes 44.1 kHz stereo stems to a temp dir.
fn run_demucs(app: &AppHandle, input: &Path, output: &Path) -> Result<(), String> {
    let bin = demucs_runtime_binary(app).ok_or_else(|| {
        "Demucs runtime is not installed. Install it from Model Hub → Audio Cleanup.".to_string()
    })?;
    let weights = demucs_weights_dir(app).ok_or_else(|| {
        "Demucs model is not installed. Download it from Model Hub → Audio Cleanup.".to_string()
    })?;

    let out_dir = std::env::temp_dir().join(format!("vox-jot-demucs-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&out_dir)
        .map_err(|err| format!("Failed to create Demucs temp dir: {err}"))?;

    let result = Command::new(&bin)
        .arg(input)
        .arg("-n")
        .arg("htdemucs")
        .arg("--model-dir")
        .arg(&weights)
        .arg("--two-stems")
        .arg("vocals")
        .arg("-o")
        .arg(&out_dir)
        .arg("--float32")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    let command_output = match result {
        Ok(value) => value,
        Err(err) => {
            let _ = fs::remove_dir_all(&out_dir);
            return Err(format!("Failed to run Demucs: {err}"));
        }
    };
    if !command_output.status.success() {
        let stderr = String::from_utf8_lossy(&command_output.stderr);
        let _ = fs::remove_dir_all(&out_dir);
        return Err(format!("Demucs separation failed: {}", stderr.trim()));
    }

    // The CLI writes stems to `<out_dir>/<input file stem>/vocals.wav`.
    let track = input
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("audio");
    let vocals = out_dir.join(track).join("vocals.wav");
    if !vocals.is_file() {
        let _ = fs::remove_dir_all(&out_dir);
        return Err("Demucs produced no vocals stem.".to_string());
    }
    let copy = fs::copy(&vocals, output);
    let _ = fs::remove_dir_all(&out_dir);
    copy.map_err(|err| format!("Failed to save the isolated vocals stem: {err}"))?;
    Ok(())
}

#[derive(Serialize, Type)]
pub struct DemucsRuntimeStatus {
    /// The Swift+MLX separation binary (+ co-located metallib) is present.
    pub runtime_installed: bool,
    /// The `demucs-mlx-fp16` weights (htdemucs variant) are present.
    pub model_installed: bool,
}

/// Whether Demucs vocal isolation can run: both the Swift runtime binary and
/// the MLX weights must be installed. Apple Silicon only.
#[tauri::command]
#[specta::specta]
pub fn demucs_runtime_status(app: AppHandle) -> Result<DemucsRuntimeStatus, String> {
    Ok(DemucsRuntimeStatus {
        runtime_installed: demucs_runtime_binary(&app).is_some(),
        model_installed: demucs_weights_dir(&app).is_some(),
    })
}

fn demucs_runtime_url(filename: &str) -> String {
    let rel_path = format!("{DEMUCS_RUNTIME_REPO_PREFIX}/{filename}");
    format!(
        "https://huggingface.co/{DEMUCS_RUNTIME_REPO_ID}/resolve/main/{}",
        crate::artifact_download::encode_hf_path(&rel_path)
    )
}

fn file_sha256_matches(path: &Path, expected_sha256: &str) -> Result<bool, String> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(format!("Failed to open {}: {err}", path.display())),
    };
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()).eq_ignore_ascii_case(expected_sha256))
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata =
        fs::metadata(path).map_err(|err| format!("Failed to inspect {}: {err}", path.display()))?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    fs::set_permissions(path, permissions)
        .map_err(|err| format!("Failed to mark {} executable: {err}", path.display()))
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

async fn download_demucs_runtime_file(
    app: &AppHandle,
    filename: &'static str,
    expected_sha256: &'static str,
    expected_size: u64,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let root = crate::storage_paths::audio_cleanup_models_dir(app)
        .map_err(|err| format!("Failed to resolve audio cleanup model dir: {err}"))?;
    let runtime_dir = root.join("runtime");
    fs::create_dir_all(&runtime_dir).map_err(|err| {
        format!(
            "Failed to create Demucs runtime dir '{}': {err}",
            runtime_dir.display()
        )
    })?;

    let final_path = runtime_dir.join(filename);
    if final_path.is_file() && file_sha256_matches(&final_path, expected_sha256)? {
        if filename == DEMUCS_RUNTIME_BINARY {
            ensure_executable(&final_path)?;
        }
        return Ok(());
    }
    if final_path.exists() {
        fs::remove_file(&final_path).map_err(|err| {
            format!(
                "Failed to clear invalid Demucs runtime file '{}': {err}",
                final_path.display()
            )
        })?;
    }

    let downloads_dir = root.join("downloads");
    fs::create_dir_all(&downloads_dir).map_err(|err| {
        format!(
            "Failed to create Demucs download dir '{}': {err}",
            downloads_dir.display()
        )
    })?;
    let partial_path = downloads_dir.join(format!("{filename}.partial"));
    let progress_app = app.clone();
    let progress = Arc::new(
        move |mut progress: crate::artifact_download::ArtifactProgress| {
            progress.phase = if progress.phase == "complete" {
                "installing-runtime".to_string()
            } else {
                "downloading-runtime".to_string()
            };
            crate::artifact_download::emit_artifact_progress(&progress_app, progress);
        },
    );

    crate::artifact_download::download_file(crate::artifact_download::FileDownloadOptions {
        domain: DEMUCS_DOWNLOAD_DOMAIN.to_string(),
        artifact_id: DEMUCS_DOWNLOAD_ARTIFACT_ID.to_string(),
        url: demucs_runtime_url(filename),
        partial_path,
        final_path: final_path.clone(),
        expected_sha256: Some(expected_sha256.to_string()),
        expected_size: Some(expected_size),
        bearer_token: crate::speech_analysis::hugging_face_token_for_runtime(),
        cancel_flag: Some(cancel_flag),
        progress: Some(progress),
    })
    .await?;

    if !file_sha256_matches(&final_path, expected_sha256)? {
        return Err(format!(
            "Demucs runtime file '{}' failed checksum validation after download.",
            filename
        ));
    }
    if filename == DEMUCS_RUNTIME_BINARY {
        ensure_executable(&final_path)?;
    }
    Ok(())
}

async fn download_demucs_weights(
    app: &AppHandle,
    cancel_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let weights_dir = demucs_weights_root(app)
        .ok_or_else(|| "Failed to resolve Demucs weights dir.".to_string())?;
    if demucs_weights_ready(&weights_dir) {
        return Ok(());
    }

    let staging_dir = weights_dir.with_file_name(".staging-demucs-mlx-fp16");
    let progress_app = app.clone();
    let progress = Arc::new(
        move |mut progress: crate::artifact_download::ArtifactProgress| {
            progress.phase = match progress.phase.as_str() {
                "preparing" => "preparing-model".to_string(),
                "recovering" | "downloading" => "downloading-model".to_string(),
                "installing" | "complete" => "installing-model".to_string(),
                other => other.to_string(),
            };
            crate::artifact_download::emit_artifact_progress(&progress_app, progress);
        },
    );
    let file_filter: crate::artifact_download::HfFileFilter =
        Arc::new(|path: &str| DEMUCS_MODEL_REQUIRED_FILES.contains(&path) || path == "README.md");

    crate::artifact_download::download_hf_repo(crate::artifact_download::HfRepoDownloadOptions {
        domain: DEMUCS_DOWNLOAD_DOMAIN.to_string(),
        artifact_id: DEMUCS_DOWNLOAD_ARTIFACT_ID.to_string(),
        repo_id: DEMUCS_MODEL_REPO_ID.to_string(),
        staging_dir,
        final_dir: weights_dir.clone(),
        token: crate::speech_analysis::hugging_face_token_for_runtime(),
        gated: false,
        resume_existing_staging: true,
        cancel_flag: Some(cancel_flag),
        file_filter: Some(file_filter),
        progress: Some(progress),
    })
    .await?;

    if demucs_weights_ready(&weights_dir) {
        Ok(())
    } else {
        Err(
            "Demucs model download completed, but required HTDemucs weights are missing."
                .to_string(),
        )
    }
}

/// Install (or repair) Demucs vocal-isolation assets. This downloads the
/// app-managed Swift+MLX runtime from the Vox Jot artifact repo and only the
/// `htdemucs` files from the public MLX weights repo.
#[tauri::command]
#[specta::specta]
pub async fn prepare_demucs_runtime(app: AppHandle) -> Result<DemucsRuntimeStatus, String> {
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = app;
        return Err(
            "Demucs MLX vocal isolation is available only on Apple Silicon Macs.".to_string(),
        );
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        if demucs_runtime_binary(&app).is_some() && demucs_weights_dir(&app).is_some() {
            return demucs_runtime_status(app);
        }

        let (cancel_flag, _guard) = begin_demucs_setup()?;
        emit_demucs_download_progress(&app, "preparing", Some(0.0), None);
        let result = async {
            crate::artifact_download::ensure_download_not_cancelled(Some(&cancel_flag))?;
            download_demucs_runtime_file(
                &app,
                DEMUCS_RUNTIME_BINARY,
                DEMUCS_RUNTIME_BINARY_SHA256,
                DEMUCS_RUNTIME_BINARY_BYTES,
                Arc::clone(&cancel_flag),
            )
            .await?;
            crate::artifact_download::ensure_download_not_cancelled(Some(&cancel_flag))?;
            download_demucs_runtime_file(
                &app,
                DEMUCS_RUNTIME_METALLIB,
                DEMUCS_RUNTIME_METALLIB_SHA256,
                DEMUCS_RUNTIME_METALLIB_BYTES,
                Arc::clone(&cancel_flag),
            )
            .await?;
            crate::artifact_download::ensure_download_not_cancelled(Some(&cancel_flag))?;
            download_demucs_weights(&app, Arc::clone(&cancel_flag)).await?;
            crate::artifact_download::ensure_download_not_cancelled(Some(&cancel_flag))
        }
        .await;

        match result {
            Ok(()) => {
                if demucs_runtime_binary(&app).is_none() || demucs_weights_dir(&app).is_none() {
                    let error =
                        "Demucs setup finished, but the runtime or model files are incomplete.";
                    emit_demucs_download_progress(&app, "failed", None, Some(error));
                    return Err(error.to_string());
                }
                emit_demucs_download_progress(&app, "complete", Some(100.0), None);
                demucs_runtime_status(app)
            }
            Err(error) => {
                let phase = if crate::artifact_download::is_cancelled_error(&error) {
                    "cancelled"
                } else {
                    "failed"
                };
                emit_demucs_download_progress(&app, phase, None, Some(&error));
                Err(error)
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn enhance_audio_file(
    app: AppHandle,
    path: String,
    output_path: Option<String>,
    options: Option<EnhanceAudioOptions>,
) -> Result<EnhanceAudioFileResult, String> {
    tokio::task::spawn_blocking(move || -> Result<EnhanceAudioFileResult, String> {
        let source_path = PathBuf::from(&path);
        if !source_path.is_file() {
            return Err(format!("Audio file not found: {}", source_path.display()));
        }

        let options = options.unwrap_or(EnhanceAudioOptions {
            model: None,
            output_sample_rate: None,
            strength: None,
        });
        let use_deepfilternet = requested_model_is_deepfilternet(options.model.as_deref());
        let use_demucs = requested_model_is_demucs(options.model.as_deref());
        let strength = options
            .strength
            .unwrap_or(DEFAULT_ENHANCEMENT_STRENGTH)
            .clamp(0.0, 1.0);

        let output_path = output_path
            .map(PathBuf::from)
            .unwrap_or_else(|| default_enhanced_output_path(&path));
        if output_path == source_path {
            return Err("Choose a different output path for the enhanced audio.".to_string());
        }
        if let Some(parent) = output_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|err| {
                    format!(
                        "Failed to create output folder '{}': {}",
                        parent.display(),
                        err
                    )
                })?;
            }
        }

        if use_demucs {
            // Demucs (MLX, Swift binary) is source separation, not denoising: it
            // splits the mix and we keep only the vocal/speech stem. The binary
            // decodes the source itself and writes 44.1 kHz stereo; we read the
            // vocals stem back as mono for the saved output.
            let temp_out = std::env::temp_dir()
                .join(format!("vox-jot-demucs-out-{}.wav", uuid::Uuid::new_v4()));
            run_demucs(&app, &source_path, &temp_out)?;
            let (enhanced, out_rate) = read_wav_as_mono_f32(&temp_out.to_string_lossy())?;
            let _ = fs::remove_file(&temp_out);
            if enhanced.is_empty() {
                return Err("Demucs produced no audio.".to_string());
            }
            write_wav(&output_path, &enhanced, out_rate)?;

            return Ok(EnhanceAudioFileResult {
                output_path: output_path.to_string_lossy().to_string(),
                sample_rate: out_rate,
                duration_ms: ((enhanced.len() as f64 / out_rate as f64) * 1000.0).round() as u64,
                model: "demucs".to_string(),
            });
        }

        if use_deepfilternet {
            // DeepFilterNet (Python sidecar) is full-band 48 kHz only. Decode the
            // source to a temp WAV; the sidecar resamples to 48 kHz, denoises, and
            // writes a 48 kHz WAV that we read back and persist.
            let (samples, sample_rate) = decode_audio_file_at(&path, FULL_BAND_SAMPLE_RATE)?;
            if samples.is_empty() {
                return Err("Audio file did not contain usable samples.".to_string());
            }
            let temp_in =
                std::env::temp_dir().join(format!("vox-jot-df-in-{}.wav", uuid::Uuid::new_v4()));
            let temp_out =
                std::env::temp_dir().join(format!("vox-jot-df-out-{}.wav", uuid::Uuid::new_v4()));
            write_wav(&temp_in, &samples, sample_rate)?;

            let run = crate::commands::denoise::run_deepfilternet(&app, &temp_in, &temp_out);
            let _ = fs::remove_file(&temp_in);
            if let Err(err) = run {
                let _ = fs::remove_file(&temp_out);
                return Err(err);
            }

            let (enhanced, out_rate) = read_wav_as_mono_f32(&temp_out.to_string_lossy())?;
            let _ = fs::remove_file(&temp_out);
            if enhanced.is_empty() {
                return Err("DeepFilterNet produced no audio.".to_string());
            }
            write_wav(&output_path, &enhanced, out_rate)?;

            return Ok(EnhanceAudioFileResult {
                output_path: output_path.to_string_lossy().to_string(),
                sample_rate: out_rate,
                duration_ms: ((enhanced.len() as f64 / out_rate as f64) * 1000.0).round() as u64,
                model: "deepfilternet".to_string(),
            });
        }

        // Native engines: RNNoise or spectral subtraction.
        let model = options
            .model
            .as_deref()
            .and_then(AudioEnhancementModel::parse)
            .unwrap_or(AudioEnhancementModel::Rnnoise);
        let output_sample_rate = options
            .output_sample_rate
            .filter(|rate| (8_000..=192_000).contains(rate))
            .unwrap_or(FULL_BAND_SAMPLE_RATE);

        // Decode at the target rate (or higher for WAV) so denoising is full-band.
        let (samples, sample_rate) = decode_audio_file_at(&path, output_sample_rate)?;
        if samples.is_empty() {
            return Err("Audio file did not contain usable samples.".to_string());
        }

        let enhanced = enhance_audio_samples(
            &samples,
            sample_rate,
            output_sample_rate,
            AudioEnhancementConfig { model, strength },
        )?;
        if enhanced.is_empty() {
            return Err("Noise reduction produced no audio.".to_string());
        }

        write_wav(&output_path, &enhanced, output_sample_rate)?;

        Ok(EnhanceAudioFileResult {
            output_path: output_path.to_string_lossy().to_string(),
            sample_rate: output_sample_rate,
            duration_ms: ((enhanced.len() as f64 / output_sample_rate as f64) * 1000.0).round()
                as u64,
            model: model.as_str().to_string(),
        })
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
#[specta::specta]
pub fn reveal_enhanced_audio(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("File not found: {}", target.display()));
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to reveal enhanced audio in Finder: {err}"))
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg("/select,")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to reveal enhanced audio in Explorer: {err}"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = target.parent().unwrap_or(target);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("Failed to open the enhanced audio folder: {err}"))
    }
}

#[derive(Debug, Deserialize)]
struct SpeechAnalysisSidecarOutput {
    ok: bool,
    text: Option<String>,
    segments: Option<Vec<TimedSegment>>,
    speaker_turns: Option<Vec<SpeakerTurn>>,
    emotion: Option<EmotionResult>,
    error: Option<String>,
}

fn legacy_speech_analysis_python_path() -> PathBuf {
    if let Ok(path) = std::env::var("VOX_JOT_SPEECH_ANALYSIS_PYTHON") {
        return PathBuf::from(path);
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".venv")
        .join("bin")
        .join("python")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpeechAnalysisPythonRuntime {
    GemmaAudio,
    MlxAudio,
    SpeechAnalysis,
    Legacy,
}

fn speech_analysis_python_runtime(
    asr_model_id: &str,
    diarization_model_id: &str,
    emotion_model_id: &str,
) -> SpeechAnalysisPythonRuntime {
    if speech_analysis::model_uses_gemma_audio_runtime(asr_model_id) {
        return SpeechAnalysisPythonRuntime::GemmaAudio;
    }

    if speech_analysis::model_uses_mlx_native(asr_model_id)
        || speech_analysis::model_uses_mlx_native(diarization_model_id)
    {
        return SpeechAnalysisPythonRuntime::MlxAudio;
    }

    if speech_analysis::model_uses_managed_python_runtime(asr_model_id)
        || speech_analysis::model_uses_managed_python_runtime(diarization_model_id)
        || speech_analysis::model_uses_managed_python_runtime(emotion_model_id)
    {
        return SpeechAnalysisPythonRuntime::SpeechAnalysis;
    }

    SpeechAnalysisPythonRuntime::Legacy
}

fn speech_analysis_python_path(
    sidecar_manager: &Arc<SidecarManager>,
    asr_model_id: &str,
    diarization_model_id: &str,
    emotion_model_id: &str,
) -> Result<PathBuf, String> {
    match speech_analysis_python_runtime(asr_model_id, diarization_model_id, emotion_model_id) {
        SpeechAnalysisPythonRuntime::GemmaAudio => sidecar_manager.ensure_gemma_audio_environment(),
        SpeechAnalysisPythonRuntime::MlxAudio => sidecar_manager.ensure_mlx_audio_environment(),
        SpeechAnalysisPythonRuntime::SpeechAnalysis => {
            sidecar_manager.ensure_speech_analysis_environment()
        }
        SpeechAnalysisPythonRuntime::Legacy => {
            let python = legacy_speech_analysis_python_path();
            if python.exists() {
                Ok(python)
            } else {
                Err(format!(
                    "Speech-analysis Python runtime not found at {}. Vox Jot will normally install the managed runtime automatically; set VOX_JOT_SPEECH_ANALYSIS_PYTHON only for local experiments.",
                    python.display()
                ))
            }
        }
    }
}

fn speech_analysis_sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("VOX_JOT_SPEECH_ANALYSIS_SIDECAR") {
        let path = PathBuf::from(path);
        return if path.exists() {
            Ok(path)
        } else {
            Err(format!(
                "Speech-analysis sidecar not found at {}",
                path.display()
            ))
        };
    }

    let runtime_dir = crate::portable::app_data_dir(app)
        .map_err(|err| format!("Failed to resolve app data dir for speech analysis: {err}"))?
        .join("speech-analysis-runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|err| format!("Failed to create speech-analysis runtime dir: {err}"))?;
    let sidecar = runtime_dir.join("speech_analysis_sidecar.py");
    let should_write = fs::read_to_string(&sidecar)
        .map(|existing| existing != SPEECH_ANALYSIS_SIDECAR_SOURCE)
        .unwrap_or(true);
    if should_write {
        fs::write(&sidecar, SPEECH_ANALYSIS_SIDECAR_SOURCE)
            .map_err(|err| format!("Failed to write speech-analysis sidecar: {err}"))?;
    }
    Ok(sidecar)
}

fn bundled_polyvoice_bin(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let relative = "resources/bin/macos-aarch64/polyvoice";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    let relative = "resources/bin/macos-x64/polyvoice";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    let relative = "resources/bin/linux-x64/polyvoice";
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    let relative = "resources/bin/windows-x64/polyvoice.exe";
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    let relative = "";

    if relative.is_empty() {
        return None;
    }
    crate::portable::resolve_resource(app, relative).ok()
}

fn bundled_polyvoice_model_dir(app: &AppHandle) -> Option<PathBuf> {
    crate::portable::resolve_resource(app, "resources/models/polyvoice").ok()
}

fn parse_speech_analysis_sidecar_output(
    stdout: &[u8],
) -> Result<SpeechAnalysisSidecarOutput, String> {
    serde_json::from_slice::<SpeechAnalysisSidecarOutput>(stdout).or_else(|exact_err| {
        let text = String::from_utf8_lossy(stdout);
        text.lines()
            .rev()
            .map(str::trim)
            .filter(|line| line.starts_with('{'))
            .find_map(|line| serde_json::from_str::<SpeechAnalysisSidecarOutput>(line).ok())
            .ok_or_else(|| format!("Invalid speech-analysis sidecar JSON: {exact_err}"))
    })
}

#[allow(clippy::type_complexity)]
fn run_speech_analysis_sidecar(
    app: &AppHandle,
    sidecar_manager: &Arc<SidecarManager>,
    audio_16k: &[f32],
    asr_model_id: &str,
    diarization_model_id: &str,
    emotion_model_id: &str,
) -> Result<
    (
        String,
        Vec<TimedSegment>,
        Vec<SpeakerTurn>,
        Option<EmotionResult>,
    ),
    String,
> {
    let python = speech_analysis_python_path(
        sidecar_manager,
        asr_model_id,
        diarization_model_id,
        emotion_model_id,
    )?;
    let sidecar = speech_analysis_sidecar_path(app)?;

    let wav = write_temp_wav_16k(audio_16k)?;
    let model_root = crate::storage_paths::speech_analysis_models_dir(app)
        .map_err(|e| format!("Failed to resolve speech-analysis model directory: {e}"))?;
    let stt_model_root = crate::storage_paths::stt_models_dir(app)
        .map_err(|e| format!("Failed to resolve STT model directory: {e}"))?;
    let mut command = Command::new(&python);
    command.env("VOX_JOT_SPEECH_ANALYSIS_MODEL_ROOT", &model_root);
    command.env("VOX_JOT_STT_MODEL_ROOT", &stt_model_root);
    command.env("PYTORCH_ENABLE_MPS_FALLBACK", "1");
    command.env("TOKENIZERS_PARALLELISM", "false");
    if let Some(polyvoice_bin) = bundled_polyvoice_bin(app) {
        command.env("VOX_JOT_POLYVOICE_BIN", polyvoice_bin);
    }
    if let Some(polyvoice_model_dir) = bundled_polyvoice_model_dir(app) {
        command.env("VOX_JOT_POLYVOICE_MODEL_DIR", polyvoice_model_dir);
    }
    if let Some(token) = speech_analysis::hugging_face_token_for_runtime() {
        command.env("HF_TOKEN", token);
    }
    let output_result = command
        .arg(&sidecar)
        .arg("--audio")
        .arg(&wav)
        .arg("--asr-model")
        .arg(asr_model_id)
        .arg("--diarization-model")
        .arg(diarization_model_id)
        .arg("--emotion-model")
        .arg(emotion_model_id)
        .output();
    let _ = std::fs::remove_file(&wav);
    let output =
        output_result.map_err(|e| format!("Failed to run speech-analysis sidecar: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if !stderr.trim().is_empty() {
            stderr.trim()
        } else {
            stdout.trim()
        };
        return Err(format!(
            "Speech-analysis sidecar failed for ASR '{}' and diarization '{}': {}",
            asr_model_id, diarization_model_id, detail
        ));
    }

    let payload = parse_speech_analysis_sidecar_output(&output.stdout)?;
    if !payload.ok {
        return Err(payload
            .error
            .unwrap_or_else(|| "Speech-analysis sidecar returned ok=false".to_string()));
    }

    Ok((
        payload.text.unwrap_or_default(),
        payload.segments.unwrap_or_default(),
        payload.speaker_turns.unwrap_or_default(),
        payload.emotion,
    ))
}

fn timed_segments_to_analysis_segments(segments: &[TimedSegment]) -> Vec<SpeechAnalysisSegment> {
    segments
        .iter()
        .map(|segment| SpeechAnalysisSegment {
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            text: segment.text.clone(),
        })
        .collect()
}

fn whole_file_segment(audio_16k: &[f32], text: &str) -> Vec<TimedSegment> {
    if text.trim().is_empty() {
        return Vec::new();
    }
    vec![TimedSegment {
        start_ms: 0,
        end_ms: ((audio_16k.len() as f64 / 16_000.0) * 1000.0).round() as u64,
        text: text.trim().to_string(),
    }]
}

fn format_speaker_labeled_text(
    labeled_segments: &[SpeakerLabeledSegment],
    fallback_text: &str,
) -> String {
    if labeled_segments.is_empty() {
        return fallback_text.to_string();
    }

    labeled_segments
        .iter()
        .filter(|segment| !segment.text.trim().is_empty())
        .map(|segment| format!("{}: {}", segment.speaker_id, segment.text.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Return type for `transcribe_file`. `segments` is empty when the
/// underlying engine did not expose timestamps (Moonshine/GigaAM/MLX
/// today). The frontend uses an empty list as the signal to disable
/// SRT/WebVTT export buttons.
#[derive(Serialize, Type)]
pub struct TranscriptionFileResult {
    pub text: String,
    pub segments: Vec<TimedSegment>,
    pub speaker_segments: Vec<SpeakerLabeledSegment>,
    pub emotion: Option<EmotionResult>,
}

#[tauri::command]
#[specta::specta]
pub async fn transcribe_file(
    app: AppHandle,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    sidecar_manager: State<'_, Arc<SidecarManager>>,
    correction_store: State<'_, Arc<CorrectionStore>>,
    path: String,
) -> Result<TranscriptionFileResult, String> {
    transcribe_file_impl(
        app,
        Arc::clone(transcription_manager.inner()),
        Arc::clone(sidecar_manager.inner()),
        Arc::clone(correction_store.inner()),
        path,
    )
    .await
}

pub(crate) async fn transcribe_file_impl(
    app: AppHandle,
    manager: Arc<TranscriptionManager>,
    speech_sidecar_manager: Arc<SidecarManager>,
    correction_store: Arc<CorrectionStore>,
    path: String,
) -> Result<TranscriptionFileResult, String> {
    let selection = speech_analysis::selection_from_settings(&app);
    let asr_model_id = selection.asr_model_id.clone();
    let diarization_model_id = selection.diarization_model_id.clone();
    let emotion_model_id = selection.emotion_model_id.clone();
    let use_sidecar_asr = asr_model_id != CURRENT_DICTATION_ASR_ID;
    let use_diarization = speech_analysis::should_run_diarization(&diarization_model_id);
    let use_emotion = speech_analysis::should_run_emotion(&emotion_model_id);
    let mut active_speech_analysis_models = Vec::new();
    if use_sidecar_asr {
        active_speech_analysis_models.push(asr_model_id.clone());
    }
    if use_diarization {
        active_speech_analysis_models.push(diarization_model_id.clone());
    }
    if use_emotion {
        active_speech_analysis_models.push(emotion_model_id.clone());
    }
    let speech_analysis_model_guard =
        speech_analysis::mark_models_in_use(active_speech_analysis_models);
    let is_wav = path.to_ascii_lowercase().ends_with(".wav");
    let sidecar_app = app.clone();
    let ffmpeg_exe = if is_wav {
        None
    } else {
        Some(resolve_ffmpeg_exe())
    };

    let (raw_text, raw_segments, raw_speaker_turns, raw_emotion) = tokio::task::spawn_blocking(
        move || -> Result<
            (
                String,
                Vec<TimedSegment>,
                Vec<SpeakerTurn>,
                Option<EmotionResult>,
            ),
            String,
        > {
            let _speech_analysis_model_guard = speech_analysis_model_guard;
            let audio_16k = if is_wav {
                let (mono, sample_rate) = read_wav_as_mono_f32(&path)?;
                resample_linear(&mono, sample_rate, 16_000)
            } else {
                let ff = ffmpeg_exe.expect("ffmpeg path resolved for non-wav");
                decode_with_ffmpeg_blocking(&ff, &path)?
            };

            if use_sidecar_asr {
                let (sidecar_text, mut sidecar_segments, speaker_turns, emotion) =
                    run_speech_analysis_sidecar(
                        &sidecar_app,
                        &speech_sidecar_manager,
                        &audio_16k,
                        &asr_model_id,
                        &diarization_model_id,
                        &emotion_model_id,
                    )?;
                if sidecar_segments.is_empty() {
                    sidecar_segments = whole_file_segment(&audio_16k, &sidecar_text);
                }
                return Ok((sidecar_text, sidecar_segments, speaker_turns, emotion));
            }

            let (current_text, mut current_segments) = manager
                .transcribe_with_segments(Arc::new(audio_16k.clone()))
                .map_err(|e| format!("Failed to transcribe file: {}", e))?;
            if current_segments.is_empty() {
                current_segments = whole_file_segment(&audio_16k, &current_text);
            }

            // The current-dictation ASR runs in-process, but diarization and
            // emotion still need the sidecar. Invoke it once for whichever of the
            // two is requested; passing the "no_*" ids makes the sidecar skip the
            // unwanted stage.
            let (speaker_turns, emotion) = if use_diarization || use_emotion {
                let (_, _, speaker_turns, emotion) = run_speech_analysis_sidecar(
                    &sidecar_app,
                    &speech_sidecar_manager,
                    &audio_16k,
                    CURRENT_DICTATION_ASR_ID,
                    &diarization_model_id,
                    &emotion_model_id,
                )?;
                (speaker_turns, emotion)
            } else {
                (Vec::new(), None)
            };

            Ok((current_text, current_segments, speaker_turns, emotion))
        },
    )
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    let settings = get_settings(&app);
    let mut text = raw_text;
    if let Some(converted) = crate::actions::maybe_convert_chinese_variant(&settings, &text).await {
        text = converted;
    }

    if settings.file_transcription_apply_dictionary {
        let dict_entries = crate::correction_tracker::store::build_effective_personal_dictionary(
            &settings,
            correction_store.as_ref(),
            None,
        );
        if !dict_entries.is_empty() {
            let dict_result =
                crate::post_processing::apply_personal_dictionary(&text, &dict_entries);
            text = dict_result.text;
        }
    }

    let speaker_segments = if raw_speaker_turns.is_empty() {
        Vec::new()
    } else {
        speech_analysis::align_segments_to_speakers(
            &timed_segments_to_analysis_segments(&raw_segments),
            &raw_speaker_turns,
        )
    };
    if !speaker_segments.is_empty() {
        text = format_speaker_labeled_text(&speaker_segments, &text);
    }

    Ok(TranscriptionFileResult {
        text,
        segments: raw_segments,
        speaker_segments,
        emotion: raw_emotion,
    })
}

/// Render `segments` as SubRip (`.srt`) text and write it to `path`.
///
/// The frontend chooses the path via the standard save dialog so the user
/// retains full control over where files land. Returns the byte count
/// written for the in-app toast message.
#[tauri::command]
#[specta::specta]
pub fn export_subtitles_srt(segments: Vec<TimedSegment>, path: String) -> Result<usize, String> {
    let body = to_srt(&segments);
    std::fs::write(&path, &body)
        .map_err(|e| format!("Failed to write SRT file '{}': {}", path, e))?;
    Ok(body.len())
}

/// Render `segments` as WebVTT (`.vtt`) text and write it to `path`.
#[tauri::command]
#[specta::specta]
pub fn export_subtitles_vtt(segments: Vec<TimedSegment>, path: String) -> Result<usize, String> {
    let body = to_vtt(&segments);
    std::fs::write(&path, &body)
        .map_err(|e| format!("Failed to write VTT file '{}': {}", path, e))?;
    Ok(body.len())
}

// ─────────────────────────────────────────────────────────────────────────
// Watch folders (auto-transcribe files dropped into chosen folders).
// All commands persist via `write_settings`, then ask the manager to
// rebuild its watch list on the next tick. The watcher itself runs on a
// background supervisor thread spun up at startup in `lib.rs`.
// ─────────────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_watch_folders(app: AppHandle) -> Result<Vec<WatchFolderConfig>, String> {
    Ok(annotate_watch_folder_missing_status(
        get_settings(&app).watch_folders,
    ))
}

fn annotate_watch_folder_missing_status(
    mut folders: Vec<WatchFolderConfig>,
) -> Vec<WatchFolderConfig> {
    for folder in &mut folders {
        folder.missing = !Path::new(&folder.path).is_dir();
    }
    folders
}

#[tauri::command]
#[specta::specta]
pub fn add_watch_folder(
    app: AppHandle,
    watch_manager: State<'_, Arc<WatchFolderManager>>,
    path: String,
    output_format: WatchFolderOutputFormat,
    delete_after: bool,
) -> Result<WatchFolderConfig, String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("'{}' is not a folder", path));
    }
    let mut settings = get_settings(&app);
    if settings.watch_folders.iter().any(|f| f.path == path) {
        return Err(format!("'{}' is already being watched", path));
    }
    let cfg = WatchFolderConfig {
        id: uuid::Uuid::new_v4().to_string(),
        path,
        output_format,
        missing: false,
        delete_after,
        enabled: true,
    };
    settings.watch_folders.push(cfg.clone());
    write_settings(&app, settings);
    watch_manager.reload_from_settings();
    Ok(cfg)
}

#[tauri::command]
#[specta::specta]
pub fn remove_watch_folder(
    app: AppHandle,
    watch_manager: State<'_, Arc<WatchFolderManager>>,
    id: String,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    let before = settings.watch_folders.len();
    settings.watch_folders.retain(|f| f.id != id);
    if settings.watch_folders.len() == before {
        return Err(format!("watch folder {} not found", id));
    }
    write_settings(&app, settings);
    watch_manager.reload_from_settings();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_watch_folder_enabled(
    app: AppHandle,
    watch_manager: State<'_, Arc<WatchFolderManager>>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    let folder = settings
        .watch_folders
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("watch folder {} not found", id))?;
    folder.enabled = enabled;
    write_settings(&app, settings);
    watch_manager.reload_from_settings();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_watch_folder_format(
    app: AppHandle,
    watch_manager: State<'_, Arc<WatchFolderManager>>,
    id: String,
    output_format: WatchFolderOutputFormat,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    let folder = settings
        .watch_folders
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("watch folder {} not found", id))?;
    folder.output_format = output_format;
    write_settings(&app, settings);
    watch_manager.reload_from_settings();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::speech_analysis::{
        align_segments_to_speakers, SpeakerLabeledSegment, SpeakerTurn, SpeechAnalysisSegment,
        NO_EMOTION_ID,
    };

    fn labeled(speaker: &str, start_ms: u64, end_ms: u64, text: &str) -> SpeakerLabeledSegment {
        SpeakerLabeledSegment {
            speaker_id: speaker.to_string(),
            start_ms,
            end_ms,
            text: text.to_string(),
            confidence: None,
        }
    }

    #[test]
    fn watch_folder_list_marks_deleted_folders_missing() {
        let temp = tempfile::tempdir().expect("temp dir");
        let existing_path = temp.path().join("existing");
        std::fs::create_dir(&existing_path).expect("existing dir");
        let deleted_path = temp.path().join("deleted");

        let folders = annotate_watch_folder_missing_status(vec![
            WatchFolderConfig {
                id: "existing".to_string(),
                path: existing_path.to_string_lossy().to_string(),
                output_format: WatchFolderOutputFormat::Text,
                missing: true,
                delete_after: false,
                enabled: true,
            },
            WatchFolderConfig {
                id: "deleted".to_string(),
                path: deleted_path.to_string_lossy().to_string(),
                output_format: WatchFolderOutputFormat::Text,
                missing: false,
                delete_after: false,
                enabled: true,
            },
        ]);

        assert!(!folders[0].missing);
        assert!(folders[1].missing);
    }

    #[test]
    fn whole_file_segment_uses_audio_duration_in_ms() {
        // 24_000 samples at 16 kHz = 1.5 s = 1500 ms.
        let audio = vec![0.0_f32; 24_000];
        let segments = whole_file_segment(&audio, "  hello world  ");

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].start_ms, 0);
        assert_eq!(segments[0].end_ms, 1_500);
        assert_eq!(segments[0].text, "hello world");
    }

    #[test]
    fn speech_analysis_python_runtime_prefers_mlx_for_mlx_asr_with_polyvoice() {
        assert_eq!(
            speech_analysis_python_runtime(
                "mlx-mega-asr",
                "onnx-polyvoice-diarization",
                NO_EMOTION_ID,
            ),
            SpeechAnalysisPythonRuntime::MlxAudio,
        );
    }

    #[test]
    fn whole_file_segment_returns_empty_for_blank_text() {
        let audio = vec![0.0_f32; 16_000];
        assert!(whole_file_segment(&audio, "   \n\t  ").is_empty());
        assert!(whole_file_segment(&audio, "").is_empty());
    }

    #[test]
    fn speech_analysis_sidecar_output_accepts_clean_json() {
        let payload = parse_speech_analysis_sidecar_output(
            br#"{"ok":true,"text":"hello","segments":[{"start_ms":0,"end_ms":1000,"text":"hello"}]}"#,
        )
        .expect("clean JSON should parse");

        assert!(payload.ok);
        assert_eq!(payload.text.as_deref(), Some("hello"));
        assert_eq!(payload.segments.unwrap().len(), 1);
    }

    #[test]
    fn speech_analysis_sidecar_output_uses_last_json_line_after_stdout_noise() {
        let payload = parse_speech_analysis_sidecar_output(
            br#"native library banner
download progress: 100%
{"ok":true,"text":"final transcript","segments":[],"speaker_turns":[]}
"#,
        )
        .expect("last JSON line should parse");

        assert!(payload.ok);
        assert_eq!(payload.text.as_deref(), Some("final transcript"));
        assert!(payload.speaker_turns.unwrap().is_empty());
    }

    #[test]
    fn speech_analysis_sidecar_output_rejects_noise_without_json() {
        let error = parse_speech_analysis_sidecar_output(b"native library banner only")
            .expect_err("stdout without JSON should fail");

        assert!(error.contains("Invalid speech-analysis sidecar JSON"));
    }

    #[test]
    fn demucs_runtime_ready_rejects_invalid_named_files() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(
            dir.path().join(DEMUCS_RUNTIME_BINARY),
            b"not the signed binary",
        )
        .expect("write binary placeholder");
        std::fs::write(
            dir.path().join(DEMUCS_RUNTIME_METALLIB),
            b"not the metallib",
        )
        .expect("write metallib placeholder");

        assert!(!demucs_runtime_ready(dir.path()));
    }

    #[test]
    fn demucs_weights_ready_requires_nonempty_files() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(dir.path().join("htdemucs.safetensors"), b"weights").expect("write weights");
        std::fs::write(dir.path().join("htdemucs_config.json"), b"{}").expect("write config");
        assert!(demucs_weights_ready(dir.path()));

        std::fs::write(dir.path().join("htdemucs.safetensors"), b"").expect("truncate weights");
        assert!(!demucs_weights_ready(dir.path()));
    }

    #[test]
    fn timed_segments_to_analysis_segments_preserves_fields() {
        let segments = vec![
            TimedSegment {
                start_ms: 100,
                end_ms: 500,
                text: "alpha".into(),
            },
            TimedSegment {
                start_ms: 600,
                end_ms: 1_200,
                text: "beta".into(),
            },
        ];
        let converted = timed_segments_to_analysis_segments(&segments);

        assert_eq!(converted.len(), 2);
        assert_eq!(
            converted[0],
            SpeechAnalysisSegment {
                start_ms: 100,
                end_ms: 500,
                text: "alpha".into()
            }
        );
        assert_eq!(
            converted[1],
            SpeechAnalysisSegment {
                start_ms: 600,
                end_ms: 1_200,
                text: "beta".into()
            }
        );
    }

    #[test]
    fn format_speaker_labeled_text_falls_back_when_segments_empty() {
        let result = format_speaker_labeled_text(&[], "raw transcript");
        assert_eq!(result, "raw transcript");
    }

    #[test]
    fn format_speaker_labeled_text_joins_speakers_one_per_line() {
        let labeled_segments = vec![
            labeled("SPEAKER_00", 0, 1_000, " hello "),
            labeled("SPEAKER_01", 1_000, 2_000, "world"),
        ];

        let result = format_speaker_labeled_text(&labeled_segments, "fallback");
        assert_eq!(result, "SPEAKER_00: hello\nSPEAKER_01: world");
    }

    #[test]
    fn format_speaker_labeled_text_skips_blank_text_segments() {
        // Only the second segment has text, so the first should be dropped.
        let labeled_segments = vec![
            labeled("SPEAKER_00", 0, 1_000, "   "),
            labeled("SPEAKER_01", 1_000, 2_000, "ok"),
        ];

        let result = format_speaker_labeled_text(&labeled_segments, "fallback");
        assert_eq!(result, "SPEAKER_01: ok");
    }

    #[test]
    fn align_segments_to_speakers_breaks_overlap_ties_by_confidence() {
        // Both turns cover the segment fully, so overlap is equal — the
        // higher-confidence speaker should win.
        let segments = vec![SpeechAnalysisSegment {
            start_ms: 1_000,
            end_ms: 3_000,
            text: "shared".to_string(),
        }];
        let turns = vec![
            SpeakerTurn {
                speaker_id: "LOW".to_string(),
                start_ms: 0,
                end_ms: 4_000,
                confidence: Some(0.30),
                source_model_id: "test".into(),
            },
            SpeakerTurn {
                speaker_id: "HIGH".to_string(),
                start_ms: 0,
                end_ms: 4_000,
                confidence: Some(0.95),
                source_model_id: "test".into(),
            },
        ];

        let labeled = align_segments_to_speakers(&segments, &turns);
        assert_eq!(labeled[0].speaker_id, "HIGH");
        assert_eq!(labeled[0].confidence, Some(0.95));
    }
}
