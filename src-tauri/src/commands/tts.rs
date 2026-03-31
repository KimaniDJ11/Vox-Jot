use crate::settings::{
    get_settings, write_settings, TtsVoicePreset, TtsVoicePresetInput, TtsVoiceTuningSettings,
    TTS_PROVIDER_MLX_CHATTERBOX_ID, TTS_PROVIDER_MLX_CSM_ID, TTS_PROVIDER_MLX_DIA_ID,
    TTS_PROVIDER_MLX_KOKORO_ID, TTS_PROVIDER_MLX_KUGEL_ID, TTS_PROVIDER_MLX_MING_OMNI_ID,
    TTS_PROVIDER_MLX_OUTE_ID, TTS_PROVIDER_MLX_QWEN3TTS_ID, TTS_PROVIDER_MLX_SPARK_ID,
    TTS_PROVIDER_MLX_VOXTRAL_TTS_ID,
};
use crate::tts::{default_preview_request, SpeakRequest, TtsManager, TtsPackInfo, VoiceInfo};
use crate::tts_profiles::{
    clear_collected_data, create_voice_profile, delete_voice_profile, get_profile_progress,
    import_profile_reference_audio, list_voice_profiles, set_continuous_improvement,
    TtsVoiceProfileDescriptor,
};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
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

fn sanitize_tuning(tuning: &mut TtsVoiceTuningSettings) {
    tuning.tempo_rate = tuning.tempo_rate.clamp(0.5, 2.0);
    tuning.expressiveness = tuning.expressiveness.clamp(0.0, 1.0);
    tuning.exaggeration = tuning.exaggeration.clamp(0.0, 1.0);
    tuning.randomness = tuning.randomness.clamp(0.0, 1.0);
    tuning.guidance = tuning.guidance.clamp(0.0, 1.0);
    tuning.stability = tuning.stability.clamp(0.0, 1.0);
    tuning.repetition_penalty = tuning.repetition_penalty.clamp(1.0, 3.0);
    tuning.style_instructions = normalize_optional_string(tuning.style_instructions.clone());
}

fn provider_uses_mlx_audio_runtime(provider_id: &str) -> bool {
    matches!(
        provider_id,
        TTS_PROVIDER_MLX_KOKORO_ID
            | TTS_PROVIDER_MLX_CHATTERBOX_ID
            | TTS_PROVIDER_MLX_QWEN3TTS_ID
            | TTS_PROVIDER_MLX_DIA_ID
            | TTS_PROVIDER_MLX_CSM_ID
            | TTS_PROVIDER_MLX_SPARK_ID
            | TTS_PROVIDER_MLX_OUTE_ID
            | TTS_PROVIDER_MLX_MING_OMNI_ID
            | TTS_PROVIDER_MLX_KUGEL_ID
            | TTS_PROVIDER_MLX_VOXTRAL_TTS_ID
    )
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

fn preset_from_input(
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
    sanitize_tuning(&mut tuning);

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
pub async fn prepare_sidecar_engine(app: AppHandle, provider_id: String) -> Result<(), String> {
    let manager = app.state::<Arc<TtsManager>>();
    if provider_uses_mlx_audio_runtime(&provider_id) {
        if let Some(sidecar) = app.try_state::<Arc<crate::sidecar::SidecarManager>>() {
            let sidecar = Arc::clone(&*sidecar);
            tokio::task::spawn_blocking(move || sidecar.ensure_mlx_audio_environment())
                .await
                .map_err(|err| format!("Failed to prepare MLX speech runtime: {err}"))??;
        }
        return Ok(());
    }

    manager
        .ensure_managed_speech_runtime_available(&provider_id)
        .await?;

    // Ensure the sidecar is running first.
    if let Some(sidecar) = app.try_state::<Arc<crate::sidecar::SidecarManager>>() {
        let sidecar = Arc::clone(&*sidecar);
        tokio::task::spawn_blocking(move || sidecar.ensure_running())
            .await
            .map_err(|err| format!("Failed to start speech runtime: {err}"))??;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|err| format!("Failed to create HTTP client: {err}"))?;
    let response = client
        .post("http://127.0.0.1:8008/listen/prepare")
        .json(&serde_json::json!({ "provider_id": provider_id }))
        .send()
        .await
        .map_err(|err| format!("Failed to reach speech runtime: {err}"))?;
    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("detail").and_then(|d| d.as_str()).map(String::from))
            .unwrap_or(body);
        return Err(format!("Engine preparation failed: {detail}"));
    }
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
    profile_id: String,
    source_path: String,
    transcript: Option<String>,
) -> Result<TtsVoiceProfileDescriptor, String> {
    import_profile_reference_audio(&app, &profile_id, &source_path, transcript)
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
