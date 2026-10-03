//! The published local settings API: routing, payloads and response field names.
//! All writes delegate to the typed settings transaction or a domain command.

use super::{
    apply_setting_updates, commands, get_settings_without_secrets, AppHandle, SettingUpdate, Value,
};
use crate::commands::settings::{aliases, preferences};

pub(super) fn protected_settings_route(key: &str) -> Option<(&'static str, &'static str)> {
    match key {
        "acoustic_profile" | "adaptive_selection_rewrite_enabled"
        | "cloud_selection_rewrite_allowed" | "markdown_export_enabled"
        | "markdown_export_dir" | "markdown_export_min_words"
        | "markdown_export_content_source" | "markdown_export_frontmatter"
        | "markdown_export_include_rewrite_selection" | "markdown_export_include_failed_paste" => Some((
            "/v1/settings/command",
            "These settings require privacy, folder authorization, or recording-pipeline validation.",
        )),
        "http_api_token" => Some(("protected", "Local API token lives in the OS credential store.")),
        "post_process_api_keys" => {
            Some(("protected", "Provider API keys live in the OS credential store."))
        }
        "post_process_api_key_status" => Some((
            "protected",
            "API key status is derived from the credential store; update keys through provider-specific commands.",
        )),
        "bindings" => Some((
            "/v1/settings/shortcut",
            "Shortcut bindings require registration side effects.",
        )),
        "selected_model" | "selected_stt_provider_id" | "selected_stt_model_id" => Some((
            "/v1/models/stt/select",
            "STT selection requires model load side effects.",
        )),
        "selected_tts_provider_id" | "selected_tts_model_id" | "selected_tts_voice_id"
        | "selected_tts_profile_id" => Some((
            "/v1/models/tts/select",
            "TTS selection should stay synchronized with the runtime catalog.",
        )),
        "selected_creative_audio_model_id" => Some((
            "/v1/settings/command",
            "Creative Audio model selection validates install/runtime readiness.",
        )),
        "tts_engine_preference" | "tts_default_voice_id" | "tts_rate" | "tts_volume" => Some((
            "/v1/settings/command",
            "TTS preference settings synchronize related voice/provider fields or clamp values.",
        )),
        "speech_runtime_path" | "tts_model_store_path"
        | "external_model_storage_enabled"
        | "external_model_storage_auto_detect"
        | "external_model_storage_path" => Some((
            "/v1/settings/command",
            "Runtime path settings are trimmed and normalized before saving.",
        )),
        "audio_enhancement_enabled" | "audio_enhancement_model" => Some((
            "/v1/settings/command",
            "Audio enhancement changes refresh the active audio pipeline.",
        )),
        "screen_context_ocr_neural_model_id" => Some((
            "/v1/ocr/select",
            "OCR model selection validates install/runtime readiness.",
        )),
        "snippets" | "snippets_enabled" => Some((
            "/v1/phrase-keys",
            "Phrase Keys have dedicated CRUD routes that validate triggers and preserve import/export behavior.",
        )),
        "write_rules" | "write_rules_enabled_override" | "write_rules_url_capture_enabled" => Some((
            "/v1/write-rules",
            "Write Profile changes have dedicated routes for validation, ordering, and rule-resolution tests.",
        )),
        "autostart_enabled" | "update_checks_enabled" | "enable_crash_reporting"
        | "enable_usage_analytics"
        | "keyboard_implementation" => Some((
            "/v1/settings/command",
            "This setting applies runtime platform side effects.",
        )),
        "post_process_enabled" | "local_privacy_mode" | "post_process_provider_id"
        | "post_process_models" | "selected_llm_provider_id" | "selected_llm_model_id"
        | "post_process_cleanup_level" | "max_rewrite_strength" | "post_process_providers" => {
            Some((
                "/v1/settings/command",
                "Post-processing settings validate providers and synchronize related LLM fields.",
            ))
        },
        "translate_to_english"
        | "translation_route_preference"
        | "translation_provider_id"
        | "translation_model_ids" => Some((
            "/v1/settings/command",
            "Translation settings validate providers and local privacy constraints.",
        )),
        "overlay_position" | "recording_overlay_style" => Some((
            "/v1/settings/command",
            "Overlay settings apply to live windows immediately.",
        )),
        "debug_mode" | "show_technical_features" | "start_hidden" => Some((
            "/v1/settings/command",
            "This setting emits runtime state updates after saving.",
        )),
        "screen_context_enabled"
        | "screen_context_excluded_bundle_ids"
        | "screen_context_pause_on_idle"
        | "screen_context_idle_threshold_ms"
        | "context_capture_mode"
        | "screen_context_ocr_quality"
        | "screen_context_ocr_engine"
        | "screen_context_ocr_timeout_ms"
        | "screen_context_token_budget"
        | "screen_context_stale_threshold_ms" => Some((
            "/v1/settings/command",
            "Screen-context settings use command validation, clamping, or UI notification side effects.",
        )),
        "app_theme" | "app_font_scale" => Some((
            "/v1/settings/command",
            "Appearance settings are validated or clamped before saving.",
        )),
        "external_script_path" => Some((
            "/v1/settings/command",
            "External paste scripts must be absolute executable paths.",
        )),
        "app_language" => Some((
            "/v1/settings/command",
            "Changing app language refreshes the tray menu.",
        )),
        "selected_microphone" => Some((
            "/v1/audio/microphone",
            "Microphone selection updates the active audio manager.",
        )),
        "selected_output_device" => Some((
            "/v1/audio/output",
            "Output-device selection has a dedicated audio route.",
        )),
        "clamshell_microphone" => Some((
            "/v1/audio/clamshell-microphone",
            "Clamshell microphone selection has a dedicated audio route.",
        )),
        "http_api_enabled" | "http_api_port" => Some((
            "Settings > Diagnostics",
            "Changing the running API server from inside its own request is intentionally blocked.",
        )),
        _ => None,
    }
}

const COMMAND_FIELDS: &[(&str, &[&str])] = &[
    ("acoustic_profile", &["acoustic_profile"]),
    (
        "adaptive_selection_rewrite_enabled",
        &["adaptive_selection_rewrite_enabled"],
    ),
    (
        "cloud_selection_rewrite_allowed",
        &["cloud_selection_rewrite_allowed"],
    ),
    ("markdown_export_enabled", &["markdown_export_enabled"]),
    (
        "markdown_export_dir",
        &["markdown_export_dir", "markdown_export_enabled"],
    ),
    ("markdown_export_min_words", &["markdown_export_min_words"]),
    (
        "markdown_export_content_source",
        &["markdown_export_content_source"],
    ),
    (
        "markdown_export_frontmatter",
        &["markdown_export_frontmatter"],
    ),
    (
        "markdown_export_include_rewrite_selection",
        &["markdown_export_include_rewrite_selection"],
    ),
    (
        "markdown_export_include_failed_paste",
        &["markdown_export_include_failed_paste"],
    ),
    (
        "keyboard_implementation",
        &["keyboard_implementation", "bindings"],
    ),
    ("autostart_enabled", &["autostart_enabled"]),
    ("update_checks_enabled", &["update_checks_enabled"]),
    ("enable_crash_reporting", &["enable_crash_reporting"]),
    ("enable_usage_analytics", &["enable_usage_analytics"]),
    ("audio_enhancement_enabled", &["audio_enhancement_enabled"]),
    ("audio_enhancement_model", &["audio_enhancement_model"]),
    ("app_theme", &["app_theme"]),
    ("app_font_scale", &["app_font_scale"]),
    (
        "translate_to_english",
        &[
            "translate_to_english",
            "translation_output_mode",
            "translation_target_language",
            "translation_route_preference",
        ],
    ),
    (
        "translation_route_preference",
        &["translation_route_preference"],
    ),
    ("overlay_position", &["overlay_position"]),
    ("recording_overlay_style", &["recording_overlay_style"]),
    ("debug_mode", &["debug_mode", "log_level"]),
    ("show_technical_features", &["show_technical_features"]),
    ("start_hidden", &["start_hidden"]),
    ("screen_context_enabled", &["screen_context_enabled"]),
    (
        "screen_context_excluded_bundle_ids",
        &["screen_context_excluded_bundle_ids"],
    ),
    (
        "screen_context_pause_on_idle",
        &["screen_context_pause_on_idle"],
    ),
    (
        "screen_context_idle_threshold_ms",
        &["screen_context_idle_threshold_ms"],
    ),
    ("context_capture_mode", &["context_capture_mode"]),
    (
        "screen_context_ocr_quality",
        &["screen_context_ocr_quality"],
    ),
    ("screen_context_ocr_engine", &["screen_context_ocr_engine"]),
    (
        "screen_context_ocr_timeout_ms",
        &["screen_context_ocr_timeout_ms"],
    ),
    (
        "screen_context_token_budget",
        &["screen_context_token_budget"],
    ),
    (
        "screen_context_stale_threshold_ms",
        &["screen_context_stale_threshold_ms"],
    ),
    ("speech_runtime_path", &["speech_runtime_path"]),
    ("tts_model_store_path", &["tts_model_store_path"]),
    (
        "external_model_storage_enabled",
        &["external_model_storage_enabled"],
    ),
    (
        "external_model_storage_auto_detect",
        &["external_model_storage_auto_detect"],
    ),
    (
        "external_model_storage_path",
        &["external_model_storage_path"],
    ),
    (
        "tts_engine_preference",
        &[
            "tts_engine_preference",
            "selected_tts_provider_id",
            "selected_tts_model_id",
        ],
    ),
    (
        "tts_default_voice_id",
        &[
            "tts_default_voice_id",
            "selected_tts_voice_id",
            "selected_tts_model_id",
        ],
    ),
    ("tts_rate", &["tts_rate"]),
    ("tts_volume", &["tts_volume"]),
    (
        "selected_creative_audio_model_id",
        &["selected_creative_audio_model_id"],
    ),
    ("post_process_enabled", &["post_process_enabled"]),
    (
        "local_privacy_mode",
        &[
            "local_privacy_mode",
            "post_process_provider_id",
            "translation_provider_id",
        ],
    ),
    (
        "post_process_provider_id",
        &[
            "post_process_provider_id",
            "selected_llm_provider_id",
            "selected_llm_model_id",
        ],
    ),
    (
        "selected_llm_provider_id",
        &[
            "post_process_provider_id",
            "selected_llm_provider_id",
            "selected_llm_model_id",
        ],
    ),
    (
        "post_process_models",
        &["post_process_models", "selected_llm_model_id"],
    ),
    (
        "selected_llm_model_id",
        &["post_process_models", "selected_llm_model_id"],
    ),
    (
        "post_process_cleanup_level",
        &[
            "post_process_cleanup_level",
            "post_process_mode",
            "max_rewrite_strength",
        ],
    ),
    ("max_rewrite_strength", &["max_rewrite_strength"]),
    ("post_process_providers", &["post_process_providers"]),
    ("translation_provider_id", &["translation_provider_id"]),
    ("translation_model_ids", &["translation_model_ids"]),
    ("external_script_path", &["external_script_path"]),
    ("app_language", &["app_language"]),
];

const STRING_COMMANDS: &[&str] = &[
    "acoustic_profile",
    "markdown_export_content_source",
    "keyboard_implementation",
    "audio_enhancement_model",
    "app_theme",
    "translation_route_preference",
    "overlay_position",
    "recording_overlay_style",
    "context_capture_mode",
    "screen_context_ocr_quality",
    "screen_context_ocr_engine",
    "tts_engine_preference",
    "selected_creative_audio_model_id",
    "post_process_provider_id",
    "selected_llm_provider_id",
    "selected_llm_model_id",
    "post_process_cleanup_level",
    "translation_provider_id",
    "app_language",
];

pub(super) async fn apply_settings_command(
    app: &AppHandle,
    key: String,
    value: Value,
) -> Result<Vec<String>, String> {
    let key = key.trim();
    let fields = command_fields(key)?;
    match key {
        "keyboard_implementation" => {
            aliases::change_keyboard_implementation_setting(
                app.clone(),
                setting_string(&value, key)?,
            )?;
        }
        "selected_creative_audio_model_id" => {
            commands::story_studio::set_creative_audio_model_selection(
                app.clone(),
                setting_string(&value, key)?,
            )?;
        }
        "post_process_models" | "translation_model_ids" => {
            let (provider, model) = provider_model_from_value(&value, key)?;
            if key == "post_process_models" {
                commands::post_process::set_post_process_model(app.clone(), provider, model)?;
            } else {
                commands::post_process::set_translation_model(app.clone(), provider, model)?;
            }
        }
        "selected_llm_model_id" => {
            commands::post_process::set_post_process_model(
                app.clone(),
                get_settings_without_secrets(app).post_process_provider_id,
                setting_string(&value, key)?,
            )?;
        }
        "post_process_providers" => {
            let (provider, url) = provider_base_url_from_value(&value, key)?;
            aliases::change_post_process_base_url_setting(app.clone(), provider, url)?;
        }
        _ => {
            apply_setting_updates(app, vec![decode_preference(key, value)?]).await?;
        }
    }
    Ok(fields.iter().map(|field| (*field).to_string()).collect())
}

fn command_fields(key: &str) -> Result<&'static [&'static str], String> {
    COMMAND_FIELDS.iter().find(|(name, _)| *name == key).map(|(_, fields)| *fields)
        .ok_or_else(|| format!("'{key}' is not a command-backed setting. Use /v1/settings/patch for patchable fields or /v1/settings/schema for routing."))
}

fn decode_preference(key: &str, mut value: Value) -> Result<SettingUpdate, String> {
    if STRING_COMMANDS.contains(&key) {
        value = setting_string(&value, key)?.into();
    }
    if key == "screen_context_excluded_bundle_ids" {
        let values = value.as_array().ok_or("Expected an array of bundle IDs.")?;
        value = serde_json::to_value(
            values
                .iter()
                .map(|value| setting_string(value, key))
                .collect::<Result<Vec<_>, _>>()?,
        )
        .map_err(|error| error.to_string())?;
    }
    let key = if key == "selected_llm_provider_id" {
        "post_process_provider_id"
    } else {
        key
    };
    preferences::decode(key, value)
}

/// The patch route retains the published field whitelist. Command-backed fields
/// keep their validation/side-effect routes; no raw AppSettings merge bypasses them.
pub(super) fn parse_setting_updates(body: Value) -> Result<Vec<SettingUpdate>, String> {
    let Value::Object(mut object) = body else {
        return Err("Expected a JSON object or { \"updates\": { ... } }.".to_string());
    };
    let updates = match object.remove("updates") {
        Some(Value::Object(updates)) => updates,
        Some(_) => return Err("updates must be a JSON object.".to_string()),
        None => object,
    };
    if updates.is_empty() {
        return Err("At least one setting update is required.".to_string());
    }
    updates
        .into_iter()
        .map(|(key, value)| {
            if let Some((route, note)) = protected_settings_route(&key) {
                return Err(format!(
                    "'{key}' is not patchable through /v1/settings/patch. Use {route}. {note}"
                ));
            }
            if !SettingUpdate::KEYS.contains(&key.as_str()) {
                return Err(format!("Unknown setting field: '{key}'."));
            }
            serde_json::from_value(serde_json::json!({ "key": key, "value": value }))
                .map_err(|error| format!("Invalid value for '{key}': {error}"))
        })
        .collect()
}

fn setting_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("'{key}' expects a non-empty string value."))
}

fn provider_model_from_value(value: &Value, key: &str) -> Result<(String, String), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("'{key}' expects an object value."))?;

    if let (Some(provider_id), Some(model)) = (object.get("provider_id"), object.get("model")) {
        return Ok((
            setting_string(provider_id, "provider_id")?,
            setting_string(model, "model")?,
        ));
    }

    if object.len() == 1 {
        let (provider_id, model) = object.iter().next().expect("object has one entry");
        return Ok((provider_id.clone(), setting_string(model, provider_id)?));
    }

    Err(format!(
        "'{key}' expects {{ \"provider_id\": string, \"model\": string }} or a one-entry provider map."
    ))
}

fn provider_base_url_from_value(value: &Value, key: &str) -> Result<(String, String), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("'{key}' expects an object value."))?;
    let provider_id = object
        .get("provider_id")
        .ok_or_else(|| format!("'{key}' requires provider_id."))?;
    let base_url = object
        .get("base_url")
        .ok_or_else(|| format!("'{key}' requires base_url."))?;
    Ok((
        setting_string(provider_id, "provider_id")?,
        setting_string(base_url, "base_url")?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn published_provider_payloads_and_response_keys_are_preserved() {
        for value in [
            json!({"provider_id": " ollama ", "model": " model "}),
            json!({"ollama": " model "}),
        ] {
            assert_eq!(
                provider_model_from_value(&value, "post_process_models").unwrap(),
                ("ollama".into(), "model".into())
            );
        }
        assert!(
            provider_model_from_value(&json!({"a":"b", "c":"d"}), "post_process_models").is_err()
        );
        assert_eq!(
            command_fields("translate_to_english").unwrap(),
            [
                "translate_to_english",
                "translation_output_mode",
                "translation_target_language",
                "translation_route_preference"
            ]
        );
        assert!(command_fields("http_api_token").is_err());
    }

    #[test]
    fn command_decoding_keeps_string_defaults_and_rejects_invalid_types() {
        assert!(
            matches!(decode_preference("app_theme", json!(" dark ")).unwrap(), SettingUpdate::AppTheme(theme) if theme == "dark")
        );
        assert!(matches!(
            decode_preference("overlay_position", json!("unknown")).unwrap(),
            SettingUpdate::OverlayPosition(crate::settings::OverlayPosition::Bottom)
        ));
        assert!(decode_preference("app_theme", json!(123)).is_err());
        assert!(decode_preference("app_theme", json!(" ")).is_err());
        assert!(decode_preference("tts_rate", json!("fast")).is_err());
        assert!(
            matches!(decode_preference("selected_llm_provider_id", json!(" ollama ")).unwrap(), SettingUpdate::PostProcessProviderId(provider) if provider == "ollama")
        );
    }
}
