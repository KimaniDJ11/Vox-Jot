use crate::managers::transcription::TranscriptionManager;
use crate::settings::{
    get_settings, sanitize_tts_voice_tuning_for_target, write_settings, TtsVoicePreset,
    TtsVoicePresetInput, TtsVoiceTuningSettings,
};
use crate::tts::{default_preview_request, SpeakRequest, TtsManager, TtsPackInfo, VoiceInfo};
use crate::tts_profiles::{
    clear_collected_data, create_voice_profile, delete_voice_profile, get_profile_progress,
    import_profile_reference_audio, list_voice_profiles, maybe_backfill_profile_transcript,
    read_wav_as_mono_16k, resolve_voice_profile, set_continuous_improvement,
    TtsVoiceProfileDescriptor,
};
use log::warn;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

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
    let manager = app.state::<Arc<TtsManager>>();
    manager
        .speak(SpeakRequest {
            text,
            locale,
            preferred_voice_id,
            preset_id: None,
            inline_preset: None,
            trigger,
            remember_last_output: remember_last_output.unwrap_or(false),
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
    tokio::task::spawn_blocking(move || manager.get_available_voices())
        .await
        .map_err(|err| format!("Failed to load TTS voices: {err}"))?
}

#[tauri::command]
#[specta::specta]
pub async fn get_tts_voices_for_selection(
    app: AppHandle,
    provider_id: String,
    model_id: Option<String>,
) -> Result<Vec<VoiceInfo>, String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    tokio::task::spawn_blocking(move || {
        manager.get_available_voices_for_selection(&provider_id, model_id.as_deref())
    })
    .await
    .map_err(|err| format!("Failed to load TTS voices for selection: {err}"))?
}

#[tauri::command]
#[specta::specta]
pub async fn refresh_tts_voices(app: AppHandle) -> Result<Vec<VoiceInfo>, String> {
    let manager = Arc::clone(&*app.state::<Arc<TtsManager>>());
    tokio::task::spawn_blocking(move || {
        manager.invalidate_voice_cache();
        manager.get_available_voices()
    })
    .await
    .map_err(|err| format!("Failed to refresh TTS voices: {err}"))?
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice(
    app: AppHandle,
    voice_id: Option<String>,
    preview_text: Option<String>,
) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager
        .speak(default_preview_request(
            voice_id,
            normalize_optional_string(preview_text),
        ))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice_preset(
    app: AppHandle,
    preset_id: String,
    preview_text: Option<String>,
) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    let mut request = default_preview_request(None, normalize_optional_string(preview_text));
    request.trigger = Some("preview_tts_voice_preset".to_string());
    request.preset_id = Some(preset_id);
    manager.speak(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_tts_voice_preset_draft(
    app: AppHandle,
    input: TtsVoicePresetInput,
    preview_text: Option<String>,
) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    let mut request = default_preview_request(None, normalize_optional_string(preview_text));
    request.trigger = Some("preview_tts_voice_preset_draft".to_string());
    request.inline_preset = Some(preset_from_input(input, None)?);
    manager.speak(request).await
}

#[tauri::command]
#[specta::specta]
pub async fn prepare_sidecar_engine(app: AppHandle, provider_id: String) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.prepare_sidecar_provider(&provider_id, None).await
}

#[tauri::command]
#[specta::specta]
pub fn get_available_tts_packs(app: AppHandle) -> Result<Vec<TtsPackInfo>, String> {
    let manager = app.state::<Arc<TtsManager>>();
    Ok(manager.get_available_packs())
}

#[tauri::command]
#[specta::specta]
pub async fn download_tts_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    manager.download_pack(&pack_id).await
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
    let settings = get_settings(&app);
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
) -> Result<VoiceChangerResult, String> {
    let source = PathBuf::from(source_path.trim());
    convert_voice_source(app, source, profile_id, tau).await
}

#[tauri::command]
#[specta::specta]
pub async fn convert_voice_recording(
    app: AppHandle,
    wav_bytes: Vec<u8>,
    profile_id: String,
    tau: Option<f32>,
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

    convert_voice_source(app, source, profile_id, tau).await
}

async fn convert_voice_source(
    app: AppHandle,
    source: PathBuf,
    profile_id: String,
    tau: Option<f32>,
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

    let profile = resolve_voice_profile(&app, &profile_id)?;
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
        "provider_id": "openvoice",
        "model": "openvoice",
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
        provider_id: "openvoice".to_string(),
        model_id: "openvoice".to_string(),
    })
}
