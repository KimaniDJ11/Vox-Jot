//! The typed contract for changing user preferences.
//!
//! Every editable preference is one [`SettingUpdate`] variant whose key is the
//! `AppSettings` field it writes. Validation, normalization, and derived fields
//! live here, independent of the runtime, so the frontend, the local HTTP API,
//! and tests all go through the same rules.

use std::collections::HashSet;
use std::path::PathBuf;

use serde::Deserialize;
use specta::Type;

use super::{
    normalize_optional_string, AcousticProfile, AppSettings, AutoSubmitKey, ClipboardHandling,
    ContextCaptureMode, LogLevel, MarkdownExportContentSource, ModelUnloadTimeout, OcrQualityMode,
    OverlayPosition, PasteMethod, RecordingOverlayStyle, RecordingRetentionPeriod,
    ScreenContextOcrEngine, SelectionTranslationDestinationMode, SoundTheme,
    TranslationBilingualLayout, TranslationDestinationMode, TranslationOutputMode,
    TranslationRoutePreference, TtsAutoReadbackMode, TtsAutoReadbackScope, TtsEnginePreference,
    TtsReadbackTextMode, TypingTool, TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID,
    TTS_MODEL_SYSTEM_DEFAULT_ID, TTS_PROVIDER_LOCAL_SIDECAR_API_ID, TTS_PROVIDER_SHERPA_PACK_ID,
    TTS_PROVIDER_SYSTEM_BUILTIN_ID,
};
use crate::post_processing::{
    DictionaryEntry, PostProcessCleanupLevel, PostProcessMode, ToneDefinition,
};
use crate::snippets::Snippet;

pub(crate) const VALID_APP_THEMES: &[&str] = &[
    "system",
    "light",
    "dark",
    "sepia",
    "ocean",
    "forest",
    "rose",
    "aurora",
    "lagoon",
    "daybreak",
    "ember",
    "galaxy",
    "slate",
    "solarized",
    "graphite",
];

macro_rules! setting_updates {
    ($($variant:ident($value:ty) = $key:literal,)*) => {
        /// One preference and its new value, serialized as
        /// `{ "key": <AppSettings field>, "value": <field value> }`.
        #[derive(Debug, Clone, Deserialize, Type)]
        #[serde(tag = "key", content = "value")]
        pub enum SettingUpdate {
            $(#[serde(rename = $key)] $variant($value),)*
        }

        impl SettingUpdate {
            /// Every `AppSettings` field that this contract can change.
            pub const KEYS: &'static [&'static str] = &[$($key),*];

            pub fn key(&self) -> &'static str {
                match self {
                    $(Self::$variant(_) => $key,)*
                }
            }
        }
    };
}

setting_updates! {
    PushToTalk(bool) = "push_to_talk",
    AudioFeedback(bool) = "audio_feedback",
    AudioFeedbackVolume(f32) = "audio_feedback_volume",
    SoundTheme(SoundTheme) = "sound_theme",
    AppTheme(String) = "app_theme",
    AppFontScale(f32) = "app_font_scale",
    StartHidden(bool) = "start_hidden",
    AutostartEnabled(bool) = "autostart_enabled",
    UpdateChecksEnabled(bool) = "update_checks_enabled",
    EnableCrashReporting(bool) = "enable_crash_reporting",
    EnableUsageAnalytics(bool) = "enable_usage_analytics",
    AlwaysOnMicrophone(bool) = "always_on_microphone",
    SelectedMicrophone(Option<String>) = "selected_microphone",
    ClamshellMicrophone(Option<String>) = "clamshell_microphone",
    SelectedOutputDevice(Option<String>) = "selected_output_device",
    AcousticProfile(AcousticProfile) = "acoustic_profile",
    AudioEnhancementEnabled(bool) = "audio_enhancement_enabled",
    AudioEnhancementModel(String) = "audio_enhancement_model",
    MuteWhileRecording(bool) = "mute_while_recording",
    AudioDuckingEnabled(bool) = "audio_ducking_enabled",
    TranslateToEnglish(bool) = "translate_to_english",
    SelectedLanguage(String) = "selected_language",
    TranslationOutputMode(TranslationOutputMode) = "translation_output_mode",
    TranslationTargetLanguage(String) = "translation_target_language",
    TranslationRoutePreference(TranslationRoutePreference) = "translation_route_preference",
    TranslationProviderId(String) = "translation_provider_id",
    TranslationBilingualLayout(TranslationBilingualLayout) = "translation_bilingual_layout",
    TranslationTranslateSnippets(bool) = "translation_translate_snippets",
    TranslationDestinationMode(TranslationDestinationMode) = "translation_destination_mode",
    SelectionTranslationDestinationMode(SelectionTranslationDestinationMode) = "selection_translation_destination_mode",
    TtsEnabled(bool) = "tts_enabled",
    TtsEnginePreference(TtsEnginePreference) = "tts_engine_preference",
    TtsAutoReadbackMode(TtsAutoReadbackMode) = "tts_auto_readback_mode",
    TtsAutoReadbackScope(TtsAutoReadbackScope) = "tts_auto_readback_scope",
    TtsReadbackTextMode(TtsReadbackTextMode) = "tts_readback_text_mode",
    TtsDefaultVoiceId(Option<String>) = "tts_default_voice_id",
    TtsRate(f32) = "tts_rate",
    TtsVolume(f32) = "tts_volume",
    TtsStopOnRecord(bool) = "tts_stop_on_record",
    SpeechRuntimePath(Option<String>) = "speech_runtime_path",
    SpeechBackendOverride(Option<String>) = "speech_backend_override",
    ContinuousImprovementHqCapture(bool) = "continuous_improvement_hq_capture",
    TtsModelStorePath(Option<String>) = "tts_model_store_path",
    ExternalModelStorageEnabled(bool) = "external_model_storage_enabled",
    ExternalModelStorageAutoDetect(bool) = "external_model_storage_auto_detect",
    ExternalModelStoragePath(Option<String>) = "external_model_storage_path",
    OverlayPosition(OverlayPosition) = "overlay_position",
    RecordingOverlayStyle(RecordingOverlayStyle) = "recording_overlay_style",
    ShowLivePartials(bool) = "show_live_partials",
    SuggestMeetingApps(bool) = "suggest_meeting_apps",
    DebugMode(bool) = "debug_mode",
    ShowTechnicalFeatures(bool) = "show_technical_features",
    LogLevel(LogLevel) = "log_level",
    CustomWords(Vec<String>) = "custom_words",
    CustomFillerWords(Option<Vec<String>>) = "custom_filler_words",
    WordCorrectionThreshold(f64) = "word_correction_threshold",
    PasteMethod(PasteMethod) = "paste_method",
    PasteDelayMs(u64) = "paste_delay_ms",
    TypingTool(TypingTool) = "typing_tool",
    ExternalScriptPath(Option<String>) = "external_script_path",
    ClipboardHandling(ClipboardHandling) = "clipboard_handling",
    AutoSubmit(bool) = "auto_submit",
    AutoSubmitKey(AutoSubmitKey) = "auto_submit_key",
    AppendTrailingSpace(bool) = "append_trailing_space",
    PinnedPasteEnabled(bool) = "pinned_paste_enabled",
    HistoryLimit(usize) = "history_limit",
    HistoryAutoAnalyzeSpeakersLongRecordingsEnabled(bool) = "history_auto_analyze_speakers_long_recordings_enabled",
    HistoryAutoAnalyzeSpeakersMinDurationMs(u32) = "history_auto_analyze_speakers_min_duration_ms",
    RecordingRetentionPeriod(RecordingRetentionPeriod) = "recording_retention_period",
    PostProcessEnabled(bool) = "post_process_enabled",
    PostProcessProviderId(String) = "post_process_provider_id",
    PostProcessMode(PostProcessMode) = "post_process_mode",
    PostProcessCleanupLevel(PostProcessCleanupLevel) = "post_process_cleanup_level",
    PostProcessSelectedPromptId(Option<String>) = "post_process_selected_prompt_id",
    MaxRewriteStrength(u8) = "max_rewrite_strength",
    ShowPreviewBeforePaste(bool) = "show_preview_before_paste",
    FallbackToRawOnFailure(bool) = "fallback_to_raw_on_failure",
    AdaptiveSelectionRewriteEnabled(bool) = "adaptive_selection_rewrite_enabled",
    CloudSelectionRewriteAllowed(bool) = "cloud_selection_rewrite_allowed",
    PersonalDictionary(Vec<DictionaryEntry>) = "personal_dictionary",
    AppAwareToneEnabled(bool) = "app_aware_tone_enabled",
    ToneDefinitions(Vec<ToneDefinition>) = "tone_definitions",
    WriteRulesEnabledOverride(Option<bool>) = "write_rules_enabled_override",
    WriteRulesUrlCaptureEnabled(bool) = "write_rules_url_capture_enabled",
    MarkdownExportEnabled(bool) = "markdown_export_enabled",
    MarkdownExportDir(Option<PathBuf>) = "markdown_export_dir",
    MarkdownExportMinWords(usize) = "markdown_export_min_words",
    MarkdownExportContentSource(MarkdownExportContentSource) = "markdown_export_content_source",
    MarkdownExportFrontmatter(bool) = "markdown_export_frontmatter",
    MarkdownExportIncludeRewriteSelection(bool) = "markdown_export_include_rewrite_selection",
    MarkdownExportIncludeFailedPaste(bool) = "markdown_export_include_failed_paste",
    LocalPrivacyMode(bool) = "local_privacy_mode",
    ScreenContextEnabled(bool) = "screen_context_enabled",
    ScreenContextExcludedBundleIds(Vec<String>) = "screen_context_excluded_bundle_ids",
    ScreenContextPauseOnIdle(bool) = "screen_context_pause_on_idle",
    ScreenContextIdleThresholdMs(u32) = "screen_context_idle_threshold_ms",
    ContextCaptureMode(ContextCaptureMode) = "context_capture_mode",
    ScreenContextOcrQuality(OcrQualityMode) = "screen_context_ocr_quality",
    ScreenContextOcrEngine(ScreenContextOcrEngine) = "screen_context_ocr_engine",
    ScreenContextOcrTimeoutMs(u32) = "screen_context_ocr_timeout_ms",
    ScreenContextTokenBudget(u32) = "screen_context_token_budget",
    ScreenContextStaleThresholdMs(u32) = "screen_context_stale_threshold_ms",
    AppLanguage(String) = "app_language",
    GlobalLanguageSyncEnabled(bool) = "global_language_sync_enabled",
    ExperimentalEnabled(bool) = "experimental_enabled",
    ShowTrayIcon(bool) = "show_tray_icon",
    CorrectionTrackingEnabled(bool) = "correction_tracking_enabled",
    FileTranscriptionApplyDictionary(bool) = "file_transcription_apply_dictionary",
    SnippetsEnabled(bool) = "snippets_enabled",
    Snippets(Vec<Snippet>) = "snippets",
    ModelUnloadTimeout(ModelUnloadTimeout) = "model_unload_timeout",
    OnboardingCompleted(bool) = "onboarding_completed",
    TtsActivePresetId(Option<String>) = "tts_active_preset_id",
    TtsVoicePresets(Vec<super::TtsVoicePreset>) = "tts_voice_presets",
    PostProcessPrompts(Vec<super::LLMPrompt>) = "post_process_prompts",
    PostProcessPromptPolicyVersion(u32) = "post_process_prompt_policy_version",
    ScreenContextOcrTimeoutPolicyVersion(u32) = "screen_context_ocr_timeout_policy_version",
    FileTranscriptionAsrModelId(String) = "file_transcription_asr_model_id",
    FileTranscriptionDiarizationModelId(String) = "file_transcription_diarization_model_id",
    FileTranscriptionEmotionModelId(String) = "file_transcription_emotion_model_id",
    WatchFolders(Vec<super::WatchFolderConfig>) = "watch_folders",

}

impl SettingUpdate {
    /// Changes to the microphone capture pipeline, which must be applied while
    /// no recording is running.
    pub fn changes_capture(&self) -> bool {
        matches!(
            self,
            Self::AcousticProfile(_)
                | Self::AudioEnhancementEnabled(_)
                | Self::AudioEnhancementModel(_)
        )
    }

    fn apply(self, s: &mut AppSettings) -> Result<(), String> {
        match self {
            Self::PushToTalk(value) => s.push_to_talk = value,
            Self::AudioFeedback(value) => s.audio_feedback = value,
            Self::AudioFeedbackVolume(value) => s.audio_feedback_volume = value.clamp(0.0, 1.0),
            Self::SoundTheme(value) => s.sound_theme = value,
            Self::AppTheme(value) => {
                if !VALID_APP_THEMES.contains(&value.as_str()) {
                    return Err(format!("Unknown app theme '{value}'."));
                }
                s.app_theme = value;
            }
            Self::AppFontScale(value) => s.app_font_scale = value.clamp(0.9, 1.3),
            Self::StartHidden(value) => s.start_hidden = value,
            Self::AutostartEnabled(value) => {
                s.autostart_enabled = value && !cfg!(vox_jot_app_store)
            }
            Self::UpdateChecksEnabled(value) => {
                s.update_checks_enabled = value && !cfg!(vox_jot_app_store)
            }
            Self::EnableCrashReporting(value) => s.enable_crash_reporting = value,
            Self::EnableUsageAnalytics(value) => s.enable_usage_analytics = value,
            Self::AlwaysOnMicrophone(value) => s.always_on_microphone = value,
            Self::SelectedMicrophone(value) => {
                s.selected_microphone = normalize_optional_string(value)
            }
            Self::ClamshellMicrophone(value) => {
                s.clamshell_microphone = normalize_optional_string(value)
            }
            Self::SelectedOutputDevice(value) => {
                s.selected_output_device = normalize_optional_string(value)
            }
            Self::AcousticProfile(value) => s.acoustic_profile = value,
            Self::AudioEnhancementEnabled(value) => s.audio_enhancement_enabled = value,
            Self::AudioEnhancementModel(value) => s.audio_enhancement_model = value,
            Self::MuteWhileRecording(value) => s.mute_while_recording = value,
            Self::AudioDuckingEnabled(value) => s.audio_ducking_enabled = value,
            Self::TranslateToEnglish(enabled) => {
                s.translate_to_english = enabled;
                s.translation_target_language = "en".to_string();
                (s.translation_output_mode, s.translation_route_preference) = if enabled {
                    (
                        TranslationOutputMode::Translated,
                        TranslationRoutePreference::WhisperEnglish,
                    )
                } else {
                    (
                        TranslationOutputMode::Source,
                        TranslationRoutePreference::Auto,
                    )
                };
            }
            Self::SelectedLanguage(value) => s.selected_language = value,
            Self::TranslationOutputMode(value) => s.translation_output_mode = value,
            Self::TranslationTargetLanguage(value) => s.translation_target_language = value,
            Self::TranslationRoutePreference(value) => s.translation_route_preference = value,
            Self::TranslationProviderId(provider_id) => {
                require_permitted_provider(s, &provider_id, "translation")?;
                s.translation_provider_id = provider_id;
            }
            Self::TranslationBilingualLayout(value) => s.translation_bilingual_layout = value,
            Self::TranslationTranslateSnippets(value) => s.translation_translate_snippets = value,
            Self::TranslationDestinationMode(value) => s.translation_destination_mode = value,
            Self::SelectionTranslationDestinationMode(value) => {
                s.selection_translation_destination_mode = value
            }
            Self::TtsEnabled(value) => s.tts_enabled = value,
            Self::TtsEnginePreference(preference) => apply_tts_engine_preference(s, preference),
            Self::TtsAutoReadbackMode(value) => s.tts_auto_readback_mode = value,
            Self::TtsAutoReadbackScope(value) => s.tts_auto_readback_scope = value,
            Self::TtsReadbackTextMode(value) => s.tts_readback_text_mode = value,
            Self::TtsDefaultVoiceId(voice_id) => {
                s.tts_default_voice_id = normalize_optional_string(voice_id);
                s.selected_tts_voice_id = s.tts_default_voice_id.clone();
                if s.selected_tts_provider_id == TTS_PROVIDER_SHERPA_PACK_ID {
                    s.selected_tts_model_id = s.selected_tts_voice_id.clone();
                }
            }
            Self::TtsRate(value) => s.tts_rate = value.clamp(0.5, 2.0),
            Self::TtsVolume(value) => s.tts_volume = value.clamp(0.0, 1.0),
            Self::TtsStopOnRecord(value) => s.tts_stop_on_record = value,
            Self::SpeechRuntimePath(value) => {
                s.speech_runtime_path = normalize_optional_string(value)
            }
            Self::SpeechBackendOverride(value) => {
                s.speech_backend_override = normalize_optional_string(value)
            }
            Self::ContinuousImprovementHqCapture(value) => {
                s.continuous_improvement_hq_capture = value
            }
            Self::TtsModelStorePath(value) => {
                s.tts_model_store_path = normalize_optional_string(value)
            }
            Self::ExternalModelStorageEnabled(value) => s.external_model_storage_enabled = value,
            Self::ExternalModelStorageAutoDetect(value) => {
                s.external_model_storage_auto_detect = value
            }
            Self::ExternalModelStoragePath(value) => {
                s.external_model_storage_path = normalize_optional_string(value);
                if s.external_model_storage_path.is_some() {
                    s.external_model_storage_enabled = true;
                }
            }
            Self::OverlayPosition(value) => s.overlay_position = value,
            Self::RecordingOverlayStyle(value) => s.recording_overlay_style = value,
            Self::ShowLivePartials(value) => s.show_live_partials = value,
            Self::SuggestMeetingApps(value) => s.suggest_meeting_apps = value,
            Self::DebugMode(enabled) => {
                s.debug_mode = enabled;
                // Debug mode needs at least debug-level file logs; disabling it
                // keeps whatever level the user chose.
                if enabled
                    && matches!(
                        s.log_level,
                        LogLevel::Info | LogLevel::Warn | LogLevel::Error
                    )
                {
                    s.log_level = LogLevel::Debug;
                }
            }
            Self::ShowTechnicalFeatures(value) => s.show_technical_features = value,
            Self::LogLevel(value) => s.log_level = value,
            Self::CustomWords(value) => s.custom_words = value,
            Self::CustomFillerWords(value) => s.custom_filler_words = value,
            Self::WordCorrectionThreshold(value) => s.word_correction_threshold = value,
            Self::PasteMethod(value) => s.paste_method = value,
            Self::PasteDelayMs(value) => s.paste_delay_ms = value,
            Self::TypingTool(value) => s.typing_tool = value,
            Self::ExternalScriptPath(value) => {
                s.external_script_path = match normalize_optional_string(value) {
                    Some(path) => Some(
                        crate::clipboard::validate_external_script_path(&path)?
                            .to_string_lossy()
                            .into_owned(),
                    ),
                    None => None,
                }
            }
            Self::ClipboardHandling(value) => s.clipboard_handling = value,
            Self::AutoSubmit(value) => s.auto_submit = value,
            Self::AutoSubmitKey(value) => s.auto_submit_key = value,
            Self::AppendTrailingSpace(value) => s.append_trailing_space = value,
            Self::PinnedPasteEnabled(value) => {
                if value && !crate::pinned_target::AVAILABLE {
                    return Err(crate::pinned_target::PinFailure::Unsupported.to_string());
                }
                s.pinned_paste_enabled = value;
            }
            Self::HistoryLimit(value) => s.history_limit = value,
            Self::HistoryAutoAnalyzeSpeakersLongRecordingsEnabled(value) => {
                s.history_auto_analyze_speakers_long_recordings_enabled = value
            }
            Self::HistoryAutoAnalyzeSpeakersMinDurationMs(value) => {
                s.history_auto_analyze_speakers_min_duration_ms = value.clamp(30_000, 7_200_000)
            }
            Self::RecordingRetentionPeriod(value) => s.recording_retention_period = value,
            Self::PostProcessEnabled(value) => s.post_process_enabled = value,
            Self::PostProcessProviderId(provider_id) => {
                require_permitted_provider(s, &provider_id, "post-processing")?;
                s.selected_llm_model_id = s
                    .post_process_models
                    .get(&provider_id)
                    .cloned()
                    .unwrap_or_default();
                s.selected_llm_provider_id = provider_id.clone();
                s.post_process_provider_id = provider_id;
            }
            Self::PostProcessMode(value) => s.post_process_mode = value,
            Self::PostProcessCleanupLevel(level) => {
                s.post_process_cleanup_level = level;
                s.post_process_mode = level.mode();
                s.max_rewrite_strength = level.rewrite_strength();
            }
            Self::PostProcessSelectedPromptId(prompt_id) => {
                if prompt_id.as_ref().is_some_and(|prompt_id| {
                    !s.post_process_prompts
                        .iter()
                        .any(|prompt| &prompt.id == prompt_id)
                }) {
                    return Err(format!("Prompt with id '{prompt_id:?}' not found."));
                }
                s.post_process_selected_prompt_id = prompt_id;
            }
            Self::MaxRewriteStrength(value) => s.max_rewrite_strength = value.min(2),
            Self::ShowPreviewBeforePaste(value) => s.show_preview_before_paste = value,
            Self::FallbackToRawOnFailure(value) => s.fallback_to_raw_on_failure = value,
            Self::AdaptiveSelectionRewriteEnabled(enabled) => {
                if enabled && !cfg!(target_os = "macos") {
                    return Err(
                        "Automatic selection detection currently requires macOS Accessibility."
                            .to_string(),
                    );
                }
                s.adaptive_selection_rewrite_enabled = enabled;
            }
            Self::CloudSelectionRewriteAllowed(value) => s.cloud_selection_rewrite_allowed = value,
            Self::PersonalDictionary(value) => s.personal_dictionary = value,
            Self::AppAwareToneEnabled(value) => s.app_aware_tone_enabled = value,
            Self::ToneDefinitions(value) => s.tone_definitions = value,
            Self::WriteRulesEnabledOverride(value) => s.write_rules_enabled_override = value,
            Self::WriteRulesUrlCaptureEnabled(value) => s.write_rules_url_capture_enabled = value,
            Self::MarkdownExportEnabled(enabled) => {
                if enabled && s.markdown_export_dir.is_none() {
                    return Err(
                        "Choose an export folder before enabling Markdown export.".to_string()
                    );
                }
                s.markdown_export_enabled = enabled;
            }
            Self::MarkdownExportDir(dir) => {
                if dir.is_none() {
                    s.markdown_export_enabled = false;
                }
                s.markdown_export_dir = dir;
            }
            Self::MarkdownExportMinWords(value) => {
                s.markdown_export_min_words = value.clamp(1, 1_000)
            }
            Self::MarkdownExportContentSource(value) => s.markdown_export_content_source = value,
            Self::MarkdownExportFrontmatter(value) => s.markdown_export_frontmatter = value,
            Self::MarkdownExportIncludeRewriteSelection(value) => {
                s.markdown_export_include_rewrite_selection = value
            }
            Self::MarkdownExportIncludeFailedPaste(value) => {
                s.markdown_export_include_failed_paste = value
            }
            Self::LocalPrivacyMode(value) => s.local_privacy_mode = value,
            Self::ScreenContextEnabled(value) => s.screen_context_enabled = value,
            Self::ScreenContextExcludedBundleIds(bundle_ids) => {
                s.screen_context_excluded_bundle_ids = unique_bundle_ids(bundle_ids)
            }
            Self::ScreenContextPauseOnIdle(value) => s.screen_context_pause_on_idle = value,
            Self::ScreenContextIdleThresholdMs(value) => {
                s.screen_context_idle_threshold_ms = value.clamp(10_000, 600_000)
            }
            Self::ContextCaptureMode(value) => s.context_capture_mode = value,
            Self::ScreenContextOcrQuality(value) => s.screen_context_ocr_quality = value,
            Self::ScreenContextOcrEngine(value) => s.screen_context_ocr_engine = value,
            Self::ScreenContextOcrTimeoutMs(value) => {
                s.screen_context_ocr_timeout_ms =
                    super::normalize_screen_context_ocr_timeout_ms(value)
            }
            Self::ScreenContextTokenBudget(value) => {
                s.screen_context_token_budget = value.clamp(100, 2_000)
            }
            Self::ScreenContextStaleThresholdMs(value) => {
                s.screen_context_stale_threshold_ms = value.clamp(500, 10_000)
            }
            Self::AppLanguage(value) => s.app_language = value,
            Self::GlobalLanguageSyncEnabled(value) => s.global_language_sync_enabled = value,
            Self::ExperimentalEnabled(value) => s.experimental_enabled = value,
            Self::ShowTrayIcon(value) => s.show_tray_icon = value,
            Self::CorrectionTrackingEnabled(value) => s.correction_tracking_enabled = value,
            Self::FileTranscriptionApplyDictionary(value) => {
                s.file_transcription_apply_dictionary = value
            }
            Self::SnippetsEnabled(value) => s.snippets_enabled = value,
            Self::Snippets(snippets) => {
                crate::snippets::validate_snippets(&snippets)?;
                s.snippets = snippets;
            }
            Self::ModelUnloadTimeout(value) => s.model_unload_timeout = value,
            Self::OnboardingCompleted(value) => s.onboarding_completed = value,
            Self::TtsActivePresetId(value) => s.tts_active_preset_id = value,
            Self::TtsVoicePresets(value) => s.tts_voice_presets = value,
            Self::PostProcessPrompts(value) => s.post_process_prompts = value,
            Self::PostProcessPromptPolicyVersion(value) => {
                s.post_process_prompt_policy_version = value
            }
            Self::ScreenContextOcrTimeoutPolicyVersion(value) => {
                s.screen_context_ocr_timeout_policy_version = value
            }
            Self::FileTranscriptionAsrModelId(value) => s.file_transcription_asr_model_id = value,
            Self::FileTranscriptionDiarizationModelId(value) => {
                s.file_transcription_diarization_model_id = value
            }
            Self::FileTranscriptionEmotionModelId(value) => {
                s.file_transcription_emotion_model_id = value
            }
            Self::WatchFolders(value) => s.watch_folders = value,
        }
        Ok(())
    }
}

/// Applies every update in order, then restores the local-privacy invariant
/// once for the resulting settings. Stops at the first rejected update.
pub fn apply_updates(
    settings: &mut AppSettings,
    updates: impl IntoIterator<Item = SettingUpdate>,
) -> Result<(), String> {
    for update in updates {
        let key = update.key();
        update
            .apply(settings)
            .map_err(|error| format!("{key}: {error}"))?;
    }
    settings.enforce_local_privacy_mode();
    Ok(())
}

fn require_permitted_provider(
    settings: &AppSettings,
    provider_id: &str,
    purpose: &str,
) -> Result<(), String> {
    if settings.post_process_provider(provider_id).is_none() {
        return Err(format!("Provider '{provider_id}' not found."));
    }
    if settings.local_privacy_mode && !settings.is_post_process_provider_local(provider_id) {
        return Err(format!(
            "Local privacy mode is enabled. Select a local {purpose} provider."
        ));
    }
    Ok(())
}

fn apply_tts_engine_preference(settings: &mut AppSettings, preference: TtsEnginePreference) {
    settings.tts_engine_preference = preference;
    settings.selected_tts_provider_id = match preference {
        TtsEnginePreference::System => TTS_PROVIDER_SYSTEM_BUILTIN_ID,
        TtsEnginePreference::SherpaOnnx => TTS_PROVIDER_SHERPA_PACK_ID,
        TtsEnginePreference::Sidecar => TTS_PROVIDER_LOCAL_SIDECAR_API_ID,
        TtsEnginePreference::Auto if cfg!(any(target_os = "macos", target_os = "windows")) => {
            TTS_PROVIDER_SYSTEM_BUILTIN_ID
        }
        TtsEnginePreference::Auto if cfg!(target_os = "linux") => TTS_PROVIDER_SHERPA_PACK_ID,
        TtsEnginePreference::Auto => TTS_PROVIDER_LOCAL_SIDECAR_API_ID,
    }
    .to_string();
    if settings.selected_tts_model_id.is_none() {
        settings.selected_tts_model_id = match settings.selected_tts_provider_id.as_str() {
            TTS_PROVIDER_SYSTEM_BUILTIN_ID => Some(TTS_MODEL_SYSTEM_DEFAULT_ID.to_string()),
            TTS_PROVIDER_LOCAL_SIDECAR_API_ID => {
                Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID.to_string())
            }
            _ => settings.tts_default_voice_id.clone(),
        };
    }
}

fn unique_bundle_ids(bundle_ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    bundle_ids
        .into_iter()
        .map(|bundle_id| bundle_id.trim().to_string())
        .filter(|bundle_id| !bundle_id.is_empty() && seen.insert(bundle_id.to_ascii_lowercase()))
        .collect()
}

#[cfg(test)]
mod tests;
