use crate::managers::model::{EngineType, ModelInfo, ModelManager};
use crate::managers::transcription::TranscriptionManager;
use crate::model_platform::{
    CapabilityFlags, CatalogModelDescriptor, DomainCatalog, ModelDomain, ModelPlatformOverview,
    ModelPlatformSelectionState, ProviderDescriptor, RuntimeRequirement,
};
use crate::settings::{
    get_settings, write_settings, AppSettings, TTS_PROVIDER_LOCAL_SIDECAR_API_ID,
    TTS_PROVIDER_SHERPA_PACK_ID, TTS_PROVIDER_SYSTEM_BUILTIN_ID,
};
use crate::tts::TtsManager;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

fn stt_provider_meta(
    engine_type: &EngineType,
) -> (&'static str, &'static str, &'static str, &'static str) {
    match engine_type {
        EngineType::Whisper => (
            "stt_whisper",
            "Whisper",
            "Vox Jot curated assets",
            "Whisper engine",
        ),
        EngineType::Parakeet => (
            "stt_parakeet",
            "Parakeet",
            "Vox Jot curated assets",
            "Parakeet engine",
        ),
        EngineType::Moonshine => (
            "stt_moonshine",
            "Moonshine",
            "Vox Jot curated assets",
            "Moonshine engine",
        ),
        EngineType::MoonshineStreaming => (
            "stt_moonshine_streaming",
            "Moonshine Streaming",
            "Vox Jot curated assets",
            "Moonshine streaming engine",
        ),
        EngineType::SenseVoice => (
            "stt_sensevoice",
            "SenseVoice",
            "Vox Jot curated assets",
            "SenseVoice engine",
        ),
        EngineType::GigaAM => (
            "stt_gigaam",
            "GigaAM",
            "Vox Jot curated assets",
            "GigaAM engine",
        ),
    }
}

fn stt_selection_provider_id(
    settings: &AppSettings,
    model_manager: &ModelManager,
) -> Option<String> {
    if !settings.selected_stt_provider_id.trim().is_empty() {
        return Some(settings.selected_stt_provider_id.clone());
    }

    model_manager
        .get_model_info(&settings.selected_model)
        .map(|model| stt_provider_meta(&model.engine_type).0.to_string())
}

fn sync_stt_selection_fields(settings: &mut AppSettings, model_info: &ModelInfo) {
    settings.selected_model = model_info.id.clone();
    settings.selected_stt_model_id = model_info.id.clone();
    settings.selected_stt_provider_id = stt_provider_meta(&model_info.engine_type).0.to_string();
}

fn build_stt_catalog(model_manager: &ModelManager, settings: &AppSettings) -> DomainCatalog {
    let models = model_manager.get_available_models();
    let selected_provider_id = stt_selection_provider_id(settings, model_manager);
    let selected_model_id = if !settings.selected_stt_model_id.trim().is_empty() {
        Some(settings.selected_stt_model_id.clone())
    } else if !settings.selected_model.trim().is_empty() {
        Some(settings.selected_model.clone())
    } else {
        None
    };

    let provider_order = [
        "stt_whisper",
        "stt_parakeet",
        "stt_moonshine",
        "stt_moonshine_streaming",
        "stt_sensevoice",
        "stt_gigaam",
    ];

    let providers = provider_order
        .iter()
        .filter_map(|provider_id| {
            let model = models.iter().find(|model| stt_provider_meta(&model.engine_type).0 == *provider_id)?;
            let (provider_id, label, source_label, runtime_label) = stt_provider_meta(&model.engine_type);
            Some(ProviderDescriptor {
                id: provider_id.to_string(),
                domain: ModelDomain::Stt,
                label: label.to_string(),
                description: format!("{label} models are downloaded through Vox Jot-managed assets and auto-routed to the correct transcription runtime."),
                source_label: source_label.to_string(),
                runtime: RuntimeRequirement {
                    id: provider_id.to_string(),
                    label: runtime_label.to_string(),
                    engine_family: label.to_lowercase().replace(' ', "_"),
                    auto_routed: true,
                },
                available: true,
                local_only: true,
                coming_soon: false,
                license_label: None,
                capabilities: CapabilityFlags {
                    downloadable: true,
                    loadable: true,
                    local_only: true,
                    supports_translation: model.supports_translation,
                    supports_streaming: matches!(model.engine_type, EngineType::MoonshineStreaming),
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
            })
        })
        .collect();

    let models = models
        .into_iter()
        .map(|model| {
            let (provider_id, _, source_label, runtime_label) =
                stt_provider_meta(&model.engine_type);
            CatalogModelDescriptor {
                id: model.id.clone(),
                provider_id: provider_id.to_string(),
                domain: ModelDomain::Stt,
                label: model.name.clone(),
                description: model.description.clone(),
                installed: model.is_downloaded,
                selected: selected_provider_id.as_deref() == Some(provider_id)
                    && selected_model_id.as_deref() == Some(model.id.as_str()),
                downloadable: true,
                source_label: source_label.to_string(),
                runtime: RuntimeRequirement {
                    id: provider_id.to_string(),
                    label: runtime_label.to_string(),
                    engine_family: provider_id.trim_start_matches("stt_").to_string(),
                    auto_routed: true,
                },
                license_label: None,
                locale: None,
                supported_languages: model.supported_languages.clone(),
                capabilities: CapabilityFlags {
                    downloadable: true,
                    loadable: true,
                    local_only: true,
                    supports_translation: model.supports_translation,
                    supports_streaming: matches!(model.engine_type, EngineType::MoonshineStreaming),
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
            }
        })
        .collect();

    DomainCatalog { providers, models }
}

fn build_llm_catalog(settings: &AppSettings) -> DomainCatalog {
    let selected_provider_id = if !settings.selected_llm_provider_id.trim().is_empty() {
        settings.selected_llm_provider_id.clone()
    } else {
        settings.post_process_provider_id.clone()
    };
    let selected_model_id = if !settings.selected_llm_model_id.trim().is_empty() {
        settings.selected_llm_model_id.clone()
    } else {
        settings
            .post_process_models
            .get(&selected_provider_id)
            .cloned()
            .unwrap_or_default()
    };

    let providers = settings
        .post_process_providers
        .iter()
        .map(|provider| ProviderDescriptor {
            id: provider.id.clone(),
            domain: ModelDomain::Llm,
            label: provider.label.clone(),
            description: "Configured local or API-backed LLM provider used by Vox Jot for language cleanup and related workflows.".to_string(),
            source_label: if provider.base_url.trim().is_empty() {
                "Managed provider".to_string()
            } else {
                provider.base_url.clone()
            },
            runtime: RuntimeRequirement {
                id: provider.id.clone(),
                label: format!("{} runtime", provider.label),
                engine_family: provider.id.clone(),
                auto_routed: true,
            },
            available: true,
            local_only: crate::settings::post_process_provider_is_local(provider),
            coming_soon: false,
            license_label: None,
            capabilities: CapabilityFlags {
                downloadable: provider.id == crate::settings::OLLAMA_PROVIDER_ID,
                loadable: true,
                local_only: crate::settings::post_process_provider_is_local(provider),
                supports_translation: true,
                supports_streaming: false,
                supports_voice_cloning: false,
                supports_instruction_prompt: true,
                supports_inline_tags: false,
                coming_soon: false,
            },
        })
        .collect();

    let models = settings
        .post_process_providers
        .iter()
        .map(|provider| {
            let model_id = settings
                .post_process_models
                .get(&provider.id)
                .cloned()
                .unwrap_or_default();
            CatalogModelDescriptor {
                id: format!("{}::{}", provider.id, model_id),
                provider_id: provider.id.clone(),
                domain: ModelDomain::Llm,
                label: if model_id.is_empty() {
                    format!("{} Default", provider.label)
                } else {
                    model_id.clone()
                },
                description: "Current default model for this provider.".to_string(),
                installed: provider.id == crate::settings::OLLAMA_PROVIDER_ID,
                selected: selected_provider_id == provider.id && selected_model_id == model_id,
                downloadable: provider.id == crate::settings::OLLAMA_PROVIDER_ID,
                source_label: if provider.base_url.trim().is_empty() {
                    "Managed provider".to_string()
                } else {
                    provider.base_url.clone()
                },
                runtime: RuntimeRequirement {
                    id: provider.id.clone(),
                    label: format!("{} runtime", provider.label),
                    engine_family: provider.id.clone(),
                    auto_routed: true,
                },
                license_label: None,
                locale: None,
                supported_languages: Vec::new(),
                capabilities: CapabilityFlags {
                    downloadable: provider.id == crate::settings::OLLAMA_PROVIDER_ID,
                    loadable: true,
                    local_only: crate::settings::post_process_provider_is_local(provider),
                    supports_translation: true,
                    supports_streaming: false,
                    supports_voice_cloning: false,
                    supports_instruction_prompt: true,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
            }
        })
        .collect();

    DomainCatalog { providers, models }
}

#[tauri::command]
#[specta::specta]
pub async fn get_available_models(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<Vec<ModelInfo>, String> {
    Ok(model_manager.get_available_models())
}

#[tauri::command]
#[specta::specta]
pub async fn get_model_info(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<Option<ModelInfo>, String> {
    Ok(model_manager.get_model_info(&model_id))
}

#[tauri::command]
#[specta::specta]
pub async fn get_model_platform_overview(
    app_handle: AppHandle,
) -> Result<ModelPlatformOverview, String> {
    let settings = get_settings(&app_handle);
    let model_manager = app_handle.state::<Arc<ModelManager>>();
    let tts_manager = app_handle.state::<Arc<TtsManager>>();

    Ok(ModelPlatformOverview {
        stt: build_stt_catalog(&*model_manager, &settings),
        llm: build_llm_catalog(&settings),
        tts: tts_manager.domain_catalog(&settings),
        selection: ModelPlatformSelectionState {
            selected_stt_provider_id: stt_selection_provider_id(&settings, &*model_manager),
            selected_stt_model_id: (!settings.selected_stt_model_id.trim().is_empty())
                .then_some(settings.selected_stt_model_id.clone())
                .or_else(|| {
                    (!settings.selected_model.trim().is_empty())
                        .then_some(settings.selected_model.clone())
                }),
            selected_llm_provider_id: (!settings.selected_llm_provider_id.trim().is_empty())
                .then_some(settings.selected_llm_provider_id.clone())
                .or_else(|| {
                    (!settings.post_process_provider_id.trim().is_empty())
                        .then_some(settings.post_process_provider_id.clone())
                }),
            selected_llm_model_id: (!settings.selected_llm_model_id.trim().is_empty())
                .then_some(settings.selected_llm_model_id.clone()),
            selected_tts_provider_id: Some(tts_manager.selected_provider_id(&settings)),
            selected_tts_model_id: tts_manager.selected_model_id(&settings),
            selected_tts_voice_id: settings
                .selected_tts_voice_id
                .clone()
                .or_else(|| settings.tts_default_voice_id.clone()),
            selected_tts_profile_id: settings.selected_tts_profile_id.clone(),
        },
    })
}

#[tauri::command]
#[specta::specta]
pub async fn download_model(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    model_manager
        .download_model(&model_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    model_id: String,
) -> Result<(), String> {
    let settings = get_settings(&app_handle);
    if settings.selected_model == model_id {
        transcription_manager
            .unload_model()
            .map_err(|e| format!("Failed to unload model: {}", e))?;

        let mut settings = get_settings(&app_handle);
        settings.selected_model = String::new();
        settings.selected_stt_model_id = String::new();
        settings.selected_stt_provider_id = String::new();
        write_settings(&app_handle, settings);
    }

    model_manager
        .delete_model(&model_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn set_stt_platform_selection(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    let model_info = model_manager
        .get_model_info(&model_id)
        .ok_or_else(|| format!("Model not found: {}", model_id))?;

    let expected_provider_id = stt_provider_meta(&model_info.engine_type).0;
    if provider_id != expected_provider_id {
        return Err(format!(
            "Model '{}' belongs to provider '{}' rather than '{}'",
            model_id, expected_provider_id, provider_id
        ));
    }

    if !model_info.is_downloaded {
        return Err(format!("Model not downloaded: {}", model_id));
    }

    transcription_manager
        .load_model(&model_id)
        .map_err(|e| e.to_string())?;

    let mut settings = get_settings(&app_handle);
    sync_stt_selection_fields(&mut settings, &model_info);
    write_settings(&app_handle, settings);
    app_handle
        .emit("active-model-changed", model_id)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_active_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    model_id: String,
) -> Result<(), String> {
    let model_info = model_manager
        .get_model_info(&model_id)
        .ok_or_else(|| format!("Model not found: {}", model_id))?;

    if !model_info.is_downloaded {
        return Err(format!("Model not downloaded: {}", model_id));
    }

    transcription_manager
        .load_model(&model_id)
        .map_err(|e| e.to_string())?;

    let mut settings = get_settings(&app_handle);
    sync_stt_selection_fields(&mut settings, &model_info);
    write_settings(&app_handle, settings);
    app_handle
        .emit("active-model-changed", model_id)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_tts_platform_selection(
    app_handle: AppHandle,
    provider_id: String,
    model_id: Option<String>,
) -> Result<(), String> {
    let settings = get_settings(&app_handle);
    let tts_manager = app_handle.state::<Arc<TtsManager>>();
    let catalog = tts_manager.domain_catalog(&settings);

    let provider = catalog
        .providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .ok_or_else(|| format!("Unknown TTS provider '{}'", provider_id))?;

    if provider.coming_soon || !provider.available {
        return Err(format!(
            "TTS provider '{}' is not available in this build",
            provider.label
        ));
    }

    let resolved_model_id = model_id.or_else(|| {
        catalog
            .models
            .iter()
            .find(|model| model.provider_id == provider_id)
            .map(|model| model.id.clone())
    });

    let Some(resolved_model_id) = resolved_model_id else {
        return Err(format!(
            "No selectable models are available for '{}'",
            provider.label
        ));
    };

    let model = catalog
        .models
        .iter()
        .find(|model| model.provider_id == provider_id && model.id == resolved_model_id)
        .ok_or_else(|| format!("Unknown TTS model '{}'", resolved_model_id))?;

    if model.capabilities.coming_soon {
        return Err(format!(
            "TTS model '{}' is not available in this build",
            model.label
        ));
    }

    let mut settings = get_settings(&app_handle);
    settings.selected_tts_provider_id = provider_id.clone();
    settings.selected_tts_model_id = Some(resolved_model_id.clone());
    settings.tts_engine_preference = match provider_id.as_str() {
        TTS_PROVIDER_SYSTEM_BUILTIN_ID => crate::settings::TtsEnginePreference::System,
        TTS_PROVIDER_SHERPA_PACK_ID => crate::settings::TtsEnginePreference::SherpaOnnx,
        TTS_PROVIDER_LOCAL_SIDECAR_API_ID => crate::settings::TtsEnginePreference::Sidecar,
        _ => settings.tts_engine_preference,
    };
    if provider_id == TTS_PROVIDER_SHERPA_PACK_ID {
        settings.tts_default_voice_id = Some(resolved_model_id.clone());
        settings.selected_tts_voice_id = Some(resolved_model_id);
    }
    write_settings(&app_handle, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_current_model(app_handle: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app_handle);
    Ok(settings.selected_model)
}

#[tauri::command]
#[specta::specta]
pub async fn get_transcription_model_status(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<Option<String>, String> {
    Ok(transcription_manager.get_current_model())
}

#[tauri::command]
#[specta::specta]
pub async fn is_model_loading(
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
) -> Result<bool, String> {
    let current_model = transcription_manager.get_current_model();
    Ok(current_model.is_none())
}

#[tauri::command]
#[specta::specta]
pub async fn has_any_models_available(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<bool, String> {
    let models = model_manager.get_available_models();
    Ok(models.iter().any(|m| m.is_downloaded))
}

#[tauri::command]
#[specta::specta]
pub async fn has_any_models_or_downloads(
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<bool, String> {
    let models = model_manager.get_available_models();
    Ok(models.iter().any(|m| m.is_downloaded))
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_download(
    model_manager: State<'_, Arc<ModelManager>>,
    model_id: String,
) -> Result<(), String> {
    model_manager
        .cancel_download(&model_id)
        .map_err(|e| e.to_string())
}
