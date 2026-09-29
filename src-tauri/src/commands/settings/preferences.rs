//! Named preference commands are the stable public wire API.
//!
//! Each adapter decodes its historical argument into the same typed update used
//! by the app and HTTP API. Validation, persistence and runtime effects have one
//! owner; no preference is written here.

use crate::post_processing::{DictionaryEntry, ToneDefinition};
use crate::settings::{LogLevel, ModelUnloadTimeout, SettingUpdate};
use tauri::AppHandle;

macro_rules! preference_commands {
    ($($name:ident($argument:ident: $value:ty) => $key:literal;)*) => {
        $(
            #[tauri::command]
            #[specta::specta]
            pub async fn $name(app: AppHandle, $argument: $value) -> Result<(), String> {
                let value = serde_json::to_value($argument).map_err(|error| error.to_string())?;
                super::update_setting(app, decode($key, value)?).await.map(|_| ())
            }
        )*
    };
}

preference_commands! {
    change_ptt_setting(enabled: bool) => "push_to_talk";
    change_audio_feedback_setting(enabled: bool) => "audio_feedback";
    change_audio_feedback_volume_setting(volume: f32) => "audio_feedback_volume";
    change_sound_theme_setting(theme: String) => "sound_theme";
    change_app_theme_setting(theme: String) => "app_theme";
    change_app_font_scale_setting(scale: f32) => "app_font_scale";
    change_start_hidden_setting(enabled: bool) => "start_hidden";
    change_autostart_setting(enabled: bool) => "autostart_enabled";
    change_translate_to_english_setting(enabled: bool) => "translate_to_english";
    change_selected_language_setting(language: String) => "selected_language";
    change_translation_output_mode_setting(mode: String) => "translation_output_mode";
    change_translation_target_language_setting(language: String) => "translation_target_language";
    change_translation_route_preference_setting(route: String) => "translation_route_preference";
    change_translation_bilingual_layout_setting(layout: String) => "translation_bilingual_layout";
    change_translation_translate_snippets_setting(enabled: bool) => "translation_translate_snippets";
    change_translation_destination_mode_setting(mode: String) => "translation_destination_mode";
    change_selection_translation_destination_mode_setting(mode: String) => "selection_translation_destination_mode";
    change_tts_enabled_setting(enabled: bool) => "tts_enabled";
    change_tts_engine_preference_setting(preference: String) => "tts_engine_preference";
    change_tts_auto_readback_mode_setting(mode: String) => "tts_auto_readback_mode";
    change_tts_auto_readback_scope_setting(scope: String) => "tts_auto_readback_scope";
    change_tts_readback_text_mode_setting(mode: String) => "tts_readback_text_mode";
    change_tts_default_voice_id_setting(voice_id: Option<String>) => "tts_default_voice_id";
    change_tts_rate_setting(rate: f32) => "tts_rate";
    change_tts_volume_setting(volume: f32) => "tts_volume";
    change_tts_stop_on_record_setting(enabled: bool) => "tts_stop_on_record";
    change_audio_enhancement_enabled_setting(enabled: bool) => "audio_enhancement_enabled";
    change_audio_enhancement_model_setting(model: String) => "audio_enhancement_model";
    change_acoustic_profile_setting(profile: String) => "acoustic_profile";
    change_tts_model_store_path_setting(path: Option<String>) => "tts_model_store_path";
    change_external_model_storage_enabled_setting(enabled: bool) => "external_model_storage_enabled";
    change_external_model_storage_auto_detect_setting(enabled: bool) => "external_model_storage_auto_detect";
    change_external_model_storage_path_setting(path: Option<String>) => "external_model_storage_path";
    change_speech_runtime_path_setting(path: Option<String>) => "speech_runtime_path";
    change_overlay_position_setting(position: String) => "overlay_position";
    change_recording_overlay_style_setting(style: String) => "recording_overlay_style";
    change_debug_mode_setting(enabled: bool) => "debug_mode";
    change_show_technical_features_setting(enabled: bool) => "show_technical_features";
    change_word_correction_threshold_setting(threshold: f64) => "word_correction_threshold";
    change_paste_method_setting(method: String) => "paste_method";
    change_typing_tool_setting(tool: String) => "typing_tool";
    change_external_script_path_setting(path: Option<String>) => "external_script_path";
    change_clipboard_handling_setting(handling: String) => "clipboard_handling";
    change_auto_submit_setting(enabled: bool) => "auto_submit";
    change_auto_submit_key_setting(key: String) => "auto_submit_key";
    change_post_process_enabled_setting(enabled: bool) => "post_process_enabled";
    change_adaptive_selection_rewrite_enabled_setting(enabled: bool) => "adaptive_selection_rewrite_enabled";
    change_cloud_selection_rewrite_allowed_setting(allowed: bool) => "cloud_selection_rewrite_allowed";
    change_markdown_export_enabled_setting(enabled: bool) => "markdown_export_enabled";
    change_markdown_export_dir_setting(path: Option<String>) => "markdown_export_dir";
    change_markdown_export_min_words_setting(min_words: usize) => "markdown_export_min_words";
    change_markdown_export_content_source_setting(source: String) => "markdown_export_content_source";
    change_markdown_export_frontmatter_setting(enabled: bool) => "markdown_export_frontmatter";
    change_markdown_export_include_rewrite_selection_setting(enabled: bool) => "markdown_export_include_rewrite_selection";
    change_markdown_export_include_failed_paste_setting(enabled: bool) => "markdown_export_include_failed_paste";
    change_suggest_meeting_apps_setting(enabled: bool) => "suggest_meeting_apps";
    change_show_live_partials_setting(enabled: bool) => "show_live_partials";
    change_local_privacy_mode_setting(enabled: bool) => "local_privacy_mode";
    set_onboarding_completed(completed: bool) => "onboarding_completed";
    change_screen_context_enabled_setting(enabled: bool) => "screen_context_enabled";
    change_screen_context_excluded_bundle_ids_setting(bundle_ids: Vec<String>) => "screen_context_excluded_bundle_ids";
    change_screen_context_pause_on_idle_setting(enabled: bool) => "screen_context_pause_on_idle";
    change_screen_context_idle_threshold_ms_setting(threshold_ms: u32) => "screen_context_idle_threshold_ms";
    change_context_capture_mode_setting(mode: String) => "context_capture_mode";
    change_screen_context_ocr_quality_setting(quality: String) => "screen_context_ocr_quality";
    change_screen_context_ocr_engine_setting(engine: String) => "screen_context_ocr_engine";
    change_screen_context_ocr_timeout_ms_setting(timeout_ms: u32) => "screen_context_ocr_timeout_ms";
    change_screen_context_token_budget_setting(token_budget: u32) => "screen_context_token_budget";
    change_screen_context_stale_threshold_ms_setting(stale_threshold_ms: u32) => "screen_context_stale_threshold_ms";
    change_post_process_mode_setting(mode: String) => "post_process_mode";
    change_post_process_cleanup_level_setting(level: String) => "post_process_cleanup_level";
    change_experimental_enabled_setting(enabled: bool) => "experimental_enabled";
    set_post_process_provider(provider_id: String) => "post_process_provider_id";
    set_translation_provider(provider_id: String) => "translation_provider_id";
    set_post_process_selected_prompt(id: String) => "post_process_selected_prompt_id";
    update_custom_words(words: Vec<String>) => "custom_words";
    change_custom_filler_words_setting(words: Option<Vec<String>>) => "custom_filler_words";
    update_personal_dictionary(entries: Vec<DictionaryEntry>) => "personal_dictionary";
    change_max_rewrite_strength_setting(strength: u8) => "max_rewrite_strength";
    change_show_preview_before_paste_setting(enabled: bool) => "show_preview_before_paste";
    change_fallback_to_raw_on_failure_setting(enabled: bool) => "fallback_to_raw_on_failure";
    change_app_aware_tone_enabled_setting(enabled: bool) => "app_aware_tone_enabled";
    change_write_rules_enabled_setting(enabled: Option<bool>) => "write_rules_enabled_override";
    update_tone_definitions(definitions: Vec<ToneDefinition>) => "tone_definitions";
    change_mute_while_recording_setting(enabled: bool) => "mute_while_recording";
    change_audio_ducking_setting(enabled: bool) => "audio_ducking_enabled";
    change_append_trailing_space_setting(enabled: bool) => "append_trailing_space";
    change_app_language_setting(language: String) => "app_language";
    change_global_language_sync_enabled_setting(enabled: bool) => "global_language_sync_enabled";
    change_update_checks_setting(enabled: bool) => "update_checks_enabled";
    change_crash_reporting_setting(enabled: bool) => "enable_crash_reporting";
    change_usage_analytics_setting(enabled: bool) => "enable_usage_analytics";
    change_show_tray_icon_setting(enabled: bool) => "show_tray_icon";
    change_correction_tracking_enabled_setting(enabled: bool) => "correction_tracking_enabled";
    change_file_transcription_apply_dictionary_setting(enabled: bool) => "file_transcription_apply_dictionary";
    change_snippets_enabled_setting(enabled: bool) => "snippets_enabled";
    update_snippets(snippets: Vec<crate::snippets::Snippet>) => "snippets";
    set_log_level(level: LogLevel) => "log_level";
    update_microphone_mode(always_on: bool) => "always_on_microphone";
    set_selected_microphone(device_name: String) => "selected_microphone";
    set_selected_output_device(device_name: String) => "selected_output_device";
    set_clamshell_microphone(device_name: String) => "clamshell_microphone";
    set_model_unload_timeout(timeout: ModelUnloadTimeout) => "model_unload_timeout";
    change_write_rules_url_capture_enabled_setting(enabled: bool) => "write_rules_url_capture_enabled";
    update_history_limit(limit: usize) => "history_limit";
    update_history_auto_analyze_speakers_long_recordings_enabled(enabled: bool) => "history_auto_analyze_speakers_long_recordings_enabled";
    update_history_auto_analyze_speakers_min_duration_ms(min_duration_ms: u32) => "history_auto_analyze_speakers_min_duration_ms";
    update_recording_retention_period(period: String) => "recording_retention_period";
}

/// Preserve the named commands' documented defaults for unrecognized strings.
/// The typed update API remains strict; these conversions belong to the older
/// string-based wire interface, not to the settings domain.
pub(crate) fn decode(key: &str, mut value: serde_json::Value) -> Result<SettingUpdate, String> {
    if matches!(
        key,
        "selected_microphone" | "selected_output_device" | "clamshell_microphone"
    ) && value.as_str() == Some("default")
    {
        value = serde_json::Value::Null;
    }
    if key == "acoustic_profile" {
        if let Some(raw) = value.as_str() {
            value = raw.trim().to_ascii_lowercase().into();
        }
    }
    let fallback = match key {
        "sound_theme" => Some((vec!["marimba", "pop", "custom"], "marimba")),
        "overlay_position" => Some((vec!["none", "top", "bottom"], "bottom")),
        "recording_overlay_style" => Some((vec!["compact", "detailed"], "compact")),
        "paste_method" => Some((
            vec![
                "ctrl_v",
                "direct",
                "none",
                "shift_insert",
                "ctrl_shift_v",
                "external_script",
            ],
            "ctrl_v",
        )),
        "typing_tool" => Some((
            vec!["auto", "wtype", "kwtype", "dotool", "ydotool", "xdotool"],
            "auto",
        )),
        "clipboard_handling" => Some((vec!["dont_modify", "copy_to_clipboard"], "dont_modify")),
        "auto_submit_key" => Some((vec!["enter", "ctrl_enter", "cmd_enter"], "enter")),
        "app_theme" => Some((crate::settings::VALID_APP_THEMES.to_vec(), "galaxy")),
        _ => None,
    };
    if let Some((known, fallback)) = fallback {
        if !value.as_str().is_some_and(|raw| known.contains(&raw)) {
            log::warn!("Unrecognized {key} value; using the public command default '{fallback}'");
            value = fallback.into();
        }
    }
    serde_json::from_value(serde_json::json!({ "key": key, "value": value }))
        .map_err(|error| format!("Invalid {key}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn named_commands_keep_device_sentinel_and_string_defaults() {
        assert!(matches!(
            decode("selected_microphone", json!("default")).unwrap(),
            SettingUpdate::SelectedMicrophone(None)
        ));
        assert!(matches!(
            decode("acoustic_profile", json!(" QUIET ")).unwrap(),
            SettingUpdate::AcousticProfile(crate::settings::AcousticProfile::Quiet)
        ));
        for (key, expected) in [
            ("sound_theme", "marimba"),
            ("overlay_position", "bottom"),
            ("paste_method", "ctrl_v"),
            ("typing_tool", "auto"),
            ("clipboard_handling", "dont_modify"),
            ("auto_submit_key", "enter"),
            ("app_theme", "galaxy"),
            ("recording_overlay_style", "compact"),
        ] {
            let mut settings = crate::settings::get_default_settings();
            crate::settings::apply_updates(&mut settings, [decode(key, json!("unknown")).unwrap()])
                .unwrap();
            assert_eq!(
                serde_json::to_value(settings).unwrap()[key],
                json!(expected),
                "{key}"
            );
        }
        assert!(decode("screen_context_ocr_quality", json!("unknown")).is_err());
    }
}
