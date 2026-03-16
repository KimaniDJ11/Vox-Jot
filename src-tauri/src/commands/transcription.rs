use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, write_settings, ModelUnloadTimeout};
use serde::Serialize;
use specta::Type;
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
    transcription_manager: State<TranscriptionManager>,
) -> Result<ModelLoadStatus, String> {
    Ok(ModelLoadStatus {
        is_loaded: transcription_manager.is_model_loaded(),
        current_model: transcription_manager.get_current_model(),
    })
}

#[tauri::command]
#[specta::specta]
pub fn unload_model_manually(
    transcription_manager: State<TranscriptionManager>,
) -> Result<(), String> {
    transcription_manager
        .unload_model()
        .map_err(|e| format!("Failed to unload model: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn transcribe_file(
    transcription_manager: State<TranscriptionManager>,
    path: String,
) -> Result<String, String> {
    if !path.to_ascii_lowercase().ends_with(".wav") {
        return Err("Only WAV files are currently supported for local file transcription".into());
    }

    let (mono, sample_rate) = read_wav_as_mono_f32(&path)?;
    let audio_16k = resample_linear(&mono, sample_rate, 16_000);

    transcription_manager
        .transcribe(audio_16k)
        .map_err(|e| format!("Failed to transcribe file: {}", e))
}
