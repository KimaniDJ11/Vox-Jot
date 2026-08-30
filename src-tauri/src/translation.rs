#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::settings::{
    post_process_provider_is_local, AppSettings, TranslationBilingualLayout,
    TranslationDestinationMode, TranslationOutputMode, TranslationRoutePreference,
};
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TranslationOrigin {
    Dictation,
    Selection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TranslationRoute {
    None,
    WhisperEnglish,
    OfflinePack,
    LocalAi,
    RemoteAi,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TranslationExecution {
    pub source_text: String,
    pub translated_text: Option<String>,
    pub final_text: String,
    pub source_language_detected: Option<String>,
    pub target_language: Option<String>,
    pub route: TranslationRoute,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub origin: TranslationOrigin,
}

impl TranslationExecution {
    pub fn source_only(
        text: &str,
        origin: TranslationOrigin,
        source_language: Option<String>,
    ) -> Self {
        Self {
            source_text: text.to_string(),
            translated_text: None,
            final_text: text.to_string(),
            source_language_detected: source_language,
            target_language: None,
            route: TranslationRoute::None,
            provider_id: None,
            model_id: None,
            origin,
        }
    }
}

pub fn normalize_language_code(language: Option<&str>) -> Option<String> {
    match language.map(str::trim).filter(|value| !value.is_empty()) {
        Some("auto") => None,
        Some("zh-Hans") => Some("zh-Hans".to_string()),
        Some("zh-Hant") => Some("zh-Hant".to_string()),
        Some(value) => Some(value.to_ascii_lowercase()),
        None => None,
    }
}

pub fn destination_label_for_dictation(settings: &AppSettings) -> &'static str {
    match settings.translation_destination_mode {
        TranslationDestinationMode::PasteInPlace => "paste_in_place",
        TranslationDestinationMode::PreviewThenPaste => "preview_then_paste",
    }
}

pub fn selection_destination_label(
    mode: crate::settings::SelectionTranslationDestinationMode,
) -> &'static str {
    match mode {
        crate::settings::SelectionTranslationDestinationMode::ReplaceSelection => {
            "replace_selection"
        }
        crate::settings::SelectionTranslationDestinationMode::PreviewThenReplace => {
            "preview_then_replace"
        }
    }
}

pub fn selection_requires_preview(settings: &AppSettings, selected_text: &str) -> bool {
    settings.selection_translation_destination_mode
        == crate::settings::SelectionTranslationDestinationMode::PreviewThenReplace
        || selected_text.chars().count() > 800
}

pub fn dictation_requires_preview(settings: &AppSettings, translated_text: &str) -> bool {
    settings.show_preview_before_paste
        || settings.translation_destination_mode == TranslationDestinationMode::PreviewThenPaste
        || matches!(
            settings.translation_output_mode,
            TranslationOutputMode::Bilingual
        )
        || translated_text.chars().count() > 1200
}

fn translate_route(
    settings: &AppSettings,
    origin: TranslationOrigin,
    source_language: Option<&str>,
) -> TranslationRoute {
    let normalized_target = normalize_language_code(Some(&settings.translation_target_language));
    let normalized_source = normalize_language_code(source_language);
    let same_language = normalized_source.is_some() && normalized_source == normalized_target;

    if same_language {
        return TranslationRoute::None;
    }

    if matches!(origin, TranslationOrigin::Dictation)
        && settings.translation_output_mode == TranslationOutputMode::Translated
        && settings.translation_target_language == "en"
        && matches!(
            settings.translation_route_preference,
            TranslationRoutePreference::Auto | TranslationRoutePreference::WhisperEnglish
        )
    {
        return TranslationRoute::WhisperEnglish;
    }

    match settings.translation_route_preference {
        TranslationRoutePreference::WhisperEnglish => TranslationRoute::WhisperEnglish,
        TranslationRoutePreference::OfflinePack => TranslationRoute::OfflinePack,
        TranslationRoutePreference::LocalAi => TranslationRoute::LocalAi,
        TranslationRoutePreference::RemoteAi => TranslationRoute::RemoteAi,
        TranslationRoutePreference::Auto => settings
            .active_translation_provider()
            .map(|provider| {
                if post_process_provider_is_local(provider) {
                    TranslationRoute::LocalAi
                } else {
                    TranslationRoute::RemoteAi
                }
            })
            .unwrap_or(TranslationRoute::LocalAi),
    }
}

fn build_translation_system_prompt(target_language: &str) -> String {
    format!(
        "You are a translation engine for Vox Jot.\nTranslate the user's text into {target_language}.\nPreserve meaning faithfully.\nPreserve URLs, email addresses, file paths, CLI flags, filenames, code tokens, product names, and acronyms verbatim when possible.\nDo not add commentary, headings, labels, or quotation marks.\nReturn only the translated text."
    )
}

fn format_translation_output(
    settings: &AppSettings,
    source_text: &str,
    translated_text: &str,
    origin: TranslationOrigin,
) -> String {
    match settings.translation_output_mode {
        TranslationOutputMode::Source if matches!(origin, TranslationOrigin::Dictation) => {
            source_text.to_string()
        }
        TranslationOutputMode::Bilingual => match settings.translation_bilingual_layout {
            TranslationBilingualLayout::TranslationThenSource => {
                format!("{translated_text}\n\n{source_text}")
            }
            TranslationBilingualLayout::SourceThenTranslation => {
                format!("{source_text}\n\n{translated_text}")
            }
        },
        _ => translated_text.to_string(),
    }
}

pub async fn translate_text(
    app: &AppHandle,
    settings: &AppSettings,
    text: &str,
    source_language_hint: Option<&str>,
    origin: TranslationOrigin,
) -> Result<TranslationExecution, String> {
    let trimmed = text.trim();
    let source_language = normalize_language_code(source_language_hint);

    if trimmed.is_empty() {
        return Ok(TranslationExecution::source_only(
            text,
            origin,
            source_language,
        ));
    }

    if matches!(origin, TranslationOrigin::Dictation)
        && settings.translation_output_mode == TranslationOutputMode::Source
    {
        return Ok(TranslationExecution::source_only(
            text,
            origin,
            source_language,
        ));
    }

    let route = translate_route(settings, origin, source_language_hint);
    if route == TranslationRoute::None {
        return Ok(TranslationExecution::source_only(
            text,
            origin,
            source_language,
        ));
    }

    if route == TranslationRoute::WhisperEnglish {
        let final_text = format_translation_output(settings, text, text, origin);
        return Ok(TranslationExecution {
            source_text: text.to_string(),
            translated_text: Some(text.to_string()),
            final_text,
            source_language_detected: source_language,
            target_language: Some(settings.translation_target_language.clone()),
            route,
            provider_id: None,
            model_id: None,
            origin,
        });
    }

    if route == TranslationRoute::OfflinePack {
        return Err(
            "Offline translation packs are not installed yet for this language pair.".to_string(),
        );
    }

    let provider = settings
        .active_translation_provider()
        .cloned()
        .ok_or_else(|| "No translation provider is configured.".to_string())?;

    if settings.local_privacy_mode && !post_process_provider_is_local(&provider) {
        return Err(
            "Local privacy mode is enabled. Select a local translation provider.".to_string(),
        );
    }

    let model = settings
        .translation_model_ids
        .get(&provider.id)
        .cloned()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "No translation model configured for provider '{}'.",
                provider.label
            )
        })?;

    let system_prompt = build_translation_system_prompt(&settings.translation_target_language);
    let user_prompt = text.to_string();

    debug!(
        "Translating text with provider '{}' using model '{}'",
        provider.id, model
    );

    let translated = if provider.id == crate::settings::APPLE_INTELLIGENCE_PROVIDER_ID {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            if !apple_intelligence::check_apple_intelligence_availability() {
                return Err("Apple Intelligence is unavailable on this Mac.".to_string());
            }

            apple_intelligence::process_text_with_system_prompt(&system_prompt, &user_prompt, 800)
                .map_err(|err| format!("Apple Intelligence translation failed: {err}"))?
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            return Err(
                "Apple Intelligence translation is only available on Apple silicon Macs."
                    .to_string(),
            );
        }
    } else {
        let api_key = crate::secret_store::get_post_process_api_key(&provider.id)
            .unwrap_or_else(|error| {
                warn!(
                    "Failed to load secure translation API key for provider '{}': {}",
                    provider.id, error
                );
                None
            })
            .unwrap_or_default();
        crate::llm_client::send_chat_completion_with_schema(
            Some(app),
            &provider,
            api_key,
            &model,
            user_prompt,
            Some(system_prompt),
            None,
        )
        .await?
        .unwrap_or_default()
    };

    let translated = translated.trim().to_string();
    if translated.is_empty() {
        warn!("Translation provider returned empty output; using source text");
        return Ok(TranslationExecution::source_only(
            text,
            origin,
            source_language,
        ));
    }

    let final_text = format_translation_output(settings, text, &translated, origin);
    Ok(TranslationExecution {
        source_text: text.to_string(),
        translated_text: Some(translated),
        final_text,
        source_language_detected: source_language,
        target_language: Some(settings.translation_target_language.clone()),
        route,
        provider_id: Some(provider.id),
        model_id: Some(model),
        origin,
    })
}
