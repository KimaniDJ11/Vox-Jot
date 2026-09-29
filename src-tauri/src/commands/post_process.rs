//! Post-processing and translation provider configuration.

use log::warn;
use tauri::AppHandle;

use crate::secret_store;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::settings::APPLE_INTELLIGENCE_DEFAULT_MODEL_ID;
use crate::settings::{
    self, is_local_base_url, AppSettings, LLMPrompt, APPLE_INTELLIGENCE_PROVIDER_ID,
    OLLAMA_PROVIDER_ID, VOX_JOT_LOCAL_PROVIDER_ID,
};

fn require_provider(settings: &AppSettings, provider_id: &str) -> Result<(), String> {
    settings
        .post_process_provider(provider_id)
        .map(|_| ())
        .ok_or_else(|| format!("Provider '{provider_id}' not found"))
}

/// Point the custom provider at a new endpoint. The saved model is cleared
/// because it belongs to the previous endpoint.
#[tauri::command]
#[specta::specta]
pub fn set_post_process_base_url(
    app: AppHandle,
    provider_id: String,
    base_url: String,
) -> Result<(), String> {
    configure_provider_endpoint(app, provider_id, base_url, true)
}

/// The named public setter retains its selected model; the UI's endpoint
/// operation also clears the model belonging to the previous endpoint.
pub(crate) fn configure_provider_endpoint(
    app: AppHandle,
    provider_id: String,
    base_url: String,
    clear_model: bool,
) -> Result<(), String> {
    settings::try_update(&app, |settings| {
        let local_privacy_mode = settings.local_privacy_mode;
        let provider = settings
            .post_process_provider_mut(&provider_id)
            .ok_or_else(|| format!("Provider '{provider_id}' not found"))?;
        if !provider.allow_base_url_edit {
            return Err(format!(
                "Provider '{}' does not allow editing the base URL",
                provider.label
            ));
        }
        if local_privacy_mode && !is_local_base_url(&base_url) {
            return Err(
                "Local privacy mode is enabled. Custom provider URL must point to localhost or loopback."
                    .to_string(),
            );
        }
        provider.base_url = base_url;
        if clear_model {
            settings
                .post_process_models
                .insert(provider_id.clone(), String::new());
            if settings.post_process_provider_id == provider_id {
                settings.selected_llm_model_id.clear();
            }
        }
        settings.enforce_local_privacy_mode();
        Ok(())
    })
}

/// Store or clear a provider's API key in the OS credential store.
#[tauri::command]
#[specta::specta]
pub fn set_post_process_api_key(
    app: AppHandle,
    provider_id: String,
    api_key: String,
) -> Result<(), String> {
    require_provider(&settings::get_settings(&app), &provider_id)?;
    let api_key = api_key.trim();
    if api_key.is_empty() {
        secret_store::clear_post_process_api_key(&provider_id)?;
    } else {
        secret_store::set_post_process_api_key(&provider_id, api_key)?;
    }
    settings::update(&app, |settings| {
        settings
            .post_process_api_key_status
            .insert(provider_id, !api_key.is_empty());
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_post_process_model(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<(), String> {
    settings::try_update(&app, |settings| {
        require_provider(settings, &provider_id)?;
        if settings.post_process_provider_id == provider_id {
            settings.selected_llm_provider_id = provider_id.clone();
            settings.selected_llm_model_id = model.clone();
        }
        settings.post_process_models.insert(provider_id, model);
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn set_translation_model(
    app: AppHandle,
    provider_id: String,
    model: String,
) -> Result<(), String> {
    settings::try_update(&app, |settings| {
        require_provider(settings, &provider_id)?;
        settings.translation_model_ids.insert(provider_id, model);
        Ok(())
    })
}

pub(crate) fn replace_translation_models(
    app: AppHandle,
    model_ids: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    settings::try_update(&app, |settings| {
        for provider_id in model_ids.keys() {
            require_provider(settings, provider_id)?;
        }
        settings.translation_model_ids = model_ids;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_post_process_models(
    app: AppHandle,
    provider_id: String,
) -> Result<Vec<String>, String> {
    let settings = settings::get_settings(&app);
    let provider = settings
        .post_process_provider(&provider_id)
        .ok_or_else(|| format!("Provider '{provider_id}' not found"))?;

    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            return Ok(vec![APPLE_INTELLIGENCE_DEFAULT_MODEL_ID.to_string()]);
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            return Err("Apple Intelligence is only available on Apple silicon Macs running macOS 26 or later.".to_string());
        }
    }

    if provider.id == VOX_JOT_LOCAL_PROVIDER_ID {
        let mut models = crate::local_llm::discover_models(&app)?
            .into_iter()
            .map(|model| model.runtime_model_id)
            .collect::<Vec<_>>();
        models.sort();
        return Ok(models);
    }

    let api_key = secret_store::get_post_process_api_key(&provider_id)
        .unwrap_or_else(|error| {
            warn!("Failed to load secure API key for provider '{provider_id}': {error}");
            None
        })
        .unwrap_or_default();

    let needs_api_key = !matches!(
        provider.id.as_str(),
        "custom" | "lmstudio" | OLLAMA_PROVIDER_ID
    );
    if needs_api_key && api_key.trim().is_empty() {
        return Err(format!(
            "API key is required for {}. Please add an API key to list available models.",
            provider.label
        ));
    }

    crate::llm_client::fetch_models(provider, api_key).await
}

#[tauri::command]
#[specta::specta]
pub fn add_post_process_prompt(
    app: AppHandle,
    name: String,
    prompt: String,
) -> Result<LLMPrompt, String> {
    let prompt = LLMPrompt {
        id: format!("prompt_{}", chrono::Utc::now().timestamp_millis()),
        name,
        prompt,
    };
    settings::update(&app, |settings| {
        settings.post_process_prompts.push(prompt.clone())
    });
    Ok(prompt)
}

#[tauri::command]
#[specta::specta]
pub fn update_post_process_prompt(
    app: AppHandle,
    id: String,
    name: String,
    prompt: String,
) -> Result<(), String> {
    settings::try_update(&app, |settings| {
        let existing = settings
            .post_process_prompts
            .iter_mut()
            .find(|existing| existing.id == id)
            .ok_or_else(|| format!("Prompt with id '{id}' not found"))?;
        existing.name = name;
        existing.prompt = prompt;
        Ok(())
    })
}

#[tauri::command]
#[specta::specta]
pub fn delete_post_process_prompt(app: AppHandle, id: String) -> Result<(), String> {
    settings::try_update(&app, |settings| {
        if settings.post_process_prompts.len() <= 1 {
            return Err("Cannot delete the last prompt".to_string());
        }
        let original_len = settings.post_process_prompts.len();
        settings
            .post_process_prompts
            .retain(|prompt| prompt.id != id);
        if settings.post_process_prompts.len() == original_len {
            return Err(format!("Prompt with id '{id}' not found"));
        }
        if settings.post_process_selected_prompt_id.as_ref() == Some(&id) {
            settings.post_process_selected_prompt_id = settings
                .post_process_prompts
                .first()
                .map(|prompt| prompt.id.clone());
        }
        Ok(())
    })
}
