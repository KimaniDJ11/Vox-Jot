use super::*;
use crate::settings::get_default_settings;
use serde_json::json;

fn parse(key: &str, value: serde_json::Value) -> Result<SettingUpdate, serde_json::Error> {
    serde_json::from_value(json!({ "key": key, "value": value }))
}

fn applied(updates: Vec<SettingUpdate>) -> Result<AppSettings, String> {
    let mut settings = get_default_settings();
    apply_updates(&mut settings, updates)?;
    Ok(settings)
}

#[test]
fn every_key_names_an_app_settings_field() {
    let fields = serde_json::to_value(get_default_settings()).expect("settings serialize");
    let fields = fields.as_object().expect("settings are an object");
    for key in SettingUpdate::KEYS {
        assert!(
            fields.contains_key(*key),
            "{key} is not an AppSettings field"
        );
    }
}

#[test]
fn keys_round_trip_through_the_wire_format() {
    let update = parse("recording_overlay_style", json!("notch")).expect("valid update");
    assert_eq!(update.key(), "recording_overlay_style");
    assert!(matches!(
        update,
        SettingUpdate::RecordingOverlayStyle(RecordingOverlayStyle::Notch)
    ));
}

#[test]
fn every_overlay_style_offered_by_the_ui_is_persisted() {
    for (raw, expected) in [
        ("compact", RecordingOverlayStyle::Compact),
        ("detailed", RecordingOverlayStyle::Detailed),
        ("minimal", RecordingOverlayStyle::Minimal),
        ("notch", RecordingOverlayStyle::Notch),
    ] {
        let settings = applied(vec![parse("recording_overlay_style", json!(raw)).unwrap()])
            .expect("style applies");
        assert_eq!(settings.recording_overlay_style, expected, "{raw}");
    }
}

#[test]
fn unknown_values_are_rejected_instead_of_replaced() {
    assert!(parse("paste_method", json!("telepathy")).is_err());
    assert!(parse("sound_theme", json!("kazoo")).is_err());
    assert!(parse("overlay_position", json!("left")).is_err());
    assert!(parse("not_a_setting", json!(true)).is_err());
    assert!(parse("push_to_talk", json!("yes")).is_err());

    let error = applied(vec![SettingUpdate::AppTheme("neon".into())]).unwrap_err();
    assert!(error.contains("app_theme"), "{error}");
}

#[test]
fn numeric_preferences_are_clamped_to_supported_ranges() {
    let settings = applied(vec![
        SettingUpdate::AudioFeedbackVolume(3.0),
        SettingUpdate::AppFontScale(0.1),
        SettingUpdate::TtsRate(9.0),
        SettingUpdate::TtsVolume(-1.0),
        SettingUpdate::MarkdownExportMinWords(0),
        SettingUpdate::ScreenContextTokenBudget(50_000),
        SettingUpdate::ScreenContextIdleThresholdMs(1),
        SettingUpdate::ScreenContextStaleThresholdMs(u32::MAX),
        SettingUpdate::HistoryAutoAnalyzeSpeakersMinDurationMs(0),
        SettingUpdate::MaxRewriteStrength(9),
    ])
    .expect("updates apply");

    assert_eq!(settings.audio_feedback_volume, 1.0);
    assert_eq!(settings.app_font_scale, 0.9);
    assert_eq!(settings.tts_rate, 2.0);
    assert_eq!(settings.tts_volume, 0.0);
    assert_eq!(settings.markdown_export_min_words, 1);
    assert_eq!(settings.screen_context_token_budget, 2_000);
    assert_eq!(settings.screen_context_idle_threshold_ms, 10_000);
    assert_eq!(settings.screen_context_stale_threshold_ms, 10_000);
    assert_eq!(
        settings.history_auto_analyze_speakers_min_duration_ms,
        30_000
    );
    assert_eq!(settings.max_rewrite_strength, 2);
}

#[test]
fn optional_text_is_trimmed_and_blank_means_unset() {
    let settings = applied(vec![
        SettingUpdate::SelectedMicrophone(Some("  USB Mic  ".into())),
        SettingUpdate::SelectedOutputDevice(Some("   ".into())),
        SettingUpdate::SpeechRuntimePath(Some("".into())),
        SettingUpdate::TtsModelStorePath(Some(" /models ".into())),
    ])
    .expect("updates apply");

    assert_eq!(settings.selected_microphone.as_deref(), Some("USB Mic"));
    assert_eq!(settings.selected_output_device, None);
    assert_eq!(settings.speech_runtime_path, None);
    assert_eq!(settings.tts_model_store_path.as_deref(), Some("/models"));
}

#[test]
fn translate_to_english_keeps_translation_fields_consistent() {
    let on = applied(vec![SettingUpdate::TranslateToEnglish(true)]).unwrap();
    assert_eq!(
        on.translation_output_mode,
        TranslationOutputMode::Translated
    );
    assert_eq!(on.translation_target_language, "en");
    assert_eq!(
        on.translation_route_preference,
        TranslationRoutePreference::WhisperEnglish
    );

    let off = applied(vec![SettingUpdate::TranslateToEnglish(false)]).unwrap();
    assert_eq!(off.translation_output_mode, TranslationOutputMode::Source);
    assert_eq!(
        off.translation_route_preference,
        TranslationRoutePreference::Auto
    );
}

#[test]
fn cleanup_level_sets_the_matching_mode_and_rewrite_strength() {
    let level = PostProcessCleanupLevel::High;
    let settings = applied(vec![SettingUpdate::PostProcessCleanupLevel(level)]).unwrap();
    assert_eq!(settings.post_process_cleanup_level, level);
    assert_eq!(settings.post_process_mode, level.mode());
    assert_eq!(settings.max_rewrite_strength, level.rewrite_strength());
}

#[test]
fn debug_mode_raises_log_detail_without_lowering_trace() {
    let mut settings = get_default_settings();
    settings.log_level = LogLevel::Warn;
    apply_updates(&mut settings, [SettingUpdate::DebugMode(true)]).unwrap();
    assert_eq!(settings.log_level, LogLevel::Debug);

    settings.log_level = LogLevel::Trace;
    apply_updates(&mut settings, [SettingUpdate::DebugMode(true)]).unwrap();
    assert_eq!(settings.log_level, LogLevel::Trace);

    apply_updates(&mut settings, [SettingUpdate::DebugMode(false)]).unwrap();
    assert_eq!(settings.log_level, LogLevel::Trace);
}

#[test]
fn provider_selection_requires_a_known_provider_and_respects_privacy() {
    let error = applied(vec![SettingUpdate::PostProcessProviderId("nope".into())]).unwrap_err();
    assert!(error.contains("not found"), "{error}");

    let mut settings = get_default_settings();
    settings.local_privacy_mode = true;
    let remote = settings
        .post_process_providers
        .iter()
        .find(|provider| !crate::settings::post_process_provider_is_local(provider))
        .map(|provider| provider.id.clone())
        .expect("a remote provider exists");
    let error = apply_updates(
        &mut settings,
        [SettingUpdate::PostProcessProviderId(remote.clone())],
    )
    .unwrap_err();
    assert!(error.contains("Local privacy mode"), "{error}");
    let error = apply_updates(
        &mut settings,
        [SettingUpdate::TranslationProviderId(remote)],
    )
    .unwrap_err();
    assert!(error.contains("translation"), "{error}");
}

#[test]
fn selecting_a_post_process_provider_selects_its_saved_model() {
    let mut settings = get_default_settings();
    let provider_id = settings.post_process_providers[0].id.clone();
    settings
        .post_process_models
        .insert(provider_id.clone(), "saved-model".into());
    apply_updates(
        &mut settings,
        [SettingUpdate::PostProcessProviderId(provider_id.clone())],
    )
    .unwrap();
    assert_eq!(settings.post_process_provider_id, provider_id);
    assert_eq!(settings.selected_llm_provider_id, provider_id);
    assert_eq!(settings.selected_llm_model_id, "saved-model");
}

#[test]
fn markdown_export_cannot_be_enabled_without_a_folder() {
    let error = applied(vec![SettingUpdate::MarkdownExportEnabled(true)]).unwrap_err();
    assert!(error.contains("export folder"), "{error}");

    let mut settings = get_default_settings();
    settings.markdown_export_dir = Some(PathBuf::from("/tmp/notes"));
    settings.markdown_export_enabled = true;
    apply_updates(&mut settings, [SettingUpdate::MarkdownExportDir(None)]).unwrap();
    assert!(!settings.markdown_export_enabled);
}

#[test]
fn excluded_bundle_ids_are_trimmed_and_deduplicated_case_insensitively() {
    let settings = applied(vec![SettingUpdate::ScreenContextExcludedBundleIds(vec![
        " com.apple.Safari ".into(),
        "".into(),
        "COM.APPLE.SAFARI".into(),
        "com.tinyspeck.slackmacgap".into(),
    ])])
    .unwrap();
    assert_eq!(
        settings.screen_context_excluded_bundle_ids,
        vec!["com.apple.Safari", "com.tinyspeck.slackmacgap"]
    );
}

#[test]
fn a_batch_reports_the_key_of_the_first_rejected_update() {
    let mut settings = get_default_settings();
    let audio_feedback = !settings.audio_feedback;
    let error = apply_updates(
        &mut settings,
        [
            SettingUpdate::AudioFeedback(audio_feedback),
            SettingUpdate::PostProcessSelectedPromptId(Some("missing".into())),
            SettingUpdate::AppTheme("neon".into()),
        ],
    )
    .unwrap_err();
    assert!(
        error.starts_with("post_process_selected_prompt_id:"),
        "{error}"
    );
}

#[test]
fn external_storage_path_enables_external_storage() {
    let settings = applied(vec![
        SettingUpdate::ExternalModelStorageEnabled(false),
        SettingUpdate::ExternalModelStoragePath(Some("/Volumes/Models".into())),
    ])
    .unwrap();
    assert!(settings.external_model_storage_enabled);
}

#[test]
fn every_offered_app_theme_is_accepted() {
    for theme in VALID_APP_THEMES {
        let settings = applied(vec![SettingUpdate::AppTheme(theme.to_string())]).unwrap();
        assert_eq!(settings.app_theme, *theme);
    }
    for theme in ["aurora", "lagoon", "daybreak", "ember", "galaxy"] {
        assert!(VALID_APP_THEMES.contains(&theme), "{theme} is missing");
    }
}

#[test]
fn capture_updates_are_identified() {
    assert!(SettingUpdate::AcousticProfile(AcousticProfile::Quiet).changes_capture());
    assert!(SettingUpdate::AudioEnhancementEnabled(true).changes_capture());
    assert!(SettingUpdate::AudioEnhancementModel("x".into()).changes_capture());
    assert!(!SettingUpdate::AlwaysOnMicrophone(true).changes_capture());
}
