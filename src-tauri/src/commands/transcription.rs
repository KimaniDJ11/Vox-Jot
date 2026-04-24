use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, write_settings, ModelUnloadTimeout};
use serde::Serialize;
use specta::Type;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, State};

fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
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

fn read_wav_as_mono_f32(path: &str) -> Result<(Vec<f32>, u32), String> {
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

fn resolve_ffmpeg_exe() -> PathBuf {
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
    PathBuf::from(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" })
}

fn decode_with_ffmpeg_blocking(ffmpeg_exe: &Path, input_path: &str) -> Result<Vec<f32>, String> {
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

#[tauri::command]
#[specta::specta]
pub async fn transcribe_file(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    path: String,
) -> Result<String, String> {
    let manager = transcription_manager.inner().clone();
    let is_wav = path.to_ascii_lowercase().ends_with(".wav");
    let ffmpeg_exe = if is_wav {
        None
    } else {
        Some(resolve_ffmpeg_exe())
    };

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let audio_16k = if is_wav {
            let (mono, sample_rate) = read_wav_as_mono_f32(&path)?;
            resample_linear(&mono, sample_rate, 16_000)
        } else {
            let ff = ffmpeg_exe.expect("ffmpeg path resolved for non-wav");
            decode_with_ffmpeg_blocking(&ff, &path)?
        };

        manager
            .transcribe(Arc::new(audio_16k))
            .map_err(|e| format!("Failed to transcribe file: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
