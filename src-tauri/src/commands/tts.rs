use crate::managers::transcription::TranscriptionManager;
use crate::settings::{
    build_tts_preset_from_legacy, get_settings, sanitize_tts_voice_tuning_for_target,
    write_settings, AppSettings, TtsVoicePreset, TtsVoicePresetInput, TtsVoiceTuningSettings,
};
use crate::tts::{default_preview_request, SpeakRequest, TtsManager, TtsPackInfo, VoiceInfo};
use crate::tts_profiles::{
    clear_collected_data, create_voice_profile, delete_voice_profile, get_profile_progress,
    import_profile_reference_audio, list_voice_profiles, maybe_backfill_profile_transcript,
    read_wav_as_mono_16k, resolve_voice_profile, set_continuous_improvement,
    TtsVoiceProfileDescriptor,
};
use hound::{WavSpec, WavWriter};
use log::warn;
use rodio::Source;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs::{self, File};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const TTS_COMMAND_STACK_BYTES: usize = 64 * 1024 * 1024;
const READER_EXPORT_SAMPLE_RATE: u32 = 24_000;
const READER_EXPORT_UNIT_GAP_SECONDS: f32 = 0.12;

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_reader_playback_rate(value: Option<f32>) -> Result<Option<f32>, String> {
    match value {
        Some(rate) if !rate.is_finite() => {
            Err("Reader playback speed must be a finite number.".to_string())
        }
        Some(rate) => Ok(Some(rate.clamp(0.5, 2.0))),
        None => Ok(None),
    }
}

fn reader_preset_for_request(
    settings: &AppSettings,
    preset_id: Option<&str>,
    playback_rate: Option<f32>,
) -> Result<TtsVoicePreset, String> {
    let mut preset = if let Some(preset_id) = preset_id.filter(|value| !value.trim().is_empty()) {
        settings
            .tts_preset(preset_id)
            .cloned()
            .ok_or_else(|| format!("Unknown Reader voice preset '{}'.", preset_id))?
    } else {
        settings
            .active_tts_preset()
            .cloned()
            .unwrap_or_else(|| build_tts_preset_from_legacy(settings, None))
    };

    if let Some(rate) = playback_rate {
        preset.tuning.tempo_rate = rate.clamp(0.5, 2.0);
    }

    Ok(preset)
}

fn sanitize_tuning(tuning: &mut TtsVoiceTuningSettings, provider_id: &str, model_id: &str) {
    tuning.tempo_rate = tuning.tempo_rate.clamp(0.5, 2.0);
    tuning.expressiveness = tuning.expressiveness.clamp(0.0, 1.0);
    tuning.exaggeration = tuning.exaggeration.clamp(0.0, 2.0);
    tuning.randomness = tuning.randomness.clamp(0.0, 1.0);
    tuning.guidance = tuning.guidance.clamp(0.0, 1.0);
    tuning.stability = tuning.stability.clamp(0.0, 1.0);
    let _ = sanitize_tts_voice_tuning_for_target(tuning, provider_id, model_id);
    tuning.style_instructions = normalize_optional_string(tuning.style_instructions.clone());
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceChangerResult {
    pub source_path: String,
    pub output_path: String,
    pub target_profile_label: String,
    pub provider_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudioExportUnit {
    pub text: String,
    pub preset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReaderAudioExportResult {
    pub output_path: String,
    pub unit_count: usize,
    pub duration_ms: u32,
}

fn fallback_preset_label(input: &TtsVoicePresetInput) -> String {
    if let Some(label) = input
        .label
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return label.trim().to_string();
    }
    if let Some(snapshot) = input
        .voice_label_snapshot
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return snapshot.trim().to_string();
    }
    if input
        .voice_profile_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return "Cloned Voice".to_string();
    }
    if let Some(voice_id) = input
        .voice_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return voice_id.to_string();
    }
    if !input.model_id.trim().is_empty() {
        return input.model_id.trim().to_string();
    }
    "Voice Preset".to_string()
}

pub(crate) fn preset_from_input(
    input: TtsVoicePresetInput,
    preset_id: Option<String>,
) -> Result<TtsVoicePreset, String> {
    if input.provider_id.trim().is_empty() {
        return Err("A TTS provider is required for voice presets.".to_string());
    }
    if input.model_id.trim().is_empty() {
        return Err("A TTS model is required for voice presets.".to_string());
    }

    let label = fallback_preset_label(&input);
    let mut tuning = input.tuning;
    sanitize_tuning(&mut tuning, &input.provider_id, &input.model_id);

    Ok(TtsVoicePreset {
        id: preset_id.unwrap_or_else(|| format!("tts-preset-{}", Uuid::new_v4())),
        label,
        provider_id: input.provider_id.trim().to_string(),
        model_id: input.model_id.trim().to_string(),
        voice_id: normalize_optional_string(input.voice_id),
        voice_profile_id: normalize_optional_string(input.voice_profile_id),
        voice_label_snapshot: normalize_optional_string(input.voice_label_snapshot),
        locale_snapshot: normalize_optional_string(input.locale_snapshot),
        tuning,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn tts_speak(
    app: AppHandle,
    text: String,
    locale: Option<String>,
    preferred_voice_id: Option<String>,
    trigger: Option<String>,
    remember_last_output: Option<bool>,
) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    speak_on_command_thread(
        manager,
        SpeakRequest {
            text,
            locale,
            preferred_voice_id,
            preset_id: None,
            inline_preset: None,
            trigger,
            remember_last_output: remember_last_output.unwrap_or(false),
        },
        "tts-command-speak",
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn tts_speak_with_preset(
    app: AppHandle,
    text: String,
    locale: Option<String>,
    preset_id: String,
    trigger: Option<String>,
    remember_last_output: Option<bool>,
) -> Result<(), String> {
    let normalized_preset_id = preset_id.trim().to_string();
    if normalized_preset_id.is_empty() {
        return Err("A voice preset is required for Reader playback.".to_string());
    }

    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    speak_on_command_thread(
        manager,
        SpeakRequest {
            text,
            locale,
            preferred_voice_id: None,
            preset_id: Some(normalized_preset_id),
            inline_preset: None,
            trigger,
            remember_last_output: remember_last_output.unwrap_or(false),
        },
        "tts-command-speak-preset",
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn tts_speak_reader(
    app: AppHandle,
    text: String,
    locale: Option<String>,
    preset_id: Option<String>,
    playback_rate: Option<f32>,
    trigger: Option<String>,
    remember_last_output: Option<bool>,
) -> Result<(), String> {
    let normalized_rate = normalize_reader_playback_rate(playback_rate)?;
    let settings = get_settings(&app);
    let preset = reader_preset_for_request(&settings, preset_id.as_deref(), normalized_rate)?;
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    speak_on_command_thread(
        manager,
        SpeakRequest {
            text,
            locale,
            preferred_voice_id: None,
            preset_id: None,
            inline_preset: Some(preset),
            trigger,
            remember_last_output: remember_last_output.unwrap_or(false),
        },
        "tts-command-reader-speak",
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn export_reader_audio(
    app: AppHandle,
    units: Vec<ReaderAudioExportUnit>,
    output_path: String,
    playback_rate: Option<f32>,
) -> Result<ReaderAudioExportResult, String> {
    let normalized_rate = normalize_reader_playback_rate(playback_rate)?;
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-reader-export", move || async move {
        export_reader_audio_inner(app, manager, units, output_path, normalized_rate).await
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn tts_stop(app: AppHandle) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.stop();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_available_tts_voices(app: AppHandle) -> Result<Vec<VoiceInfo>, String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-list-voices", move || async move {
        let settings = get_settings(&app);
        let provider_id = manager.selected_provider_id(&settings);
        manager
            .ensure_managed_speech_runtime_available(&provider_id)
            .await?;
        manager.get_available_voices()
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_tts_voices_for_selection(
    app: AppHandle,
    provider_id: String,
    model_id: Option<String>,
) -> Result<Vec<VoiceInfo>, String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-selection-voices", move || async move {
        manager
            .ensure_managed_speech_runtime_available(&provider_id)
            .await?;
        manager.get_available_voices_for_selection(&provider_id, model_id.as_deref())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn refresh_tts_voices(app: AppHandle) -> Result<Vec<VoiceInfo>, String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-refresh-voices", move || async move {
        let settings = get_settings(&app);
        let provider_id = manager.selected_provider_id(&settings);
        manager
            .ensure_managed_speech_runtime_available(&provider_id)
            .await?;
        manager.invalidate_voice_cache();
        manager.get_available_voices()
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice(
    app: AppHandle,
    voice_id: Option<String>,
    preview_text: Option<String>,
) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    speak_on_command_thread(
        manager,
        default_preview_request(voice_id, normalize_optional_string(preview_text)),
        "tts-command-preview-voice",
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice_preset(
    app: AppHandle,
    preset_id: String,
    preview_text: Option<String>,
) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    let mut request = default_preview_request(None, normalize_optional_string(preview_text));
    request.trigger = Some("preview_tts_voice_preset".to_string());
    request.preset_id = Some(preset_id);
    speak_on_command_thread(manager, request, "tts-command-preview-preset").await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice_preset_draft(
    app: AppHandle,
    input: TtsVoicePresetInput,
    preview_text: Option<String>,
) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    let mut request = default_preview_request(None, normalize_optional_string(preview_text));
    request.trigger = Some("preview_tts_voice_preset_draft".to_string());
    request.inline_preset = Some(preset_from_input(input, None)?);
    speak_on_command_thread(manager, request, "tts-command-preview-draft").await
}

#[tauri::command]
#[specta::specta]
pub async fn prepare_sidecar_engine(app: AppHandle, provider_id: String) -> Result<(), String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    run_tts_async_command_on_stack("tts-command-prepare-sidecar", move || async move {
        manager.prepare_sidecar_provider(&provider_id, None).await
    })
    .await
}

async fn run_tts_async_command_on_stack<T, F, Fut>(
    thread_name: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = Result<T, String>> + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    thread::Builder::new()
        .name(thread_name.to_string())
        .stack_size(TTS_COMMAND_STACK_BYTES)
        .spawn(move || {
            let result = (|| {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|err| format!("Failed to start TTS command runtime: {err}"))?;
                runtime.block_on(task())
            })();
            let _ = tx.send(result);
        })
        .map_err(|err| format!("Failed to start TTS command thread: {err}"))?;

    rx.await
        .map_err(|_| "TTS command thread stopped before returning a result.".to_string())?
}

async fn speak_on_command_thread(
    manager: Arc<TtsManager>,
    request: SpeakRequest,
    thread_name: &'static str,
) -> Result<(), String> {
    run_tts_async_command_on_stack(
        thread_name,
        move || async move { manager.speak(request).await },
    )
    .await
}

async fn export_reader_audio_inner(
    app: AppHandle,
    manager: Arc<TtsManager>,
    units: Vec<ReaderAudioExportUnit>,
    output_path: String,
    playback_rate: Option<f32>,
) -> Result<ReaderAudioExportResult, String> {
    let target = PathBuf::from(output_path.trim());
    if target.as_os_str().is_empty() {
        return Err("Choose where to save the Reader audio file.".to_string());
    }
    if let Some(parent) = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create Reader audio export folder: {err}"))?;
    }

    let settings = get_settings(&app);
    let stop_flag = Arc::new(AtomicBool::new(false));
    let mut output_samples = Vec::new();
    let mut rendered_units = 0usize;
    let gap_samples =
        (READER_EXPORT_SAMPLE_RATE as f32 * READER_EXPORT_UNIT_GAP_SECONDS).round() as usize;

    for unit in units {
        let text = unit.text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        let preset =
            reader_preset_for_request(&settings, unit.preset_id.as_deref(), playback_rate)?;
        let temp_paths = manager
            .synthesize_to_temp_files(
                SpeakRequest {
                    text,
                    locale: None,
                    preferred_voice_id: None,
                    preset_id: None,
                    inline_preset: Some(preset),
                    trigger: Some("reader_audio_export".to_string()),
                    remember_last_output: false,
                },
                Arc::clone(&stop_flag),
            )
            .await?;

        let mut unit_samples = Vec::new();
        for temp_path in temp_paths {
            let decoded = decode_rendered_audio_file_mono(&temp_path, READER_EXPORT_SAMPLE_RATE)?;
            unit_samples.extend(decoded);
            let _ = fs::remove_file(temp_path);
        }
        if unit_samples.is_empty() {
            continue;
        }
        if !output_samples.is_empty() && gap_samples > 0 {
            output_samples.extend(std::iter::repeat_n(0.0, gap_samples));
        }
        output_samples.extend(unit_samples);
        rendered_units += 1;
    }

    if rendered_units == 0 || output_samples.is_empty() {
        return Err("There is no readable text to export.".to_string());
    }

    write_reader_export_wav(&output_samples, READER_EXPORT_SAMPLE_RATE, &target)?;
    let duration_ms = ((output_samples.len() as f64 / f64::from(READER_EXPORT_SAMPLE_RATE))
        * 1000.0)
        .round() as u32;

    Ok(ReaderAudioExportResult {
        output_path: target.to_string_lossy().to_string(),
        unit_count: rendered_units,
        duration_ms,
    })
}

fn decode_rendered_audio_file_mono(
    path: &Path,
    target_sample_rate: u32,
) -> Result<Vec<f32>, String> {
    let file = File::open(path).map_err(|err| {
        format!(
            "Failed to open rendered Reader audio '{}': {err}",
            path.display()
        )
    })?;
    let decoder = rodio::Decoder::try_from(file).map_err(|err| {
        format!(
            "Failed to decode rendered Reader audio '{}': {err}",
            path.display()
        )
    })?;
    let channels = usize::from(decoder.channels()).max(1);
    let sample_rate = decoder.sample_rate();
    let interleaved = decoder.collect::<Vec<f32>>();
    let mono = if channels == 1 {
        interleaved
    } else {
        interleaved
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
            .collect::<Vec<_>>()
    };
    Ok(resample_reader_audio_linear(
        &mono,
        sample_rate,
        target_sample_rate,
    ))
}

fn resample_reader_audio_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate {
        return samples.to_vec();
    }

    let output_len =
        ((samples.len() as f64 * target_rate as f64) / source_rate as f64).round() as usize;
    if output_len == 0 {
        return Vec::new();
    }
    if samples.len() == 1 {
        return vec![samples[0]; output_len];
    }

    let ratio = source_rate as f64 / target_rate as f64;
    (0..output_len)
        .map(|index| {
            let source_pos = index as f64 * ratio;
            let left = source_pos.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let frac = (source_pos - left as f64) as f32;
            samples[left] * (1.0 - frac) + samples[right] * frac
        })
        .collect()
}

fn write_reader_export_wav(
    samples: &[f32],
    sample_rate: u32,
    output_path: &Path,
) -> Result<(), String> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer =
        WavWriter::create(output_path, spec).map_err(|err| format!("WAV write error: {err}"))?;
    for sample in samples {
        let sample_i16 = (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
        writer
            .write_sample(sample_i16)
            .map_err(|err| format!("WAV sample write error: {err}"))?;
    }
    writer
        .finalize()
        .map_err(|err| format!("WAV finalize error: {err}"))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_available_tts_packs(app: AppHandle) -> Result<Vec<TtsPackInfo>, String> {
    let manager = app.state::<Arc<TtsManager>>();
    Ok(manager.get_available_packs())
}

#[tauri::command]
#[specta::specta]
pub fn download_tts_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    if pack_id.trim().is_empty() {
        return Err("TTS pack id is required.".to_string());
    }

    let manager = app.state::<Arc<TtsManager>>().inner().clone();
    let event_app = app.clone();
    let event_pack_id = pack_id.clone();
    let cancel_flag = crate::artifact_download::register_download_cancel_flag("tts", &pack_id);
    // download_pack has a large async state machine that overflows the default 2 MB tokio
    // worker stack on macOS ARM64. Spawn a dedicated OS thread with TTS_COMMAND_STACK_BYTES.
    thread::Builder::new()
        .name("tts-command-download-pack".to_string())
        .stack_size(TTS_COMMAND_STACK_BYTES)
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(err) => {
                    let msg = format!("Failed to start TTS download runtime: {err}");
                    warn!("{msg}");
                    emit_tts_pack_download_progress(
                        &event_app,
                        &event_pack_id,
                        "failed",
                        Some(&msg),
                    );
                    return;
                }
            };
            emit_tts_pack_download_progress(&event_app, &event_pack_id, "preparing", None);
            let result =
                runtime.block_on(manager.download_pack(&pack_id, Some(Arc::clone(&cancel_flag))));
            crate::artifact_download::clear_download_cancel_flag("tts", &event_pack_id);
            match result {
                Ok(()) => {
                    emit_tts_pack_download_progress(&event_app, &event_pack_id, "complete", None)
                }
                Err(error) => {
                    warn!("TTS pack download failed for {event_pack_id}: {error}");
                    emit_tts_pack_download_progress(
                        &event_app,
                        &event_pack_id,
                        "failed",
                        Some(&error),
                    );
                }
            }
        })
        .map_err(|err| format!("Failed to start TTS download thread: {err}"))?;
    Ok(())
}

fn emit_tts_pack_download_progress(
    app: &AppHandle,
    pack_id: &str,
    stage: &str,
    error: Option<&str>,
) {
    let payload = serde_json::json!({
        "repo_id": pack_id,
        "stage": stage,
        "file": null,
        "file_index": null,
        "file_count": null,
        "downloaded_bytes": null,
        "total_bytes": null,
        "error": error,
    });
    let _ = app.emit("tts-hf-download-progress", payload);
}

#[tauri::command]
#[specta::specta]
pub fn remove_tts_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.remove_pack(&pack_id)
}

#[tauri::command]
#[specta::specta]
pub fn list_tts_voice_presets(app: AppHandle) -> Result<Vec<TtsVoicePreset>, String> {
    let mut settings = get_settings(&app);
    let profiles = list_voice_profiles(&app)?;
    let removed_presets = settings.delete_tts_presets_for_missing_profiles(
        profiles.iter().map(|profile| profile.id.as_str()),
    );
    let removed_retired_presets =
        settings.delete_tts_presets_for_models(crate::tts::retired_tts_model_ids().iter().copied());
    if removed_presets > 0 || removed_retired_presets > 0 {
        write_settings(&app, settings.clone());
    }
    Ok(settings.tts_voice_presets)
}

#[tauri::command]
#[specta::specta]
pub fn create_tts_voice_preset(
    app: AppHandle,
    input: TtsVoicePresetInput,
) -> Result<TtsVoicePreset, String> {
    let mut settings = get_settings(&app);
    let preset = preset_from_input(input, None)?;
    settings.upsert_tts_preset(preset.clone());
    settings.set_active_tts_preset_id(Some(preset.id.clone()));
    settings.sync_legacy_tts_state_from_active_preset();
    write_settings(&app, settings);
    Ok(preset)
}

#[tauri::command]
#[specta::specta]
pub fn update_tts_voice_preset(
    app: AppHandle,
    preset_id: String,
    input: TtsVoicePresetInput,
) -> Result<TtsVoicePreset, String> {
    let mut settings = get_settings(&app);
    if settings.tts_preset(&preset_id).is_none() {
        return Err(format!("Unknown voice preset '{}'.", preset_id));
    }

    let preset = preset_from_input(input, Some(preset_id.clone()))?;
    settings.upsert_tts_preset(preset.clone());
    if settings.tts_active_preset_id.as_deref() == Some(preset_id.as_str()) {
        settings.sync_legacy_tts_state_from_active_preset();
    }
    write_settings(&app, settings);
    Ok(preset)
}

#[tauri::command]
#[specta::specta]
pub fn delete_tts_voice_preset(app: AppHandle, preset_id: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    if !settings.delete_tts_preset(&preset_id) {
        return Err(format!("Unknown voice preset '{}'.", preset_id));
    }
    settings.set_active_tts_preset_id(settings.tts_active_preset_id.clone());
    settings.sync_legacy_tts_state_from_active_preset();
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_active_tts_voice_preset(
    app: AppHandle,
    preset_id: String,
) -> Result<TtsVoicePreset, String> {
    let mut settings = get_settings(&app);
    let Some(preset) = settings.tts_preset(&preset_id).cloned() else {
        return Err(format!("Unknown voice preset '{}'.", preset_id));
    };
    settings.set_active_tts_preset_id(Some(preset_id));
    settings.sync_legacy_tts_state_from_active_preset();
    write_settings(&app, settings);
    Ok(preset)
}

#[tauri::command]
#[specta::specta]
pub fn list_tts_voice_profiles(app: AppHandle) -> Result<Vec<TtsVoiceProfileDescriptor>, String> {
    list_voice_profiles(&app)
}

#[tauri::command]
#[specta::specta]
pub fn create_tts_voice_profile(
    app: AppHandle,
    label: String,
    description: Option<String>,
    transcript: Option<String>,
) -> Result<TtsVoiceProfileDescriptor, String> {
    create_voice_profile(&app, label, description, transcript)
}

#[tauri::command]
#[specta::specta]
pub fn import_tts_voice_profile_sample(
    app: AppHandle,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    profile_id: String,
    source_path: String,
    transcript: Option<String>,
) -> Result<TtsVoiceProfileDescriptor, String> {
    let descriptor = import_profile_reference_audio(&app, &profile_id, &source_path, transcript)?;
    let has_transcript = descriptor
        .transcript
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    if has_transcript {
        return Ok(descriptor);
    }

    let manager = Arc::clone(&*transcription_manager);
    match maybe_backfill_profile_transcript(&app, &profile_id, |reference_audio_path| {
        manager.initiate_model_load();
        let audio_16k = read_wav_as_mono_16k(reference_audio_path)?;
        if audio_16k.is_empty() {
            return Ok(None);
        }
        let transcript = manager
            .transcribe(Arc::new(audio_16k))
            .map_err(|err| format!("Failed to auto-transcribe voice reference audio: {err}"))?;
        let trimmed = transcript.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }
        Ok(Some(trimmed.to_string()))
    }) {
        Ok(updated) => Ok(updated),
        Err(err) => {
            warn!(
                "Could not auto-transcribe reference audio for profile '{}': {}",
                profile_id, err
            );
            Ok(descriptor)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn delete_tts_voice_profile(app: AppHandle, profile_id: String) -> Result<(), String> {
    delete_voice_profile(&app, &profile_id)
}

#[tauri::command]
#[specta::specta]
pub fn set_active_improvement_profile(
    app: AppHandle,
    profile_id: String,
    enabled: bool,
) -> Result<TtsVoiceProfileDescriptor, String> {
    set_continuous_improvement(&app, &profile_id, enabled)
}

#[tauri::command]
#[specta::specta]
pub fn clear_profile_collected_data(
    app: AppHandle,
    profile_id: String,
) -> Result<TtsVoiceProfileDescriptor, String> {
    clear_collected_data(&app, &profile_id)
}

#[tauri::command]
#[specta::specta]
pub fn get_voice_profile_progress(
    app: AppHandle,
    profile_id: String,
) -> Result<TtsVoiceProfileDescriptor, String> {
    get_profile_progress(&app, &profile_id)
}

#[tauri::command]
#[specta::specta]
pub async fn convert_voice_sample(
    app: AppHandle,
    source_path: String,
    profile_id: String,
    tau: Option<f32>,
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<VoiceChangerResult, String> {
    let source = PathBuf::from(source_path.trim());
    convert_voice_source(app, source, profile_id, tau, provider_id, model_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn convert_voice_recording(
    app: AppHandle,
    wav_bytes: Vec<u8>,
    profile_id: String,
    tau: Option<f32>,
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<VoiceChangerResult, String> {
    if wav_bytes.is_empty() {
        return Err("No microphone audio was captured.".to_string());
    }

    let app_data_dir = crate::portable::app_data_dir(&app)
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    let source_dir = app_data_dir.join("voice-changer").join("sources");
    std::fs::create_dir_all(&source_dir)
        .map_err(|err| format!("Failed to create Voice Changer source directory: {err}"))?;
    let source = source_dir.join(format!(
        "voice-changer-source-{}-{}.wav",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        Uuid::new_v4()
    ));
    std::fs::write(&source, wav_bytes)
        .map_err(|err| format!("Failed to save microphone recording: {err}"))?;

    convert_voice_source(app, source, profile_id, tau, provider_id, model_id).await
}

fn resolve_voice_changer_model(
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<(String, String), String> {
    let requested_model_id = model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let provider_id = provider_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or({
            if matches!(
                requested_model_id,
                Some("chatterbox" | "chatterbox-turbo" | "chatterbox-multilingual")
            ) {
                "chatterbox"
            } else {
                "openvoice"
            }
        });
    let model_id = requested_model_id.unwrap_or(provider_id);

    let supported = matches!(
        (provider_id, model_id),
        ("openvoice", "openvoice")
            | ("chatterbox", "chatterbox")
            | ("chatterbox", "chatterbox-turbo")
            | ("chatterbox", "chatterbox-multilingual")
    );
    if !supported {
        return Err(format!(
            "{provider_id}/{model_id} does not support Voice Changer audio conversion."
        ));
    }

    Ok((provider_id.to_string(), model_id.to_string()))
}

async fn convert_voice_source(
    app: AppHandle,
    source: PathBuf,
    profile_id: String,
    tau: Option<f32>,
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<VoiceChangerResult, String> {
    if !source.exists() {
        return Err(format!("Source audio file not found: {}", source.display()));
    }

    if source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("wav"))
        != Some(true)
    {
        return Err("Voice Changer currently accepts WAV source audio.".to_string());
    }

    let (provider_id, model_id) = resolve_voice_changer_model(provider_id, model_id)?;
    let profile = resolve_voice_profile(&app, &profile_id)?;
    let _model_use_guard = app
        .try_state::<Arc<TtsManager>>()
        .map(|manager| manager.track_model_use(Some(model_id.as_str())));
    let sidecar = app
        .try_state::<Arc<crate::sidecar::SidecarManager>>()
        .ok_or_else(|| "Speech runtime manager is not available.".to_string())?;
    let sidecar = Arc::clone(&*sidecar);
    let sidecar_for_start = Arc::clone(&sidecar);
    tokio::task::spawn_blocking(move || sidecar_for_start.ensure_speech_runtime())
        .await
        .map_err(|err| format!("Failed to start Speech runtime: {err}"))??;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|err| format!("Failed to create voice changer client: {err}"))?;
    let request_payload = serde_json::json!({
        "source_audio_path": source.to_string_lossy(),
        "provider_id": provider_id.clone(),
        "model": model_id.clone(),
        "profile_id": profile_id,
        "tau": tau.unwrap_or(0.3).clamp(0.0, 1.0),
    });
    let mut response = client
        .post("http://127.0.0.1:8008/v1/audio/voice-conversion")
        .json(&request_payload)
        .send()
        .await
        .map_err(|err| format!("Voice Changer request failed: {err}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        let sidecar_for_restart = Arc::clone(&sidecar);
        tokio::task::spawn_blocking(move || sidecar_for_restart.restart_speech_runtime())
            .await
            .map_err(|err| format!("Failed to restart Speech runtime: {err}"))??;
        response = client
            .post("http://127.0.0.1:8008/v1/audio/voice-conversion")
            .json(&request_payload)
            .send()
            .await
            .map_err(|err| format!("Voice Changer request failed after runtime restart: {err}"))?;
    }

    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .text()
            .await
            .unwrap_or_else(|_| "No error detail returned.".to_string());
        return Err(format!("Voice Changer failed ({status}): {detail}"));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read converted voice audio: {err}"))?;
    if bytes.is_empty() {
        return Err("Voice Changer returned empty audio.".to_string());
    }

    let app_data_dir = crate::portable::app_data_dir(&app)
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    let output_dir = app_data_dir.join("voice-changer");
    std::fs::create_dir_all(&output_dir)
        .map_err(|err| format!("Failed to create Voice Changer output directory: {err}"))?;
    let output_path = output_dir.join(format!(
        "voice-changer-{}-{}.wav",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        Uuid::new_v4()
    ));
    std::fs::write(&output_path, bytes)
        .map_err(|err| format!("Failed to save converted voice audio: {err}"))?;

    Ok(VoiceChangerResult {
        source_path: source.to_string_lossy().to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        target_profile_label: profile.label,
        provider_id,
        model_id,
    })
}
