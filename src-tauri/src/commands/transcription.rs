use crate::correction_tracker::store::CorrectionStore;
use crate::helpers::subtitles::{to_srt, to_vtt, TimedSegment};
use crate::managers::transcription::TranscriptionManager;
use crate::managers::watch_folders::WatchFolderManager;
use crate::settings::{
    get_settings, write_settings, ModelUnloadTimeout, WatchFolderConfig, WatchFolderOutputFormat,
};
use crate::sidecar::SidecarManager;
use crate::speech_analysis::{
    self, SpeakerLabeledSegment, SpeakerTurn, SpeechAnalysisSegment, CURRENT_DICTATION_ASR_ID,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
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
    let mut reader = hound::WavReader::open(path)
        .map_err(|e| format!("Failed to open WAV file '{}': {}", path, e))?;
    let spec = reader.spec();

    if spec.channels == 0 {
        return Err("WAV file has no channels".to_string());
    }

    let mut mono = Vec::new();
    match spec.sample_format {
        hound::SampleFormat::Float => {
            let all: Vec<f32> = reader
                .samples::<f32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed reading WAV float samples: {}", e))?;

            for frame in all.chunks(spec.channels as usize) {
                let sum: f32 = frame.iter().copied().sum();
                mono.push(sum / frame.len() as f32);
            }
        }
        hound::SampleFormat::Int => {
            let all: Vec<i32> = reader
                .samples::<i32>()
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed reading WAV int samples: {}", e))?;

            let scale = 2f32.powi((spec.bits_per_sample as i32) - 1);
            for frame in all.chunks(spec.channels as usize) {
                let sum: f32 = frame.iter().map(|s| (*s as f32) / scale).sum();
                mono.push(sum / frame.len() as f32);
            }
        }
    }

    Ok((mono, spec.sample_rate))
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
            "16000",
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

fn write_temp_wav_16k(samples: &[f32]) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!(
        "vox-jot-speech-analysis-{}.wav",
        uuid::Uuid::new_v4()
    ));
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&path, spec)
        .map_err(|e| format!("Failed to write temporary speech-analysis WAV: {}", e))?;
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
        writer
            .write_sample(value)
            .map_err(|e| format!("Failed to encode speech-analysis WAV sample: {}", e))?;
    }
    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize speech-analysis WAV: {}", e))?;
    Ok(path)
}

#[derive(Debug, Deserialize)]
struct SpeechAnalysisSidecarOutput {
    ok: bool,
    text: Option<String>,
    segments: Option<Vec<TimedSegment>>,
    speaker_turns: Option<Vec<SpeakerTurn>>,
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

fn speech_analysis_python_path(
    sidecar_manager: &Arc<SidecarManager>,
    asr_model_id: &str,
    diarization_model_id: &str,
) -> Result<PathBuf, String> {
    if speech_analysis::model_uses_managed_python_runtime(asr_model_id)
        || speech_analysis::model_uses_managed_python_runtime(diarization_model_id)
    {
        return sidecar_manager.ensure_speech_analysis_environment();
    }

    if speech_analysis::model_uses_mlx_native(asr_model_id)
        || speech_analysis::model_uses_mlx_native(diarization_model_id)
    {
        return sidecar_manager.ensure_mlx_audio_environment();
    }

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

fn run_speech_analysis_sidecar(
    app: &AppHandle,
    sidecar_manager: &Arc<SidecarManager>,
    audio_16k: &[f32],
    asr_model_id: &str,
    diarization_model_id: &str,
) -> Result<(String, Vec<TimedSegment>, Vec<SpeakerTurn>), String> {
    let python = speech_analysis_python_path(sidecar_manager, asr_model_id, diarization_model_id)?;
    let sidecar = speech_analysis_sidecar_path(app)?;

    let wav = write_temp_wav_16k(audio_16k)?;
    let model_root = crate::storage_paths::speech_analysis_models_dir(app)
        .map_err(|e| format!("Failed to resolve speech-analysis model directory: {e}"))?;
    let stt_model_root = crate::storage_paths::stt_models_dir(app)
        .map_err(|e| format!("Failed to resolve STT model directory: {e}"))?;
    let mut command = Command::new(&python);
    command.env("VOX_JOT_SPEECH_ANALYSIS_MODEL_ROOT", &model_root);
    command.env("VOX_JOT_STT_MODEL_ROOT", &stt_model_root);
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
    let manager = transcription_manager.inner().clone();
    let selection = speech_analysis::selection_from_settings(&app);
    let asr_model_id = selection.asr_model_id.clone();
    let diarization_model_id = selection.diarization_model_id.clone();
    let use_sidecar_asr = asr_model_id != CURRENT_DICTATION_ASR_ID;
    let use_diarization = speech_analysis::should_run_diarization(&diarization_model_id);
    let mut active_speech_analysis_models = Vec::new();
    if use_sidecar_asr {
        active_speech_analysis_models.push(asr_model_id.clone());
    }
    if use_diarization {
        active_speech_analysis_models.push(diarization_model_id.clone());
    }
    let speech_analysis_model_guard =
        speech_analysis::mark_models_in_use(active_speech_analysis_models);
    let speech_sidecar_manager = sidecar_manager.inner().clone();
    let is_wav = path.to_ascii_lowercase().ends_with(".wav");
    let sidecar_app = app.clone();
    let ffmpeg_exe = if is_wav {
        None
    } else {
        Some(resolve_ffmpeg_exe())
    };

    let (raw_text, raw_segments, raw_speaker_turns) = tokio::task::spawn_blocking(
        move || -> Result<(String, Vec<TimedSegment>, Vec<SpeakerTurn>), String> {
            let _speech_analysis_model_guard = speech_analysis_model_guard;
            let audio_16k = if is_wav {
                let (mono, sample_rate) = read_wav_as_mono_f32(&path)?;
                resample_linear(&mono, sample_rate, 16_000)
            } else {
                let ff = ffmpeg_exe.expect("ffmpeg path resolved for non-wav");
                decode_with_ffmpeg_blocking(&ff, &path)?
            };

            if use_sidecar_asr {
                let (sidecar_text, mut sidecar_segments, speaker_turns) =
                    run_speech_analysis_sidecar(
                        &sidecar_app,
                        &speech_sidecar_manager,
                        &audio_16k,
                        &asr_model_id,
                        &diarization_model_id,
                    )?;
                if sidecar_segments.is_empty() {
                    sidecar_segments = whole_file_segment(&audio_16k, &sidecar_text);
                }
                return Ok((sidecar_text, sidecar_segments, speaker_turns));
            }

            let (current_text, mut current_segments) = manager
                .transcribe_with_segments(Arc::new(audio_16k.clone()))
                .map_err(|e| format!("Failed to transcribe file: {}", e))?;
            if current_segments.is_empty() {
                current_segments = whole_file_segment(&audio_16k, &current_text);
            }

            let speaker_turns = if use_diarization {
                let (_, _, speaker_turns) = run_speech_analysis_sidecar(
                    &sidecar_app,
                    &speech_sidecar_manager,
                    &audio_16k,
                    CURRENT_DICTATION_ASR_ID,
                    &diarization_model_id,
                )?;
                speaker_turns
            } else {
                Vec::new()
            };

            Ok((current_text, current_segments, speaker_turns))
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
            correction_store.inner().as_ref(),
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
    Ok(get_settings(&app).watch_folders)
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
