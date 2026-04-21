use crate::portable;
use crate::post_processing::{AppToneMapping, DictionaryEntry, PostProcessMode, ToneDefinition};
use crate::snippets::Snippet;
use log::{debug, warn};
use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

pub const APPLE_INTELLIGENCE_PROVIDER_ID: &str = "apple_intelligence";
pub const APPLE_INTELLIGENCE_DEFAULT_MODEL_ID: &str = "Apple Intelligence";
pub const OLLAMA_PROVIDER_ID: &str = "ollama";
pub const TTS_PROVIDER_SYSTEM_BUILTIN_ID: &str = "system_builtin";
pub const TTS_PROVIDER_SHERPA_PACK_ID: &str = "sherpa_pack";
pub const TTS_PROVIDER_LOCAL_SIDECAR_API_ID: &str = "local_sidecar_api";
pub const TTS_PROVIDER_QWEN3_NATIVE_ID: &str = "qwen3_native";
pub const TTS_PROVIDER_OPENVOICE_ID: &str = "openvoice";
pub const TTS_PROVIDER_CHATTERBOX_ID: &str = "chatterbox";
pub const TTS_PROVIDER_KOKORO_ID: &str = "kokoro";
pub const TTS_PROVIDER_XTTS_ID: &str = "xtts";
pub const TTS_PROVIDER_FISH_SPEECH_ID: &str = "fish_speech";
pub const TTS_PROVIDER_FISH_SPEECH_LOCAL_ID: &str = "fish_speech_local";
pub const TTS_PROVIDER_TADA_LOCAL_ID: &str = "tada_local";
pub const TTS_PROVIDER_HF_S2S_LOCAL_ID: &str = "hf_s2s_local";
pub const TTS_PROVIDER_MLX_KOKORO_ID: &str = "mlx_kokoro";
pub const TTS_PROVIDER_MLX_CHATTERBOX_ID: &str = "mlx_chatterbox";
pub const TTS_PROVIDER_MLX_QWEN3TTS_ID: &str = "mlx_qwen3tts";
pub const TTS_PROVIDER_MLX_DIA_ID: &str = "mlx_dia";
pub const TTS_PROVIDER_MLX_CSM_ID: &str = "mlx_csm";
pub const TTS_PROVIDER_MLX_SPARK_ID: &str = "mlx_spark";
pub const TTS_PROVIDER_MLX_OUTE_ID: &str = "mlx_oute";
pub const TTS_PROVIDER_MLX_MING_OMNI_ID: &str = "mlx_ming_omni";
pub const TTS_PROVIDER_MLX_KUGEL_ID: &str = "mlx_kugel";
pub const TTS_PROVIDER_MLX_VOXTRAL_TTS_ID: &str = "mlx_voxtral_tts";
pub const TTS_PROVIDER_MLX_BARK_ID: &str = "mlx_bark";
pub const TTS_PROVIDER_MLX_FISH_AUDIO_ID: &str = "mlx_fish_audio";
pub const TTS_PROVIDER_MLX_LFM_AUDIO_ID: &str = "mlx_lfm_audio";
pub const TTS_PROVIDER_MLX_POCKET_TTS_ID: &str = "mlx_pocket_tts";
pub const TTS_PROVIDER_MLX_VOXCPM_ID: &str = "mlx_voxcpm";
pub const TTS_MODEL_SYSTEM_DEFAULT_ID: &str = "system-default";
pub const TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID: &str = "local-sidecar-default";
const POST_PROCESS_PROMPT_POLICY_VERSION: u32 = 6;
const DEFAULT_POST_PROCESS_PROMPT_ID: &str = "default_improve_transcriptions_v2";
const DEFAULT_POST_PROCESS_PROMPT_NAME: &str = "Improve Transcriptions";

pub fn default_tts_model_store_dir(app: &AppHandle) -> PathBuf {
    crate::storage_paths::tts_model_store_dir(app).unwrap_or_else(|_| {
        portable::app_data_dir(app)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("models")
            .join("tts")
            .join("store")
    })
}

pub fn default_speech_runtime_install_dir(app: &AppHandle, platform_id: &str) -> PathBuf {
    crate::storage_paths::tts_runtime_dir(app)
        .unwrap_or_else(|_| {
            portable::app_data_dir(app)
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("models")
                .join("tts")
                .join("runtime")
        })
        .join(platform_id)
}

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
#[serde(rename_all = "lowercase")]
pub enum RecordingOverlayStyle {
    Compact,
    Detailed,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum ModelUnloadTimeout {
    #[default]
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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardHandling {
    #[default]
    DontModify,
    CopyToClipboard,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutoSubmitKey {
    #[default]
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
pub enum ContextCaptureMode {
    AlwaysFrequent,
    AdaptiveCache,
    MostlyOnDemand,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type)]
#[serde(rename_all = "snake_case")]
pub enum OcrQualityMode {
    Fast,
    Balanced,
    Accurate,
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

impl Default for PasteMethod {
    fn default() -> Self {
        // Default to CtrlV for macOS and Windows, Direct for Linux
        #[cfg(target_os = "linux")]
        return PasteMethod::Direct;
        #[cfg(not(target_os = "linux"))]
        return PasteMethod::CtrlV;
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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum TypingTool {
    #[default]
    Auto,
    Wtype,
    Kwtype,
    Dotool,
    Ydotool,
    Xdotool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum TranslationOutputMode {
    #[default]
    Source,
    Translated,
    Bilingual,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum TranslationRoutePreference {
    #[default]
    Auto,
    WhisperEnglish,
    OfflinePack,
    LocalAi,
    RemoteAi,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum TranslationBilingualLayout {
    #[default]
    TranslationThenSource,
    SourceThenTranslation,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum TranslationDestinationMode {
    #[default]
    PasteInPlace,
    PreviewThenPaste,
    OpenInJotPad,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum SelectionTranslationDestinationMode {
    #[default]
    ReplaceSelection,
    PreviewThenReplace,
    OpenInJotPad,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum TtsEnginePreference {
    #[default]
    Auto,
    System,
    SherpaOnnx,
    Sidecar,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum TtsAutoReadbackMode {
    #[default]
    Off,
    AfterOutput,
    AfterPreviewConfirm,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum TtsAutoReadbackScope {
    #[default]
    DictationOnly,
    DictationAndSelection,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum TtsReadbackTextMode {
    #[default]
    FinalOutput,
    TranslatedBlock,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Type)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum TtsStyleControlValue {
    Number(f32),
    Boolean(bool),
    Text(String),
}

#[derive(Serialize, Debug, Clone, PartialEq, Type)]
pub struct TtsVoiceTuningSettings {
    #[serde(default = "default_tts_rate")]
    pub tempo_rate: f32,
    #[serde(default = "default_tts_expressiveness")]
    pub expressiveness: f32,
    #[serde(default = "default_tts_exaggeration")]
    pub exaggeration: f32,
    #[serde(default = "default_tts_randomness")]
    pub randomness: f32,
    #[serde(default = "default_tts_guidance")]
    pub guidance: f32,
    #[serde(default = "default_tts_stability")]
    pub stability: f32,
    #[serde(default = "default_tts_repetition_penalty")]
    pub repetition_penalty: f32,
    #[serde(default)]
    pub style_instructions: Option<String>,
}

#[derive(Deserialize, Default)]
struct TtsVoiceTuningSettingsCompat {
    #[serde(default)]
    tempo_rate: Option<f32>,
    #[serde(default)]
    expressiveness: Option<f32>,
    #[serde(default)]
    exaggeration: Option<f32>,
    #[serde(default)]
    randomness: Option<f32>,
    #[serde(default)]
    guidance: Option<f32>,
    #[serde(default)]
    stability: Option<f32>,
    #[serde(default)]
    repetition_penalty: Option<f32>,
    #[serde(default)]
    style_instructions: Option<String>,
    #[serde(default)]
    rate: Option<f32>,
    #[serde(default)]
    advanced_overrides: HashMap<String, TtsStyleControlValue>,
}

impl<'de> Deserialize<'de> for TtsVoiceTuningSettings {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let compat = TtsVoiceTuningSettingsCompat::deserialize(deserializer)?;
        let legacy_number = |key: &str| -> Option<f32> {
            match compat.advanced_overrides.get(key) {
                Some(TtsStyleControlValue::Number(value)) => Some(*value),
                _ => None,
            }
        };
        let legacy_text = |key: &str| -> Option<String> {
            match compat.advanced_overrides.get(key) {
                Some(TtsStyleControlValue::Text(value)) => Some(value.clone()),
                _ => None,
            }
        };

        Ok(Self {
            tempo_rate: compat
                .tempo_rate
                .or(compat.rate)
                .or_else(|| legacy_number("speed"))
                .unwrap_or_else(default_tts_rate),
            expressiveness: compat
                .expressiveness
                .unwrap_or_else(default_tts_expressiveness),
            exaggeration: compat.exaggeration.unwrap_or_else(|| {
                legacy_number("exaggeration").unwrap_or_else(default_tts_exaggeration)
            }),
            randomness: compat
                .randomness
                .or_else(|| legacy_number("temperature"))
                .unwrap_or_else(default_tts_randomness),
            guidance: compat
                .guidance
                .or_else(|| legacy_number("cfg_weight"))
                .unwrap_or_else(default_tts_guidance),
            stability: compat.stability.unwrap_or_else(default_tts_stability),
            repetition_penalty: compat
                .repetition_penalty
                .or_else(|| legacy_number("repetition_penalty"))
                .unwrap_or_else(default_tts_repetition_penalty),
            style_instructions: normalize_optional_string(
                compat
                    .style_instructions
                    .or_else(|| legacy_text("style_instructions")),
            ),
        })
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct TtsVoicePreset {
    pub id: String,
    pub label: String,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub voice_id: Option<String>,
    #[serde(default)]
    pub voice_profile_id: Option<String>,
    #[serde(default)]
    pub voice_label_snapshot: Option<String>,
    #[serde(default)]
    pub locale_snapshot: Option<String>,
    #[serde(rename = "tuning", alias = "style")]
    pub tuning: TtsVoiceTuningSettings,
}

#[derive(Serialize, Deserialize, Debug, Clone, Type)]
pub struct TtsVoicePresetInput {
    #[serde(default)]
    pub label: Option<String>,
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub voice_id: Option<String>,
    #[serde(default)]
    pub voice_profile_id: Option<String>,
    #[serde(default)]
    pub voice_label_snapshot: Option<String>,
    #[serde(default)]
    pub locale_snapshot: Option<String>,
    #[serde(rename = "tuning", alias = "style")]
    pub tuning: TtsVoiceTuningSettings,
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
    #[serde(default)]
    pub selected_stt_provider_id: String,
    #[serde(default)]
    pub selected_stt_model_id: String,
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
    #[serde(default)]
    pub selected_tts_provider_id: String,
    #[serde(default)]
    pub selected_tts_model_id: Option<String>,
    #[serde(default)]
    pub selected_tts_voice_id: Option<String>,
    #[serde(default)]
    pub selected_tts_profile_id: Option<String>,
    #[serde(default)]
    pub tts_active_preset_id: Option<String>,
    #[serde(default)]
    pub tts_voice_presets: Vec<TtsVoicePreset>,
    #[serde(default = "default_tts_rate")]
    pub tts_rate: f32,
    #[serde(default = "default_tts_volume")]
    pub tts_volume: f32,
    #[serde(default = "default_tts_stop_on_record")]
    pub tts_stop_on_record: bool,
    #[serde(default)]
    pub speech_runtime_path: Option<String>,
    #[serde(default)]
    pub tts_model_store_path: Option<String>,
    #[serde(default)]
    pub speech_backend_override: Option<String>,
    #[serde(default)]
    pub audio_enhancement_enabled: bool,
    #[serde(default = "default_audio_enhancement_model")]
    pub audio_enhancement_model: String,
    #[serde(default = "default_overlay_position")]
    pub overlay_position: OverlayPosition,
    #[serde(default = "default_recording_overlay_style")]
    pub recording_overlay_style: RecordingOverlayStyle,
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
    #[serde(default = "default_screen_context_enabled")]
    pub screen_context_enabled: bool,
    #[serde(default)]
    pub screen_context_excluded_bundle_ids: Vec<String>,
    #[serde(default = "default_screen_context_pause_on_idle")]
    pub screen_context_pause_on_idle: bool,
    #[serde(default = "default_screen_context_idle_threshold_ms")]
    pub screen_context_idle_threshold_ms: u32,
    #[serde(default = "default_context_capture_mode")]
    pub context_capture_mode: ContextCaptureMode,
    #[serde(default = "default_screen_context_ocr_quality")]
    pub screen_context_ocr_quality: OcrQualityMode,
    #[serde(default = "default_screen_context_ocr_timeout_ms")]
    pub screen_context_ocr_timeout_ms: u32,
    #[serde(default = "default_screen_context_token_budget")]
    pub screen_context_token_budget: u32,
    #[serde(default = "default_screen_context_stale_threshold_ms")]
    pub screen_context_stale_threshold_ms: u32,
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
    #[serde(default = "default_selected_llm_provider_id")]
    pub selected_llm_provider_id: String,
    #[serde(default = "default_selected_llm_model_id")]
    pub selected_llm_model_id: String,
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
    #[serde(default = "default_global_language_sync_enabled")]
    pub global_language_sync_enabled: bool,
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
    #[serde(default)]
    pub continuous_improvement_hq_capture: bool,
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

fn default_tts_expressiveness() -> f32 {
    0.5
}

fn default_tts_exaggeration() -> f32 {
    0.5
}

fn default_tts_randomness() -> f32 {
    0.7
}

fn default_tts_guidance() -> f32 {
    0.5
}

fn default_tts_stability() -> f32 {
    0.5
}

fn default_tts_repetition_penalty() -> f32 {
    1.2
}

fn default_tts_volume() -> f32 {
    0.85
}

fn default_tts_stop_on_record() -> bool {
    true
}

fn default_audio_enhancement_model() -> String {
    "rnnoise".to_string()
}

fn default_selected_llm_provider_id() -> String {
    default_post_process_provider_id()
}

fn default_selected_llm_model_id() -> String {
    default_model_for_provider(&default_selected_llm_provider_id())
}

fn default_selected_tts_provider_id_from_legacy(preference: TtsEnginePreference) -> &'static str {
    match preference {
        TtsEnginePreference::System => TTS_PROVIDER_SYSTEM_BUILTIN_ID,
        TtsEnginePreference::SherpaOnnx => TTS_PROVIDER_SHERPA_PACK_ID,
        TtsEnginePreference::Sidecar => TTS_PROVIDER_LOCAL_SIDECAR_API_ID,
        TtsEnginePreference::Auto => {
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                TTS_PROVIDER_SYSTEM_BUILTIN_ID
            }
            #[cfg(target_os = "linux")]
            {
                TTS_PROVIDER_SHERPA_PACK_ID
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                TTS_PROVIDER_LOCAL_SIDECAR_API_ID
            }
        }
    }
}

fn default_selected_tts_model_id_for_provider(provider_id: &str) -> Option<String> {
    match provider_id {
        TTS_PROVIDER_SYSTEM_BUILTIN_ID => Some(TTS_MODEL_SYSTEM_DEFAULT_ID.to_string()),
        TTS_PROVIDER_LOCAL_SIDECAR_API_ID => Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID.to_string()),
        _ => None,
    }
}

fn default_overlay_position() -> OverlayPosition {
    #[cfg(target_os = "linux")]
    return OverlayPosition::None;
    #[cfg(not(target_os = "linux"))]
    return OverlayPosition::Bottom;
}

fn default_recording_overlay_style() -> RecordingOverlayStyle {
    RecordingOverlayStyle::Compact
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

fn default_context_capture_mode() -> ContextCaptureMode {
    ContextCaptureMode::AlwaysFrequent
}

fn default_screen_context_ocr_quality() -> OcrQualityMode {
    OcrQualityMode::Balanced
}

fn default_screen_context_ocr_timeout_ms() -> u32 {
    700
}

fn default_screen_context_token_budget() -> u32 {
    400
}

fn default_screen_context_stale_threshold_ms() -> u32 {
    2_500
}

fn default_screen_context_enabled() -> bool {
    true
}

fn default_screen_context_pause_on_idle() -> bool {
    true
}

fn default_screen_context_idle_threshold_ms() -> u32 {
    60_000
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
                                    if id.is_empty() {
                                        None
                                    } else {
                                        Some(id)
                                    }
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

fn default_global_language_sync_enabled() -> bool {
    true
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
    if provider_id == OLLAMA_PROVIDER_ID {
        return "qwen2.5:1.5b".to_string();
    }
    if provider_id == "groq" {
        return "llama-3.1-8b-instant".to_string();
    }
    if provider_id == "cerebras" {
        return "llama-3.3-70b".to_string();
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
    r#"Optional extra instructions for Vox Jot's built-in dictation post-processor.
Keep additions brief and task-specific.

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

    if settings.tts_voice_presets.is_empty() {
        let preset = build_tts_preset_from_legacy(settings, Some("tts-preset-default".to_string()));
        settings.tts_voice_presets.push(preset);
        changed = true;
    }

    for preset in &mut settings.tts_voice_presets {
        let next_label = fallback_tts_preset_label(
            &preset.provider_id,
            &preset.model_id,
            preset.voice_id.as_deref(),
            preset.voice_profile_id.as_deref(),
            preset.voice_label_snapshot.as_deref(),
        );
        if preset.label.trim().is_empty() {
            preset.label = next_label;
            changed = true;
        }

        let next_provider_id = if preset.provider_id.trim().is_empty() {
            default_selected_tts_provider_id_from_legacy(settings.tts_engine_preference).to_string()
        } else {
            preset.provider_id.trim().to_string()
        };
        if preset.provider_id != next_provider_id {
            preset.provider_id = next_provider_id;
            changed = true;
        }

        let next_model_id = if preset.model_id.trim().is_empty() {
            default_selected_tts_model_id_for_provider(&preset.provider_id)
                .unwrap_or_else(|| preset.provider_id.clone())
        } else {
            preset.model_id.trim().to_string()
        };
        if preset.model_id != next_model_id {
            preset.model_id = next_model_id;
            changed = true;
        }

        let normalized_voice_id = normalize_optional_string(preset.voice_id.clone());
        if preset.voice_id != normalized_voice_id {
            preset.voice_id = normalized_voice_id;
            changed = true;
        }
        let normalized_profile_id = normalize_optional_string(preset.voice_profile_id.clone());
        if preset.voice_profile_id != normalized_profile_id {
            preset.voice_profile_id = normalized_profile_id;
            changed = true;
        }
        let normalized_voice_label = normalize_optional_string(preset.voice_label_snapshot.clone());
        if preset.voice_label_snapshot != normalized_voice_label {
            preset.voice_label_snapshot = normalized_voice_label;
            changed = true;
        }
        let normalized_locale = normalize_optional_string(preset.locale_snapshot.clone());
        if preset.locale_snapshot != normalized_locale {
            preset.locale_snapshot = normalized_locale;
            changed = true;
        }

        if sanitize_tts_voice_tuning(&mut preset.tuning) {
            changed = true;
        }
    }

    if settings.set_active_tts_preset_id(settings.tts_active_preset_id.clone()) {
        changed = true;
    }

    if settings.sync_legacy_tts_state_from_active_preset() {
        changed = true;
    }

    changed
}

fn ensure_model_platform_defaults(settings: &mut AppSettings) -> bool {
    let mut changed = false;

    if settings.selected_stt_model_id != settings.selected_model {
        settings.selected_stt_model_id = settings.selected_model.clone();
        changed = true;
    }

    if settings.selected_llm_provider_id.trim().is_empty() {
        settings.selected_llm_provider_id = settings.post_process_provider_id.clone();
        changed = true;
    }

    let expected_llm_model = settings
        .post_process_models
        .get(&settings.post_process_provider_id)
        .cloned()
        .unwrap_or_else(|| default_model_for_provider(&settings.post_process_provider_id));
    if settings.selected_llm_model_id.trim().is_empty()
        || settings.selected_llm_provider_id != settings.post_process_provider_id
    {
        settings.selected_llm_provider_id = settings.post_process_provider_id.clone();
        settings.selected_llm_model_id = expected_llm_model;
        changed = true;
    }

    if settings.selected_tts_provider_id.trim().is_empty() {
        settings.selected_tts_provider_id =
            default_selected_tts_provider_id_from_legacy(settings.tts_engine_preference)
                .to_string();
        changed = true;
    }

    match settings.selected_tts_provider_id.as_str() {
        TTS_PROVIDER_SYSTEM_BUILTIN_ID | TTS_PROVIDER_SHERPA_PACK_ID => {
            if settings.selected_tts_voice_id != settings.tts_default_voice_id {
                settings.selected_tts_voice_id = settings.tts_default_voice_id.clone();
                changed = true;
            }
        }
        _ => {}
    }

    if settings.selected_tts_model_id.is_none() {
        settings.selected_tts_model_id = match settings.selected_tts_provider_id.as_str() {
            TTS_PROVIDER_SYSTEM_BUILTIN_ID | TTS_PROVIDER_SHERPA_PACK_ID => {
                settings.selected_tts_voice_id.clone().or_else(|| {
                    default_selected_tts_model_id_for_provider(&settings.selected_tts_provider_id)
                })
            }
            _ => default_selected_tts_model_id_for_provider(&settings.selected_tts_provider_id),
        };
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
    #[cfg(target_os = "windows")]
    let default_command_menu_shortcut = "ctrl+k";
    #[cfg(target_os = "macos")]
    let default_command_menu_shortcut = "command+k";
    #[cfg(target_os = "linux")]
    let default_command_menu_shortcut = "ctrl+k";
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let default_command_menu_shortcut = "ctrl+k";

    bindings.insert(
        "toggle_command_menu".to_string(),
        ShortcutBinding {
            id: "toggle_command_menu".to_string(),
            name: "Command Menu".to_string(),
            description: "Opens the command menu from anywhere.".to_string(),
            default_binding: default_command_menu_shortcut.to_string(),
            current_binding: default_command_menu_shortcut.to_string(),
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
        selected_stt_provider_id: String::new(),
        selected_stt_model_id: String::new(),
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
        selected_tts_provider_id: String::new(),
        selected_tts_model_id: None,
        selected_tts_voice_id: None,
        selected_tts_profile_id: None,
        tts_active_preset_id: None,
        tts_voice_presets: Vec::new(),
        tts_rate: default_tts_rate(),
        tts_volume: default_tts_volume(),
        tts_stop_on_record: default_tts_stop_on_record(),
        speech_runtime_path: None,
        tts_model_store_path: None,
        speech_backend_override: None,
        audio_enhancement_enabled: true,
        audio_enhancement_model: default_audio_enhancement_model(),
        overlay_position: default_overlay_position(),
        recording_overlay_style: default_recording_overlay_style(),
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
        screen_context_enabled: default_screen_context_enabled(),
        screen_context_excluded_bundle_ids: Vec::new(),
        screen_context_pause_on_idle: default_screen_context_pause_on_idle(),
        screen_context_idle_threshold_ms: default_screen_context_idle_threshold_ms(),
        context_capture_mode: default_context_capture_mode(),
        screen_context_ocr_quality: default_screen_context_ocr_quality(),
        screen_context_ocr_timeout_ms: default_screen_context_ocr_timeout_ms(),
        screen_context_token_budget: default_screen_context_token_budget(),
        screen_context_stale_threshold_ms: default_screen_context_stale_threshold_ms(),
        post_process_mode: default_post_process_mode(),
        post_process_provider_id: default_post_process_provider_id(),
        post_process_providers: default_post_process_providers(),
        post_process_api_keys: default_post_process_api_keys(),
        post_process_models: default_post_process_models(),
        selected_llm_provider_id: default_selected_llm_provider_id(),
        selected_llm_model_id: default_selected_llm_model_id(),
        post_process_prompts: default_post_process_prompts(),
        post_process_selected_prompt_id: default_post_process_prompts()
            .first()
            .map(|prompt| prompt.id.clone()),
        post_process_prompt_policy_version: default_post_process_prompt_policy_version(),
        mute_while_recording: false,
        append_trailing_space: false,
        app_language: default_app_language(),
        global_language_sync_enabled: default_global_language_sync_enabled(),
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
        continuous_improvement_hq_capture: false,
    }
}

impl AppSettings {
    pub fn tts_preset(&self, preset_id: &str) -> Option<&TtsVoicePreset> {
        self.tts_voice_presets
            .iter()
            .find(|preset| preset.id == preset_id)
    }

    pub fn tts_preset_mut(&mut self, preset_id: &str) -> Option<&mut TtsVoicePreset> {
        self.tts_voice_presets
            .iter_mut()
            .find(|preset| preset.id == preset_id)
    }

    pub fn active_tts_preset(&self) -> Option<&TtsVoicePreset> {
        self.tts_active_preset_id
            .as_deref()
            .and_then(|preset_id| self.tts_preset(preset_id))
            .or_else(|| self.tts_voice_presets.first())
    }

    pub fn explicit_active_tts_preset(&self) -> Option<&TtsVoicePreset> {
        self.tts_active_preset_id
            .as_deref()
            .and_then(|preset_id| self.tts_preset(preset_id))
    }

    pub fn active_tts_preset_mut(&mut self) -> Option<&mut TtsVoicePreset> {
        let preset_id = self.tts_active_preset_id.clone().or_else(|| {
            self.tts_voice_presets
                .first()
                .map(|preset| preset.id.clone())
        })?;
        self.tts_preset_mut(&preset_id)
    }

    pub fn set_active_tts_preset_id(&mut self, preset_id: Option<String>) -> bool {
        let next_id = preset_id
            .and_then(|value| self.tts_preset(&value).map(|preset| preset.id.clone()))
            .or_else(|| {
                self.tts_voice_presets
                    .first()
                    .map(|preset| preset.id.clone())
            });
        if self.tts_active_preset_id == next_id {
            return false;
        }
        self.tts_active_preset_id = next_id;
        true
    }

    pub fn upsert_tts_preset(&mut self, preset: TtsVoicePreset) -> bool {
        if let Some(existing) = self.tts_preset_mut(&preset.id) {
            *existing = preset;
            true
        } else {
            self.tts_voice_presets.insert(0, preset);
            true
        }
    }

    pub fn delete_tts_preset(&mut self, preset_id: &str) -> bool {
        let original_len = self.tts_voice_presets.len();
        self.tts_voice_presets
            .retain(|preset| preset.id != preset_id);
        original_len != self.tts_voice_presets.len()
    }

    pub fn sync_legacy_tts_state_from_active_preset(&mut self) -> bool {
        let Some(preset) = self.active_tts_preset().cloned() else {
            return false;
        };

        let mut changed = false;
        if self.selected_tts_provider_id != preset.provider_id {
            self.selected_tts_provider_id = preset.provider_id.clone();
            changed = true;
        }
        let next_model_id = Some(preset.model_id.clone());
        if self.selected_tts_model_id != next_model_id {
            self.selected_tts_model_id = next_model_id;
            changed = true;
        }
        if self.selected_tts_profile_id != preset.voice_profile_id {
            self.selected_tts_profile_id = preset.voice_profile_id.clone();
            changed = true;
        }
        if self.selected_tts_voice_id != preset.voice_id {
            self.selected_tts_voice_id = preset.voice_id.clone();
            changed = true;
        }
        if self.tts_default_voice_id != preset.voice_id {
            self.tts_default_voice_id = preset.voice_id.clone();
            changed = true;
        }

        let next_rate = preset.tuning.tempo_rate.clamp(0.5, 2.0);
        if (self.tts_rate - next_rate).abs() > f32::EPSILON {
            self.tts_rate = next_rate;
            changed = true;
        }

        changed
    }

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

fn fallback_tts_preset_label(
    provider_id: &str,
    model_id: &str,
    voice_id: Option<&str>,
    voice_profile_id: Option<&str>,
    snapshot: Option<&str>,
) -> String {
    if let Some(snapshot) = snapshot.filter(|value| !value.trim().is_empty()) {
        return snapshot.trim().to_string();
    }
    if voice_profile_id.is_some() {
        return "Cloned Voice".to_string();
    }
    if let Some(voice_id) = voice_id.filter(|value| !value.trim().is_empty()) {
        return voice_id.to_string();
    }
    if provider_id == TTS_PROVIDER_SYSTEM_BUILTIN_ID {
        return "System Voice".to_string();
    }
    if !model_id.trim().is_empty() {
        return model_id.to_string();
    }
    "Voice Preset".to_string()
}

fn sanitize_tts_voice_tuning(tuning: &mut TtsVoiceTuningSettings) -> bool {
    let mut changed = false;
    let next_tempo_rate = tuning.tempo_rate.clamp(0.5, 2.0);
    if (tuning.tempo_rate - next_tempo_rate).abs() > f32::EPSILON {
        tuning.tempo_rate = next_tempo_rate;
        changed = true;
    }
    let next_expressiveness = tuning.expressiveness.clamp(0.0, 1.0);
    if (tuning.expressiveness - next_expressiveness).abs() > f32::EPSILON {
        tuning.expressiveness = next_expressiveness;
        changed = true;
    }
    let next_exaggeration = tuning.exaggeration.clamp(0.0, 1.0);
    if (tuning.exaggeration - next_exaggeration).abs() > f32::EPSILON {
        tuning.exaggeration = next_exaggeration;
        changed = true;
    }
    let next_randomness = tuning.randomness.clamp(0.0, 1.0);
    if (tuning.randomness - next_randomness).abs() > f32::EPSILON {
        tuning.randomness = next_randomness;
        changed = true;
    }
    let next_guidance = tuning.guidance.clamp(0.0, 1.0);
    if (tuning.guidance - next_guidance).abs() > f32::EPSILON {
        tuning.guidance = next_guidance;
        changed = true;
    }
    let next_stability = tuning.stability.clamp(0.0, 1.0);
    if (tuning.stability - next_stability).abs() > f32::EPSILON {
        tuning.stability = next_stability;
        changed = true;
    }
    let next_repetition_penalty = tuning.repetition_penalty.clamp(1.0, 3.0);
    if (tuning.repetition_penalty - next_repetition_penalty).abs() > f32::EPSILON {
        tuning.repetition_penalty = next_repetition_penalty;
        changed = true;
    }
    let normalized_instructions = normalize_optional_string(tuning.style_instructions.clone());
    if tuning.style_instructions != normalized_instructions {
        tuning.style_instructions = normalized_instructions;
        changed = true;
    }
    changed
}

fn build_tts_preset_from_legacy(
    settings: &AppSettings,
    preset_id: Option<String>,
) -> TtsVoicePreset {
    let provider_id = if settings.selected_tts_provider_id.trim().is_empty() {
        default_selected_tts_provider_id_from_legacy(settings.tts_engine_preference).to_string()
    } else {
        settings.selected_tts_provider_id.clone()
    };
    let model_id = settings
        .selected_tts_model_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| match provider_id.as_str() {
            TTS_PROVIDER_SHERPA_PACK_ID => settings
                .selected_tts_voice_id
                .clone()
                .or_else(|| settings.tts_default_voice_id.clone()),
            _ => default_selected_tts_model_id_for_provider(&provider_id),
        })
        .unwrap_or_else(|| provider_id.clone());
    let voice_id = normalize_optional_string(
        settings
            .selected_tts_voice_id
            .clone()
            .or_else(|| settings.tts_default_voice_id.clone())
            .or_else(|| {
                if provider_id == TTS_PROVIDER_SHERPA_PACK_ID {
                    Some(model_id.clone())
                } else {
                    None
                }
            }),
    );
    let voice_profile_id = normalize_optional_string(settings.selected_tts_profile_id.clone());
    let voice_label_snapshot = voice_profile_id
        .clone()
        .or_else(|| voice_id.clone())
        .or_else(|| {
            Some(fallback_tts_preset_label(
                &provider_id,
                &model_id,
                None,
                None,
                None,
            ))
        });

    TtsVoicePreset {
        id: preset_id.unwrap_or_else(|| format!("tts-preset-{}", Uuid::new_v4())),
        label: fallback_tts_preset_label(
            &provider_id,
            &model_id,
            voice_id.as_deref(),
            voice_profile_id.as_deref(),
            voice_label_snapshot.as_deref(),
        ),
        provider_id,
        model_id,
        voice_id,
        voice_profile_id,
        voice_label_snapshot,
        locale_snapshot: None,
        tuning: TtsVoiceTuningSettings {
            tempo_rate: settings.tts_rate.clamp(0.5, 2.0),
            expressiveness: default_tts_expressiveness(),
            exaggeration: default_tts_exaggeration(),
            randomness: default_tts_randomness(),
            guidance: default_tts_guidance(),
            stability: default_tts_stability(),
            repetition_penalty: default_tts_repetition_penalty(),
            style_instructions: None,
        },
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
                    if let std::collections::hash_map::Entry::Vacant(entry) =
                        settings.bindings.entry(key.clone())
                    {
                        debug!("Adding missing binding: {}", key);
                        entry.insert(value);
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
    let post_process_changed = ensure_post_process_defaults(&mut settings);
    let model_platform_changed = ensure_model_platform_defaults(&mut settings);
    let tts_changed = ensure_tts_defaults(&mut settings);

    if translation_changed || tts_changed || post_process_changed || model_platform_changed {
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
    let post_process_changed = ensure_post_process_defaults(&mut settings);
    let model_platform_changed = ensure_model_platform_defaults(&mut settings);
    let tts_changed = ensure_tts_defaults(&mut settings);

    if translation_changed || tts_changed || post_process_changed || model_platform_changed {
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
    fn default_settings_enable_global_language_sync() {
        let settings = get_default_settings();
        assert!(settings.global_language_sync_enabled);
    }

    #[test]
    fn default_settings_enable_audio_enhancement() {
        let settings = get_default_settings();
        assert!(settings.audio_enhancement_enabled);
        assert_eq!(settings.audio_enhancement_model, "rnnoise");
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
        assert!(settings.post_process_prompts[0].prompt.contains(
            "Optional extra instructions for Vox Jot's built-in dictation post-processor."
        ));
    }

    #[test]
    fn default_post_process_models_prefer_fast_presets() {
        let settings = get_default_settings();

        assert_eq!(
            settings
                .post_process_models
                .get(OLLAMA_PROVIDER_ID)
                .map(String::as_str),
            Some("qwen2.5:1.5b")
        );
        assert_eq!(
            settings.post_process_models.get("groq").map(String::as_str),
            Some("llama-3.1-8b-instant")
        );
        assert_eq!(
            settings
                .post_process_models
                .get("cerebras")
                .map(String::as_str),
            Some("llama-3.3-70b")
        );
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
        assert_eq!(settings.selected_stt_model_id, "");
        assert_eq!(settings.selected_stt_provider_id, "");
        assert_eq!(settings.selected_tts_provider_id, "");
        assert!(settings.selected_tts_model_id.is_none());
        assert!(settings.selected_tts_voice_id.is_none());
        assert_eq!(
            settings.selected_llm_provider_id,
            default_selected_llm_provider_id()
        );
        assert_eq!(
            settings.selected_llm_model_id,
            default_selected_llm_model_id()
        );
        assert!(settings.bindings.contains_key("speak_selection"));
        assert!(settings.bindings.contains_key("speak_last_output"));
        assert!(settings.bindings.contains_key("stop_speaking"));
    }

    #[test]
    fn legacy_tts_preset_style_deserializes_into_normalized_tuning() {
        let preset: TtsVoicePreset = serde_json::from_value(serde_json::json!({
            "id": "preset-1",
            "label": "Legacy Preset",
            "provider_id": "chatterbox",
            "model_id": "chatterbox",
            "style": {
                "expressiveness": 0.62,
                "rate": 1.35,
                "advanced_overrides": {
                    "cfg_weight": { "kind": "number", "value": 0.81 },
                    "temperature": { "kind": "number", "value": 0.44 },
                    "repetition_penalty": { "kind": "number", "value": 1.9 },
                    "style_instructions": { "kind": "text", "value": "  cinematic  " }
                }
            }
        }))
        .expect("legacy preset should deserialize");

        assert_eq!(preset.tuning.tempo_rate, 1.35);
        assert_eq!(preset.tuning.expressiveness, 0.62);
        assert_eq!(preset.tuning.guidance, 0.81);
        assert_eq!(preset.tuning.randomness, 0.44);
        assert_eq!(preset.tuning.repetition_penalty, 1.9);
        assert_eq!(
            preset.tuning.style_instructions.as_deref(),
            Some("cinematic")
        );
    }

    #[test]
    fn explicit_active_tts_preset_does_not_fall_back_to_first_preset() {
        let mut settings = get_default_settings();
        let default_tuning = TtsVoiceTuningSettings {
            tempo_rate: settings.tts_rate.clamp(0.5, 2.0),
            expressiveness: default_tts_expressiveness(),
            exaggeration: default_tts_exaggeration(),
            randomness: default_tts_randomness(),
            guidance: default_tts_guidance(),
            stability: default_tts_stability(),
            repetition_penalty: default_tts_repetition_penalty(),
            style_instructions: None,
        };
        settings.tts_voice_presets = vec![
            TtsVoicePreset {
                id: "preset-1".to_string(),
                label: "Preset One".to_string(),
                provider_id: "mlx_ming_omni".to_string(),
                model_id: "mlx-community/Ming-Omni-0.5B-bf16".to_string(),
                voice_id: None,
                voice_profile_id: None,
                voice_label_snapshot: None,
                locale_snapshot: None,
                tuning: default_tuning.clone(),
            },
            TtsVoicePreset {
                id: "preset-2".to_string(),
                label: "Preset Two".to_string(),
                provider_id: "mlx_kokoro".to_string(),
                model_id: "kokoro-82m".to_string(),
                voice_id: None,
                voice_profile_id: None,
                voice_label_snapshot: None,
                locale_snapshot: None,
                tuning: default_tuning,
            },
        ];

        assert_eq!(
            settings
                .active_tts_preset()
                .expect("fallback preset should exist")
                .id,
            "preset-1"
        );
        assert!(settings.explicit_active_tts_preset().is_none());

        settings.tts_active_preset_id = Some("preset-2".to_string());

        assert_eq!(
            settings
                .explicit_active_tts_preset()
                .expect("explicit preset should resolve")
                .id,
            "preset-2"
        );
    }
}
