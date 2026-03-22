use crate::post_processing::{AppToneMapping, DictionaryEntry, PostProcessMode, ToneDefinition};
use crate::snippets::Snippet;
use log::{debug, warn};
use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use specta::Type;
use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const APPLE_INTELLIGENCE_PROVIDER_ID: &str = "apple_intelligence";
pub const APPLE_INTELLIGENCE_DEFAULT_MODEL_ID: &str = "Apple Intelligence";
pub const OLLAMA_PROVIDER_ID: &str = "ollama";
const POST_PROCESS_PROMPT_POLICY_VERSION: u32 = 5;
const DEFAULT_POST_PROCESS_PROMPT_ID: &str = "default_improve_transcriptions_v2";
const DEFAULT_POST_PROCESS_PROMPT_NAME: &str = "Improve Transcriptions";

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

// Custom deserializer to handle both old numeric format (1-5) and new string format ("trace", "debug", etc.)
impl<'de> Deserialize<'de> for LogLevel {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct LogLevelVisitor;

        impl<'de> Visitor<'de> for LogLevelVisitor {
            type Value = LogLevel;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a string or integer representing log level")
            }

            fn visit_str<E: de::Error>(self, value: &str) -> Result<LogLevel, E> {
                match value.to_lowercase().as_str() {
                    "trace" => Ok(LogLevel::Trace),
                    "debug" => Ok(LogLevel::Debug),
                    "info" => Ok(LogLevel::Info),
                    "warn" => Ok(LogLevel::Warn),
                    "error" => Ok(LogLevel::Error),
                    _ => Err(E::unknown_variant(
                        value,
                        &["trace", "debug", "info", "warn", "error"],
                    )),
                }
            }

            fn visit_u64<E: de::Error>(self, value: u64) -> Result<LogLevel, E> {
                match value {
                    1 => Ok(LogLevel::Trace),
                    2 => Ok(LogLevel::Debug),
                    3 => Ok(LogLevel::Info),
                    4 => Ok(LogLevel::Warn),
                    5 => Ok(LogLevel::Error),
                    _ => Err(E::invalid_value(de::Unexpected::Unsigned(value), &"1-5")),
                }
            }
        }

        deserializer.deserialize_any(LogLevelVisitor)
    }
}

impl From<LogLevel> for tauri_plugin_log::LogLevel {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Trace => tauri_plugin_log::LogLevel::Trace,
            LogLevel::Debug => tauri_plugin_log::LogLevel::Debug,
            LogLevel::Info => tauri_plugin_log::LogLevel::Info,
            LogLevel::Warn => tauri_plugin_log::LogLevel::Warn,
            LogLevel::Error => tauri_plugin_log::LogLevel::Error,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct ShortcutBinding {
    pub id: String,
    pub name: String,
    pub description: String,
    pub default_binding: String,
    pub current_binding: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct LLMPrompt {
    pub id: String,
    pub name: String,
    pub prompt: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct PostProcessProvider {
    pub id: String,
    pub label: String,
    pub base_url: String,
    #[serde(default)]
    pub allow_base_url_edit: bool,
    #[serde(default)]
    pub models_endpoint: Option<String>,
    #[serde(default)]
    pub supports_structured_output: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "lowercase")]
pub enum OverlayPosition {
    None,
    Top,
    Bottom,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum ModelUnloadTimeout {
    Never,
    Immediately,
    Min2,
    Min5,
    Min10,
    Min15,
    Hour1,
    Sec5, // Debug mode only
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum PasteMethod {
    CtrlV,
    Direct,
    None,
    ShiftInsert,
    CtrlShiftV,
    ExternalScript,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardHandling {
    DontModify,
    CopyToClipboard,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum AutoSubmitKey {
    Enter,
    CtrlEnter,
    CmdEnter,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum RecordingRetentionPeriod {
    Never,
    PreserveLimit,
    Days3,
    Weeks2,
    Months3,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum KeyboardImplementation {
    Tauri,
    HandyKeys,
}

impl Default for KeyboardImplementation {
    fn default() -> Self {
        #[cfg(target_os = "linux")]
        return KeyboardImplementation::Tauri;
        #[cfg(not(target_os = "linux"))]
        return KeyboardImplementation::HandyKeys;
    }
}

impl Default for ModelUnloadTimeout {
    fn default() -> Self {
        ModelUnloadTimeout::Never
    }
}

impl Default for PasteMethod {
    fn default() -> Self {
        // Default to CtrlV for macOS and Windows, Direct for Linux
        #[cfg(target_os = "linux")]
        return PasteMethod::Direct;
        #[cfg(not(target_os = "linux"))]
        return PasteMethod::CtrlV;
    }
}

impl Default for ClipboardHandling {
    fn default() -> Self {
        ClipboardHandling::DontModify
    }
}

impl Default for AutoSubmitKey {
    fn default() -> Self {
        AutoSubmitKey::Enter
    }
}

impl ModelUnloadTimeout {
    pub fn to_minutes(self) -> Option<u64> {
        match self {
            ModelUnloadTimeout::Never => None,
            ModelUnloadTimeout::Immediately => Some(0), // Special case for immediate unloading
            ModelUnloadTimeout::Min2 => Some(2),
            ModelUnloadTimeout::Min5 => Some(5),
            ModelUnloadTimeout::Min10 => Some(10),
            ModelUnloadTimeout::Min15 => Some(15),
            ModelUnloadTimeout::Hour1 => Some(60),
            ModelUnloadTimeout::Sec5 => Some(0), // Special case for debug - handled separately
        }
    }

    pub fn to_seconds(self) -> Option<u64> {
        match self {
            ModelUnloadTimeout::Never => None,
            ModelUnloadTimeout::Immediately => Some(0), // Special case for immediate unloading
            ModelUnloadTimeout::Sec5 => Some(5),
            _ => self.to_minutes().map(|m| m * 60),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum SoundTheme {
    Marimba,
    Pop,
    Custom,
}

impl SoundTheme {
    fn as_str(&self) -> &'static str {
        match self {
            SoundTheme::Marimba => "marimba",
            SoundTheme::Pop => "pop",
            SoundTheme::Custom => "custom",
        }
    }

    pub fn to_start_path(&self) -> String {
        format!("resources/{}_start.wav", self.as_str())
    }

    pub fn to_stop_path(&self) -> String {
        format!("resources/{}_stop.wav", self.as_str())
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TypingTool {
    Auto,
    Wtype,
    Kwtype,
    Dotool,
    Ydotool,
    Xdotool,
}

impl Default for TypingTool {
    fn default() -> Self {
        TypingTool::Auto
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TranslationOutputMode {
    Source,
    Translated,
    Bilingual,
}

impl Default for TranslationOutputMode {
    fn default() -> Self {
        TranslationOutputMode::Source
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TranslationRoutePreference {
    Auto,
    WhisperEnglish,
    OfflinePack,
    LocalAi,
    RemoteAi,
}

impl Default for TranslationRoutePreference {
    fn default() -> Self {
        TranslationRoutePreference::Auto
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TranslationBilingualLayout {
    TranslationThenSource,
    SourceThenTranslation,
}

impl Default for TranslationBilingualLayout {
    fn default() -> Self {
        TranslationBilingualLayout::TranslationThenSource
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TranslationDestinationMode {
    PasteInPlace,
    PreviewThenPaste,
    OpenInJotPad,
}

impl Default for TranslationDestinationMode {
    fn default() -> Self {
        TranslationDestinationMode::PasteInPlace
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum SelectionTranslationDestinationMode {
    ReplaceSelection,
    PreviewThenReplace,
    OpenInJotPad,
}

impl Default for SelectionTranslationDestinationMode {
    fn default() -> Self {
        SelectionTranslationDestinationMode::ReplaceSelection
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsEnginePreference {
    Auto,
    System,
    SherpaOnnx,
    Sidecar,
}

impl Default for TtsEnginePreference {
    fn default() -> Self {
        TtsEnginePreference::Auto
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsAutoReadbackMode {
    Off,
    AfterOutput,
    AfterPreviewConfirm,
}

impl Default for TtsAutoReadbackMode {
    fn default() -> Self {
        TtsAutoReadbackMode::Off
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsAutoReadbackScope {
    DictationOnly,
    DictationAndSelection,
}

impl Default for TtsAutoReadbackScope {
    fn default() -> Self {
        TtsAutoReadbackScope::DictationOnly
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsReadbackTextMode {
    FinalOutput,
    TranslatedBlock,
}

impl Default for TtsReadbackTextMode {
    fn default() -> Self {
        TtsReadbackTextMode::FinalOutput
    }
}

/* still handy for composing the initial JSON in the store ------------- */
#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct AppSettings {
    pub bindings: HashMap<String, ShortcutBinding>,
    pub push_to_talk: bool,
    pub audio_feedback: bool,
    #[serde(default = "default_audio_feedback_volume")]
    pub audio_feedback_volume: f32,
    #[serde(default = "default_sound_theme")]
    pub sound_theme: SoundTheme,
    #[serde(default = "default_start_hidden")]
    pub start_hidden: bool,
    #[serde(default = "default_autostart_enabled")]
    pub autostart_enabled: bool,
    #[serde(default = "default_update_checks_enabled")]
    pub update_checks_enabled: bool,
    #[serde(default = "default_model")]
    pub selected_model: String,
    #[serde(default = "default_always_on_microphone")]
    pub always_on_microphone: bool,
    #[serde(default)]
    pub selected_microphone: Option<String>,
    #[serde(default)]
    pub clamshell_microphone: Option<String>,
    #[serde(default)]
    pub selected_output_device: Option<String>,
    #[serde(default = "default_translate_to_english")]
    pub translate_to_english: bool,
    #[serde(default = "default_selected_language")]
    pub selected_language: String,
    #[serde(default)]
    pub translation_output_mode: TranslationOutputMode,
    #[serde(default = "default_translation_target_language")]
    pub translation_target_language: String,
    #[serde(default)]
    pub translation_route_preference: TranslationRoutePreference,
    #[serde(default = "default_translation_provider_id")]
    pub translation_provider_id: String,
    #[serde(default = "default_translation_model_ids")]
    pub translation_model_ids: HashMap<String, String>,
    #[serde(default)]
    pub translation_bilingual_layout: TranslationBilingualLayout,
    #[serde(default)]
    pub translation_translate_snippets: bool,
    #[serde(default)]
    pub translation_destination_mode: TranslationDestinationMode,
    #[serde(default)]
    pub selection_translation_destination_mode: SelectionTranslationDestinationMode,
    #[serde(default)]
    pub tts_enabled: bool,
    #[serde(default)]
    pub tts_engine_preference: TtsEnginePreference,
    #[serde(default)]
    pub tts_auto_readback_mode: TtsAutoReadbackMode,
    #[serde(default)]
    pub tts_auto_readback_scope: TtsAutoReadbackScope,
    #[serde(default)]
    pub tts_readback_text_mode: TtsReadbackTextMode,
    #[serde(default)]
    pub tts_default_voice_id: Option<String>,
    #[serde(default = "default_tts_rate")]
    pub tts_rate: f32,
    #[serde(default = "default_tts_volume")]
    pub tts_volume: f32,
    #[serde(default = "default_tts_stop_on_record")]
    pub tts_stop_on_record: bool,
    #[serde(default = "default_overlay_position")]
    pub overlay_position: OverlayPosition,
    #[serde(default = "default_debug_mode")]
    pub debug_mode: bool,
    #[serde(default = "default_log_level")]
    pub log_level: LogLevel,
    #[serde(default)]
    pub custom_words: Vec<String>,
    #[serde(default)]
    pub model_unload_timeout: ModelUnloadTimeout,
    #[serde(default = "default_word_correction_threshold")]
    pub word_correction_threshold: f64,
    #[serde(default = "default_history_limit")]
    pub history_limit: usize,
    #[serde(default = "default_recording_retention_period")]
    pub recording_retention_period: RecordingRetentionPeriod,
    #[serde(default)]
    pub paste_method: PasteMethod,
    #[serde(default)]
    pub clipboard_handling: ClipboardHandling,
    #[serde(default = "default_auto_submit")]
    pub auto_submit: bool,
    #[serde(default)]
    pub auto_submit_key: AutoSubmitKey,
    #[serde(default = "default_post_process_enabled")]
    pub post_process_enabled: bool,
    #[serde(default = "default_local_privacy_mode")]
    pub local_privacy_mode: bool,
    #[serde(default = "default_post_process_mode")]
    pub post_process_mode: PostProcessMode,
    #[serde(default = "default_post_process_provider_id")]
    pub post_process_provider_id: String,
    #[serde(default = "default_post_process_providers")]
    pub post_process_providers: Vec<PostProcessProvider>,
    #[serde(default = "default_post_process_api_keys")]
    pub post_process_api_keys: HashMap<String, String>,
    #[serde(default = "default_post_process_models")]
    pub post_process_models: HashMap<String, String>,
    #[serde(default = "default_post_process_prompts")]
    pub post_process_prompts: Vec<LLMPrompt>,
    #[serde(default)]
    pub post_process_selected_prompt_id: Option<String>,
    #[serde(default = "default_post_process_prompt_policy_version")]
    pub post_process_prompt_policy_version: u32,
    #[serde(default)]
    pub mute_while_recording: bool,
    #[serde(default)]
    pub append_trailing_space: bool,
    #[serde(default = "default_app_language")]
    pub app_language: String,
    #[serde(default)]
    pub experimental_enabled: bool,
    #[serde(default)]
    pub keyboard_implementation: KeyboardImplementation,
    #[serde(default = "default_show_tray_icon")]
    pub show_tray_icon: bool,
    #[serde(default = "default_paste_delay_ms")]
    pub paste_delay_ms: u64,
    #[serde(default = "default_typing_tool")]
    pub typing_tool: TypingTool,
    pub external_script_path: Option<String>,
    #[serde(default)]
    pub custom_filler_words: Option<Vec<String>>,
    #[serde(default)]
    pub personal_dictionary: Vec<DictionaryEntry>,
    #[serde(default = "default_max_rewrite_strength")]
    pub max_rewrite_strength: u8,
    #[serde(default = "default_show_preview_before_paste")]
    pub show_preview_before_paste: bool,
    #[serde(default = "default_fallback_to_raw_on_failure")]
    pub fallback_to_raw_on_failure: bool,
    #[serde(default = "default_app_aware_tone_enabled")]
    pub app_aware_tone_enabled: bool,
    #[serde(default = "default_tone_definitions")]
    pub tone_definitions: Vec<ToneDefinition>,
    #[serde(default = "default_app_tone_mappings")]
    pub app_tone_mappings: Vec<AppToneMapping>,
    #[serde(default = "default_correction_tracking_enabled")]
    pub correction_tracking_enabled: bool,
    #[serde(default = "default_snippets_enabled")]
    pub snippets_enabled: bool,
    #[serde(default)]
    pub snippets: Vec<Snippet>,
    #[serde(default = "default_app_theme")]
    pub app_theme: String,
}

fn default_app_theme() -> String {
    "system".to_string()
}

fn default_model() -> String {
    "".to_string()
}

fn default_always_on_microphone() -> bool {
    false
}

fn default_translate_to_english() -> bool {
    false
}

fn default_start_hidden() -> bool {
    false
}

fn default_autostart_enabled() -> bool {
    false
}

fn default_update_checks_enabled() -> bool {
    true
}

fn default_selected_language() -> String {
    "auto".to_string()
}

fn default_translation_target_language() -> String {
    "en".to_string()
}

fn default_tts_rate() -> f32 {
    1.0
}

fn default_tts_volume() -> f32 {
    0.85
}

fn default_tts_stop_on_record() -> bool {
    true
}

fn default_overlay_position() -> OverlayPosition {
    #[cfg(target_os = "linux")]
    return OverlayPosition::None;
    #[cfg(not(target_os = "linux"))]
    return OverlayPosition::Bottom;
}

fn default_debug_mode() -> bool {
    false
}

fn default_log_level() -> LogLevel {
    LogLevel::Debug
}

fn default_word_correction_threshold() -> f64 {
    0.18
}

fn default_paste_delay_ms() -> u64 {
    60
}

fn default_auto_submit() -> bool {
    false
}

fn default_history_limit() -> usize {
    5
}

fn default_recording_retention_period() -> RecordingRetentionPeriod {
    RecordingRetentionPeriod::PreserveLimit
}

fn default_audio_feedback_volume() -> f32 {
    1.0
}

fn default_sound_theme() -> SoundTheme {
    SoundTheme::Marimba
}

fn default_post_process_enabled() -> bool {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return true;
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    return false;
}

fn default_local_privacy_mode() -> bool {
    false
}

fn default_post_process_mode() -> PostProcessMode {
    PostProcessMode::Literal
}

fn default_max_rewrite_strength() -> u8 {
    1
}

fn default_show_preview_before_paste() -> bool {
    false
}

fn default_fallback_to_raw_on_failure() -> bool {
    true
}

fn default_app_aware_tone_enabled() -> bool {
    false
}

fn default_tone_definitions() -> Vec<ToneDefinition> {
    vec![
        ToneDefinition {
            id: "neutral".to_string(),
            label: "Neutral".to_string(),
            instruction: "Keep the tone neutral and close to the speaker's original wording."
                .to_string(),
        },
        ToneDefinition {
            id: "casual".to_string(),
            label: "Casual".to_string(),
            instruction:
                "Use a casual, conversational tone suitable for quick chat messages while preserving meaning."
                    .to_string(),
        },
        ToneDefinition {
            id: "professional".to_string(),
            label: "Professional".to_string(),
            instruction:
                "Use a polished, professional tone suitable for email or documents while preserving meaning."
                    .to_string(),
        },
        ToneDefinition {
            id: "coding".to_string(),
            label: "Coding".to_string(),
            instruction:
                "Format the text as precise technical writing suited for code editors and terminals. \
                 Use exact technical terms, preserve variable and function names verbatim, \
                 format code snippets with proper syntax, and keep comments concise. \
                 Convert spoken code descriptions into valid code when the intent is clear \
                 (e.g., \"define a function called foo that takes a string\" → \"fn foo(s: &str)\"). \
                 Prefer lowercase and avoid unnecessary punctuation."
                    .to_string(),
        },
    ]
}

/// All candidate app-tone mappings. At first launch the app filters this list
/// down to only apps actually installed on the user's machine (macOS).  On
/// other platforms the full list is used as-is since there is no installed-app
/// detection yet.
fn default_app_tone_mappings_candidates() -> Vec<AppToneMapping> {
    vec![
        // ── Chat / Casual ───────────────────────────────────────
        AppToneMapping {
            bundle_id: "com.tinyspeck.slackmacgap".to_string(),
            app_name: "Slack".to_string(),
            tone_id: "casual".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.hnc.Discord".to_string(),
            app_name: "Discord".to_string(),
            tone_id: "casual".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.apple.MobileSMS".to_string(),
            app_name: "Messages".to_string(),
            tone_id: "casual".to_string(),
        },
        AppToneMapping {
            bundle_id: "us.zoom.xos".to_string(),
            app_name: "Zoom".to_string(),
            tone_id: "casual".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.facebook.archon.developerID".to_string(),
            app_name: "Messenger".to_string(),
            tone_id: "casual".to_string(),
        },
        AppToneMapping {
            bundle_id: "ru.keepcoder.Telegram".to_string(),
            app_name: "Telegram".to_string(),
            tone_id: "casual".to_string(),
        },
        AppToneMapping {
            bundle_id: "net.whatsapp.WhatsApp".to_string(),
            app_name: "WhatsApp".to_string(),
            tone_id: "casual".to_string(),
        },
        // ── Professional ────────────────────────────────────────
        AppToneMapping {
            bundle_id: "com.apple.mail".to_string(),
            app_name: "Mail".to_string(),
            tone_id: "professional".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.microsoft.Word".to_string(),
            app_name: "Microsoft Word".to_string(),
            tone_id: "professional".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.microsoft.Outlook".to_string(),
            app_name: "Microsoft Outlook".to_string(),
            tone_id: "professional".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.google.Chrome".to_string(),
            app_name: "Google Chrome".to_string(),
            tone_id: "neutral".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.apple.Safari".to_string(),
            app_name: "Safari".to_string(),
            tone_id: "neutral".to_string(),
        },
        // ── Neutral ─────────────────────────────────────────────
        AppToneMapping {
            bundle_id: "com.apple.Notes".to_string(),
            app_name: "Notes".to_string(),
            tone_id: "neutral".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.apple.Pages".to_string(),
            app_name: "Pages".to_string(),
            tone_id: "neutral".to_string(),
        },
        AppToneMapping {
            bundle_id: "md.obsidian".to_string(),
            app_name: "Obsidian".to_string(),
            tone_id: "neutral".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.notion.id".to_string(),
            app_name: "Notion".to_string(),
            tone_id: "neutral".to_string(),
        },
        // ── Coding ──────────────────────────────────────────────
        AppToneMapping {
            bundle_id: "com.microsoft.VSCode".to_string(),
            app_name: "VS Code".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.vscodium".to_string(),
            app_name: "VSCodium".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "dev.zed.Zed".to_string(),
            app_name: "Zed".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.sublimetext.4".to_string(),
            app_name: "Sublime Text".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.jetbrains.intellij".to_string(),
            app_name: "IntelliJ IDEA".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.jetbrains.WebStorm".to_string(),
            app_name: "WebStorm".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.jetbrains.pycharm".to_string(),
            app_name: "PyCharm".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.jetbrains.CLion".to_string(),
            app_name: "CLion".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.jetbrains.rider".to_string(),
            app_name: "Rider".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.jetbrains.goland".to_string(),
            app_name: "GoLand".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.jetbrains.rustrover".to_string(),
            app_name: "RustRover".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.apple.dt.Xcode".to_string(),
            app_name: "Xcode".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.googlecode.iterm2".to_string(),
            app_name: "iTerm2".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.apple.Terminal".to_string(),
            app_name: "Terminal".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "net.kovidgoyal.kitty".to_string(),
            app_name: "Kitty".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.github.wez.wezterm".to_string(),
            app_name: "WezTerm".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "co.zeit.hyper".to_string(),
            app_name: "Hyper".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.mitchellh.ghostty".to_string(),
            app_name: "Ghostty".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "dev.warp.Warp-Stable".to_string(),
            app_name: "Warp".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.todesktop.230313mzl4w4u92".to_string(),
            app_name: "Cursor".to_string(),
            tone_id: "coding".to_string(),
        },
        AppToneMapping {
            bundle_id: "com.windsurf.windsurf".to_string(),
            app_name: "Windsurf".to_string(),
            tone_id: "coding".to_string(),
        },
    ]
}

/// Filters `default_app_tone_mappings_candidates()` down to apps actually
/// installed on the current machine.  Falls back to the full candidate list
/// when installed-app detection is unavailable (non-macOS).
pub fn default_app_tone_mappings() -> Vec<AppToneMapping> {
    let candidates = default_app_tone_mappings_candidates();

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Collect the set of bundle IDs present on this machine via Spotlight.
        let installed: std::collections::HashSet<String> = Command::new("mdfind")
            .arg("kMDItemContentType == 'com.apple.application-bundle'")
            .output()
            .ok()
            .map(|output| {
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout
                    .lines()
                    .filter_map(|line| {
                        let plist = format!("{}/Contents/Info.plist", line.trim());
                        Command::new("defaults")
                            .args(["read", &plist, "CFBundleIdentifier"])
                            .output()
                            .ok()
                            .and_then(|o| {
                                if o.status.success() {
                                    let id = String::from_utf8_lossy(&o.stdout).trim().to_string();
                                    if id.is_empty() { None } else { Some(id) }
                                } else {
                                    None
                                }
                            })
                    })
                    .collect()
            })
            .unwrap_or_default();

        if installed.is_empty() {
            // Spotlight unavailable — keep all candidates
            return candidates;
        }

        let filtered: Vec<AppToneMapping> = candidates
            .into_iter()
            .filter(|m| installed.contains(&m.bundle_id))
            .collect();

        // If nothing matched at all (unlikely), keep the Apple basics
        if filtered.is_empty() {
            return default_app_tone_mappings_candidates()
                .into_iter()
                .filter(|m| m.bundle_id.starts_with("com.apple."))
                .collect();
        }

        filtered
    }

    #[cfg(not(target_os = "macos"))]
    {
        candidates
    }
}

fn default_app_language() -> String {
    tauri_plugin_os::locale()
        .map(|l| l.replace('_', "-"))
        .unwrap_or_else(|| "en".to_string())
}

fn default_show_tray_icon() -> bool {
    true
}

fn default_post_process_provider_id() -> String {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return APPLE_INTELLIGENCE_PROVIDER_ID.to_string();
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    return "openai".to_string();
}

fn default_translation_provider_id() -> String {
    default_post_process_provider_id()
}

fn default_post_process_providers() -> Vec<PostProcessProvider> {
    let mut providers = vec![
        PostProcessProvider {
            id: "openai".to_string(),
            label: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
        PostProcessProvider {
            id: "zai".to_string(),
            label: "Z.AI".to_string(),
            base_url: "https://api.z.ai/api/paas/v4".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
        PostProcessProvider {
            id: "openrouter".to_string(),
            label: "OpenRouter".to_string(),
            base_url: "https://openrouter.ai/api/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
        PostProcessProvider {
            id: "anthropic".to_string(),
            label: "Anthropic".to_string(),
            base_url: "https://api.anthropic.com/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        },
        PostProcessProvider {
            id: "groq".to_string(),
            label: "Groq".to_string(),
            base_url: "https://api.groq.com/openai/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        },
        PostProcessProvider {
            id: "cerebras".to_string(),
            label: "Cerebras".to_string(),
            base_url: "https://api.cerebras.ai/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: true,
        },
        PostProcessProvider {
            id: "lmstudio".to_string(),
            label: "LM Studio".to_string(),
            base_url: "http://localhost:1234/v1".to_string(),
            allow_base_url_edit: false,
            models_endpoint: Some("/models".to_string()),
            supports_structured_output: false,
        },
    ];

    // Note: We always include Apple Intelligence on macOS ARM64 without checking availability
    // at startup. The availability check is deferred to when the user actually tries to use it
    // (in actions.rs). This prevents crashes on macOS 26.x beta where accessing
    // SystemLanguageModel.default during early app initialization causes SIGABRT.
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        providers.push(PostProcessProvider {
            id: APPLE_INTELLIGENCE_PROVIDER_ID.to_string(),
            label: "Apple Intelligence".to_string(),
            base_url: "apple-intelligence://local".to_string(),
            allow_base_url_edit: false,
            models_endpoint: None,
            supports_structured_output: true,
        });
    }

    // Ollama - local LLM inference (always present, no API key needed)
    providers.push(PostProcessProvider {
        id: OLLAMA_PROVIDER_ID.to_string(),
        label: "Ollama Internal".to_string(),
        base_url: "http://127.0.0.1:11434/v1".to_string(),
        allow_base_url_edit: false,
        models_endpoint: Some("/models".to_string()),
        supports_structured_output: false,
    });
    // Custom provider always comes last
    providers.push(PostProcessProvider {
        id: "custom".to_string(),
        label: "Custom".to_string(),
        base_url: "http://localhost:11434/v1".to_string(),
        allow_base_url_edit: true,
        models_endpoint: Some("/models".to_string()),
        supports_structured_output: false,
    });

    providers
}

fn default_post_process_api_keys() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for provider in default_post_process_providers() {
        map.insert(provider.id, String::new());
    }
    map
}

fn default_model_for_provider(provider_id: &str) -> String {
    if provider_id == APPLE_INTELLIGENCE_PROVIDER_ID {
        return APPLE_INTELLIGENCE_DEFAULT_MODEL_ID.to_string();
    }

    String::new()
}

fn default_post_process_models() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for provider in default_post_process_providers() {
        map.insert(
            provider.id.clone(),
            default_model_for_provider(&provider.id),
        );
    }
    map
}

fn default_translation_model_ids() -> HashMap<String, String> {
    default_post_process_models()
}

fn default_post_process_prompt_template() -> &'static str {
    r#"You are a local dictation post-processor.

Task:
Clean speech-to-text output while preserving the speaker's meaning exactly.

Active mode: intent
Rewrite strength: 1 (0=conservative, 2=aggressive)

Return only the final text.

Rules:
- Preserve meaning and the speaker's intended correction.
- Never invent facts, headings, commentary, explanations, or extra detail.
- Apply personal dictionary spellings exactly when they appear in the transcript.
- Preserve names, acronyms, URLs, emails, filenames, code terms, variable names, product names, unusual proper nouns, and technical jargon unless the speaker clearly corrected them.
- Preserve technical punctuation and symbols when they are likely intentional, including slashes, backslashes, underscores, hyphens, periods, colons, parentheses, brackets, quotes, @ symbols, plus signs, minus signs, and file extensions.
- Fix capitalization, punctuation, spacing, paragraph breaks, and formatting only when the intended structure is reasonably clear.
- Interpret spoken correction cues such as "scratch that", "actually", "I mean", "correction", "wait no", "rather", and natural restarts, and keep only the corrected intent.
- Remove filler words, false starts, and repeated fragments only when doing so does not change meaning.
- If the transcript is already clear, make the smallest possible changes.
- Use stronger rewrites only when clear structure, correction, or formatting cues are present.
- If multiple interpretations are possible, choose the most conservative one.
- If the utterance seems incomplete, ambiguous, cut off, or mid-thought, avoid heavy rewriting and stay close to the transcript.

Structure rules:
- Do not force bullets, numbering, or heavy formatting unless structure is clearly implied.
- If the transcript contains an introductory sentence that implies a list, followed by two or more short parallel items, format the items as a bullet list and end the intro sentence with a colon.
- Treat groceries, packing items, tasks, ingredients, feature lists, names, and short noun phrases as strong list candidates when grouped together.
- You may infer list item boundaries from repeated short noun phrases even when the transcript has little or no punctuation.
- Treat joiners such as "and", "also", and "plus" as list separators when the content is clearly list-like.
- When you turn an intro sentence plus short items into an unordered list, keep the intro sentence and use `* ` bullets for each item.
- Example: "I want to pick up a few things from the store. Bread, potato chips, ice cream." -> "I want to pick up a few things from the store:\n* Bread\n* Potato chips\n* Ice cream"
- Example: "Required verifications Request Government Issue ID conduct in person meeting employment verification income documentation personal reference previous reference I meant previous landlord reference and credit check also social security verification" -> "Required Verification Request:\n* Government-issued ID\n* Conduct in-person meeting\n* Employment verification\n* Income documentation\n* Personal references\n* Previous landlord reference\n* Credit check\n* Social security verification"
- If sequence words or ordered cues appear, such as "one", "two", "three", "first", "second", "next", or "finally", prefer a numbered list when the content is clearly step-like or ordered.
- If the user clearly dictated separate thoughts, insert paragraph breaks.
- If the user says "new line", "new paragraph", "skip a line", or equivalent phrasing, reflect that structure in the final text when it fits naturally.
- If punctuation words are spoken explicitly, such as "period", "comma", "question mark", "exclamation point", or "colon", respect them when they appear intentional.
- If the content is ordinary prose, keep it as ordinary prose rather than converting it into a list.

Mode behavior:
- In literal mode, preserve wording as much as possible and avoid stylistic rewriting.
- In intent mode, lightly clean for readability while preserving tone, specificity, and meaning.
- In intent mode, convert obvious rambling speech into clean written text only when the meaning is unmistakable.
- Do not summarize, shorten, or formalize unless the transcript itself clearly signals that intent.

Correction behavior:
- When the speaker revises a phrase mid-sentence, keep the final intended wording and remove the abandoned wording.
- When the speaker restates something more clearly, prefer the later phrasing if it is obviously a replacement rather than an addition.
- Treat a later contradiction or restart as a replacement when the intent is clear, including patterns like "...? No, ..." and "..., no, ...".
- Example: "Hi Greg, let's connect soon. Are you available Friday at three o'clock? No, I'm at four o'clock." -> "Hi Greg, let's connect soon. Are you available Friday at four o'clock?"
- When a correction cue appears inside a list or sequence of short items, replace only the item being corrected and keep the surrounding items.
- Example: "Personnel Reference Previous Reference I meant previous landlord reference credit check social security verification" -> "Personnel Reference Previous Landlord Reference Credit Check Social Security Verification"
- Example: "Required verifications Request Government Issue ID conduct in person meeting employment verification income documentation personal reference previous reference I meant previous landlord reference and credit check also social security verification" -> "Required Verification Request:\n* Government-issued ID\n* Conduct in-person meeting\n* Employment verification\n* Income documentation\n* Personal references\n* Previous landlord reference\n* Credit check\n* Social security verification"
- If a correction is unclear, preserve the original wording instead of guessing.

Safety behavior:
- Do not guess unknown jargon.
- Do not replace uncommon words with more common words unless the speaker clearly intended that.
- Do not convert uncertain technical text into plain English.
- Do not add markdown headings, explanations, labels, or surrounding quotation marks.

Active app guidance:
- Notes (tone: neutral): Keep the tone neutral and close to the speaker's original wording.
- Prefer readable notes over polished prose, but do not over-format short fragments.

Output:
- Return only the final processed text.
- Do not explain changes.
- Do not mention rules.

Transcript:
${output}"#
}

fn default_post_process_prompts() -> Vec<LLMPrompt> {
    vec![LLMPrompt {
        id: DEFAULT_POST_PROCESS_PROMPT_ID.to_string(),
        name: DEFAULT_POST_PROCESS_PROMPT_NAME.to_string(),
        prompt: default_post_process_prompt_template().to_string(),
    }]
}

fn default_post_process_prompt_policy_version() -> u32 {
    POST_PROCESS_PROMPT_POLICY_VERSION
}

fn default_typing_tool() -> TypingTool {
    TypingTool::Auto
}

fn default_correction_tracking_enabled() -> bool {
    true
}

fn default_snippets_enabled() -> bool {
    true
}

fn ensure_translation_defaults(settings: &mut AppSettings) -> bool {
    let mut changed = false;

    if settings.translate_to_english
        && settings.translation_output_mode == TranslationOutputMode::Source
    {
        settings.translation_output_mode = TranslationOutputMode::Translated;
        settings.translation_target_language = "en".to_string();
        settings.translation_route_preference = TranslationRoutePreference::WhisperEnglish;
        changed = true;
    }

    if settings.translation_target_language.trim().is_empty() {
        settings.translation_target_language = default_translation_target_language();
        changed = true;
    }

    if settings.translation_provider_id.trim().is_empty() {
        settings.translation_provider_id = default_translation_provider_id();
        changed = true;
    }

    for (provider_id, default_model) in default_translation_model_ids() {
        match settings.translation_model_ids.get_mut(&provider_id) {
            Some(existing) => {
                if existing.is_empty() && !default_model.is_empty() {
                    *existing = default_model.clone();
                    changed = true;
                }
            }
            None => {
                settings
                    .translation_model_ids
                    .insert(provider_id, default_model);
                changed = true;
            }
        }
    }

    changed
}

fn ensure_tts_defaults(settings: &mut AppSettings) -> bool {
    let mut changed = false;

    if !(0.5..=2.0).contains(&settings.tts_rate) {
        settings.tts_rate = default_tts_rate();
        changed = true;
    }

    if !(0.0..=1.0).contains(&settings.tts_volume) {
        settings.tts_volume = default_tts_volume();
        changed = true;
    }

    if matches!(
        settings.translation_output_mode,
        TranslationOutputMode::Bilingual
    ) && settings.tts_readback_text_mode == TtsReadbackTextMode::FinalOutput
    {
        settings.tts_readback_text_mode = TtsReadbackTextMode::TranslatedBlock;
        changed = true;
    }

    changed
}

/// Internal constants for correction behavior — no longer user-configurable.
/// These are optimized defaults that "just work."
pub mod correction_defaults {
    /// Minimum times a correction must be seen before auto-applying.
    pub const MIN_FREQUENCY: u32 = 1;
    /// Minimum confidence score (0.0–1.0) for auto-applying a correction.
    pub const MIN_CONFIDENCE: f64 = 0.5;
}

fn ensure_post_process_defaults(settings: &mut AppSettings) -> bool {
    let mut changed = false;

    if settings.post_process_prompt_policy_version < POST_PROCESS_PROMPT_POLICY_VERSION {
        let default_prompts = default_post_process_prompts();
        let default_prompt_id = default_prompts.first().map(|prompt| prompt.id.clone());

        settings.post_process_prompts = default_prompts;
        settings.post_process_selected_prompt_id = default_prompt_id;
        settings.post_process_prompt_policy_version = POST_PROCESS_PROMPT_POLICY_VERSION;
        changed = true;

        debug!(
            "Migrated post-process prompts to policy version {}",
            POST_PROCESS_PROMPT_POLICY_VERSION
        );
    }

    if settings.post_process_prompts.is_empty() {
        settings.post_process_prompts = default_post_process_prompts();
        changed = true;
    }

    let selected_prompt_valid = settings
        .post_process_selected_prompt_id
        .as_ref()
        .map(|selected_id| {
            settings
                .post_process_prompts
                .iter()
                .any(|prompt| &prompt.id == selected_id)
        })
        .unwrap_or(false);

    if !selected_prompt_valid {
        settings.post_process_selected_prompt_id = settings
            .post_process_prompts
            .first()
            .map(|prompt| prompt.id.clone());
        changed = true;
    }

    for provider in default_post_process_providers() {
        // Use match to do a single lookup - either sync existing or add new
        match settings
            .post_process_providers
            .iter_mut()
            .find(|p| p.id == provider.id)
        {
            Some(existing) => {
                // Sync supports_structured_output field for existing providers (migration)
                if existing.supports_structured_output != provider.supports_structured_output {
                    debug!(
                        "Updating supports_structured_output for provider '{}' from {} to {}",
                        provider.id,
                        existing.supports_structured_output,
                        provider.supports_structured_output
                    );
                    existing.supports_structured_output = provider.supports_structured_output;
                    changed = true;
                }
            }
            None => {
                // Provider doesn't exist, add it
                settings.post_process_providers.push(provider.clone());
                changed = true;
            }
        }

        if !settings.post_process_api_keys.contains_key(&provider.id) {
            settings
                .post_process_api_keys
                .insert(provider.id.clone(), String::new());
            changed = true;
        }

        let default_model = default_model_for_provider(&provider.id);
        match settings.post_process_models.get_mut(&provider.id) {
            Some(existing) => {
                if existing.is_empty() && !default_model.is_empty() {
                    *existing = default_model.clone();
                    changed = true;
                }
            }
            None => {
                settings
                    .post_process_models
                    .insert(provider.id.clone(), default_model);
                changed = true;
            }
        }
    }

    if settings.tone_definitions.is_empty() {
        settings.tone_definitions = default_tone_definitions();
        changed = true;
    }

    // Migration: ensure every starter tone exists (e.g. "coding" added later).
    for starter in default_tone_definitions() {
        if !settings.tone_definitions.iter().any(|t| t.id == starter.id) {
            debug!("Adding missing starter tone definition: {}", starter.id);
            settings.tone_definitions.push(starter);
            changed = true;
        }
    }

    if settings.app_tone_mappings.is_empty() {
        settings.app_tone_mappings = default_app_tone_mappings();
        changed = true;
    }

    // Migration: replace the old hardcoded 6-app defaults with the new
    // installed-app-aware defaults when the user hasn't customised mappings.
    {
        let old_defaults: std::collections::HashSet<&str> = [
            "com.tinyspeck.slackmacgap",
            "com.hnc.Discord",
            "com.apple.MobileSMS",
            "com.apple.mail",
            "com.microsoft.Word",
            "com.apple.Notes",
        ]
        .into_iter()
        .collect();

        let current_ids: std::collections::HashSet<&str> = settings
            .app_tone_mappings
            .iter()
            .map(|m| m.bundle_id.as_str())
            .collect();

        if current_ids == old_defaults {
            debug!("Migrating app-tone mappings from legacy 6-app defaults to installed-app-aware defaults");
            settings.app_tone_mappings = default_app_tone_mappings();
            changed = true;
        }
    }

    // Migration: on Apple Silicon, switch users who still have the old "openai"
    // default (with no API key configured) over to Apple Intelligence and enable
    // post-processing so it works out of the box.
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        if settings.post_process_provider_id == "openai" {
            let openai_key = settings
                .post_process_api_keys
                .get("openai")
                .cloned()
                .unwrap_or_default();
            if openai_key.trim().is_empty() {
                debug!("Migrating unconfigured OpenAI provider to Apple Intelligence");
                settings.post_process_provider_id = APPLE_INTELLIGENCE_PROVIDER_ID.to_string();
                settings.post_process_enabled = true;
                changed = true;
            }
        }
    }

    if settings.enforce_local_privacy_mode() {
        changed = true;
    }

    changed
}

pub const SETTINGS_STORE_PATH: &str = "settings_store.json";

pub fn get_default_settings() -> AppSettings {
    #[cfg(target_os = "windows")]
    let default_shortcut = "ctrl+space";
    #[cfg(target_os = "macos")]
    let default_shortcut = "option+space";
    #[cfg(target_os = "linux")]
    let default_shortcut = "ctrl+space";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_shortcut = "alt+space";

    let mut bindings = HashMap::new();
    bindings.insert(
        "transcribe".to_string(),
        ShortcutBinding {
            id: "transcribe".to_string(),
            name: "Transcribe".to_string(),
            description: "Converts your speech into text.".to_string(),
            default_binding: default_shortcut.to_string(),
            current_binding: default_shortcut.to_string(),
        },
    );
    #[cfg(target_os = "windows")]
    let default_post_process_shortcut = "ctrl+shift+space";
    #[cfg(target_os = "macos")]
    let default_post_process_shortcut = "option+shift+space";
    #[cfg(target_os = "linux")]
    let default_post_process_shortcut = "ctrl+shift+space";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_post_process_shortcut = "alt+shift+space";

    bindings.insert(
        "transcribe_with_post_process".to_string(),
        ShortcutBinding {
            id: "transcribe_with_post_process".to_string(),
            name: "Transcribe with Post-Processing".to_string(),
            description: "Converts your speech into text and applies AI post-processing."
                .to_string(),
            default_binding: default_post_process_shortcut.to_string(),
            current_binding: default_post_process_shortcut.to_string(),
        },
    );
    #[cfg(target_os = "windows")]
    let default_rewrite_shortcut = "ctrl+alt+r";
    #[cfg(target_os = "macos")]
    let default_rewrite_shortcut = "option+command+r";
    #[cfg(target_os = "linux")]
    let default_rewrite_shortcut = "ctrl+alt+r";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_rewrite_shortcut = "alt+shift+r";

    bindings.insert(
        "rewrite_selection".to_string(),
        ShortcutBinding {
            id: "rewrite_selection".to_string(),
            name: "Rewrite Selection".to_string(),
            description: "Rewrites currently selected text based on your spoken instructions."
                .to_string(),
            default_binding: default_rewrite_shortcut.to_string(),
            current_binding: default_rewrite_shortcut.to_string(),
        },
    );
    #[cfg(target_os = "windows")]
    let default_translate_selection_shortcut = "ctrl+alt+t";
    #[cfg(target_os = "macos")]
    let default_translate_selection_shortcut = "option+command+t";
    #[cfg(target_os = "linux")]
    let default_translate_selection_shortcut = "ctrl+alt+t";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_translate_selection_shortcut = "alt+shift+t";

    bindings.insert(
        "translate_selection".to_string(),
        ShortcutBinding {
            id: "translate_selection".to_string(),
            name: "Translate Selection".to_string(),
            description: "Translates the currently selected text.".to_string(),
            default_binding: default_translate_selection_shortcut.to_string(),
            current_binding: default_translate_selection_shortcut.to_string(),
        },
    );
    #[cfg(target_os = "windows")]
    let default_speak_selection_shortcut = "ctrl+alt+s";
    #[cfg(target_os = "macos")]
    let default_speak_selection_shortcut = "option+command+s";
    #[cfg(target_os = "linux")]
    let default_speak_selection_shortcut = "ctrl+alt+s";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_speak_selection_shortcut = "alt+shift+s";

    bindings.insert(
        "speak_selection".to_string(),
        ShortcutBinding {
            id: "speak_selection".to_string(),
            name: "Speak Selection".to_string(),
            description: "Reads the currently selected text aloud.".to_string(),
            default_binding: default_speak_selection_shortcut.to_string(),
            current_binding: default_speak_selection_shortcut.to_string(),
        },
    );
    #[cfg(target_os = "windows")]
    let default_speak_last_output_shortcut = "ctrl+alt+l";
    #[cfg(target_os = "macos")]
    let default_speak_last_output_shortcut = "option+command+l";
    #[cfg(target_os = "linux")]
    let default_speak_last_output_shortcut = "ctrl+alt+l";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_speak_last_output_shortcut = "alt+shift+l";

    bindings.insert(
        "speak_last_output".to_string(),
        ShortcutBinding {
            id: "speak_last_output".to_string(),
            name: "Speak Last Output".to_string(),
            description: "Reads the last text Vox Jot produced aloud.".to_string(),
            default_binding: default_speak_last_output_shortcut.to_string(),
            current_binding: default_speak_last_output_shortcut.to_string(),
        },
    );
    #[cfg(target_os = "windows")]
    let default_stop_speaking_shortcut = "ctrl+alt+x";
    #[cfg(target_os = "macos")]
    let default_stop_speaking_shortcut = "option+command+x";
    #[cfg(target_os = "linux")]
    let default_stop_speaking_shortcut = "ctrl+alt+x";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_stop_speaking_shortcut = "alt+shift+x";

    bindings.insert(
        "stop_speaking".to_string(),
        ShortcutBinding {
            id: "stop_speaking".to_string(),
            name: "Stop Speaking".to_string(),
            description: "Stops current speech playback.".to_string(),
            default_binding: default_stop_speaking_shortcut.to_string(),
            current_binding: default_stop_speaking_shortcut.to_string(),
        },
    );
    bindings.insert(
        "cancel".to_string(),
        ShortcutBinding {
            id: "cancel".to_string(),
            name: "Cancel".to_string(),
            description: "Cancels the current recording.".to_string(),
            default_binding: "escape".to_string(),
            current_binding: "escape".to_string(),
        },
    );

    AppSettings {
        bindings,
        push_to_talk: true,
        audio_feedback: false,
        audio_feedback_volume: default_audio_feedback_volume(),
        sound_theme: default_sound_theme(),
        start_hidden: default_start_hidden(),
        autostart_enabled: default_autostart_enabled(),
        update_checks_enabled: default_update_checks_enabled(),
        selected_model: "".to_string(),
        always_on_microphone: false,
        selected_microphone: None,
        clamshell_microphone: None,
        selected_output_device: None,
        translate_to_english: false,
        selected_language: "auto".to_string(),
        translation_output_mode: TranslationOutputMode::default(),
        translation_target_language: default_translation_target_language(),
        translation_route_preference: TranslationRoutePreference::default(),
        translation_provider_id: default_translation_provider_id(),
        translation_model_ids: default_translation_model_ids(),
        translation_bilingual_layout: TranslationBilingualLayout::default(),
        translation_translate_snippets: false,
        translation_destination_mode: TranslationDestinationMode::default(),
        selection_translation_destination_mode: SelectionTranslationDestinationMode::default(),
        tts_enabled: false,
        tts_engine_preference: TtsEnginePreference::default(),
        tts_auto_readback_mode: TtsAutoReadbackMode::default(),
        tts_auto_readback_scope: TtsAutoReadbackScope::default(),
        tts_readback_text_mode: TtsReadbackTextMode::default(),
        tts_default_voice_id: None,
        tts_rate: default_tts_rate(),
        tts_volume: default_tts_volume(),
        tts_stop_on_record: default_tts_stop_on_record(),
        overlay_position: default_overlay_position(),
        debug_mode: false,
        log_level: default_log_level(),
        custom_words: Vec::new(),
        model_unload_timeout: ModelUnloadTimeout::Never,
        word_correction_threshold: default_word_correction_threshold(),
        history_limit: default_history_limit(),
        recording_retention_period: default_recording_retention_period(),
        paste_method: PasteMethod::default(),
        clipboard_handling: ClipboardHandling::default(),
        auto_submit: default_auto_submit(),
        auto_submit_key: AutoSubmitKey::default(),
        post_process_enabled: default_post_process_enabled(),
        local_privacy_mode: default_local_privacy_mode(),
        post_process_mode: default_post_process_mode(),
        post_process_provider_id: default_post_process_provider_id(),
        post_process_providers: default_post_process_providers(),
        post_process_api_keys: default_post_process_api_keys(),
        post_process_models: default_post_process_models(),
        post_process_prompts: default_post_process_prompts(),
        post_process_selected_prompt_id: default_post_process_prompts()
            .first()
            .map(|prompt| prompt.id.clone()),
        post_process_prompt_policy_version: default_post_process_prompt_policy_version(),
        mute_while_recording: false,
        append_trailing_space: false,
        app_language: default_app_language(),
        experimental_enabled: false,
        keyboard_implementation: KeyboardImplementation::default(),
        show_tray_icon: default_show_tray_icon(),
        paste_delay_ms: default_paste_delay_ms(),
        typing_tool: default_typing_tool(),
        external_script_path: None,
        custom_filler_words: None,
        personal_dictionary: Vec::new(),
        max_rewrite_strength: default_max_rewrite_strength(),
        show_preview_before_paste: default_show_preview_before_paste(),
        fallback_to_raw_on_failure: default_fallback_to_raw_on_failure(),
        app_aware_tone_enabled: default_app_aware_tone_enabled(),
        tone_definitions: default_tone_definitions(),
        app_tone_mappings: default_app_tone_mappings(),
        correction_tracking_enabled: default_correction_tracking_enabled(),
        snippets_enabled: default_snippets_enabled(),
        snippets: Vec::new(),
        app_theme: default_app_theme(),
    }
}

impl AppSettings {
    pub fn translation_enabled(&self) -> bool {
        self.translation_output_mode != TranslationOutputMode::Source
    }

    pub fn active_post_process_provider(&self) -> Option<&PostProcessProvider> {
        self.post_process_providers
            .iter()
            .find(|provider| provider.id == self.post_process_provider_id)
    }

    pub fn post_process_provider(&self, provider_id: &str) -> Option<&PostProcessProvider> {
        self.post_process_providers
            .iter()
            .find(|provider| provider.id == provider_id)
    }

    pub fn post_process_provider_mut(
        &mut self,
        provider_id: &str,
    ) -> Option<&mut PostProcessProvider> {
        self.post_process_providers
            .iter_mut()
            .find(|provider| provider.id == provider_id)
    }

    pub fn active_translation_provider(&self) -> Option<&PostProcessProvider> {
        self.post_process_providers
            .iter()
            .find(|provider| provider.id == self.translation_provider_id)
    }

    pub fn active_translation_provider_is_local(&self) -> bool {
        self.active_translation_provider()
            .map(post_process_provider_is_local)
            .unwrap_or(false)
    }

    pub fn preferred_local_translation_provider_id(&self) -> Option<String> {
        if self.active_translation_provider_is_local() {
            return Some(self.translation_provider_id.clone());
        }

        if self.is_post_process_provider_local(APPLE_INTELLIGENCE_PROVIDER_ID) {
            return Some(APPLE_INTELLIGENCE_PROVIDER_ID.to_string());
        }

        if self.is_post_process_provider_local("custom") {
            return Some("custom".to_string());
        }

        self.post_process_providers
            .iter()
            .find(|provider| post_process_provider_is_local(provider))
            .map(|provider| provider.id.clone())
    }

    pub fn tone_definition(&self, tone_id: &str) -> Option<&ToneDefinition> {
        self.tone_definitions.iter().find(|tone| tone.id == tone_id)
    }

    pub fn app_tone_mapping(&self, bundle_id: &str) -> Option<&AppToneMapping> {
        self.app_tone_mappings
            .iter()
            .find(|mapping| mapping.bundle_id.eq_ignore_ascii_case(bundle_id))
    }

    pub fn is_post_process_provider_local(&self, provider_id: &str) -> bool {
        self.post_process_provider(provider_id)
            .map(post_process_provider_is_local)
            .unwrap_or(false)
    }

    pub fn active_post_process_provider_is_local(&self) -> bool {
        self.active_post_process_provider()
            .map(post_process_provider_is_local)
            .unwrap_or(false)
    }

    pub fn preferred_local_post_process_provider_id(&self) -> Option<String> {
        if self.active_post_process_provider_is_local() {
            return Some(self.post_process_provider_id.clone());
        }

        if self.is_post_process_provider_local(APPLE_INTELLIGENCE_PROVIDER_ID) {
            return Some(APPLE_INTELLIGENCE_PROVIDER_ID.to_string());
        }

        if self.is_post_process_provider_local("custom") {
            return Some("custom".to_string());
        }

        self.post_process_providers
            .iter()
            .find(|provider| post_process_provider_is_local(provider))
            .map(|provider| provider.id.clone())
    }

    pub fn enforce_local_privacy_mode(&mut self) -> bool {
        if !self.local_privacy_mode {
            return false;
        }

        let mut changed = false;

        if !self.active_post_process_provider_is_local() {
            if let Some(provider_id) = self.preferred_local_post_process_provider_id() {
                if self.post_process_provider_id != provider_id {
                    self.post_process_provider_id = provider_id;
                    changed = true;
                }
            } else if self.post_process_enabled {
                // If no local provider exists, force-disable post-processing.
                self.post_process_enabled = false;
                changed = true;
            }
        }

        if self.translation_enabled() && !self.active_translation_provider_is_local() {
            if let Some(provider_id) = self.preferred_local_translation_provider_id() {
                if self.translation_provider_id != provider_id {
                    self.translation_provider_id = provider_id;
                    changed = true;
                }
            }
        }

        changed
    }
}

pub fn is_local_base_url(base_url: &str) -> bool {
    let lower = base_url.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }

    lower.starts_with("http://localhost")
        || lower.starts_with("https://localhost")
        || lower.starts_with("http://127.0.0.1")
        || lower.starts_with("https://127.0.0.1")
        || lower.starts_with("http://[::1]")
        || lower.starts_with("https://[::1]")
}

pub fn post_process_provider_is_local(provider: &PostProcessProvider) -> bool {
    if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
        return true;
    }

    is_local_base_url(&provider.base_url)
}

pub fn load_or_create_app_settings(app: &AppHandle) -> AppSettings {
    // Initialize store
    let store = app
        .store(crate::portable::store_path(SETTINGS_STORE_PATH))
        .expect("Failed to initialize store");

    let mut settings = if let Some(settings_value) = store.get("settings") {
        // Parse the entire settings object
        match serde_json::from_value::<AppSettings>(settings_value) {
            Ok(mut settings) => {
                debug!("Found existing settings: {:?}", settings);
                let default_settings = get_default_settings();
                let mut updated = false;

                // Merge default bindings into existing settings
                for (key, value) in default_settings.bindings {
                    if !settings.bindings.contains_key(&key) {
                        debug!("Adding missing binding: {}", key);
                        settings.bindings.insert(key, value);
                        updated = true;
                    }
                }

                if updated {
                    debug!("Settings updated with new bindings");
                    store.set("settings", serde_json::to_value(&settings).unwrap());
                }

                settings
            }
            Err(e) => {
                warn!("Failed to parse settings: {}", e);
                // Fall back to default settings if parsing fails
                let default_settings = get_default_settings();
                store.set("settings", serde_json::to_value(&default_settings).unwrap());
                default_settings
            }
        }
    } else {
        let default_settings = get_default_settings();
        store.set("settings", serde_json::to_value(&default_settings).unwrap());
        default_settings
    };

    let translation_changed = ensure_translation_defaults(&mut settings);
    let tts_changed = ensure_tts_defaults(&mut settings);
    let post_process_changed = ensure_post_process_defaults(&mut settings);

    if translation_changed || tts_changed || post_process_changed {
        store.set("settings", serde_json::to_value(&settings).unwrap());
    }

    settings
}

pub fn get_settings(app: &AppHandle) -> AppSettings {
    let store = app
        .store(crate::portable::store_path(SETTINGS_STORE_PATH))
        .expect("Failed to initialize store");

    let mut settings = if let Some(settings_value) = store.get("settings") {
        serde_json::from_value::<AppSettings>(settings_value).unwrap_or_else(|_| {
            let default_settings = get_default_settings();
            store.set("settings", serde_json::to_value(&default_settings).unwrap());
            default_settings
        })
    } else {
        let default_settings = get_default_settings();
        store.set("settings", serde_json::to_value(&default_settings).unwrap());
        default_settings
    };

    let translation_changed = ensure_translation_defaults(&mut settings);
    let tts_changed = ensure_tts_defaults(&mut settings);
    let post_process_changed = ensure_post_process_defaults(&mut settings);

    if translation_changed || tts_changed || post_process_changed {
        store.set("settings", serde_json::to_value(&settings).unwrap());
    }

    settings
}

pub fn write_settings(app: &AppHandle, settings: AppSettings) {
    let store = app
        .store(crate::portable::store_path(SETTINGS_STORE_PATH))
        .expect("Failed to initialize store");

    store.set("settings", serde_json::to_value(&settings).unwrap());
}

pub fn get_bindings(app: &AppHandle) -> HashMap<String, ShortcutBinding> {
    let settings = get_settings(app);

    settings.bindings
}

pub fn get_stored_binding(app: &AppHandle, id: &str) -> ShortcutBinding {
    let bindings = get_bindings(app);

    let binding = bindings.get(id).unwrap().clone();

    binding
}

pub fn get_history_limit(app: &AppHandle) -> usize {
    let settings = get_settings(app);
    settings.history_limit
}

pub fn get_recording_retention_period(app: &AppHandle) -> RecordingRetentionPeriod {
    let settings = get_settings(app);
    settings.recording_retention_period
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_disable_auto_submit() {
        let settings = get_default_settings();
        assert!(!settings.auto_submit);
        assert_eq!(settings.auto_submit_key, AutoSubmitKey::Enter);
    }

    #[test]
    fn default_settings_include_app_aware_tone_presets() {
        let settings = get_default_settings();

        assert!(!settings.app_aware_tone_enabled);
        assert!(settings
            .tone_definitions
            .iter()
            .any(|tone| tone.id == "casual"));
        assert!(settings
            .app_tone_mappings
            .iter()
            .any(|mapping| mapping.bundle_id == "com.apple.mail"));
    }

    #[test]
    fn ensure_post_process_defaults_restores_tone_presets() {
        let mut settings = get_default_settings();
        settings.tone_definitions.clear();
        settings.app_tone_mappings.clear();

        let changed = ensure_post_process_defaults(&mut settings);

        assert!(changed);
        assert!(!settings.tone_definitions.is_empty());
        assert!(!settings.app_tone_mappings.is_empty());
    }

    #[test]
    fn default_settings_pin_current_prompt_policy_version() {
        let settings = get_default_settings();
        assert_eq!(
            settings.post_process_prompt_policy_version,
            POST_PROCESS_PROMPT_POLICY_VERSION
        );
    }

    #[test]
    fn ensure_post_process_defaults_migrates_legacy_prompt_policy() {
        let mut settings = get_default_settings();
        settings.post_process_prompt_policy_version = 0;
        settings.post_process_prompts = vec![LLMPrompt {
            id: "custom_old".to_string(),
            name: "Custom Old".to_string(),
            prompt: "Old prompt".to_string(),
        }];
        settings.post_process_selected_prompt_id = Some("custom_old".to_string());

        let changed = ensure_post_process_defaults(&mut settings);

        assert!(changed);
        assert_eq!(
            settings.post_process_prompt_policy_version,
            POST_PROCESS_PROMPT_POLICY_VERSION
        );
        assert_eq!(settings.post_process_prompts.len(), 1);
        assert_eq!(
            settings.post_process_prompts[0].id,
            DEFAULT_POST_PROCESS_PROMPT_ID
        );
        assert_eq!(
            settings.post_process_selected_prompt_id,
            Some(DEFAULT_POST_PROCESS_PROMPT_ID.to_string())
        );
    }

    #[test]
    fn ensure_post_process_defaults_keeps_user_prompt_after_policy_migration() {
        let mut settings = get_default_settings();
        settings.post_process_prompt_policy_version = POST_PROCESS_PROMPT_POLICY_VERSION;
        settings.post_process_prompts = vec![LLMPrompt {
            id: "user_prompt".to_string(),
            name: "User Prompt".to_string(),
            prompt: "Do user things with ${output}".to_string(),
        }];
        settings.post_process_selected_prompt_id = Some("user_prompt".to_string());

        let changed = ensure_post_process_defaults(&mut settings);

        assert!(!changed);
        assert_eq!(settings.post_process_prompts.len(), 1);
        assert_eq!(settings.post_process_prompts[0].id, "user_prompt");
        assert_eq!(
            settings.post_process_selected_prompt_id,
            Some("user_prompt".to_string())
        );
    }

    #[test]
    fn ensure_post_process_defaults_replaces_legacy_prompt_set_with_current_default() {
        let mut settings = get_default_settings();
        settings.post_process_prompt_policy_version = 4;
        settings.post_process_prompts = vec![
            LLMPrompt {
                id: DEFAULT_POST_PROCESS_PROMPT_ID.to_string(),
                name: "Improve Transcriptions".to_string(),
                prompt: "Older built-in prompt".to_string(),
            },
            LLMPrompt {
                id: "user_prompt".to_string(),
                name: "User Prompt".to_string(),
                prompt: "Custom prompt".to_string(),
            },
        ];
        settings.post_process_selected_prompt_id = Some("user_prompt".to_string());

        let changed = ensure_post_process_defaults(&mut settings);

        assert!(changed);
        assert_eq!(
            settings.post_process_prompt_policy_version,
            POST_PROCESS_PROMPT_POLICY_VERSION
        );
        assert_eq!(settings.post_process_prompts.len(), 1);
        assert_eq!(
            settings.post_process_prompts[0].id,
            DEFAULT_POST_PROCESS_PROMPT_ID
        );
        assert_eq!(
            settings.post_process_selected_prompt_id,
            Some(DEFAULT_POST_PROCESS_PROMPT_ID.to_string())
        );
        assert!(settings.post_process_prompts[0]
            .prompt
            .contains("Previous Landlord Reference Credit Check Social Security Verification"));
    }

    #[test]
    fn enforce_local_privacy_mode_switches_to_local_provider() {
        let mut settings = get_default_settings();
        settings.local_privacy_mode = true;
        settings.post_process_provider_id = "openai".to_string();

        let changed = settings.enforce_local_privacy_mode();

        assert!(changed);
        assert_ne!(settings.post_process_provider_id, "openai");
        assert!(settings.active_post_process_provider_is_local());
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn default_settings_enable_apple_intelligence_on_arm64() {
        let settings = get_default_settings();
        assert!(settings.post_process_enabled);
        assert_eq!(
            settings.post_process_provider_id,
            APPLE_INTELLIGENCE_PROVIDER_ID
        );
        assert_eq!(settings.max_rewrite_strength, 1);
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn ensure_post_process_defaults_migrates_unconfigured_openai_to_apple() {
        let mut settings = get_default_settings();
        // Simulate an existing user whose provider was defaulting to openai with no key
        settings.post_process_provider_id = "openai".to_string();
        settings.post_process_enabled = false;
        settings
            .post_process_api_keys
            .insert("openai".to_string(), String::new());

        let changed = ensure_post_process_defaults(&mut settings);

        assert!(changed);
        assert_eq!(
            settings.post_process_provider_id,
            APPLE_INTELLIGENCE_PROVIDER_ID
        );
        assert!(settings.post_process_enabled);
    }

    #[test]
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn ensure_post_process_defaults_preserves_configured_openai() {
        let mut settings = get_default_settings();
        // Simulate a user who intentionally configured OpenAI with an API key
        settings.post_process_provider_id = "openai".to_string();
        settings.post_process_enabled = true;
        settings
            .post_process_api_keys
            .insert("openai".to_string(), "sk-test-key".to_string());

        let _changed = ensure_post_process_defaults(&mut settings);

        // Should NOT migrate — user intentionally configured OpenAI
        assert_eq!(settings.post_process_provider_id, "openai");
        assert!(settings.post_process_enabled);
        // changed may be true for other reasons (other defaults), but provider must stay
    }

    #[test]
    fn default_settings_include_tts_defaults_and_shortcuts() {
        let settings = get_default_settings();

        assert!(!settings.tts_enabled);
        assert_eq!(settings.tts_engine_preference, TtsEnginePreference::Auto);
        assert_eq!(settings.tts_auto_readback_mode, TtsAutoReadbackMode::Off);
        assert_eq!(
            settings.tts_auto_readback_scope,
            TtsAutoReadbackScope::DictationOnly
        );
        assert_eq!(
            settings.tts_readback_text_mode,
            TtsReadbackTextMode::FinalOutput
        );
        assert_eq!(settings.tts_rate, default_tts_rate());
        assert_eq!(settings.tts_volume, default_tts_volume());
        assert!(settings.tts_stop_on_record);
        assert!(settings.bindings.contains_key("speak_selection"));
        assert!(settings.bindings.contains_key("speak_last_output"));
        assert!(settings.bindings.contains_key("stop_speaking"));
    }
}
