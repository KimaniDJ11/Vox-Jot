use crate::github_release;
use crate::model_platform::{
    CapabilityFlags, CatalogModelDescriptor, CatalogSourceKind, DomainCatalog, ModelDomain,
    ProviderDescriptor, RuntimeRequirement, TtsAdvancedControlDescriptor, TtsAdvancedControlKind,
    TtsControlGroup, TtsDeliverySupport, TtsExpressivenessMode,
};
use crate::settings::{
    default_tts_model_store_dir, get_settings, is_local_base_url,
    sanitize_tts_voice_tuning_for_target, AppSettings, TtsAutoReadbackMode, TtsAutoReadbackScope,
    TtsEnginePreference, TtsReadbackTextMode, TtsStyleControlValue, TtsVoicePreset,
    TtsVoiceTuningSettings, TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID, TTS_MODEL_SYSTEM_DEFAULT_ID,
    TTS_PROVIDER_CHATTERBOX_ID, TTS_PROVIDER_HF_S2S_LOCAL_ID, TTS_PROVIDER_KOKORO_ID,
    TTS_PROVIDER_LOCAL_SIDECAR_API_ID, TTS_PROVIDER_MLX_BARK_ID, TTS_PROVIDER_MLX_CHATTERBOX_ID,
    TTS_PROVIDER_MLX_CSM_ID, TTS_PROVIDER_MLX_DIA_ID, TTS_PROVIDER_MLX_FISH_AUDIO_ID,
    TTS_PROVIDER_MLX_KOKORO_ID, TTS_PROVIDER_MLX_KUGEL_ID, TTS_PROVIDER_MLX_LFM_AUDIO_ID,
    TTS_PROVIDER_MLX_MING_OMNI_ID, TTS_PROVIDER_MLX_OUTE_ID, TTS_PROVIDER_MLX_POCKET_TTS_ID,
    TTS_PROVIDER_MLX_QWEN3TTS_ID, TTS_PROVIDER_MLX_SPARK_ID, TTS_PROVIDER_MLX_VOXCPM_ID,
    TTS_PROVIDER_MLX_VOXTRAL_TTS_ID, TTS_PROVIDER_OPENVOICE_ID, TTS_PROVIDER_QWEN3_NATIVE_ID,
    TTS_PROVIDER_SHERPA_PACK_ID, TTS_PROVIDER_SYSTEM_BUILTIN_ID, TTS_PROVIDER_TADA_LOCAL_ID,
    TTS_PROVIDER_XTTS_ID,
};
use crate::sidecar::SidecarBackend;
use crate::translation::TranslationOrigin;
use crate::tts_profiles::{self, ResolvedTtsVoiceProfile};
use crate::{audio_playback, portable};
use log::{info, warn};
use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

static SAY_VOICE_RE: once_cell::sync::Lazy<Regex> = once_cell::sync::Lazy::new(|| {
    Regex::new(r"^(?P<name>.+?)\s{2,}(?P<locale>[A-Za-z_]+)\s+#").expect("valid say voice regex")
});

const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:8008/v1/audio/speech";
const PREVIEW_SAMPLE_TEXT: &str = "Vox Jot is ready.";
const PACK_MANIFEST_NAME: &str = "vox_jot_tts_manifest.json";
const DEFAULT_TTS_ASSET_BASE_URL: &str =
    "https://github.com/KimaniDJ11/Vox-Jot/releases/download/v0.3.0-tts-models";
const RUNTIME_TTS_REQUEST_TIMEOUT_SECS: u64 = 180;
const HIDDEN_RUNTIME_MODEL_IDS: &[&str] = &[];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsEngineKind {
    System,
    SherpaOnnx,
    Sidecar,
    MlxNative,
    Qwen3Native,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VoiceInfo {
    pub id: String,
    pub label: String,
    pub locale: Option<String>,
    pub engine: TtsEngineKind,
    pub installed: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TtsPackInfo {
    pub id: String,
    pub label: String,
    pub locale: String,
    pub voice_id: String,
    pub archive_name: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeListenProviderCatalogEntry {
    id: String,
    label: String,
    description: String,
    source_label: String,
    provider: RuntimeListenProviderDefinition,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeListenProviderDefinition {
    id: String,
    label: String,
    engine_family: String,
    supported_platforms: Vec<String>,
    license_label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeStyleControlOption {
    value: String,
    label: String,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeStyleControl {
    id: String,
    #[serde(default)]
    group: Option<String>,
    label: String,
    description: Option<String>,
    kind: String,
    min: Option<f64>,
    max: Option<f64>,
    step: Option<f64>,
    unit: Option<String>,
    options: Option<Vec<RuntimeStyleControlOption>>,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeListenModelCatalogEntry {
    id: String,
    provider_id: String,
    label: String,
    description: String,
    source_label: String,
    capabilities: RuntimeListenCapabilities,
    readiness: RuntimeListenReadiness,
    supported_languages: Vec<String>,
    #[serde(default)]
    style_controls: Vec<RuntimeStyleControl>,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeListenCapabilities {
    supports_basic_tts: bool,
    supports_voice_cloning: bool,
    supports_instruction_prompt: bool,
    supports_streaming: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeListenReadiness {
    status: String,
    runtime_label: String,
    issues: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeListenSelection {
    selected_provider_id: Option<String>,
    selected_model_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeListenCatalogResponse {
    providers: Vec<RuntimeListenProviderCatalogEntry>,
    models: Vec<RuntimeListenModelCatalogEntry>,
    selection: RuntimeListenSelection,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeListenVoiceEntry {
    id: String,
    label: String,
    locale: Option<String>,
    installed: bool,
    available: bool,
}

#[derive(Debug, Clone)]
struct RuntimeListenState {
    providers: Vec<RuntimeListenProviderCatalogEntry>,
    models: Vec<RuntimeListenModelCatalogEntry>,
    selection: Option<RuntimeListenSelection>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SherpaModelFamily {
    Vits,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SherpaPackManifest {
    id: String,
    label: String,
    locale: String,
    source_url: String,
    source_name: String,
    model_family: SherpaModelFamily,
    model_file: String,
    tokens_file: String,
    data_dir: Option<String>,
    lexicon_file: Option<String>,
    rule_fsts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SpeakRequest {
    pub text: String,
    pub locale: Option<String>,
    pub preferred_voice_id: Option<String>,
    pub preset_id: Option<String>,
    pub inline_preset: Option<TtsVoicePreset>,
    pub trigger: Option<String>,
    pub remember_last_output: bool,
}

#[derive(Debug, Clone, Default)]
pub struct TtsHistoryContext {
    pub tts_requested: Option<bool>,
    pub tts_engine: Option<String>,
    pub tts_voice_id: Option<String>,
    pub tts_locale: Option<String>,
    pub tts_trigger: Option<String>,
    pub tts_status: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TtsAutoSpeakPlan {
    pub should_speak: bool,
    pub text: String,
    pub locale: Option<String>,
    pub trigger: String,
    pub tts_requested: bool,
    pub tts_engine: Option<String>,
    pub tts_voice_id: Option<String>,
    pub tts_locale: Option<String>,
    pub tts_status: Option<String>,
}

#[derive(Debug, Clone)]
struct LastOutput {
    text: String,
    locale: Option<String>,
}

#[derive(Debug, Clone)]
struct PackDefinition {
    id: &'static str,
    label: &'static str,
    locale: &'static str,
    voice_id: &'static str,
    archive_name: &'static str,
    source_name: &'static str,
    source_url: &'static str,
    model_family: SherpaModelFamily,
    model_file: &'static str,
    tokens_file: &'static str,
    data_dir: Option<&'static str>,
    lexicon_file: Option<&'static str>,
    rule_fsts: &'static [&'static str],
}

struct Qwen3Context {
    runtime_root: PathBuf,
    model_root: PathBuf,
    clone_profile: Option<Qwen3CloneProfile>,
    language: String,
}

struct MlxAudioContext {
    provider_id: String,
    model_id: String,
    model_label: String,
    python_path: PathBuf,
    bridge_script_path: PathBuf,
    model_source: String,
    clone_profile: Option<MlxAudioCloneProfile>,
    language: String,
    supports_instruction_prompt: bool,
}

#[derive(Debug, Clone)]
struct Qwen3CloneProfile {
    reference_audio_path: PathBuf,
    transcript: Option<String>,
}

#[derive(Debug, Clone)]
struct MlxAudioCloneProfile {
    reference_audio_path: PathBuf,
    transcript: Option<String>,
}

#[derive(Debug, Clone)]
struct Qwen3PackDefinition {
    id: &'static str,
    label: &'static str,
    locale: &'static str,
    /// HuggingFace repo ID for models too large for GitHub release assets (>2 GB).
    /// When set, the installer downloads individual files from HuggingFace as a
    /// fallback when the GitHub release archive is unavailable.
    hf_repo_id: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
struct Qwen3PackFeatures {
    description: &'static str,
    supports_voice_cloning: bool,
    supports_instruction_prompt: bool,
}

const QWEN3_PACK_DEFINITIONS: &[Qwen3PackDefinition] = &[
    Qwen3PackDefinition {
        id: "qwen3-0.6b-base",
        label: "Qwen3 0.6B Base",
        locale: "mul",
        hf_repo_id: None,
    },
    Qwen3PackDefinition {
        id: "qwen3-0.6b-customvoice",
        label: "Qwen3 0.6B CustomVoice",
        locale: "mul",
        hf_repo_id: None,
    },
    Qwen3PackDefinition {
        id: "qwen3-1.7b-customvoice",
        label: "Qwen3 1.7B CustomVoice",
        locale: "mul",
        hf_repo_id: Some("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"),
    },
];

const PACK_DEFINITIONS: &[PackDefinition] = &[
    PackDefinition {
        id: "tts-sherpa-en-us-lessac-medium",
        label: "English (US) - Lessac",
        locale: "en-US",
        voice_id: "lessac-medium",
        archive_name: "tts-sherpa-en-us-lessac-medium.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "en_US-lessac-medium.onnx",
        tokens_file: "tokens.txt",
        data_dir: Some("espeak-ng-data"),
        lexicon_file: None,
        rule_fsts: &[],
    },
    PackDefinition {
        id: "tts-sherpa-zh-cn-melo",
        label: "Chinese + English - Melo",
        locale: "zh-CN",
        voice_id: "melo-zh-en",
        archive_name: "tts-sherpa-zh-cn-melo.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "model.onnx",
        tokens_file: "tokens.txt",
        data_dir: None,
        lexicon_file: Some("lexicon.txt"),
        rule_fsts: &["date.fst", "number.fst", "phone.fst", "new_heteronym.fst"],
    },
];

#[derive(Debug, Clone)]
struct SherpaRuntimeDefinition {
    platform_id: &'static str,
    archive_name: &'static str,
    source_url: &'static str,
}

#[derive(Debug, Clone)]
struct SherpaContext {
    runtime_root: PathBuf,
    pack_root: PathBuf,
    manifest: SherpaPackManifest,
}

#[derive(Debug, Clone)]
struct ManagedSpeechRuntimeDefinition {
    platform_id: &'static str,
    archive_name: &'static str,
}

#[derive(Debug, Clone)]
struct ManagedRuntimeModelDefinition {
    provider_id: &'static str,
    model_id: &'static str,
    label: &'static str,
    description: &'static str,
    archive_name: &'static str,
    install_subdir: &'static str,
    source_repo_dir: Option<&'static str>,
    engine_family: &'static str,
    license_label: Option<&'static str>,
    locale: Option<&'static str>,
    supported_languages: &'static [&'static str],
    supports_voice_cloning: bool,
    supports_instruction_prompt: bool,
    /// HuggingFace repo ID for models too large for GitHub release assets (>2 GB).
    hf_repo_id: Option<&'static str>,
}

const MANAGED_RUNTIME_MODEL_DEFINITIONS: &[ManagedRuntimeModelDefinition] = &[
    ManagedRuntimeModelDefinition {
        provider_id: TTS_PROVIDER_OPENVOICE_ID,
        model_id: "openvoice",
        label: "OpenVoice",
        description: "Flexible local voice cloning and multilingual speech generation.",
        archive_name: "tts-openvoice.tar.gz",
        install_subdir: "OpenVoice",
        source_repo_dir: Some("OpenVoice"),
        engine_family: "openvoice",
        license_label: Some("MIT"),
        locale: Some("mul"),
        supported_languages: &["en", "es", "fr", "zh", "ja", "ko"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
        hf_repo_id: None,
    },
    ManagedRuntimeModelDefinition {
        provider_id: TTS_PROVIDER_CHATTERBOX_ID,
        model_id: "chatterbox",
        label: "Chatterbox",
        description: "Expressive local neural voice model with conditioning controls.",
        archive_name: "tts-chatterbox.tar.gz",
        install_subdir: "chatterbox",
        source_repo_dir: Some("chatterbox"),
        engine_family: "chatterbox",
        license_label: Some("Apache-2.0"),
        locale: Some("en"),
        supported_languages: &["en"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
        hf_repo_id: Some("ResembleAI/chatterbox"),
    },
    ManagedRuntimeModelDefinition {
        provider_id: TTS_PROVIDER_KOKORO_ID,
        model_id: "kokoro-82m-v1.0",
        label: "Kokoro 82M",
        description: "Fast local speech model tuned for lightweight high-quality playback.",
        archive_name: "tts-kokoro-82m-v1.0.tar.gz",
        install_subdir: "Kokoro",
        source_repo_dir: Some("kokoro"),
        engine_family: "kokoro",
        license_label: Some("Apache-2.0"),
        locale: Some("mul"),
        supported_languages: &["en", "es", "fr", "hi", "it", "pt", "ja", "zh"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
        hf_repo_id: None,
    },
    ManagedRuntimeModelDefinition {
        provider_id: TTS_PROVIDER_XTTS_ID,
        model_id: "xtts-v2",
        label: "XTTS v2",
        description: "Coqui XTTS multilingual local synthesis with voice cloning.",
        archive_name: "tts-xtts-v2.tar.gz",
        install_subdir: "Coqui/XTTS",
        source_repo_dir: Some("coqui-tts"),
        engine_family: "xtts",
        license_label: Some("Coqui Public Model License"),
        locale: Some("mul"),
        supported_languages: &[
            "en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "hu",
            "ko", "ja", "hi",
        ],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
        hf_repo_id: Some("coqui/XTTS-v2"),
    },
];

#[derive(Debug, Clone)]
struct MlxAudioTtsModelDefinition {
    provider_id: &'static str,
    provider_label: &'static str,
    provider_description: &'static str,
    model_id: &'static str,
    hf_model_id: &'static str,
    local_dir_names: &'static [&'static str],
    label: &'static str,
    description: &'static str,
    engine_family: &'static str,
    license_label: Option<&'static str>,
    supported_languages: &'static [&'static str],
    supports_voice_cloning: bool,
    supports_instruction_prompt: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct VoiceProfileCompatibility {
    pub provider_ids: Vec<String>,
    pub model_ids: Vec<String>,
}

const MLX_AUDIO_TTS_MODEL_DEFINITIONS: &[MlxAudioTtsModelDefinition] = &[
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_KOKORO_ID,
        provider_label: "MLX Kokoro",
        provider_description: "Metal-accelerated Kokoro synthesis through mlx-audio.",
        model_id: "kokoro-82m",
        hf_model_id: "mlx-community/Kokoro-82M-bf16",
        local_dir_names: &["Kokoro-82M-bf16"],
        label: "Kokoro 82M",
        description: "Fast, lightweight multilingual TTS on Apple Silicon.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en", "ja", "zh", "fr", "es", "it", "pt", "hi"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_CHATTERBOX_ID,
        provider_label: "MLX Chatterbox",
        provider_description: "Expressive Chatterbox voices routed through mlx-audio.",
        model_id: "chatterbox",
        hf_model_id: "mlx-community/chatterbox-fp16",
        local_dir_names: &["Chatterbox-fp16"],
        label: "Chatterbox",
        description: "Expressive multilingual TTS with preset voice styles.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &[
            "en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh", "ja",
            "hu", "ko",
        ],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_QWEN3TTS_ID,
        provider_label: "MLX Qwen3 TTS",
        provider_description: "Qwen3 voice design and multilingual synthesis via mlx-audio.",
        model_id: "qwen3-tts-0.6b",
        hf_model_id: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
        local_dir_names: &["Qwen3-TTS-0.6B-Base-bf16"],
        label: "Qwen3 TTS 0.6B",
        description: "Smaller Qwen3 TTS model for multilingual synthesis and cloning.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["zh", "en", "ja", "ko", "mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_QWEN3TTS_ID,
        provider_label: "MLX Qwen3 TTS",
        provider_description: "Qwen3 voice design and multilingual synthesis via mlx-audio.",
        model_id: "qwen3-tts-0.6b-4bit",
        hf_model_id: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        local_dir_names: &["Qwen3-TTS-12Hz-0.6B-Base-4bit"],
        label: "Qwen3 TTS 0.6B 4-bit",
        description: "Smaller quantized Qwen3 TTS model for local multilingual synthesis.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["zh", "en", "ja", "ko", "mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_QWEN3TTS_ID,
        provider_label: "MLX Qwen3 TTS",
        provider_description: "Qwen3 voice design and multilingual synthesis via mlx-audio.",
        model_id: "qwen3-tts-1.7b",
        hf_model_id: "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16",
        local_dir_names: &["Qwen3-TTS-1.7B-VoiceDesign-bf16"],
        label: "Qwen3 TTS 1.7B",
        description: "Larger Qwen3 TTS model with richer voice design controls.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["zh", "en", "ja", "ko", "mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_QWEN3TTS_ID,
        provider_label: "MLX Qwen3 TTS",
        provider_description: "Qwen3 voice design and multilingual synthesis via mlx-audio.",
        model_id: "qwen3-tts-1.7b-base",
        hf_model_id: "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
        local_dir_names: &["Qwen3-TTS-12Hz-1.7B-Base-bf16"],
        label: "Qwen3 TTS 1.7B Base",
        description: "Larger base Qwen3 TTS checkpoint for multilingual synthesis and cloning.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["zh", "en", "ja", "ko", "mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_DIA_ID,
        provider_label: "MLX Dia",
        provider_description: "Dialogue-focused Dia voices running through mlx-audio.",
        model_id: "dia-1.6b",
        hf_model_id: "mlx-community/Dia-1.6B-fp16",
        local_dir_names: &["Dia-1.6B-fp16"],
        label: "Dia 1.6B",
        description: "Dialogue-focused English TTS with multi-speaker support.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_CSM_ID,
        provider_label: "MLX CSM",
        provider_description: "Sesame CSM voice cloning through mlx-audio.",
        model_id: "csm-1b",
        hf_model_id: "mlx-community/csm-1b",
        local_dir_names: &["CSM-1B"],
        label: "CSM 1B",
        description: "Conversational speech model with reference-audio cloning.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_SPARK_ID,
        provider_label: "MLX Spark",
        provider_description: "Spark-TTS served from the shared mlx-audio runtime.",
        model_id: "spark-tts-0.5b",
        hf_model_id: "mlx-community/Spark-TTS-0.5B-bf16",
        local_dir_names: &["Spark-TTS-0.5B-bf16"],
        label: "Spark TTS 0.5B",
        description: "Efficient bilingual Spark TTS model for English and Chinese.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en", "zh"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_OUTE_ID,
        provider_label: "MLX OuteTTS",
        provider_description: "Compact OuteTTS synthesis via mlx-audio.",
        model_id: "outetts-0.6b",
        hf_model_id: "mlx-community/OuteTTS-1.0-0.6B-fp16",
        local_dir_names: &["OuteTTS-1.0-0.6B-fp16"],
        label: "OuteTTS 0.6B",
        description: "Compact English TTS model with fast inference.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_MING_OMNI_ID,
        provider_label: "MLX Ming Omni",
        provider_description: "Ming Omni synthesis with style controls via mlx-audio.",
        model_id: "ming-omni-0.5b",
        hf_model_id: "mlx-community/Ming-omni-tts-0.5B-bf16",
        local_dir_names: &["Ming-omni-tts-0.5B-4bit", "Ming-omni-tts-0.5B-bf16"],
        label: "Ming Omni 0.5B",
        description: "Dense Ming Omni TTS with voice cloning and style control.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en", "zh"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_KUGEL_ID,
        provider_label: "MLX KugelAudio",
        provider_description: "European-language KugelAudio voices through mlx-audio.",
        model_id: "kugel-audio-7b",
        hf_model_id: "kugelaudio/kugelaudio-0-open",
        local_dir_names: &["kugelaudio-0-open"],
        label: "KugelAudio 7B",
        description: "High-quality European-language TTS with a default voice.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &[
            "en", "de", "fr", "es", "it", "pt", "nl", "pl", "ru", "uk", "cs", "ro", "hu", "sv",
            "da", "fi", "no", "el", "bg", "sk", "hr", "sr", "tr",
        ],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_BARK_ID,
        provider_label: "MLX Bark",
        provider_description: "Suno Bark voices running through mlx-audio.",
        model_id: "bark-small",
        hf_model_id: "mlx-community/bark-small",
        local_dir_names: &["bark-small"],
        label: "Bark Small",
        description: "Compact Bark checkpoint for expressive local speech generation.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["mul"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_FISH_AUDIO_ID,
        provider_label: "MLX Fish Audio",
        provider_description: "Fish Audio S2 synthesis and cloning through mlx-audio.",
        model_id: "fish-audio-s2-pro",
        hf_model_id: "mlx-community/fish-audio-s2-pro-bf16",
        local_dir_names: &["fish-audio-s2-pro-bf16"],
        label: "Fish Audio S2 Pro",
        description: "Multilingual Fish Audio checkpoint with reference-audio voice cloning.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_LFM_AUDIO_ID,
        provider_label: "MLX LFM Audio",
        provider_description: "Liquid LFM Audio speech generation through a custom MLX bridge.",
        model_id: "lfm2-5-audio-1-5b",
        hf_model_id: "mlx-community/LFM2.5-Audio-1.5B-bf16",
        local_dir_names: &["LFM2.5-Audio-1.5B-bf16"],
        label: "LFM2.5 Audio 1.5B",
        description: "Unified Liquid audio model wired for local text-to-speech previews.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en"],
        supports_voice_cloning: false,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_POCKET_TTS_ID,
        provider_label: "MLX Pocket TTS",
        provider_description: "Pocket TTS voices and cloning through mlx-audio.",
        model_id: "pocket-tts",
        hf_model_id: "mlx-community/pocket-tts",
        local_dir_names: &["pocket-tts"],
        label: "Pocket TTS",
        description:
            "Reference-audio driven Pocket TTS checkpoint with bundled speaker embeddings.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_VOXCPM_ID,
        provider_label: "MLX VoxCPM2",
        provider_description:
            "VoxCPM2 voice cloning and voice design through a patched MLX bridge.",
        model_id: "voxcpm2-4bit",
        hf_model_id: "mlx-community/VoxCPM2-4bit",
        local_dir_names: &["VoxCPM2-4bit"],
        label: "VoxCPM2 4-bit",
        description: "Quantized multilingual VoxCPM2 with local voice design and cloning support.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en", "zh", "id", "ja", "ko", "mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_POCKET_TTS_ID,
        provider_label: "MLX Pocket TTS",
        provider_description: "Pocket TTS voices and cloning through mlx-audio.",
        model_id: "pocket-tts-4bit",
        hf_model_id: "mlx-community/pocket-tts-4bit",
        local_dir_names: &["pocket-tts-4bit"],
        label: "Pocket TTS 4-bit",
        description: "Quantized Pocket TTS checkpoint for lighter-weight local generation.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_POCKET_TTS_ID,
        provider_label: "MLX Pocket TTS",
        provider_description: "Pocket TTS voices and cloning through mlx-audio.",
        model_id: "pocket-tts-8bit",
        hf_model_id: "mlx-community/pocket-tts-8bit",
        local_dir_names: &["pocket-tts-8bit"],
        label: "Pocket TTS 8-bit",
        description: "8-bit Pocket TTS checkpoint for faster local synthesis.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_VOXTRAL_TTS_ID,
        provider_label: "MLX Voxtral TTS",
        provider_description: "Voxtral multilingual TTS exposed through mlx-audio.",
        model_id: "voxtral-tts-4b",
        hf_model_id: "mlx-community/Voxtral-4B-TTS-2603-mlx-bf16",
        local_dir_names: &["Voxtral-TTS-4B-MLX-6bit", "Voxtral-4B-TTS-2603-mlx-bf16"],
        label: "Voxtral TTS 4B",
        description: "Multilingual Mistral TTS with preset voices across nine languages.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en", "fr", "es", "de", "it", "pt", "nl", "ar", "hi"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
];

fn provider_uses_managed_speech_runtime(provider_id: &str) -> bool {
    matches!(
        provider_id,
        TTS_PROVIDER_OPENVOICE_ID
            | TTS_PROVIDER_CHATTERBOX_ID
            | TTS_PROVIDER_KOKORO_ID
            | TTS_PROVIDER_XTTS_ID
    )
}

fn provider_is_mlx_audio(provider_id: &str) -> bool {
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
            | TTS_PROVIDER_MLX_BARK_ID
            | TTS_PROVIDER_MLX_FISH_AUDIO_ID
            | TTS_PROVIDER_MLX_LFM_AUDIO_ID
            | TTS_PROVIDER_MLX_POCKET_TTS_ID
            | TTS_PROVIDER_MLX_VOXCPM_ID
            | TTS_PROVIDER_MLX_VOXTRAL_TTS_ID
    )
}

fn mlx_audio_runtime_supported() -> bool {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        true
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        false
    }
}

fn mlx_audio_tts_model_definition(model_id: &str) -> Option<&'static MlxAudioTtsModelDefinition> {
    MLX_AUDIO_TTS_MODEL_DEFINITIONS
        .iter()
        .find(|definition| definition.model_id == model_id)
}

fn mlx_audio_model_unavailable_reason(model_id: &str) -> Option<&'static str> {
    match model_id {
        "outetts-0.6b" => Some(
            "OuteTTS 0.6B is temporarily disabled because the current mlx-audio runtime does not generate usable audio for this checkpoint.",
        ),
        _ => None,
    }
}

fn mlx_audio_definition_available(definition: &MlxAudioTtsModelDefinition) -> bool {
    mlx_audio_model_unavailable_reason(definition.model_id).is_none()
}

fn ensure_mlx_audio_definition_available(
    definition: &MlxAudioTtsModelDefinition,
) -> Result<(), String> {
    match mlx_audio_model_unavailable_reason(definition.model_id) {
        Some(reason) => Err(reason.to_string()),
        None => Ok(()),
    }
}

fn first_mlx_audio_model_for_provider(
    provider_id: &str,
) -> Option<&'static MlxAudioTtsModelDefinition> {
    MLX_AUDIO_TTS_MODEL_DEFINITIONS.iter().find(|definition| {
        definition.provider_id == provider_id && mlx_audio_definition_available(definition)
    })
}

pub(crate) fn supported_voice_profile_compatibility() -> VoiceProfileCompatibility {
    let mut provider_ids =
        std::collections::BTreeSet::from([TTS_PROVIDER_QWEN3_NATIVE_ID.to_string()]);
    let mut model_ids = std::collections::BTreeSet::from(["qwen3-0.6b-base".to_string()]);

    for definition in MANAGED_RUNTIME_MODEL_DEFINITIONS
        .iter()
        .filter(|definition| definition.supports_voice_cloning)
    {
        provider_ids.insert(definition.provider_id.to_string());
        model_ids.insert(definition.model_id.to_string());
    }

    for definition in MLX_AUDIO_TTS_MODEL_DEFINITIONS
        .iter()
        .filter(|definition| mlx_audio_definition_available(definition))
        .filter(|definition| definition.supports_voice_cloning)
    {
        provider_ids.insert(definition.provider_id.to_string());
        model_ids.insert(definition.model_id.to_string());
    }

    VoiceProfileCompatibility {
        provider_ids: provider_ids.into_iter().collect(),
        model_ids: model_ids.into_iter().collect(),
    }
}

fn mlx_voice_locale(voice_id: &str) -> Option<&'static str> {
    match voice_id.split('_').next().unwrap_or_default() {
        "af" | "am" => Some("en-US"),
        "bf" | "bm" => Some("en-GB"),
        "ef" | "em" => Some("es"),
        "ff" | "fm" => Some("fr-FR"),
        "hf" | "hm" => Some("hi"),
        "if" | "im" => Some("it"),
        "jf" | "jm" => Some("ja-JP"),
        "pf" | "pm" => Some("pt-BR"),
        "zf" | "zm" => Some("zh-CN"),
        _ => None,
    }
}

fn mlx_voice_label(voice_id: &str) -> String {
    voice_id
        .split_once('_')
        .map(|(_, name)| name)
        .unwrap_or(voice_id)
        .split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn mlx_voice_locale_for_provider(provider_id: &str, voice_id: &str) -> Option<String> {
    if provider_id == TTS_PROVIDER_MLX_KOKORO_ID {
        return mlx_voice_locale(voice_id).map(str::to_string);
    }

    if provider_id == TTS_PROVIDER_MLX_VOXTRAL_TTS_ID {
        let prefix = voice_id.split('_').next().unwrap_or_default();
        let locale = match prefix {
            "fr" => Some("fr-FR"),
            "es" => Some("es"),
            "de" => Some("de"),
            "it" => Some("it"),
            "pt" => Some("pt-BR"),
            "nl" => Some("nl"),
            "ar" => Some("ar"),
            "hi" => Some("hi"),
            // Style voices in Voxtral's embedding set are English presets.
            "casual" | "cheerful" | "neutral" => Some("en"),
            _ => None,
        };
        return locale.map(str::to_string);
    }

    None
}

pub struct TtsManager {
    app_handle: AppHandle,
    current_stop_flag: Mutex<Option<Arc<AtomicBool>>>,
    last_output: Mutex<Option<LastOutput>>,
    cached_system_voices: Mutex<Option<Vec<VoiceInfo>>>,
}

impl TtsManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        let manager = Self {
            app_handle: app_handle.clone(),
            current_stop_flag: Mutex::new(None),
            last_output: Mutex::new(None),
            cached_system_voices: Mutex::new(None),
        };

        if let Err(err) = migrate_legacy_tts_model_layout(app_handle) {
            warn!("Failed to migrate legacy TTS assets: {err}");
        }

        manager
    }

    fn qwen3_pack_features(&self, definition: &Qwen3PackDefinition) -> Qwen3PackFeatures {
        match definition.id {
            "qwen3-0.6b-base" => Qwen3PackFeatures {
                description: "Voice cloning from reference audio.",
                supports_voice_cloning: true,
                supports_instruction_prompt: false,
            },
            "qwen3-0.6b-customvoice" => Qwen3PackFeatures {
                description: "Preset voices with local native runtime.",
                supports_voice_cloning: false,
                supports_instruction_prompt: false,
            },
            "qwen3-1.7b-customvoice" => Qwen3PackFeatures {
                description: "Preset voices plus expressive instruction control.",
                supports_voice_cloning: false,
                supports_instruction_prompt: true,
            },
            _ => Qwen3PackFeatures {
                description: "Qwen3 Native text-to-speech engine model.",
                supports_voice_cloning: false,
                supports_instruction_prompt: false,
            },
        }
    }

    fn qwen3_pack_archive_name(&self, definition: &Qwen3PackDefinition) -> String {
        format!("{}.tar.gz", definition.id)
    }

    fn tts_model_store_root(&self) -> PathBuf {
        let configured = get_settings(&self.app_handle)
            .tts_model_store_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(PathBuf::from);

        if let Some(path) = configured {
            if legacy_dev_tts_store_dir()
                .as_ref()
                .is_some_and(|legacy| legacy == &path)
            {
                return default_tts_model_store_dir(&self.app_handle);
            }

            return path;
        }

        default_tts_model_store_dir(&self.app_handle)
    }

    fn mlx_audio_model_candidate_paths(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        let configured_store = self.tts_model_store_root();
        let (hf_repo_namespace, hf_repo_basename) = definition
            .hf_model_id
            .rsplit_once('/')
            .map(|(namespace, basename)| (Some(namespace), basename))
            .unwrap_or((None, definition.model_id));

        for store in [configured_store.clone(), configured_store.join("MLX")] {
            candidates.push(store.join(definition.model_id));
            candidates.push(store.join(hf_repo_basename));
            for dir_name in definition.local_dir_names {
                candidates.push(store.join(dir_name));
            }
            if let Some(namespace) = hf_repo_namespace {
                candidates.push(store.join(namespace).join(hf_repo_basename));
                candidates.push(store.join(namespace).join(definition.model_id));
                for dir_name in definition.local_dir_names {
                    candidates.push(store.join(namespace).join(dir_name));
                }
            }
        }

        candidates
    }

    fn resolved_mlx_audio_model_root(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Option<PathBuf> {
        self.mlx_audio_model_candidate_paths(definition)
            .into_iter()
            .find_map(|candidate| {
                if !candidate.exists() {
                    return None;
                }

                if candidate.is_dir() && candidate.join("config.json").exists() {
                    return Some(candidate);
                }

                resolve_extracted_root(&candidate).and_then(|root| {
                    if root.join("config.json").exists() {
                        Some(root)
                    } else {
                        None
                    }
                })
            })
    }

    fn mlx_audio_model_install_dir(&self, definition: &MlxAudioTtsModelDefinition) -> PathBuf {
        let repo_basename = definition
            .hf_model_id
            .rsplit('/')
            .next()
            .unwrap_or(definition.model_id);
        let directory_name = definition
            .local_dir_names
            .first()
            .copied()
            .unwrap_or(repo_basename);
        self.tts_model_store_root().join("MLX").join(directory_name)
    }

    fn mlx_audio_model_installed(&self, definition: &MlxAudioTtsModelDefinition) -> bool {
        self.resolved_mlx_audio_model_root(definition).is_some()
    }

    fn ensure_mlx_audio_model_root(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Result<PathBuf, String> {
        self.resolved_mlx_audio_model_root(definition)
            .ok_or_else(|| {
                format!(
                    "{} is not installed yet. Download it from Speech Output settings first.",
                    definition.label
                )
            })
    }

    fn resolve_mlx_audio_model_source(&self, definition: &MlxAudioTtsModelDefinition) -> String {
        self.resolved_mlx_audio_model_root(definition)
            .unwrap_or_else(|| PathBuf::from(definition.hf_model_id))
            .to_string_lossy()
            .to_string()
    }

    fn settings_for_voice_selection(
        &self,
        provider_id: &str,
        model_id: Option<&str>,
    ) -> AppSettings {
        let mut settings = get_settings(&self.app_handle);
        settings.tts_active_preset_id = None;
        settings.selected_tts_provider_id = provider_id.to_string();
        settings.selected_tts_model_id = model_id.map(str::to_string);
        settings.selected_tts_voice_id = None;
        settings.selected_tts_profile_id = None;
        settings
    }

    fn mlx_audio_voice_inventory(&self, settings: &AppSettings) -> Vec<VoiceInfo> {
        let provider_id = self.selected_provider_id(settings);
        let definition = settings
            .explicit_active_tts_preset()
            .and_then(|preset| mlx_audio_tts_model_definition(&preset.model_id))
            .or_else(|| {
                settings
                    .selected_tts_model_id
                    .as_deref()
                    .and_then(mlx_audio_tts_model_definition)
            })
            .or_else(|| first_mlx_audio_model_for_provider(&provider_id));

        definition
            .map(|definition| self.mlx_audio_voice_inventory_for_definition(definition))
            .unwrap_or_default()
    }

    fn mlx_audio_voice_inventory_for_definition(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Vec<VoiceInfo> {
        let provider_id = definition.provider_id;
        let model_source = PathBuf::from(self.resolve_mlx_audio_model_source(definition));

        let voices = if provider_id == TTS_PROVIDER_MLX_KOKORO_ID {
            self.kokoro_voice_inventory(&model_source)
        } else {
            self.mlx_embedded_voice_inventory(&model_source)
        };

        if !voices.is_empty() {
            return voices
                .into_iter()
                .map(|mut voice| {
                    voice.locale = mlx_voice_locale_for_provider(provider_id, &voice.id);
                    voice
                })
                .collect();
        }

        self.mlx_config_voice_inventory(&model_source, provider_id)
    }

    fn kokoro_voice_inventory(&self, model_source: &Path) -> Vec<VoiceInfo> {
        let voices_dir = [
            model_source.join("checkpoints").join("voices"),
            model_source.join("voices"),
        ]
        .into_iter()
        .find(|candidate| candidate.is_dir());

        let Some(voices_dir) = voices_dir else {
            return Vec::new();
        };

        let Ok(entries) = fs::read_dir(&voices_dir) else {
            warn!(
                "Failed to enumerate Kokoro voices from {}",
                voices_dir.display()
            );
            return Vec::new();
        };

        let mut voices = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                let is_voice_file = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("pt"))
                    .unwrap_or(false);
                if !is_voice_file {
                    return None;
                }

                let voice_id = path.file_stem()?.to_str()?.to_string();
                Some(VoiceInfo {
                    label: mlx_voice_label(&voice_id),
                    locale: mlx_voice_locale(&voice_id).map(str::to_string),
                    id: voice_id,
                    engine: TtsEngineKind::MlxNative,
                    installed: true,
                    available: true,
                })
            })
            .collect::<Vec<_>>();

        voices.sort_by(|left, right| left.label.cmp(&right.label).then(left.id.cmp(&right.id)));
        voices
    }

    fn mlx_embedded_voice_inventory(&self, model_source: &Path) -> Vec<VoiceInfo> {
        let voices_dir = ["voice_embedding", "embeddings", "voices"]
            .into_iter()
            .map(|dir| model_source.join(dir))
            .find(|candidate| candidate.is_dir());
        let Some(voices_dir) = voices_dir else {
            return Vec::new();
        };

        let Ok(entries) = fs::read_dir(&voices_dir) else {
            warn!(
                "Failed to enumerate MLX embedded voices from {}",
                voices_dir.display()
            );
            return Vec::new();
        };

        let mut voices = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                let extension = path.extension().and_then(|ext| ext.to_str())?;
                let is_embedding_file = matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "safetensors" | "pt" | "bin"
                );
                if !is_embedding_file {
                    return None;
                }

                let voice_id = path.file_stem()?.to_str()?.to_string();
                Some(VoiceInfo {
                    label: mlx_voice_label(&voice_id),
                    locale: None,
                    id: voice_id,
                    engine: TtsEngineKind::MlxNative,
                    installed: true,
                    available: true,
                })
            })
            .collect::<Vec<_>>();

        voices.sort_by(|left, right| left.label.cmp(&right.label).then(left.id.cmp(&right.id)));
        voices
    }

    fn mlx_config_voice_inventory(&self, model_source: &Path, provider_id: &str) -> Vec<VoiceInfo> {
        let voice_ids = ["config.json", "params.json"]
            .into_iter()
            .filter_map(|filename| {
                let path = model_source.join(filename);
                let raw = fs::read_to_string(path).ok()?;
                let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
                value
                    .pointer("/multimodal/audio_tokenizer_args/voice")
                    .and_then(|voice_map| voice_map.as_object())
                    .map(|voice_map| voice_map.keys().cloned().collect::<Vec<_>>())
            })
            .flatten()
            .collect::<std::collections::BTreeSet<_>>();

        voice_ids
            .into_iter()
            .map(|voice_id| VoiceInfo {
                label: mlx_voice_label(&voice_id),
                locale: mlx_voice_locale_for_provider(provider_id, &voice_id),
                id: voice_id,
                engine: TtsEngineKind::MlxNative,
                installed: true,
                available: true,
            })
            .collect()
    }

    pub fn get_available_voices_for_selection(
        &self,
        provider_id: &str,
        model_id: Option<&str>,
    ) -> Result<Vec<VoiceInfo>, String> {
        if provider_is_mlx_audio(provider_id) {
            if let Some(definition) = model_id
                .and_then(mlx_audio_tts_model_definition)
                .or_else(|| first_mlx_audio_model_for_provider(provider_id))
            {
                ensure_mlx_audio_definition_available(definition)?;
            }
        }

        let settings = self.settings_for_voice_selection(provider_id, model_id);
        match self.resolve_engine_kind(&settings, None)? {
            TtsEngineKind::System => self.system_voices(),
            TtsEngineKind::SherpaOnnx => Ok(self.installed_pack_voices()),
            TtsEngineKind::MlxNative => Ok(self.mlx_audio_voice_inventory(&settings)),
            TtsEngineKind::Qwen3Native => Ok(self.installed_qwen3_voices()),
            TtsEngineKind::Sidecar => self.runtime_managed_voices(&settings),
        }
    }

    fn managed_runtime_model_definition(
        &self,
        model_id: &str,
    ) -> Option<&'static ManagedRuntimeModelDefinition> {
        MANAGED_RUNTIME_MODEL_DEFINITIONS
            .iter()
            .find(|definition| definition.model_id == model_id)
    }

    fn managed_runtime_model_install_dir(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> PathBuf {
        self.tts_model_store_root().join(definition.install_subdir)
    }

    fn managed_runtime_model_source_dir(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> Option<PathBuf> {
        let configured_store = self.tts_model_store_root();
        let source_repo_dir = definition.source_repo_dir?;
        let configured_path = configured_store.join(source_repo_dir);
        if configured_path.exists() {
            return Some(configured_path);
        }

        None
    }

    fn managed_runtime_model_installed(&self, definition: &ManagedRuntimeModelDefinition) -> bool {
        let install_dir = self.managed_runtime_model_install_dir(definition);
        let resolved = resolve_extracted_root(&install_dir).unwrap_or(install_dir);
        if resolved.exists()
            && resolved
                .read_dir()
                .map(|mut entries| entries.next().is_some())
                .unwrap_or(false)
        {
            return true;
        }

        self.managed_runtime_model_source_dir(definition)
            .and_then(|source_dir| {
                source_dir
                    .read_dir()
                    .ok()
                    .map(|mut entries| entries.next().is_some())
            })
            .unwrap_or(false)
    }

    fn managed_runtime_model_candidate_paths(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> Vec<PathBuf> {
        let mut candidates = Vec::new();

        for relative_path in [
            format!("resources/tts-runtime-models/{}", definition.archive_name),
            format!("resources/tts-runtime-models/{}", definition.model_id),
        ] {
            if let Ok(path) = portable::resolve_resource(&self.app_handle, &relative_path) {
                candidates.push(path);
            }
        }

        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(manifest_dir.clone());
        candidates.push(
            manifest_dir
                .join("resources")
                .join("tts-runtime-models")
                .join(definition.archive_name),
        );
        candidates.push(
            manifest_dir
                .join("resources")
                .join("tts-runtime-models")
                .join(definition.model_id),
        );
        candidates.push(repo_root.join(definition.archive_name));
        candidates.push(repo_root.join(definition.model_id));

        candidates
    }

    fn find_managed_runtime_model_source(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> Option<PathBuf> {
        self.managed_runtime_model_candidate_paths(definition)
            .into_iter()
            .find(|candidate| candidate.exists())
    }

    fn qwen3_pack_candidate_paths(&self, definition: &Qwen3PackDefinition) -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        let archive_name = self.qwen3_pack_archive_name(definition);

        for relative_path in [
            format!("resources/tts-packs/qwen3/{archive_name}"),
            format!("resources/tts-packs/qwen3/{}", definition.id),
            format!("resources/tts/qwen3/{archive_name}"),
            format!("resources/tts/qwen3/{}", definition.id),
        ] {
            if let Ok(path) = portable::resolve_resource(&self.app_handle, &relative_path) {
                candidates.push(path);
            }
        }

        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(manifest_dir.clone());
        candidates.push(
            manifest_dir
                .join("resources")
                .join("tts-packs")
                .join("qwen3")
                .join(&archive_name),
        );
        candidates.push(
            manifest_dir
                .join("resources")
                .join("tts-packs")
                .join("qwen3")
                .join(definition.id),
        );
        candidates.push(repo_root.join(&archive_name));
        candidates.push(repo_root.join(definition.id));

        let configured_store = self.tts_model_store_root();
        for central_store in [configured_store.join("qwen3"), configured_store] {
            candidates.push(central_store.join(&archive_name));
            candidates.push(central_store.join(definition.id));
        }

        candidates
    }

    fn find_qwen3_pack_source(&self, definition: &Qwen3PackDefinition) -> Option<PathBuf> {
        self.qwen3_pack_candidate_paths(definition)
            .into_iter()
            .find(|candidate| candidate.exists())
    }

    fn resolved_qwen3_pack_root(&self, definition: &Qwen3PackDefinition) -> Option<PathBuf> {
        if let Some(root) = resolve_extracted_root(&self.pack_install_dir(definition.id)) {
            return Some(root);
        }

        self.qwen3_pack_candidate_paths(definition)
            .into_iter()
            .find(|candidate| {
                candidate.is_dir()
                    && candidate.join("config.json").exists()
                    && candidate.join("speech_tokenizer").exists()
            })
    }

    fn install_local_pack_source(
        &self,
        source_path: &Path,
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        if source_path.is_dir() {
            if install_dir.exists() {
                fs::remove_dir_all(install_dir)
                    .map_err(|err| format!("Failed to clear archive destination: {err}"))?;
            }
            copy_directory_recursive(source_path, install_dir)
                .map_err(|err| format!("Failed to install {label}: {err}"))?;
            return Ok(());
        }

        if source_path.is_file() {
            return extract_archive(source_path, install_dir);
        }

        Err(format!(
            "{} source could not be found at {}",
            label,
            source_path.display()
        ))
    }

    async fn install_qwen3_pack(&self, definition: &Qwen3PackDefinition) -> Result<(), String> {
        let install_dir = self.pack_install_dir(definition.id);
        let label = format!("Qwen3 pack '{}'", definition.label);
        if let Some(source_path) = self.find_qwen3_pack_source(definition) {
            match self.install_local_pack_source(&source_path, &install_dir, &label) {
                Ok(()) => return Ok(()),
                Err(local_error) => {
                    info!("{label}: local source failed ({local_error}), trying remote download");
                }
            }
        }

        // Try GitHub release archive first, then fall back to HuggingFace if configured.
        let archive_name = self.qwen3_pack_archive_name(definition);
        let github_result = self
            .download_and_extract_archive(
                &[self.asset_download_url(&archive_name)],
                &install_dir,
                &label,
            )
            .await;

        match github_result {
            Ok(()) => Ok(()),
            Err(github_error) => {
                if let Some(hf_repo) = definition.hf_repo_id {
                    info!(
                        "{label}: GitHub download failed ({github_error}), falling back to HuggingFace ({hf_repo})"
                    );
                    self.download_hf_snapshot(hf_repo, &install_dir, &label)
                        .await
                } else {
                    Err(github_error)
                }
            }
        }
    }

    async fn ensure_managed_speech_runtime_installed(&self) -> Result<PathBuf, String> {
        let definition = managed_speech_runtime_definition().ok_or_else(|| {
            "The managed Speech runtime is not available on this platform yet.".to_string()
        })?;

        let install_dir = crate::settings::default_speech_runtime_install_dir(
            &self.app_handle,
            definition.platform_id,
        );
        if let Some(root) = resolve_extracted_root(&install_dir) {
            if managed_speech_runtime_entrypoint(&root).is_some() {
                return Ok(root);
            }
        }

        if let Some(source_path) = self.find_managed_speech_runtime_source(&definition) {
            self.install_local_pack_source(&source_path, &install_dir, "Speech runtime")?;
            let root = resolve_extracted_root(&install_dir).ok_or_else(|| {
                "Speech runtime extraction did not produce any files.".to_string()
            })?;
            if managed_speech_runtime_entrypoint(&root).is_some() {
                return Ok(root);
            }
        }

        self.download_and_extract_archive(
            &[self.asset_download_url(definition.archive_name)],
            &install_dir,
            "Speech runtime",
        )
        .await?;

        let root = resolve_extracted_root(&install_dir)
            .ok_or_else(|| "Speech runtime extraction did not produce any files.".to_string())?;
        if managed_speech_runtime_entrypoint(&root).is_none() {
            return Err(
                "Speech runtime download completed, but the runtime launcher is missing."
                    .to_string(),
            );
        }

        Ok(root)
    }

    pub async fn ensure_managed_speech_runtime_available(
        &self,
        provider_id: &str,
    ) -> Result<(), String> {
        if provider_uses_managed_speech_runtime(provider_id) {
            // Only skip installation if the *speech-runtime* specifically is
            // already running (e.g. from iCloud or a custom path).  A generic
            // `is_running()` check can be fooled by `mlx_audio.server` which
            // does not serve these providers.
            if let Some(sidecar) = self
                .app_handle
                .try_state::<std::sync::Arc<crate::sidecar::SidecarManager>>()
            {
                let sidecar = Arc::clone(&*sidecar);
                let runtime_state = tokio::task::spawn_blocking(move || {
                    (
                        sidecar.is_speech_runtime_running(),
                        sidecar.has_speech_runtime_source(),
                    )
                })
                .await
                .map_err(|err| format!("Failed to check speech runtime availability: {err}"))?;
                let (runtime_running, runtime_available) = runtime_state;
                if runtime_running || runtime_available {
                    return Ok(());
                }
            }
            let _ = self.ensure_managed_speech_runtime_installed().await?;
        }
        Ok(())
    }

    pub async fn prepare_sidecar_provider(
        &self,
        provider_id: &str,
        model_id: Option<&str>,
    ) -> Result<(), String> {
        if provider_is_mlx_audio(provider_id) {
            let sidecar = self
                .app_handle
                .try_state::<Arc<crate::sidecar::SidecarManager>>()
                .map(|state| Arc::clone(&*state))
                .ok_or_else(|| "MLX speech runtime manager is not available.".to_string())?;
            tokio::task::spawn_blocking(move || sidecar.ensure_mlx_audio_environment())
                .await
                .map_err(|err| format!("Failed to prepare MLX speech runtime: {err}"))??;
            return Ok(());
        }

        self.ensure_managed_speech_runtime_available(provider_id)
            .await?;

        if let Some(sidecar) = self
            .app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
        {
            let sidecar = Arc::clone(&*sidecar);
            // Sidecar-managed providers (kokoro, chatterbox, xtts, etc.)
            // require the speech-runtime, not mlx_audio.server.  Use
            // `ensure_speech_runtime()` to stop the wrong backend if needed.
            tokio::task::spawn_blocking(move || sidecar.ensure_speech_runtime())
                .await
                .map_err(|err| format!("Failed to start speech runtime: {err}"))??;
        }

        let prepare_url = self
            .sidecar_request_url("listen/prepare")
            .ok_or_else(|| "Failed to resolve the local speech runtime URL.".to_string())?;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .build()
            .map_err(|err| format!("Failed to create HTTP client: {err}"))?;
        let response = client
            .post(prepare_url)
            .json(&serde_json::json!({
                "provider_id": provider_id,
                "model_id": model_id,
            }))
            .send()
            .await
            .map_err(|err| {
                format!(
                    "Failed to reach speech runtime while preparing {}: {err}",
                    sidecar_runtime_target(provider_id, model_id)
                )
            })?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let detail = sidecar_error_detail(&body);
            return Err(if detail.is_empty() {
                format!(
                    "{} preparation failed with HTTP {status}",
                    sidecar_runtime_target(provider_id, model_id)
                )
            } else {
                format!(
                    "{} preparation failed: {detail}",
                    sidecar_runtime_target(provider_id, model_id)
                )
            });
        }

        Ok(())
    }

    fn managed_speech_runtime_candidate_paths(
        &self,
        definition: &ManagedSpeechRuntimeDefinition,
    ) -> Vec<PathBuf> {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| manifest_dir.clone());

        vec![
            manifest_dir
                .join("resources")
                .join("tts-runtime")
                .join(definition.archive_name),
            repo_root.join("dist").join(definition.archive_name),
            repo_root.join(definition.archive_name),
        ]
    }

    fn find_managed_speech_runtime_source(
        &self,
        definition: &ManagedSpeechRuntimeDefinition,
    ) -> Option<PathBuf> {
        self.managed_speech_runtime_candidate_paths(definition)
            .into_iter()
            .find(|candidate| candidate.exists())
    }

    async fn install_managed_runtime_model(
        &self,
        definition: &ManagedRuntimeModelDefinition,
    ) -> Result<(), String> {
        let install_dir = self.managed_runtime_model_install_dir(definition);
        let label = format!("{} model assets", definition.label);

        if let Some(source_path) = self.find_managed_runtime_model_source(definition) {
            match self.install_local_pack_source(&source_path, &install_dir, &label) {
                Ok(()) => {
                    let _ = self.ensure_managed_speech_runtime_installed().await?;
                    return Ok(());
                }
                Err(local_error) => {
                    info!("{label}: local source failed ({local_error}), trying remote download");
                }
            }
        }

        // Try GitHub release archive first.
        let github_result = self
            .download_and_extract_archive(
                &[self.asset_download_url(definition.archive_name)],
                &install_dir,
                &label,
            )
            .await;

        match github_result {
            Ok(()) => {
                let _ = self.ensure_managed_speech_runtime_installed().await?;
                Ok(())
            }
            Err(github_error) => {
                if let Some(hf_repo) = definition.hf_repo_id {
                    info!(
                        "{label}: GitHub download failed ({github_error}), falling back to HuggingFace ({hf_repo})"
                    );
                    self.download_hf_snapshot(hf_repo, &install_dir, &label)
                        .await?;
                    let _ = self.ensure_managed_speech_runtime_installed().await?;
                    Ok(())
                } else {
                    Err(github_error)
                }
            }
        }
    }

    async fn install_mlx_audio_model(
        &self,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Result<(), String> {
        let install_dir = self.mlx_audio_model_install_dir(definition);
        let label = format!("{} MLX model assets", definition.label);

        self.download_hf_snapshot_into_exact_dir(definition.hf_model_id, &install_dir, &label)
            .await
    }

    pub fn stop(&self) {
        if let Some(flag) = self
            .current_stop_flag
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn set_last_output(&self, text: String, locale: Option<String>) {
        *self.last_output.lock().unwrap_or_else(|e| e.into_inner()) =
            Some(LastOutput { text, locale });
    }

    pub fn speak_last_output_request(&self) -> Result<SpeakRequest, String> {
        let Some(last_output) = self
            .last_output
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        else {
            return Err("No previous output is available to speak yet.".to_string());
        };

        Ok(SpeakRequest {
            text: last_output.text,
            locale: last_output.locale,
            preferred_voice_id: None,
            preset_id: None,
            inline_preset: None,
            trigger: Some("speak_last_output".to_string()),
            remember_last_output: false,
        })
    }

    pub fn get_available_voices(&self) -> Result<Vec<VoiceInfo>, String> {
        let settings = get_settings(&self.app_handle);
        match self.resolve_engine_kind(&settings, None)? {
            TtsEngineKind::System => self.system_voices(),
            TtsEngineKind::SherpaOnnx => Ok(self.installed_pack_voices()),
            TtsEngineKind::MlxNative => Ok(self.mlx_audio_voice_inventory(&settings)),
            TtsEngineKind::Qwen3Native => Ok(self.installed_qwen3_voices()),
            TtsEngineKind::Sidecar => self.runtime_managed_voices(&settings),
        }
    }

    pub fn warm_system_voice_cache(&self) -> Result<(), String> {
        let _ = self.system_voices()?;
        Ok(())
    }

    fn get_available_sherpa_packs(&self) -> Vec<TtsPackInfo> {
        PACK_DEFINITIONS
            .iter()
            .map(|definition| TtsPackInfo {
                id: definition.id.to_string(),
                label: definition.label.to_string(),
                locale: definition.locale.to_string(),
                voice_id: definition.voice_id.to_string(),
                archive_name: definition.archive_name.to_string(),
                installed: self.installed_pack_root(definition.id).is_some(),
            })
            .collect()
    }

    fn get_available_qwen3_packs(&self) -> Vec<TtsPackInfo> {
        QWEN3_PACK_DEFINITIONS
            .iter()
            .map(|definition| TtsPackInfo {
                id: definition.id.to_string(),
                label: definition.label.to_string(),
                locale: definition.locale.to_string(),
                voice_id: definition.id.to_string(),
                archive_name: self.qwen3_pack_archive_name(definition),
                installed: self.resolved_qwen3_pack_root(definition).is_some(),
            })
            .collect()
    }

    pub fn get_available_packs(&self) -> Vec<TtsPackInfo> {
        let mut packs = self.get_available_sherpa_packs();
        packs.extend(self.get_available_qwen3_packs());
        packs
    }

    fn runtime_advanced_controls(
        &self,
        model: &RuntimeListenModelCatalogEntry,
    ) -> Vec<TtsAdvancedControlDescriptor> {
        let mut controls = if model.style_controls.is_empty() {
            self.runtime_fallback_advanced_controls(&model.provider_id)
        } else {
            model
                .style_controls
                .iter()
                .filter_map(Self::map_runtime_style_control)
                .collect()
        };

        if model.capabilities.supports_instruction_prompt
            && !controls
                .iter()
                .any(|control| control.id == "style_instructions")
        {
            controls.push(Self::instruction_prompt_control(
                "Optional provider-specific speaking instructions passed through to the runtime.",
            ));
        }

        controls
    }

    fn map_runtime_style_control(
        control: &RuntimeStyleControl,
    ) -> Option<TtsAdvancedControlDescriptor> {
        let kind = match control.kind.trim().to_ascii_lowercase().as_str() {
            "slider" => TtsAdvancedControlKind::Slider,
            "toggle" => TtsAdvancedControlKind::Toggle,
            "select" => TtsAdvancedControlKind::Select,
            "text" => TtsAdvancedControlKind::Text,
            _ => return None,
        };

        Some(TtsAdvancedControlDescriptor {
            id: control.id.clone(),
            group: Self::runtime_control_group(control.group.as_deref(), control.id.as_str()),
            label: control.label.clone(),
            description: control.description.clone(),
            kind,
            min: control.min.map(|value| value as f32),
            max: control.max.map(|value| value as f32),
            step: control.step.map(|value| value as f32),
            unit: control.unit.clone(),
            options: control
                .options
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|option| crate::model_platform::TtsAdvancedControlOption {
                    value: option.value,
                    label: option.label,
                })
                .collect(),
            default_value: None,
        })
    }

    fn instruction_prompt_control(description: &str) -> TtsAdvancedControlDescriptor {
        TtsAdvancedControlDescriptor {
            id: "style_instructions".to_string(),
            group: TtsControlGroup::Steering,
            label: "Style Instructions".to_string(),
            description: Some(description.to_string()),
            kind: TtsAdvancedControlKind::Text,
            min: None,
            max: None,
            step: None,
            unit: None,
            options: Vec::new(),
            default_value: None,
        }
    }

    fn slider_advanced_control(
        id: &str,
        group: TtsControlGroup,
        label: &str,
        description: &str,
        min: f32,
        max: f32,
        step: f32,
        default_value: f32,
        unit: Option<&str>,
    ) -> TtsAdvancedControlDescriptor {
        TtsAdvancedControlDescriptor {
            id: id.to_string(),
            group,
            label: label.to_string(),
            description: Some(description.to_string()),
            kind: TtsAdvancedControlKind::Slider,
            min: Some(min),
            max: Some(max),
            step: Some(step),
            unit: unit.map(str::to_string),
            options: Vec::new(),
            default_value: Some(TtsStyleControlValue::Number(default_value)),
        }
    }

    fn runtime_fallback_advanced_controls(
        &self,
        provider_id: &str,
    ) -> Vec<TtsAdvancedControlDescriptor> {
        let provider_id = provider_id.to_ascii_lowercase();

        if provider_id == TTS_PROVIDER_MLX_FISH_AUDIO_ID {
            return vec![
                Self::slider_advanced_control(
                    "randomness",
                    TtsControlGroup::Sampler,
                    "Randomness",
                    "Balances stable reads with more expressive sampling.",
                    0.0,
                    1.0,
                    0.05,
                    0.7,
                    None,
                ),
                Self::slider_advanced_control(
                    "repetition_penalty",
                    TtsControlGroup::Guidance,
                    "Repetition Penalty",
                    "Helps reduce repeated words or loops in longer reads.",
                    1.0,
                    3.0,
                    0.05,
                    1.2,
                    None,
                ),
            ];
        }

        if provider_id.contains("kokoro") {
            return vec![Self::slider_advanced_control(
                "tempo_rate",
                TtsControlGroup::Tempo,
                "Tempo",
                "Adjusts Kokoro delivery speed for this preset.",
                0.5,
                2.0,
                0.05,
                1.0,
                Some("x"),
            )];
        }

        if provider_id.contains("chatterbox") {
            return vec![
                Self::slider_advanced_control(
                    "guidance",
                    TtsControlGroup::Guidance,
                    "Guidance",
                    "Controls how strongly Chatterbox follows its conditioning signal.",
                    0.0,
                    1.0,
                    0.05,
                    0.5,
                    None,
                ),
                Self::slider_advanced_control(
                    "randomness",
                    TtsControlGroup::Sampler,
                    "Randomness",
                    "Balances predictable versus more varied delivery.",
                    0.0,
                    1.0,
                    0.05,
                    0.8,
                    None,
                ),
                Self::slider_advanced_control(
                    "exaggeration",
                    TtsControlGroup::Style,
                    "Exaggeration",
                    "Pushes Chatterbox toward a more pronounced style.",
                    0.0,
                    1.0,
                    0.05,
                    0.5,
                    None,
                ),
                Self::slider_advanced_control(
                    "repetition_penalty",
                    TtsControlGroup::Guidance,
                    "Repetition Penalty",
                    "Discourages repeated words in longer reads.",
                    1.0,
                    3.0,
                    0.1,
                    1.2,
                    None,
                ),
            ];
        }

        if provider_id.contains("xtts") || provider_id.contains("coqui") {
            return vec![
                Self::slider_advanced_control(
                    "randomness",
                    TtsControlGroup::Sampler,
                    "Randomness",
                    "Balances stable reads with more expressive sampling.",
                    0.0,
                    1.0,
                    0.05,
                    0.65,
                    None,
                ),
                Self::slider_advanced_control(
                    "repetition_penalty",
                    TtsControlGroup::Guidance,
                    "Repetition Penalty",
                    "Discourages repeated tokens in longer generations.",
                    1.0,
                    3.0,
                    0.1,
                    2.0,
                    None,
                ),
            ];
        }

        if provider_id.contains("openvoice") {
            return vec![Self::slider_advanced_control(
                "tempo_rate",
                TtsControlGroup::Tempo,
                "Tempo",
                "Speeds OpenVoice up or down for a tighter delivery fit.",
                0.5,
                2.0,
                0.05,
                1.0,
                Some("x"),
            )];
        }

        Vec::new()
    }

    fn builtin_delivery_support(&self, provider_id: &str) -> TtsDeliverySupport {
        let expressiveness_mode = if provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID {
            TtsExpressivenessMode::Native
        } else {
            TtsExpressivenessMode::Unsupported
        };

        TtsDeliverySupport {
            expressiveness_mode,
            advanced_controls: if provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID {
                vec![TtsAdvancedControlDescriptor {
                    id: "style_instructions".to_string(),
                    group: TtsControlGroup::Steering,
                    label: "Style Instructions".to_string(),
                    description: Some(
                        "Optional sidecar-specific instructions passed through with speech generation."
                            .to_string(),
                    ),
                    kind: TtsAdvancedControlKind::Text,
                    min: None,
                    max: None,
                    step: None,
                    unit: None,
                    options: Vec::new(),
                    default_value: None,
                }]
            } else {
                Vec::new()
            },
        }
    }

    fn runtime_control_group(raw_group: Option<&str>, control_id: &str) -> TtsControlGroup {
        match raw_group
            .unwrap_or(control_id)
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "identity" => TtsControlGroup::Identity,
            "tempo" => TtsControlGroup::Tempo,
            "style" => TtsControlGroup::Style,
            "sampler" => TtsControlGroup::Sampler,
            "steering" => TtsControlGroup::Steering,
            "tempo_rate" | "speed" => TtsControlGroup::Tempo,
            "expressiveness" | "exaggeration" => TtsControlGroup::Style,
            "randomness" | "temperature" | "top_p" | "top_k" => TtsControlGroup::Sampler,
            "guidance" | "cfg_weight" | "stability" | "repetition_penalty" => {
                TtsControlGroup::Guidance
            }
            "style_instructions" => TtsControlGroup::Steering,
            _ => TtsControlGroup::Style,
        }
    }

    fn runtime_delivery_support(
        &self,
        model: &RuntimeListenModelCatalogEntry,
    ) -> TtsDeliverySupport {
        TtsDeliverySupport {
            expressiveness_mode: TtsExpressivenessMode::Native,
            advanced_controls: self.runtime_advanced_controls(model),
        }
    }

    fn sidecar_backend(&self) -> Option<SidecarBackend> {
        self.app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
            .map(|sidecar| sidecar.backend())
    }

    fn mlx_audio_runtime_state(&self) -> RuntimeListenState {
        let providers = MLX_AUDIO_TTS_MODEL_DEFINITIONS
            .iter()
            .filter(|definition| mlx_audio_definition_available(definition))
            .fold(Vec::new(), |mut entries, definition| {
                if entries
                    .iter()
                    .any(|entry: &RuntimeListenProviderCatalogEntry| {
                        entry.id == definition.provider_id
                    })
                {
                    return entries;
                }

                entries.push(RuntimeListenProviderCatalogEntry {
                    id: definition.provider_id.to_string(),
                    label: definition.provider_label.to_string(),
                    description: definition.provider_description.to_string(),
                    source_label: "mlx-audio runtime".to_string(),
                    provider: RuntimeListenProviderDefinition {
                        id: definition.provider_id.to_string(),
                        label: definition.provider_label.to_string(),
                        engine_family: definition.engine_family.to_string(),
                        supported_platforms: vec!["darwin".to_string()],
                        license_label: definition.license_label.map(str::to_string),
                    },
                });
                entries
            });

        let models = MLX_AUDIO_TTS_MODEL_DEFINITIONS
            .iter()
            .filter(|definition| mlx_audio_definition_available(definition))
            .map(|definition| {
                let installed = self.mlx_audio_model_installed(definition);
                RuntimeListenModelCatalogEntry {
                    id: definition.model_id.to_string(),
                    provider_id: definition.provider_id.to_string(),
                    label: definition.label.to_string(),
                    description: definition.description.to_string(),
                    source_label: "mlx-audio runtime".to_string(),
                    capabilities: RuntimeListenCapabilities {
                        supports_basic_tts: true,
                        supports_voice_cloning: definition.supports_voice_cloning,
                        supports_instruction_prompt: definition.supports_instruction_prompt,
                        supports_streaming: false,
                    },
                    readiness: RuntimeListenReadiness {
                        status: if installed {
                            "ready".to_string()
                        } else {
                            "missing".to_string()
                        },
                        runtime_label: "mlx-audio runtime".to_string(),
                        issues: if installed {
                            Vec::new()
                        } else {
                            vec![format!(
                                "{} is available from Hugging Face but is not installed locally yet.",
                                definition.label
                            )]
                        },
                    },
                    supported_languages: definition
                        .supported_languages
                        .iter()
                        .map(|value| value.to_string())
                        .collect(),
                    style_controls: Vec::new(),
                }
            })
            .collect();

        RuntimeListenState {
            providers,
            models,
            selection: None,
        }
    }

    fn managed_runtime_provider_descriptors(&self) -> Vec<ProviderDescriptor> {
        let mut providers = Vec::new();

        for definition in MANAGED_RUNTIME_MODEL_DEFINITIONS {
            if providers
                .iter()
                .any(|provider: &ProviderDescriptor| provider.id == definition.provider_id)
            {
                continue;
            }

            providers.push(ProviderDescriptor {
                id: definition.provider_id.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: definition.label.to_string(),
                description: format!(
                    "{} Managed by Vox Jot and served through the bundled Speech runtime.",
                    definition.description
                ),
                source_label: "Vox Jot managed runtime".to_string(),
                runtime: RuntimeRequirement {
                    id: format!("managed_{}", definition.provider_id),
                    label: "Speech runtime".to_string(),
                    engine_family: definition.engine_family.to_string(),
                    auto_routed: true,
                },
                available: managed_speech_runtime_definition().is_some(),
                local_only: true,
                coming_soon: false,
                license_label: definition.license_label.map(str::to_string),
                capabilities: CapabilityFlags {
                    downloadable: true,
                    loadable: true,
                    local_only: true,
                    supports_translation: false,
                    supports_streaming: false,
                    supports_voice_cloning: definition.supports_voice_cloning,
                    supports_instruction_prompt: definition.supports_instruction_prompt,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
            });
        }

        providers
    }

    fn managed_runtime_placeholder_models(
        &self,
        selected_provider_id: &str,
        selected_model_id: Option<&str>,
    ) -> Vec<CatalogModelDescriptor> {
        MANAGED_RUNTIME_MODEL_DEFINITIONS
            .iter()
            .map(|definition| {
                let installed = self.managed_runtime_model_installed(definition);
                let selected = selected_provider_id == definition.provider_id
                    && selected_model_id == Some(definition.model_id);
                CatalogModelDescriptor {
                    id: definition.model_id.to_string(),
                    provider_id: definition.provider_id.to_string(),
                    domain: ModelDomain::Tts,
                    source_kind: CatalogSourceKind::Builtin,
                    label: definition.label.to_string(),
                    description: definition.description.to_string(),
                    installed,
                    selected,
                    active: selected && installed,
                    runnable: installed,
                    downloadable: true,
                    source_label: "Vox Jot model assets".to_string(),
                    runtime: RuntimeRequirement {
                        id: format!("managed_{}", definition.provider_id),
                        label: "Speech runtime".to_string(),
                        engine_family: definition.engine_family.to_string(),
                        auto_routed: true,
                    },
                    license_label: definition.license_label.map(str::to_string),
                    locale: definition.locale.map(str::to_string),
                    supported_languages: definition
                        .supported_languages
                        .iter()
                        .map(|value| value.to_string())
                        .collect(),
                    readiness_status: Some(if installed { "ready" } else { "missing" }.to_string()),
                    readiness_issues: if installed {
                        Vec::new()
                    } else {
                        vec![format!(
                            "{} is available to download and Vox Jot will install the required Speech runtime automatically.",
                            definition.label
                        )]
                    },
                    capabilities: CapabilityFlags {
                        downloadable: true,
                        loadable: true,
                        local_only: true,
                        supports_translation: false,
                        supports_streaming: false,
                        supports_voice_cloning: definition.supports_voice_cloning,
                        supports_instruction_prompt: definition.supports_instruction_prompt,
                        supports_inline_tags: false,
                        coming_soon: false,
                    },
                    delivery_support: self.builtin_delivery_support(definition.provider_id),
                }
            })
            .collect()
    }

    fn resolved_preset_for_request(
        &self,
        settings: &AppSettings,
        request: &SpeakRequest,
    ) -> Option<TtsVoicePreset> {
        request
            .inline_preset
            .clone()
            .or_else(|| {
                request
                    .preset_id
                    .as_deref()
                    .and_then(|preset_id| settings.tts_preset(preset_id).cloned())
            })
            .or_else(|| settings.active_tts_preset().cloned())
    }

    pub fn selected_provider_id(&self, settings: &AppSettings) -> String {
        if let Some(preset) = settings.explicit_active_tts_preset() {
            if !preset.provider_id.trim().is_empty() {
                return preset.provider_id.clone();
            }
        }
        if !settings.selected_tts_provider_id.trim().is_empty() {
            return settings.selected_tts_provider_id.clone();
        }

        match settings.tts_engine_preference {
            TtsEnginePreference::System => TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string(),
            TtsEnginePreference::SherpaOnnx => TTS_PROVIDER_SHERPA_PACK_ID.to_string(),
            TtsEnginePreference::Sidecar => TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
            TtsEnginePreference::Auto => {
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                {
                    TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string()
                }
                #[cfg(target_os = "linux")]
                {
                    TTS_PROVIDER_SHERPA_PACK_ID.to_string()
                }
                #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
                {
                    TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string()
                }
            }
        }
    }

    pub fn selected_model_id(&self, settings: &AppSettings) -> Option<String> {
        if let Some(preset) = settings.explicit_active_tts_preset() {
            if !preset.model_id.trim().is_empty() {
                return Some(preset.model_id.clone());
            }
        }
        settings
            .selected_tts_model_id
            .clone()
            .or_else(|| settings.selected_tts_voice_id.clone())
            .or_else(|| settings.tts_default_voice_id.clone())
            .or_else(|| {
                let provider_id = self.selected_provider_id(settings);
                match provider_id.as_str() {
                    TTS_PROVIDER_SYSTEM_BUILTIN_ID => Some(TTS_MODEL_SYSTEM_DEFAULT_ID.to_string()),
                    TTS_PROVIDER_LOCAL_SIDECAR_API_ID => {
                        Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID.to_string())
                    }
                    _ => None,
                }
            })
    }

    pub async fn domain_catalog(&self, settings: &AppSettings) -> DomainCatalog {
        let requested_provider_id = self.selected_provider_id(settings);
        let requested_model_id = self.selected_model_id(settings);
        let runtime_listen_state = self.fetch_runtime_listen_state().await;
        let runtime_provider_ids = runtime_listen_state
            .as_ref()
            .map(|state| {
                state
                    .providers
                    .iter()
                    .map(|provider| provider.id.clone())
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        let runtime_selected_provider_id = runtime_listen_state
            .as_ref()
            .and_then(|state| state.selection.as_ref())
            .and_then(|selection| selection.selected_provider_id.clone());
        let runtime_selected_model_id = runtime_listen_state
            .as_ref()
            .and_then(|state| state.selection.as_ref())
            .and_then(|selection| selection.selected_model_id.clone());
        let selected_provider_id = if runtime_listen_state.is_some()
            && (requested_provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                || runtime_provider_ids.contains(&requested_provider_id))
        {
            runtime_selected_provider_id.unwrap_or(requested_provider_id.clone())
        } else {
            requested_provider_id.clone()
        };
        let selected_model_id = if runtime_listen_state.is_some()
            && (requested_provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                || runtime_provider_ids.contains(&requested_provider_id))
        {
            runtime_selected_model_id.or(requested_model_id.clone())
        } else {
            requested_model_id.clone()
        };
        let runtime_catalog_available = runtime_listen_state
            .as_ref()
            .map(|state| !state.models.is_empty())
            .unwrap_or(false);
        let show_local_sidecar_api = std::env::var("VOX_JOT_ENABLE_LOCAL_SIDECAR_API")
            .ok()
            .as_deref()
            == Some("1");

        let system_runtime = RuntimeRequirement {
            id: "system_tts".to_string(),
            label: "OS speech runtime".to_string(),
            engine_family: "system".to_string(),
            auto_routed: true,
        };
        let sherpa_runtime = RuntimeRequirement {
            id: "sherpa_onnx".to_string(),
            label: "Sherpa ONNX offline runtime".to_string(),
            engine_family: "sherpa_onnx".to_string(),
            auto_routed: true,
        };
        let sidecar_runtime = RuntimeRequirement {
            id: "local_sidecar_api".to_string(),
            label: "Local speech API runtime".to_string(),
            engine_family: "sidecar".to_string(),
            auto_routed: true,
        };

        let planned_capabilities = CapabilityFlags {
            downloadable: false,
            loadable: false,
            local_only: true,
            supports_translation: false,
            supports_streaming: true,
            supports_voice_cloning: true,
            supports_instruction_prompt: true,
            supports_inline_tags: true,
            coming_soon: true,
        };

        let mut qwen3_capabilities = planned_capabilities.clone();
        qwen3_capabilities.downloadable = true;
        qwen3_capabilities.loadable = true;
        qwen3_capabilities.coming_soon = false;
        let qwen3_models = QWEN3_PACK_DEFINITIONS.iter().collect::<Vec<_>>();

        let mut providers = vec![
            ProviderDescriptor {
                id: TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "System Built-In".to_string(),
                description:
                    "Use platform speech synthesis and choose from installed system voices."
                        .to_string(),
                source_label: "Platform runtime".to_string(),
                runtime: system_runtime.clone(),
                available: self.ensure_system_engine_supported().is_ok(),
                local_only: true,
                coming_soon: false,
                license_label: None,
                capabilities: CapabilityFlags {
                    downloadable: false,
                    loadable: true,
                    local_only: true,
                    supports_translation: false,
                    supports_streaming: false,
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
            },
            ProviderDescriptor {
                id: TTS_PROVIDER_SHERPA_PACK_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "Sherpa Pack".to_string(),
                description:
                    "Use Vox Jot-managed offline voice packs with automatic local runtime routing."
                        .to_string(),
                source_label: "Vox Jot curated assets".to_string(),
                runtime: sherpa_runtime.clone(),
                available: true,
                local_only: true,
                coming_soon: false,
                license_label: Some("Sherpa ONNX model assets".to_string()),
                capabilities: CapabilityFlags {
                    downloadable: true,
                    loadable: true,
                    local_only: true,
                    supports_translation: false,
                    supports_streaming: false,
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
            },
        ];

        if !runtime_catalog_available && show_local_sidecar_api {
            providers.push(ProviderDescriptor {
                id: TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "Local Sidecar API".to_string(),
                description:
                    "Route speech to a local OpenAI-compatible speech endpoint managed outside the app."
                        .to_string(),
                source_label: "User-managed local endpoint".to_string(),
                runtime: sidecar_runtime.clone(),
                available: self.ensure_sidecar_supported(settings).is_ok(),
                local_only: true,
                coming_soon: false,
                license_label: None,
                capabilities: CapabilityFlags {
                    downloadable: false,
                    loadable: true,
                    local_only: true,
                    supports_translation: false,
                    supports_streaming: false,
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
            });
        }

        providers.extend([
            ProviderDescriptor {
                id: TTS_PROVIDER_QWEN3_NATIVE_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "Qwen3 Native".to_string(),
                description:
                    "Native Qwen3 runtime with preset voices, instructions, and cloning support."
                        .to_string(),
                source_label: "Provider-hosted model weights".to_string(),
                runtime: RuntimeRequirement {
                    id: "qwen3_native".to_string(),
                    label: "Qwen3 native runtime".to_string(),
                    engine_family: "qwen3".to_string(),
                    auto_routed: true,
                },
                available: qwen3_runtime_definition().is_some(),
                local_only: true,
                coming_soon: false,
                license_label: Some("Apache-2.0".to_string()),
                capabilities: qwen3_capabilities.clone(),
            },
            ProviderDescriptor {
                id: TTS_PROVIDER_TADA_LOCAL_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "TADA Local".to_string(),
                description: "Planned local sidecar integration for Hume TADA models.".to_string(),
                source_label: "Provider-hosted model weights".to_string(),
                runtime: RuntimeRequirement {
                    id: "tada_local".to_string(),
                    label: "TADA local sidecar".to_string(),
                    engine_family: "tada".to_string(),
                    auto_routed: true,
                },
                available: false,
                local_only: true,
                coming_soon: true,
                license_label: Some("Llama 3.2".to_string()),
                capabilities: planned_capabilities.clone(),
            },
            ProviderDescriptor {
                id: TTS_PROVIDER_HF_S2S_LOCAL_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "HF Speech-to-Speech".to_string(),
                description:
                    "Planned local adapter for the Hugging Face speech-to-speech pipeline."
                        .to_string(),
                source_label: "Local pipeline adapter".to_string(),
                runtime: RuntimeRequirement {
                    id: "hf_s2s_local".to_string(),
                    label: "speech-to-speech local pipeline".to_string(),
                    engine_family: "speech_to_speech".to_string(),
                    auto_routed: true,
                },
                available: false,
                local_only: true,
                coming_soon: true,
                license_label: None,
                capabilities: planned_capabilities.clone(),
            },
        ]);

        providers.extend(self.managed_runtime_provider_descriptors());

        let mut models = vec![CatalogModelDescriptor {
            id: TTS_MODEL_SYSTEM_DEFAULT_ID.to_string(),
            provider_id: TTS_PROVIDER_SYSTEM_BUILTIN_ID.to_string(),
            domain: ModelDomain::Tts,
            source_kind: CatalogSourceKind::Builtin,
            label: "System Voices".to_string(),
            description: "Uses the operating system voice inventory.".to_string(),
            installed: true,
            selected: selected_provider_id == TTS_PROVIDER_SYSTEM_BUILTIN_ID
                && selected_model_id.as_deref() == Some(TTS_MODEL_SYSTEM_DEFAULT_ID),
            active: selected_provider_id == TTS_PROVIDER_SYSTEM_BUILTIN_ID
                && selected_model_id.as_deref() == Some(TTS_MODEL_SYSTEM_DEFAULT_ID),
            runnable: true,
            downloadable: false,
            source_label: "Platform runtime".to_string(),
            runtime: system_runtime,
            license_label: None,
            locale: None,
            supported_languages: Vec::new(),
            readiness_status: Some("ready".to_string()),
            readiness_issues: Vec::new(),
            capabilities: CapabilityFlags {
                downloadable: false,
                loadable: true,
                local_only: true,
                supports_translation: false,
                supports_streaming: false,
                supports_voice_cloning: false,
                supports_instruction_prompt: false,
                supports_inline_tags: false,
                coming_soon: false,
            },
            delivery_support: self.builtin_delivery_support(TTS_PROVIDER_SYSTEM_BUILTIN_ID),
        }];

        if !runtime_catalog_available && show_local_sidecar_api {
            models.push(CatalogModelDescriptor {
                id: TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID.to_string(),
                provider_id: TTS_PROVIDER_LOCAL_SIDECAR_API_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: "OpenAI-Compatible Speech API".to_string(),
                description: "Routes synthesis to the configured local speech endpoint."
                    .to_string(),
                installed: true,
                selected: selected_provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                    && selected_model_id.as_deref() == Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID),
                active: selected_provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID
                    && selected_model_id.as_deref() == Some(TTS_MODEL_LOCAL_SIDECAR_DEFAULT_ID),
                runnable: self.ensure_sidecar_supported(settings).is_ok(),
                downloadable: false,
                source_label: "User-managed local endpoint".to_string(),
                runtime: sidecar_runtime.clone(),
                license_label: None,
                locale: None,
                supported_languages: Vec::new(),
                readiness_status: Some("ready".to_string()),
                readiness_issues: Vec::new(),
                capabilities: CapabilityFlags {
                    downloadable: false,
                    loadable: true,
                    local_only: true,
                    supports_translation: false,
                    supports_streaming: false,
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
                delivery_support: self.builtin_delivery_support(TTS_PROVIDER_LOCAL_SIDECAR_API_ID),
            });
        }

        models.extend(self.managed_runtime_placeholder_models(
            &selected_provider_id,
            selected_model_id.as_deref(),
        ));

        models.extend(
            qwen3_models
                .into_iter()
                .map(|pack| {
                    let installed = self.installed_pack_root(pack.id).is_some();
                    let selected = selected_provider_id == TTS_PROVIDER_QWEN3_NATIVE_ID
                        && selected_model_id.as_deref() == Some(pack.id);
                    let features = self.qwen3_pack_features(pack);
                    let mut capabilities = qwen3_capabilities.clone();
                    capabilities.supports_voice_cloning = features.supports_voice_cloning;
                    capabilities.supports_instruction_prompt = features.supports_instruction_prompt;
                    CatalogModelDescriptor {
                        id: pack.id.to_string(),
                        provider_id: TTS_PROVIDER_QWEN3_NATIVE_ID.to_string(),
                        domain: ModelDomain::Tts,
                        source_kind: CatalogSourceKind::Builtin,
                        label: pack.label.to_string(),
                        description: features.description.to_string(),
                        installed,
                        selected,
                        active: selected && installed,
                        runnable: installed,
                        downloadable: true,
                        source_label: "Vox Jot model assets".to_string(),
                        runtime: RuntimeRequirement {
                            id: "qwen3_native".to_string(),
                            label: "Qwen3 native runtime".to_string(),
                            engine_family: "qwen3".to_string(),
                            auto_routed: true,
                        },
                        license_label: Some("Apache-2.0".to_string()),
                        locale: Some(pack.locale.to_string()),
                        supported_languages: vec![pack.locale.to_string()],
                        readiness_status: Some(if installed { "ready" } else { "missing" }.to_string()),
                        readiness_issues: if installed {
                            Vec::new()
                        } else {
                            vec![format!(
                                "{} is available from Vox Jot model assets, but it has not been installed locally yet.",
                                pack.label
                            )]
                        },
                        capabilities,
                        delivery_support: self.builtin_delivery_support(
                            TTS_PROVIDER_QWEN3_NATIVE_ID,
                        ),
                    }
                }),
        );

        models.extend(self.get_available_packs().into_iter().map(|pack| {
            let selected = selected_provider_id == TTS_PROVIDER_SHERPA_PACK_ID
                && selected_model_id.as_deref() == Some(pack.id.as_str());
            CatalogModelDescriptor {
                id: pack.id.clone(),
                provider_id: TTS_PROVIDER_SHERPA_PACK_ID.to_string(),
                domain: ModelDomain::Tts,
                source_kind: CatalogSourceKind::Builtin,
                label: pack.label.clone(),
                description: format!("Offline pack for {}", pack.locale),
                installed: pack.installed,
                selected,
                active: selected && pack.installed,
                runnable: pack.installed,
                downloadable: true,
                source_label: "Vox Jot curated assets".to_string(),
                runtime: sherpa_runtime.clone(),
                license_label: Some("Sherpa ONNX model assets".to_string()),
                locale: Some(pack.locale.clone()),
                supported_languages: vec![pack.locale.clone()],
                readiness_status: Some(
                    if pack.installed { "ready" } else { "missing" }.to_string(),
                ),
                readiness_issues: if pack.installed {
                    Vec::new()
                } else {
                    vec![format!(
                        "{} is listed in Vox Jot but not downloaded yet.",
                        pack.label
                    )]
                },
                capabilities: CapabilityFlags {
                    downloadable: true,
                    loadable: true,
                    local_only: true,
                    supports_translation: false,
                    supports_streaming: false,
                    supports_voice_cloning: false,
                    supports_instruction_prompt: false,
                    supports_inline_tags: false,
                    coming_soon: false,
                },
                delivery_support: self.builtin_delivery_support(TTS_PROVIDER_SHERPA_PACK_ID),
            }
        }));

        // Planned builtin model placeholders for providers not yet served by the runtime.
        models.extend(
            [
                (
                    "tada-1b",
                    TTS_PROVIDER_TADA_LOCAL_ID,
                    "TADA 1B",
                    "English voice cloning and long-form generation.",
                    Some("Llama 3.2"),
                ),
                (
                    "tada-3b-ml",
                    TTS_PROVIDER_TADA_LOCAL_ID,
                    "TADA 3B ML",
                    "Multilingual local sidecar model.",
                    Some("Llama 3.2"),
                ),
                (
                    "hf-s2s-default",
                    TTS_PROVIDER_HF_S2S_LOCAL_ID,
                    "speech-to-speech Adapter",
                    "Local adapter that orchestrates external TTS backends.",
                    None,
                ),
            ]
            .into_iter()
            .map(
                |(id, provider_id, label, description, license_label)| CatalogModelDescriptor {
                    id: id.to_string(),
                    provider_id: provider_id.to_string(),
                    domain: ModelDomain::Tts,
                    source_kind: CatalogSourceKind::Builtin,
                    label: label.to_string(),
                    description: description.to_string(),
                    installed: false,
                    selected: selected_provider_id == provider_id
                        && selected_model_id.as_deref() == Some(id),
                    active: false,
                    runnable: false,
                    downloadable: false,
                    source_label: "Planned provider integration".to_string(),
                    runtime: providers
                        .iter()
                        .find(|provider| provider.id == provider_id)
                        .map(|provider| provider.runtime.clone())
                        .unwrap_or(RuntimeRequirement {
                            id: provider_id.to_string(),
                            label: provider_id.to_string(),
                            engine_family: provider_id.to_string(),
                            auto_routed: true,
                        }),
                    license_label: license_label.map(|value| value.to_string()),
                    locale: None,
                    supported_languages: Vec::new(),
                    readiness_status: Some("coming_soon".to_string()),
                    readiness_issues: vec![
                        "This provider is not implemented in Vox Jot yet.".to_string()
                    ],
                    capabilities: planned_capabilities.clone(),
                    delivery_support: self.builtin_delivery_support(provider_id),
                },
            ),
        );

        if let Some(runtime_state) = runtime_listen_state {
            let current_platform = current_runtime_platform_id();
            let runtime_models = runtime_state
                .models
                .into_iter()
                .filter(|model| {
                    model.capabilities.supports_basic_tts
                        && !HIDDEN_RUNTIME_MODEL_IDS.contains(&model.id.as_str())
                })
                .collect::<Vec<_>>();
            let runtime_provider_ids = runtime_models
                .iter()
                .map(|model| model.provider_id.clone())
                .collect::<std::collections::HashSet<_>>();

            for provider in runtime_state.providers.into_iter().filter(|provider| {
                provider
                    .provider
                    .supported_platforms
                    .iter()
                    .any(|platform| platform.eq_ignore_ascii_case(current_platform))
                    && runtime_provider_ids.contains(&provider.id)
            }) {
                let provider_models = runtime_models
                    .iter()
                    .filter(|model| model.provider_id == provider.id)
                    .collect::<Vec<_>>();
                let descriptor = ProviderDescriptor {
                    id: provider.id.clone(),
                    domain: ModelDomain::Tts,
                    source_kind: CatalogSourceKind::Runtime,
                    label: provider.label.clone(),
                    description: provider.description.clone(),
                    source_label: provider.source_label.clone(),
                    runtime: RuntimeRequirement {
                        id: format!("runtime_{}", provider.provider.id),
                        label: format!("{} runtime", provider.provider.label),
                        engine_family: provider.provider.engine_family.clone(),
                        auto_routed: true,
                    },
                    available: true,
                    local_only: true,
                    coming_soon: false,
                    license_label: provider.provider.license_label.clone(),
                    capabilities: CapabilityFlags {
                        downloadable: provider_is_mlx_audio(&provider.id),
                        loadable: true,
                        local_only: true,
                        supports_translation: false,
                        supports_streaming: provider_models
                            .iter()
                            .any(|model| model.capabilities.supports_streaming),
                        supports_voice_cloning: provider_models
                            .iter()
                            .any(|model| model.capabilities.supports_voice_cloning),
                        supports_instruction_prompt: provider_models
                            .iter()
                            .any(|model| model.capabilities.supports_instruction_prompt),
                        supports_inline_tags: false,
                        coming_soon: false,
                    },
                };

                if let Some(existing) = providers.iter_mut().find(|item| item.id == descriptor.id) {
                    *existing = descriptor;
                } else {
                    providers.push(descriptor);
                }
            }

            let runtime_provider_map = providers
                .iter()
                .filter(|provider| provider.source_kind == CatalogSourceKind::Runtime)
                .map(|provider| (provider.id.clone(), provider))
                .collect::<std::collections::HashMap<_, _>>();

            models.extend(runtime_models.into_iter().filter_map(|model| {
                let provider = runtime_provider_map.get(&model.provider_id)?;
                let selected = selected_provider_id == model.provider_id
                    && selected_model_id.as_deref() == Some(model.id.as_str());
                let is_mlx_runtime_model = provider_is_mlx_audio(&model.provider_id);
                let installed = !model.readiness.status.eq_ignore_ascii_case("missing");
                let runnable = model.readiness.status.eq_ignore_ascii_case("ready");
                Some(CatalogModelDescriptor {
                    id: model.id.clone(),
                    provider_id: model.provider_id.clone(),
                    domain: ModelDomain::Tts,
                    source_kind: CatalogSourceKind::Runtime,
                    label: model.label.clone(),
                    description: model.description.clone(),
                    installed,
                    selected,
                    active: selected && runnable,
                    runnable,
                    downloadable: is_mlx_runtime_model,
                    source_label: model.source_label.clone(),
                    runtime: RuntimeRequirement {
                        id: provider.runtime.id.clone(),
                        label: model.readiness.runtime_label.clone(),
                        engine_family: provider.runtime.engine_family.clone(),
                        auto_routed: true,
                    },
                    license_label: provider.license_label.clone(),
                    locale: None,
                    supported_languages: model.supported_languages.clone(),
                    readiness_status: Some(model.readiness.status.clone()),
                    readiness_issues: model.readiness.issues.clone(),
                    capabilities: CapabilityFlags {
                        downloadable: is_mlx_runtime_model,
                        loadable: true,
                        local_only: true,
                        supports_translation: false,
                        supports_streaming: model.capabilities.supports_streaming,
                        supports_voice_cloning: model.capabilities.supports_voice_cloning,
                        supports_instruction_prompt: model.capabilities.supports_instruction_prompt,
                        supports_inline_tags: false,
                        coming_soon: false,
                    },
                    delivery_support: self.runtime_delivery_support(&model),
                })
            }));

            let mut deduped_models: Vec<CatalogModelDescriptor> = Vec::with_capacity(models.len());
            for model in models.into_iter() {
                if let Some(existing) = deduped_models
                    .iter_mut()
                    .find(|item| item.id == model.id && item.provider_id == model.provider_id)
                {
                    let prefer_runtime = model.source_kind == CatalogSourceKind::Runtime
                        || (!existing.installed && model.installed);
                    if prefer_runtime {
                        *existing = model;
                    }
                } else {
                    deduped_models.push(model);
                }
            }
            models = deduped_models;
        }

        DomainCatalog { providers, models }
    }

    async fn fetch_runtime_listen_state(&self) -> Option<RuntimeListenState> {
        if self.sidecar_backend() == Some(SidecarBackend::MlxAudio) {
            return Some(self.mlx_audio_runtime_state());
        }

        if let Some(sidecar) = self
            .app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
        {
            let sidecar = Arc::clone(&*sidecar);
            let sidecar_result =
                tokio::task::spawn_blocking(move || sidecar.ensure_running_if_available())
                    .await
                    .ok()?;

            if let Err(err) = sidecar_result {
                warn!("Speech runtime sidecar catalog auto-start failed: {err}");
            }
        }

        let root_url = self.sidecar_root_url()?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .ok()?;

        let catalog = client
            .get(root_url.join("listen/catalog").ok()?)
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?
            .json::<RuntimeListenCatalogResponse>()
            .await
            .ok()?;

        Some(RuntimeListenState {
            providers: catalog.providers,
            models: catalog.models,
            selection: Some(catalog.selection),
        })
    }

    pub async fn sync_runtime_selection(
        &self,
        provider_id: &str,
        model_id: &str,
        profile_id: Option<&str>,
    ) -> Result<(), String> {
        if provider_is_mlx_audio(provider_id)
            && self.sidecar_backend() == Some(SidecarBackend::MlxAudio)
        {
            return Ok(());
        }

        let root_url = self
            .sidecar_root_url()
            .ok_or_else(|| "Failed to resolve the local speech runtime URL.".to_string())?;
        let payload = serde_json::json!({
            "provider_id": provider_id,
            "model_id": model_id,
            "profile_id": profile_id,
        });

        let response = reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
            .map_err(|err| format!("Failed to create runtime client: {err}"))?
            .post(
                root_url
                    .join("listen/selection")
                    .map_err(|err| format!("Failed to build runtime selection URL: {err}"))?,
            )
            .json(&payload)
            .send()
            .await
            .map_err(|err| format!("Failed to save runtime selection: {err}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let detail = body.trim();
            return Err(if detail.is_empty() {
                format!("Runtime selection update failed with HTTP {}.", status)
            } else {
                format!(
                    "Runtime selection update failed with HTTP {}: {}",
                    status, detail
                )
            });
        }

        Ok(())
    }

    fn sidecar_root_url(&self) -> Option<reqwest::Url> {
        self.sidecar_request_url("/")
    }

    fn sidecar_request_url(&self, path: &str) -> Option<reqwest::Url> {
        sidecar_request_url_from_base(&self.sidecar_base_url(), path)
    }

    fn ensure_sidecar_running_blocking(&self, provider_id: &str) -> Result<(), String> {
        if let Some(sidecar) = self
            .app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
        {
            if provider_uses_managed_speech_runtime(provider_id) {
                sidecar.ensure_speech_runtime()?;
            } else if sidecar.backend() == SidecarBackend::MlxAudio {
                sidecar.ensure_running()?;
            } else {
                sidecar.ensure_running_if_available()?;
            }
        }
        Ok(())
    }

    fn fetch_runtime_listen_voices(
        &self,
        provider_id: &str,
        model_id: Option<&str>,
    ) -> Result<Vec<VoiceInfo>, String> {
        if provider_is_mlx_audio(provider_id)
            && self.sidecar_backend() == Some(SidecarBackend::MlxAudio)
        {
            return Ok(Vec::new());
        }

        self.ensure_sidecar_running_blocking(provider_id)?;

        let root_url = self
            .sidecar_root_url()
            .ok_or_else(|| "Failed to resolve the local speech runtime URL.".to_string())?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|err| format!("Failed to create runtime client: {err}"))?;
        let url = root_url
            .join("listen/voices")
            .map_err(|err| format!("Failed to build runtime voice URL: {err}"))?;

        let response = client
            .get(url)
            .query(&[
                ("provider_id", provider_id),
                ("model_id", model_id.unwrap_or("")),
            ])
            .send()
            .map_err(|err| format!("Failed to fetch runtime voice inventory: {err}"))?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            warn!(
                "Speech runtime does not expose /listen/voices yet for provider '{}' model '{}'; returning an empty voice inventory.",
                provider_id,
                model_id.unwrap_or("")
            );
            return Ok(Vec::new());
        }

        if !response.status().is_success() {
            let body = response.text().unwrap_or_default();
            let detail = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|value| {
                    value
                        .get("detail")
                        .and_then(|detail| detail.as_str().map(str::to_string))
                })
                .unwrap_or(body);
            return Err(format!("Failed to fetch runtime voices: {detail}"));
        }

        let runtime_voices = response
            .json::<Vec<RuntimeListenVoiceEntry>>()
            .map_err(|err| format!("Failed to decode runtime voice inventory: {err}"))?;

        Ok(runtime_voices
            .into_iter()
            .map(|voice| VoiceInfo {
                id: voice.id,
                label: voice.label,
                locale: voice.locale,
                engine: TtsEngineKind::Sidecar,
                installed: voice.installed,
                available: voice.available,
            })
            .collect())
    }

    fn runtime_managed_voices(&self, settings: &AppSettings) -> Result<Vec<VoiceInfo>, String> {
        let provider_id = self.selected_provider_id(settings);
        if !provider_uses_managed_speech_runtime(&provider_id) {
            return Ok(Vec::new());
        }

        let model_id = self.selected_model_id(settings);
        self.fetch_runtime_listen_voices(&provider_id, model_id.as_deref())
    }

    pub async fn download_pack(&self, pack_id: &str) -> Result<(), String> {
        if let Some(definition) = PACK_DEFINITIONS
            .iter()
            .find(|definition| definition.id == pack_id)
        {
            let install_dir = self.pack_install_dir(definition.id);
            self.download_and_extract_archive(
                &[
                    self.asset_download_url(definition.archive_name),
                    definition.source_url.to_string(),
                ],
                &install_dir,
                &format!("TTS pack '{}'", definition.label),
            )
            .await?;

            let pack_root = self.installed_pack_root(definition.id).ok_or_else(|| {
                format!(
                    "Downloaded TTS pack '{}' could not be located",
                    definition.id
                )
            })?;
            self.write_default_pack_manifest(definition, &pack_root)?;
            let _ = self.ensure_sherpa_runtime_installed().await?;
            return Ok(());
        }

        if let Some(definition) = QWEN3_PACK_DEFINITIONS
            .iter()
            .find(|definition| definition.id == pack_id)
        {
            return self.install_qwen3_pack(definition).await;
        }

        if let Some(definition) = mlx_audio_tts_model_definition(pack_id) {
            return self.install_mlx_audio_model(definition).await;
        }

        if let Some(definition) = self.managed_runtime_model_definition(pack_id) {
            return self.install_managed_runtime_model(definition).await;
        }

        Err(format!("Unknown TTS pack '{pack_id}'"))
    }

    pub fn remove_pack(&self, pack_id: &str) -> Result<(), String> {
        let install_dir = self.pack_install_dir(pack_id);
        if install_dir.exists() {
            fs::remove_dir_all(&install_dir)
                .map_err(|err| format!("Failed to remove TTS pack: {err}"))?;
        }
        Ok(())
    }

    pub async fn speak(&self, request: SpeakRequest) -> Result<(), String> {
        let settings = get_settings(&self.app_handle);
        let selected_preset = self.resolved_preset_for_request(&settings, &request);
        let mut effective_settings = settings.clone();
        if let Some(preset) = selected_preset.as_ref() {
            effective_settings.tts_active_preset_id = None;
            effective_settings.selected_tts_provider_id = preset.provider_id.clone();
            effective_settings.selected_tts_model_id = Some(preset.model_id.clone());
            effective_settings.selected_tts_profile_id = preset.voice_profile_id.clone();
            effective_settings.selected_tts_voice_id = preset.voice_id.clone();
            effective_settings.tts_default_voice_id = preset.voice_id.clone();
            effective_settings.tts_rate = preset.tuning.tempo_rate.clamp(0.5, 2.0);
        }
        let trimmed = request.text.trim();
        if trimmed.is_empty() {
            return Ok(());
        }

        if let Some(audio_manager) = self
            .app_handle
            .try_state::<Arc<crate::managers::audio::AudioRecordingManager>>()
        {
            if audio_manager.is_recording() {
                return Err("Stop recording before playing speech output.".to_string());
            }
        }

        self.stop();

        if request.remember_last_output {
            self.set_last_output(trimmed.to_string(), request.locale.clone());
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        {
            let mut guard = self
                .current_stop_flag
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *guard = Some(stop_flag.clone());
        }

        let locale = normalize_locale(request.locale.as_deref());
        let engine = self.resolve_engine_kind(&effective_settings, locale.as_deref())?;
        let selected_provider_id = self.selected_provider_id(&effective_settings);
        let selected_model_id = selected_preset
            .as_ref()
            .map(|preset| preset.model_id.clone())
            .or_else(|| self.selected_model_id(&effective_settings));
        let selected_profile_id = selected_preset
            .as_ref()
            .and_then(|preset| preset.voice_profile_id.clone())
            .or_else(|| effective_settings.selected_tts_profile_id.clone());

        let chunks = chunk_text(trimmed);
        if engine == TtsEngineKind::Sidecar {
            if is_preview_trigger(request.trigger.as_deref())
                && provider_uses_managed_speech_runtime(&selected_provider_id)
            {
                self.prepare_sidecar_provider(&selected_provider_id, selected_model_id.as_deref())
                    .await?;
            } else {
                self.ensure_managed_speech_runtime_available(&selected_provider_id)
                    .await?;
                if let Some(sidecar) = self
                    .app_handle
                    .try_state::<Arc<crate::sidecar::SidecarManager>>()
                {
                    let sidecar = Arc::clone(&*sidecar);
                    let uses_speech_runtime =
                        provider_uses_managed_speech_runtime(&selected_provider_id);
                    let ensure_result = tokio::task::spawn_blocking(move || {
                        if uses_speech_runtime {
                            sidecar.ensure_speech_runtime()
                        } else {
                            sidecar.ensure_running()
                        }
                    })
                    .await;
                    match ensure_result {
                        Ok(Ok(())) => {}
                        Ok(Err(err)) => return Err(err),
                        Err(err) => {
                            return Err(format!(
                                "Failed to start the local Speech runtime before playback: {err}"
                            ))
                        }
                    }
                }
            }
        }
        let voice = self.select_voice(
            &effective_settings,
            engine,
            locale.as_deref(),
            request.preferred_voice_id.as_deref(),
        )?;
        let sherpa_context = match engine {
            TtsEngineKind::SherpaOnnx => Some(
                self.prepare_sherpa_context(locale.as_deref(), voice.as_ref())
                    .await?,
            ),
            _ => None,
        };
        let qwen3_context = match engine {
            TtsEngineKind::Qwen3Native => Some(
                self.prepare_qwen3_context(&effective_settings, locale.as_deref(), voice.as_ref())
                    .await?,
            ),
            _ => None,
        };
        let mlx_audio_context = match engine {
            TtsEngineKind::MlxNative => Some(
                self.prepare_mlx_audio_context(&effective_settings, locale.as_deref())
                    .await?,
            ),
            _ => None,
        };
        let tts_volume = settings.tts_volume.clamp(0.0, 1.0);
        let output_device = settings.selected_output_device.clone();
        let app_handle = self.app_handle.clone();
        let preferred_voice_id = request
            .preferred_voice_id
            .clone()
            .or_else(|| voice.as_ref().map(|voice| voice.id.clone()))
            .or_else(|| {
                selected_preset
                    .as_ref()
                    .and_then(|preset| preset.voice_id.clone())
            });
        // For MLX models the voice_id is model-specific (e.g. Kokoro voice
        // names like "af_heart"). Drop any stale voice_id that looks like a
        // model identifier from another provider (e.g. "qwen3-0.6b-base").
        let preferred_voice_id = if engine == TtsEngineKind::MlxNative {
            preferred_voice_id.filter(|voice_id| is_valid_mlx_voice_id(voice_id))
        } else {
            preferred_voice_id
        };
        let tuning = selected_preset
            .as_ref()
            .map(|preset| preset.tuning.clone())
            .unwrap_or(TtsVoiceTuningSettings {
                tempo_rate: effective_settings.tts_rate.clamp(0.5, 2.0),
                expressiveness: 0.5,
                exaggeration: 0.5,
                randomness: 0.7,
                guidance: 0.5,
                stability: 0.5,
                repetition_penalty: 1.2,
                style_instructions: None,
            });
        let trigger = request.trigger.clone();

        info!(
            "Speaking {} chunk(s) with {:?} engine, voice {:?}, preset {:?}, trigger {:?}",
            chunks.len(),
            engine,
            preferred_voice_id,
            selected_preset.as_ref().map(|preset| preset.id.as_str()),
            trigger
        );

        let join_result = tokio::task::spawn_blocking(move || {
            for chunk in chunks {
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }

                match engine {
                    TtsEngineKind::System => {
                        speak_system_chunk(
                            &app_handle,
                            &chunk,
                            locale.as_deref(),
                            voice.as_ref(),
                            tuning.tempo_rate,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::SherpaOnnx => {
                        let sherpa_context = sherpa_context
                            .as_ref()
                            .ok_or_else(|| "No Sherpa-ONNX TTS pack is available.".to_string())?;
                        speak_sherpa_chunk(
                            &chunk,
                            sherpa_context,
                            tuning.tempo_rate,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::Qwen3Native => {
                        let qwen3_context = qwen3_context
                            .as_ref()
                            .ok_or_else(|| "No Qwen3 Native models are available.".to_string())?;
                        speak_qwen3_chunk(
                            &chunk,
                            qwen3_context,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::MlxNative => {
                        let mlx_audio_context = mlx_audio_context
                            .as_ref()
                            .ok_or_else(|| "No MLX speech models are available.".to_string())?;
                        speak_mlx_audio_chunk(
                            &chunk,
                            mlx_audio_context,
                            preferred_voice_id.as_deref(),
                            voice.as_ref(),
                            &tuning,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                    TtsEngineKind::Sidecar => {
                        speak_sidecar_chunk(
                            &chunk,
                            &selected_provider_id,
                            selected_model_id.as_deref(),
                            selected_profile_id.as_deref(),
                            locale.as_deref(),
                            preferred_voice_id.as_deref(),
                            voice.as_ref(),
                            &tuning,
                            tts_volume,
                            output_device.clone(),
                            &stop_flag,
                        )?;
                    }
                }
            }

            Ok::<(), String>(())
        })
        .await
        .map_err(|err| format!("TTS task failed: {err}"))?;
        self.current_stop_flag
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();

        join_result
    }

    pub fn sidecar_base_url(&self) -> String {
        std::env::var("VOX_JOT_TTS_SIDECAR_URL").unwrap_or_else(|_| DEFAULT_SIDECAR_URL.to_string())
    }

    fn tts_asset_base_url(&self) -> String {
        std::env::var("VOX_JOT_TTS_MODELS_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_TTS_ASSET_BASE_URL.to_string())
    }

    fn resolve_engine_kind(
        &self,
        settings: &AppSettings,
        locale: Option<&str>,
    ) -> Result<TtsEngineKind, String> {
        match self.selected_provider_id(settings).as_str() {
            TTS_PROVIDER_SYSTEM_BUILTIN_ID => return self.ensure_system_engine_supported(),
            TTS_PROVIDER_SHERPA_PACK_ID => return Ok(TtsEngineKind::SherpaOnnx),
            TTS_PROVIDER_LOCAL_SIDECAR_API_ID => return self.ensure_sidecar_supported(settings),
            TTS_PROVIDER_QWEN3_NATIVE_ID => return Ok(TtsEngineKind::Qwen3Native),
            provider_id if provider_is_mlx_audio(provider_id) => {
                return self.ensure_mlx_audio_supported()
            }
            TTS_PROVIDER_OPENVOICE_ID
            | TTS_PROVIDER_CHATTERBOX_ID
            | TTS_PROVIDER_KOKORO_ID
            | TTS_PROVIDER_XTTS_ID => return self.ensure_sidecar_supported(settings),
            TTS_PROVIDER_TADA_LOCAL_ID => {
                return Err(
                    "TADA local TTS is planned but not available in this build yet.".to_string(),
                )
            }
            TTS_PROVIDER_HF_S2S_LOCAL_ID => {
                return Err(
                    "HF speech-to-speech TTS is planned but not available in this build yet."
                        .to_string(),
                )
            }
            other if !other.is_empty() => {
                // Unknown provider IDs are assumed to be runtime-managed providers
                // served through the sidecar.
                return self.ensure_sidecar_supported(settings);
            }
            _ => {}
        }

        match settings.tts_engine_preference {
            TtsEnginePreference::System => self.ensure_system_engine_supported(),
            TtsEnginePreference::SherpaOnnx => Ok(TtsEngineKind::SherpaOnnx),
            TtsEnginePreference::Sidecar => self.ensure_sidecar_supported(settings),
            TtsEnginePreference::Auto => {
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                {
                    let _ = locale;
                    self.ensure_system_engine_supported()
                }
                #[cfg(target_os = "linux")]
                {
                    if self.has_installed_pack_for_locale(locale) {
                        Ok(TtsEngineKind::SherpaOnnx)
                    } else {
                        self.ensure_sidecar_supported(settings).or_else(|_| {
                            Err("Install a TTS pack or configure a local sidecar to enable speech output on Linux.".to_string())
                        })
                    }
                }
            }
        }
    }

    fn ensure_mlx_audio_supported(&self) -> Result<TtsEngineKind, String> {
        if mlx_audio_runtime_supported() {
            Ok(TtsEngineKind::MlxNative)
        } else {
            Err("MLX speech models currently require macOS on Apple Silicon.".to_string())
        }
    }

    fn ensure_system_engine_supported(&self) -> Result<TtsEngineKind, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            Ok(TtsEngineKind::System)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("System TTS is not available on this platform.".to_string())
        }
    }

    fn ensure_sidecar_supported(&self, settings: &AppSettings) -> Result<TtsEngineKind, String> {
        let base_url = self.sidecar_base_url();
        if settings.local_privacy_mode && !is_local_base_url(&base_url) {
            return Err("Local privacy mode requires a localhost TTS sidecar URL.".to_string());
        }
        Ok(TtsEngineKind::Sidecar)
    }

    fn asset_download_url(&self, archive_name: &str) -> String {
        format!(
            "{}/{}",
            self.tts_asset_base_url().trim_end_matches('/'),
            archive_name
        )
    }

    fn pack_install_dir(&self, pack_id: &str) -> PathBuf {
        crate::storage_paths::tts_packs_dir(&self.app_handle)
            .unwrap_or_else(|_| default_tts_model_store_dir(&self.app_handle))
            .join(pack_id)
    }

    fn runtime_install_dir(&self, platform_id: &str) -> PathBuf {
        crate::storage_paths::tts_runtime_dir(&self.app_handle)
            .unwrap_or_else(|_| default_tts_model_store_dir(&self.app_handle))
            .join(platform_id)
    }

    fn qwen3_runtime_install_dir(&self, platform_id: &str) -> PathBuf {
        crate::storage_paths::tts_runtime_dir(&self.app_handle)
            .unwrap_or_else(|_| default_tts_model_store_dir(&self.app_handle))
            .join(format!("qwen3-{platform_id}"))
    }

    #[cfg(target_os = "linux")]
    fn has_installed_pack_for_locale(&self, locale: Option<&str>) -> bool {
        let Some(locale) = locale else {
            return self
                .get_available_sherpa_packs()
                .iter()
                .any(|pack| pack.installed);
        };
        self.get_available_sherpa_packs()
            .iter()
            .any(|pack| pack.installed && locale_matches(Some(pack.locale.as_str()), Some(locale)))
    }

    fn installed_pack_voices(&self) -> Vec<VoiceInfo> {
        self.get_available_sherpa_packs()
            .into_iter()
            .filter(|pack| pack.installed)
            .map(|pack| VoiceInfo {
                id: pack.id,
                label: pack.label,
                locale: Some(pack.locale),
                engine: TtsEngineKind::SherpaOnnx,
                installed: true,
                available: true,
            })
            .collect()
    }

    fn installed_pack_root(&self, pack_id: &str) -> Option<PathBuf> {
        resolve_extracted_root(&self.pack_install_dir(pack_id))
    }

    fn definition_for_voice(&self, voice: &VoiceInfo) -> Option<&'static PackDefinition> {
        PACK_DEFINITIONS
            .iter()
            .find(|definition| definition.id == voice.id || definition.voice_id == voice.id)
    }

    async fn prepare_sherpa_context(
        &self,
        locale: Option<&str>,
        voice: Option<&VoiceInfo>,
    ) -> Result<SherpaContext, String> {
        let runtime_root = self.ensure_sherpa_runtime_installed().await?;

        let definition = if let Some(voice) = voice {
            self.definition_for_voice(voice)
        } else {
            PACK_DEFINITIONS.iter().find(|definition| {
                self.installed_pack_root(definition.id).is_some()
                    && locale_matches(Some(definition.locale), locale)
            })
        }
        .or_else(|| {
            PACK_DEFINITIONS
                .iter()
                .find(|definition| self.installed_pack_root(definition.id).is_some())
        })
        .ok_or_else(|| {
            "No Sherpa-ONNX TTS pack is installed yet. Download a pack in Speech Output settings first."
                .to_string()
        })?;

        let pack_root = self
            .installed_pack_root(definition.id)
            .ok_or_else(|| format!("Installed pack '{}' is missing on disk", definition.id))?;
        self.write_default_pack_manifest(definition, &pack_root)?;
        let manifest = self
            .read_pack_manifest(&pack_root)
            .unwrap_or_else(|_| self.default_pack_manifest(definition));

        Ok(SherpaContext {
            runtime_root,
            pack_root,
            manifest,
        })
    }

    async fn ensure_sherpa_runtime_installed(&self) -> Result<PathBuf, String> {
        let definition = sherpa_runtime_definition().ok_or_else(|| {
            "Sherpa-ONNX runtime is not supported on this platform yet.".to_string()
        })?;

        let install_dir = self.runtime_install_dir(definition.platform_id);
        if let Some(root) = resolve_extracted_root(&install_dir) {
            if sherpa_runtime_binary_path(&root).exists() {
                return Ok(root);
            }
        }

        self.download_and_extract_archive(
            &[
                self.asset_download_url(definition.archive_name),
                definition.source_url.to_string(),
            ],
            &install_dir,
            "Sherpa-ONNX runtime",
        )
        .await?;

        let root = resolve_extracted_root(&install_dir).ok_or_else(|| {
            "Sherpa-ONNX runtime extraction did not produce any files.".to_string()
        })?;
        if !sherpa_runtime_binary_path(&root).exists() {
            return Err(
                "Sherpa-ONNX runtime download completed, but the offline-tts binary is missing."
                    .to_string(),
            );
        }

        Ok(root)
    }

    async fn ensure_qwen3_runtime_installed(&self) -> Result<PathBuf, String> {
        let (platform_id, archive_name, source_url) =
            qwen3_runtime_definition().ok_or_else(|| {
                "Qwen3 TTS runtime is not supported on this platform yet.".to_string()
            })?;

        let install_dir = self.qwen3_runtime_install_dir(platform_id);
        if let Some(root) = resolve_extracted_root(&install_dir) {
            if qwen3_runtime_binary_path(&root).exists() {
                return Ok(root);
            }
        }

        self.download_and_extract_archive(
            &[
                self.asset_download_url(archive_name),
                source_url.to_string(),
            ],
            &install_dir,
            "Qwen3 Native runtime",
        )
        .await?;

        let root = resolve_extracted_root(&install_dir).ok_or_else(|| {
            "Qwen3 Native runtime extraction did not produce any files.".to_string()
        })?;
        if !qwen3_runtime_binary_path(&root).exists() {
            return Err(
                "Qwen3 Native runtime download completed, but the binary is missing.".to_string(),
            );
        }

        Ok(root)
    }

    fn installed_qwen3_voices(&self) -> Vec<VoiceInfo> {
        QWEN3_PACK_DEFINITIONS
            .iter()
            .filter(|definition| self.resolved_qwen3_pack_root(definition).is_some())
            .map(|def| VoiceInfo {
                id: def.id.to_string(),
                label: def.label.to_string(),
                locale: Some(def.locale.to_string()),
                engine: TtsEngineKind::Qwen3Native,
                installed: true,
                available: true,
            })
            .collect()
    }

    async fn prepare_qwen3_context(
        &self,
        settings: &AppSettings,
        locale: Option<&str>,
        voice: Option<&VoiceInfo>,
    ) -> Result<Qwen3Context, String> {
        let runtime_root = self.ensure_qwen3_runtime_installed().await?;

        let voice = voice
            .cloned()
            .or_else(|| self.installed_qwen3_voices().first().cloned())
            .ok_or_else(|| {
                "No Qwen3 Native models installed. Download one from settings.".to_string()
            })?;

        let model_root = self
            .resolved_qwen3_pack_root(
                QWEN3_PACK_DEFINITIONS
                    .iter()
                    .find(|definition| definition.id == voice.id)
                    .ok_or_else(|| {
                        format!("Unknown Qwen3 model '{}' is not supported", voice.id)
                    })?,
            )
            .ok_or_else(|| format!("Installed Qwen3 model '{}' is missing on disk", voice.id))?;

        let clone_profile = self.resolve_qwen3_clone_profile(settings, &voice.id)?;

        Ok(Qwen3Context {
            runtime_root,
            model_root,
            clone_profile,
            language: qwen3_language_for_locale(locale),
        })
    }

    async fn prepare_mlx_audio_context(
        &self,
        settings: &AppSettings,
        locale: Option<&str>,
    ) -> Result<MlxAudioContext, String> {
        let provider_id = self.selected_provider_id(settings);
        let definition = settings
            .explicit_active_tts_preset()
            .and_then(|preset| mlx_audio_tts_model_definition(&preset.model_id))
            .or_else(|| {
                settings
                    .selected_tts_model_id
                    .as_deref()
                    .and_then(mlx_audio_tts_model_definition)
            })
            .or_else(|| first_mlx_audio_model_for_provider(&provider_id))
            .ok_or_else(|| format!("No MLX model is configured for provider '{provider_id}'."))?;
        ensure_mlx_audio_definition_available(definition)?;
        let model_root = self.ensure_mlx_audio_model_root(definition)?;

        let sidecar = self
            .app_handle
            .try_state::<Arc<crate::sidecar::SidecarManager>>()
            .map(|state| Arc::clone(&*state))
            .ok_or_else(|| "MLX speech runtime manager is not available.".to_string())?;
        let python_path =
            tokio::task::spawn_blocking(move || sidecar.ensure_mlx_audio_environment())
                .await
                .map_err(|err| format!("Failed to prepare mlx-audio environment: {err}"))??;
        let bridge_script_path =
            portable::resolve_resource(&self.app_handle, "resources/python/mlx_audio_generate.py")
                .map_err(|err| format!("Failed to resolve MLX audio bridge script: {err}"))?;
        if !bridge_script_path.exists() {
            return Err(format!(
                "MLX audio bridge script is missing: {}",
                bridge_script_path.display()
            ));
        }

        Ok(MlxAudioContext {
            provider_id: definition.provider_id.to_string(),
            model_id: definition.model_id.to_string(),
            model_label: definition.label.to_string(),
            python_path,
            bridge_script_path,
            model_source: model_root.to_string_lossy().to_string(),
            clone_profile: self.resolve_mlx_audio_clone_profile(settings, definition)?,
            language: mlx_audio_language_for_locale(locale),
            supports_instruction_prompt: definition.supports_instruction_prompt,
        })
    }

    fn resolve_qwen3_clone_profile(
        &self,
        settings: &AppSettings,
        model_id: &str,
    ) -> Result<Option<Qwen3CloneProfile>, String> {
        let Some(profile_id) = settings
            .selected_tts_profile_id
            .as_deref()
            .filter(|profile_id| !profile_id.trim().is_empty())
        else {
            return Ok(None);
        };

        if model_id != "qwen3-0.6b-base" {
            return Err(
                "Voice cloning currently requires the Qwen3 0.6B Base model. Switch the speech model or clear the selected voice profile."
                    .to_string(),
            );
        }

        let profile = tts_profiles::resolve_voice_profile(&self.app_handle, profile_id)?;
        ensure_profile_supports_qwen3_base(&profile)?;

        Ok(Some(Qwen3CloneProfile {
            reference_audio_path: profile.reference_audio_path,
            transcript: profile.transcript,
        }))
    }

    fn resolve_mlx_audio_clone_profile(
        &self,
        settings: &AppSettings,
        definition: &MlxAudioTtsModelDefinition,
    ) -> Result<Option<MlxAudioCloneProfile>, String> {
        let Some(profile_id) = settings
            .selected_tts_profile_id
            .as_deref()
            .filter(|profile_id| !profile_id.trim().is_empty())
        else {
            return Ok(None);
        };

        if !definition.supports_voice_cloning {
            return Ok(None);
        }

        let profile = tts_profiles::resolve_voice_profile(&self.app_handle, profile_id)?;
        let provider_compatible = profile.compatible_provider_ids.is_empty()
            || profile
                .compatible_provider_ids
                .iter()
                .any(|provider_id| provider_id == definition.provider_id);
        let model_compatible = profile.compatible_model_ids.is_empty()
            || profile
                .compatible_model_ids
                .iter()
                .any(|model_id| model_id == definition.model_id);

        if !(provider_compatible && model_compatible) {
            return Ok(None);
        }

        Ok(Some(MlxAudioCloneProfile {
            reference_audio_path: profile.reference_audio_path,
            transcript: profile.transcript,
        }))
    }

    async fn download_and_extract_archive(
        &self,
        candidate_urls: &[String],
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        let download_dir = crate::storage_paths::tts_downloads_dir(&self.app_handle)
            .map_err(|err| format!("TTS dir error: {err}"))?;
        fs::create_dir_all(&download_dir)
            .map_err(|err| format!("Failed to create TTS download dir: {err}"))?;

        let mut last_error = None;
        for url in candidate_urls {
            match self.download_archive(url, &download_dir, label).await {
                Ok(archive_path) => {
                    let extract_result = extract_archive(&archive_path, install_dir);
                    let _ = fs::remove_file(&archive_path);
                    return extract_result;
                }
                Err(err) => last_error = Some(err),
            }
        }

        Err(last_error.unwrap_or_else(|| format!("Failed to download {label}.")))
    }

    async fn download_archive(
        &self,
        url: &str,
        download_dir: &Path,
        label: &str,
    ) -> Result<PathBuf, String> {
        let client = reqwest::Client::new();
        let response = github_release::get_with_optional_github_auth(&client, url, None)
            .await
            .map_err(|err| format!("Failed to download {label}: {err}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Failed to download {label}: HTTP {} ({url})",
                response.status()
            ));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|err| format!("Failed to read {label} bytes: {err}"))?;

        let file_name = url
            .split('/')
            .next_back()
            .filter(|name| !name.is_empty())
            .unwrap_or("tts-asset.tar.gz");
        let archive_path = download_dir.join(format!("{}-{}", Uuid::new_v4(), file_name));
        fs::write(&archive_path, bytes).map_err(|err| format!("Failed to save {label}: {err}"))?;
        Ok(archive_path)
    }

    /// Download all files from a HuggingFace model repository into `install_dir`.
    /// Used as a fallback for models too large for GitHub release assets (>2 GB).
    async fn download_hf_snapshot(
        &self,
        repo_id: &str,
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        #[derive(Deserialize)]
        struct HfSibling {
            rfilename: String,
        }
        #[derive(Deserialize)]
        struct HfModelInfo {
            siblings: Vec<HfSibling>,
        }

        let client = reqwest::Client::new();
        let api_url = format!("https://huggingface.co/api/models/{repo_id}");
        info!("HF snapshot: listing files from {api_url}");

        let model_info: HfModelInfo = client
            .get(&api_url)
            .send()
            .await
            .map_err(|e| format!("Failed to query HuggingFace API for {label}: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse HuggingFace API response for {label}: {e}"))?;

        if install_dir.exists() {
            fs::remove_dir_all(install_dir)
                .map_err(|e| format!("Failed to clear install dir for {label}: {e}"))?;
        }
        // Create a subdirectory matching the repo basename so the extracted
        // layout mirrors the GitHub-release tar structure (archive contains a
        // single top-level directory named after the pack id).
        let inner_dir = install_dir.join(repo_id.rsplit('/').next().unwrap_or(repo_id));
        fs::create_dir_all(&inner_dir)
            .map_err(|e| format!("Failed to create install dir for {label}: {e}"))?;

        for sibling in &model_info.siblings {
            let file_url = format!(
                "https://huggingface.co/{repo_id}/resolve/main/{}",
                sibling.rfilename
            );
            let dest = inner_dir.join(&sibling.rfilename);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Failed to create directory for {}: {e}", sibling.rfilename)
                })?;
            }
            info!("HF snapshot: downloading {}", sibling.rfilename);
            let response = client
                .get(&file_url)
                .send()
                .await
                .map_err(|e| format!("Failed to download {}: {e}", sibling.rfilename))?;
            if !response.status().is_success() {
                return Err(format!(
                    "Failed to download {}: HTTP {}",
                    sibling.rfilename,
                    response.status()
                ));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("Failed to read {}: {e}", sibling.rfilename))?;
            fs::write(&dest, bytes)
                .map_err(|e| format!("Failed to write {}: {e}", sibling.rfilename))?;
        }

        info!(
            "HF snapshot: completed {label} ({} files)",
            model_info.siblings.len()
        );
        Ok(())
    }

    async fn download_hf_snapshot_into_exact_dir(
        &self,
        repo_id: &str,
        install_dir: &Path,
        label: &str,
    ) -> Result<(), String> {
        #[derive(Deserialize)]
        struct HfSibling {
            rfilename: String,
        }
        #[derive(Deserialize)]
        struct HfModelInfo {
            siblings: Vec<HfSibling>,
        }

        let client = reqwest::Client::new();
        let api_url = format!("https://huggingface.co/api/models/{repo_id}");
        info!("HF snapshot: listing files from {api_url}");

        let model_info: HfModelInfo = client
            .get(&api_url)
            .send()
            .await
            .map_err(|e| format!("Failed to query HuggingFace API for {label}: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse HuggingFace API response for {label}: {e}"))?;

        if install_dir.exists() {
            fs::remove_dir_all(install_dir)
                .map_err(|e| format!("Failed to clear install dir for {label}: {e}"))?;
        }
        fs::create_dir_all(install_dir)
            .map_err(|e| format!("Failed to create install dir for {label}: {e}"))?;

        for sibling in &model_info.siblings {
            let file_url = format!(
                "https://huggingface.co/{repo_id}/resolve/main/{}",
                sibling.rfilename
            );
            let dest = install_dir.join(&sibling.rfilename);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Failed to create directory for {}: {e}", sibling.rfilename)
                })?;
            }
            info!("HF snapshot: downloading {}", sibling.rfilename);
            let response = client
                .get(&file_url)
                .send()
                .await
                .map_err(|e| format!("Failed to download {}: {e}", sibling.rfilename))?;
            if !response.status().is_success() {
                return Err(format!(
                    "Failed to download {}: HTTP {}",
                    sibling.rfilename,
                    response.status()
                ));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("Failed to read {}: {e}", sibling.rfilename))?;
            fs::write(&dest, bytes)
                .map_err(|e| format!("Failed to write {}: {e}", sibling.rfilename))?;
        }

        info!(
            "HF snapshot: completed {label} ({} files)",
            model_info.siblings.len()
        );
        Ok(())
    }

    fn default_pack_manifest(&self, definition: &PackDefinition) -> SherpaPackManifest {
        SherpaPackManifest {
            id: definition.id.to_string(),
            label: definition.label.to_string(),
            locale: definition.locale.to_string(),
            source_url: definition.source_url.to_string(),
            source_name: definition.source_name.to_string(),
            model_family: definition.model_family,
            model_file: definition.model_file.to_string(),
            tokens_file: definition.tokens_file.to_string(),
            data_dir: definition.data_dir.map(ToString::to_string),
            lexicon_file: definition.lexicon_file.map(ToString::to_string),
            rule_fsts: definition
                .rule_fsts
                .iter()
                .map(|value| value.to_string())
                .collect(),
        }
    }

    fn write_default_pack_manifest(
        &self,
        definition: &PackDefinition,
        pack_root: &Path,
    ) -> Result<(), String> {
        let manifest_path = pack_root.join(PACK_MANIFEST_NAME);
        if manifest_path.exists() {
            return Ok(());
        }

        let manifest = self.default_pack_manifest(definition);
        let bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|err| format!("Failed to serialize TTS pack manifest: {err}"))?;
        fs::write(&manifest_path, bytes)
            .map_err(|err| format!("Failed to write TTS pack manifest: {err}"))
    }

    fn read_pack_manifest(&self, pack_root: &Path) -> Result<SherpaPackManifest, String> {
        let bytes = fs::read(pack_root.join(PACK_MANIFEST_NAME))
            .map_err(|err| format!("Failed to read TTS pack manifest: {err}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|err| format!("Failed to parse TTS pack manifest: {err}"))
    }

    fn system_voices(&self) -> Result<Vec<VoiceInfo>, String> {
        {
            let cache = self
                .cached_system_voices
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(voices) = cache.as_ref() {
                return Ok(voices.clone());
            }
        }

        let voices = {
            #[cfg(target_os = "macos")]
            {
                macos_system_voices()?
            }
            #[cfg(target_os = "windows")]
            {
                windows_system_voices()?
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                Vec::new()
            }
        };

        let mut cache = self
            .cached_system_voices
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *cache = Some(voices.clone());
        Ok(voices)
    }

    /// Clear the cached system voices so the next call re-enumerates.
    pub fn invalidate_voice_cache(&self) {
        let mut cache = self
            .cached_system_voices
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *cache = None;
    }

    fn select_voice(
        &self,
        settings: &AppSettings,
        engine: TtsEngineKind,
        locale: Option<&str>,
        preferred_voice_id: Option<&str>,
    ) -> Result<Option<VoiceInfo>, String> {
        let voices = match engine {
            TtsEngineKind::System => self.system_voices()?,
            TtsEngineKind::SherpaOnnx => self.installed_pack_voices(),
            TtsEngineKind::MlxNative => self.mlx_audio_voice_inventory(settings),
            TtsEngineKind::Qwen3Native => self.installed_qwen3_voices(),
            TtsEngineKind::Sidecar => Vec::new(),
        };

        if voices.is_empty() {
            return Ok(None);
        }

        if let Some(voice_id) = preferred_voice_id {
            if let Some(voice) = voices.iter().find(|voice| voice.id == voice_id) {
                return Ok(Some(voice.clone()));
            }
        }

        if let Some(voice_id) = settings
            .selected_tts_voice_id
            .as_deref()
            .filter(|voice_id| !voice_id.trim().is_empty())
        {
            if let Some(voice) = voices.iter().find(|voice| voice.id == voice_id) {
                return Ok(Some(voice.clone()));
            }
        }

        if let Some(model_id) = settings
            .selected_tts_model_id
            .as_deref()
            .filter(|model_id| !model_id.trim().is_empty())
        {
            if let Some(voice) = voices.iter().find(|voice| voice.id == model_id) {
                return Ok(Some(voice.clone()));
            }
        }

        if let Some(voice_id) = settings
            .tts_default_voice_id
            .as_deref()
            .filter(|voice_id| !voice_id.trim().is_empty())
        {
            if let Some(voice) = voices.iter().find(|voice| voice.id == voice_id) {
                return Ok(Some(voice.clone()));
            }
        }

        if let Some(locale) = locale {
            if let Some(voice) = voices
                .iter()
                .find(|voice| locale_matches(voice.locale.as_deref(), Some(locale)))
            {
                return Ok(Some(voice.clone()));
            }

            let language = locale_language(locale);
            if let Some(voice) = voices.iter().find(|voice| {
                voice
                    .locale
                    .as_deref()
                    .map(locale_language)
                    .map(|voice_language| voice_language == language)
                    .unwrap_or(false)
            }) {
                return Ok(Some(voice.clone()));
            }
        }

        Ok(voices.first().cloned())
    }
}

#[cfg(target_os = "macos")]
fn macos_system_voices() -> Result<Vec<VoiceInfo>, String> {
    let output = Command::new("/usr/bin/say")
        .args(["-v", "?"])
        .output()
        .map_err(|err| format!("Failed to enumerate macOS voices: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut voices = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(captures) = SAY_VOICE_RE.captures(trimmed) {
            let name = captures
                .name("name")
                .map(|value| value.as_str().trim().to_string())
                .unwrap_or_default();
            let locale = captures
                .name("locale")
                .map(|value| value.as_str().replace('_', "-"));
            voices.push(VoiceInfo {
                id: name.clone(),
                label: name,
                locale,
                engine: TtsEngineKind::System,
                installed: true,
                available: true,
            });
        }
    }

    Ok(voices)
}

#[cfg(target_os = "windows")]
fn windows_system_voices() -> Result<Vec<VoiceInfo>, String> {
    let script = r#"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object {
  $info = $_.VoiceInfo
  [PSCustomObject]@{
    id = $info.Name
    label = $info.Name
    locale = $info.Culture.Name
  }
}
$voices | ConvertTo-Json -Compress
"#;
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .map_err(|err| format!("Failed to enumerate Windows voices: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|err| format!("Failed to parse Windows voices: {err}"))?;
    let entries = match parsed {
        serde_json::Value::Array(values) => values,
        serde_json::Value::Object(_) => vec![parsed],
        _ => Vec::new(),
    };

    let voices = entries
        .into_iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?.to_string();
            let label = entry
                .get("label")
                .and_then(|value| value.as_str())
                .unwrap_or(&id)
                .to_string();
            let locale = entry
                .get("locale")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());
            Some(VoiceInfo {
                id,
                label,
                locale,
                engine: TtsEngineKind::System,
                installed: true,
                available: true,
            })
        })
        .collect();

    Ok(voices)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn windows_system_voices() -> Result<Vec<VoiceInfo>, String> {
    Ok(Vec::new())
}

fn sherpa_runtime_definition() -> Option<SherpaRuntimeDefinition> {
    #[cfg(target_os = "macos")]
    {
        return Some(SherpaRuntimeDefinition {
            platform_id: "macos-universal2",
            archive_name: "tts-sherpa-runtime-macos-universal2.tar.gz",
            source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-osx-universal2-shared.tar.bz2",
        });
    }
    #[cfg(target_os = "linux")]
    {
        return Some(SherpaRuntimeDefinition {
            platform_id: "linux-x64",
            archive_name: "tts-sherpa-runtime-linux-x64.tar.gz",
            source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-linux-x64-shared.tar.bz2",
        });
    }
    #[cfg(target_os = "windows")]
    {
        return Some(SherpaRuntimeDefinition {
            platform_id: "windows-x64",
            archive_name: "tts-sherpa-runtime-win-x64.tar.gz",
            source_url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-v1.12.20-win-x64-shared.tar.bz2",
        });
    }
    #[allow(unreachable_code)]
    None
}

fn sherpa_runtime_binary_path(runtime_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return runtime_root.join("bin").join("sherpa-onnx-offline-tts.exe");
    }
    #[cfg(not(target_os = "windows"))]
    {
        runtime_root.join("bin").join("sherpa-onnx-offline-tts")
    }
}

fn current_runtime_platform_id() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "darwin"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        "unknown"
    }
}

fn managed_speech_runtime_definition() -> Option<ManagedSpeechRuntimeDefinition> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Some(ManagedSpeechRuntimeDefinition {
            platform_id: "macos-aarch64",
            archive_name: "speech-runtime-macos-aarch64.tar.gz",
        });
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Some(ManagedSpeechRuntimeDefinition {
            platform_id: "macos-x64",
            archive_name: "speech-runtime-macos-x64.tar.gz",
        });
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Some(ManagedSpeechRuntimeDefinition {
            platform_id: "linux-x64",
            archive_name: "speech-runtime-linux-x64.tar.gz",
        });
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Some(ManagedSpeechRuntimeDefinition {
            platform_id: "windows-x64",
            archive_name: "speech-runtime-windows-x64.tar.gz",
        });
    }
    #[allow(unreachable_code)]
    None
}

fn managed_speech_runtime_entrypoint(runtime_root: &Path) -> Option<PathBuf> {
    [
        runtime_root.join("runtime").join("app.py"),
        runtime_root.join("app.py"),
    ]
    .into_iter()
    .find(|candidate| candidate.exists())
}

fn qwen3_runtime_definition() -> Option<(&'static str, &'static str, &'static str)> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Some((
            "macos-aarch64",
            "qwen3-tts-macos-aarch64.zip",
            "https://github.com/second-state/qwen3_tts_rs/releases/download/v0.1.5/qwen3-tts-macos-aarch64.zip",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        return Some((
            "linux-x64",
            "qwen3-tts-linux-x86_64.zip",
            "https://github.com/second-state/qwen3_tts_rs/releases/download/v0.1.5/qwen3-tts-linux-x86_64.zip",
        ));
    }
    #[cfg(target_os = "windows")]
    {
        return Some((
            "windows-x64",
            "qwen3-tts-windows-x86_64.zip",
            "https://github.com/second-state/qwen3_tts_rs/releases/download/v0.1.5/qwen3-tts-windows-x86_64.zip",
        ));
    }
    #[allow(unreachable_code)]
    None
}

fn qwen3_runtime_binary_path(runtime_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        runtime_root.join("tts.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        runtime_root.join("tts")
    }
}

fn qwen3_voice_clone_binary_path(runtime_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        runtime_root.join("voice_clone.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        runtime_root.join("voice_clone")
    }
}

fn qwen3_language_for_locale(locale: Option<&str>) -> String {
    match locale.map(locale_language).as_deref() {
        Some("zh") => "chinese".to_string(),
        _ => "english".to_string(),
    }
}

fn mlx_audio_language_for_locale(locale: Option<&str>) -> String {
    locale
        .map(locale_language)
        .filter(|language| !language.trim().is_empty())
        .unwrap_or_else(|| "en".to_string())
}

fn ensure_profile_supports_qwen3_base(profile: &ResolvedTtsVoiceProfile) -> Result<(), String> {
    if !profile
        .compatible_provider_ids
        .iter()
        .any(|provider_id| provider_id == TTS_PROVIDER_QWEN3_NATIVE_ID)
    {
        return Err(format!(
            "Voice profile '{}' is not marked as compatible with Qwen3 Native.",
            profile.label
        ));
    }

    if !profile
        .compatible_model_ids
        .iter()
        .any(|model_id| model_id == "qwen3-0.6b-base")
    {
        return Err(format!(
            "Voice profile '{}' is not marked as compatible with Qwen3 0.6B Base.",
            profile.label
        ));
    }

    Ok(())
}

fn resolve_extracted_root(base_dir: &Path) -> Option<PathBuf> {
    if !base_dir.exists() {
        return None;
    }

    let mut current = base_dir.to_path_buf();
    loop {
        let entries = fs::read_dir(&current).ok()?;
        let mut child_dirs = Vec::new();
        let mut saw_file = false;

        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with('.'))
                .unwrap_or(false)
            {
                continue;
            }

            if entry.file_type().ok()?.is_dir() {
                child_dirs.push(path);
            } else {
                saw_file = true;
            }
        }

        if !saw_file && child_dirs.len() == 1 {
            current = child_dirs.pop().unwrap();
            continue;
        }

        return Some(current);
    }
}

fn copy_directory_recursive(source_dir: &Path, destination_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination_dir)?;

    for entry in fs::read_dir(source_dir)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination_dir.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_directory_recursive(&source_path, &destination_path)?;
        } else {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

fn extract_archive(archive_path: &Path, install_dir: &Path) -> Result<(), String> {
    if install_dir.exists() {
        fs::remove_dir_all(install_dir)
            .map_err(|err| format!("Failed to clear archive destination: {err}"))?;
    }
    fs::create_dir_all(install_dir)
        .map_err(|err| format!("Failed to create archive destination: {err}"))?;

    let file = File::open(archive_path)
        .map_err(|err| format!("Failed to open archive {:?}: {err}", archive_path))?;
    let archive_name = archive_path.to_string_lossy();

    if archive_name.ends_with(".tar.gz") {
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(install_dir)
            .map_err(|err| format!("Failed to extract tar.gz archive: {err}"))?;
    } else if archive_name.ends_with(".tar.bz2") {
        let decoder = bzip2::read::BzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(install_dir)
            .map_err(|err| format!("Failed to extract tar.bz2 archive: {err}"))?;
    } else if archive_name.ends_with(".zip") {
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|err| format!("Failed to read zip archive: {err}"))?;
        archive
            .extract(install_dir)
            .map_err(|err| format!("Failed to extract zip archive: {err}"))?;
    } else {
        return Err(format!(
            "Unsupported TTS archive format: {}",
            archive_path.display()
        ));
    }

    Ok(())
}

fn speak_sherpa_chunk(
    text: &str,
    context: &SherpaContext,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Ok(());
    }

    let temp_file = std::env::temp_dir().join(format!("vox-jot-sherpa-{}.wav", Uuid::new_v4()));
    let binary_path = sherpa_runtime_binary_path(&context.runtime_root);
    let lib_dir = context.runtime_root.join("lib");
    let mut command = Command::new(&binary_path);
    command
        .arg(format!("--output-filename={}", temp_file.display()))
        .arg("--num-threads=2");

    match context.manifest.model_family {
        SherpaModelFamily::Vits => {
            command
                .arg(format!(
                    "--vits-model={}",
                    context
                        .pack_root
                        .join(&context.manifest.model_file)
                        .display()
                ))
                .arg(format!(
                    "--vits-tokens={}",
                    context
                        .pack_root
                        .join(&context.manifest.tokens_file)
                        .display()
                ))
                .arg(format!(
                    "--vits-length-scale={:.3}",
                    (1.0 / rate.clamp(0.5, 2.0)).clamp(0.5, 2.0)
                ));

            if let Some(data_dir) = context.manifest.data_dir.as_deref() {
                command.arg(format!(
                    "--vits-data-dir={}",
                    context.pack_root.join(data_dir).display()
                ));
            }
            if let Some(lexicon_file) = context.manifest.lexicon_file.as_deref() {
                command.arg(format!(
                    "--vits-lexicon={}",
                    context.pack_root.join(lexicon_file).display()
                ));
            }
        }
    }

    if !context.manifest.rule_fsts.is_empty() {
        let joined = context
            .manifest
            .rule_fsts
            .iter()
            .map(|file| context.pack_root.join(file).display().to_string())
            .collect::<Vec<_>>()
            .join(",");
        command.arg(format!("--tts-rule-fsts={}", joined));
    }

    #[cfg(target_os = "macos")]
    command.env("DYLD_LIBRARY_PATH", &lib_dir);
    #[cfg(target_os = "linux")]
    command.env("LD_LIBRARY_PATH", &lib_dir);
    #[cfg(target_os = "windows")]
    {
        let existing_path = std::env::var_os("PATH").unwrap_or_default();
        let mut runtime_path = std::ffi::OsString::from(lib_dir.as_os_str());
        runtime_path.push(";");
        runtime_path.push(context.runtime_root.join("bin"));
        runtime_path.push(";");
        runtime_path.push(existing_path);
        command.env("PATH", runtime_path);
    }

    let output = command
        .arg(text)
        .output()
        .map_err(|err| format!("Failed to run Sherpa-ONNX TTS: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            format!("Sherpa-ONNX TTS failed: {stderr}")
        } else if !stdout.is_empty() {
            format!("Sherpa-ONNX TTS failed: {stdout}")
        } else {
            "Sherpa-ONNX TTS failed without a detailed error.".to_string()
        });
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = fs::remove_file(&temp_file);
        return Ok(());
    }

    let play_result =
        audio_playback::play_audio_file_with_stop(&temp_file, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play Sherpa-ONNX speech audio: {err}"));
    let _ = fs::remove_file(&temp_file);
    play_result
}

fn speak_qwen3_chunk(
    text: &str,
    context: &Qwen3Context,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Ok(());
    }

    let binary_path = if context.clone_profile.is_some() {
        qwen3_voice_clone_binary_path(&context.runtime_root)
    } else {
        qwen3_runtime_binary_path(&context.runtime_root)
    };
    if !binary_path.exists() {
        return Err(format!(
            "Qwen3 runtime binary is missing: {}",
            binary_path.display()
        ));
    }

    let temp_dir = std::env::temp_dir();
    let file_uuid = Uuid::new_v4().to_string();
    let temp_cwd = temp_dir.join(format!("qwen3-{}", file_uuid));
    std::fs::create_dir_all(&temp_cwd)
        .map_err(|e| format!("Failed to create temp qwen3 dir: {}", e))?;

    let mut command = Command::new(&binary_path);
    command.current_dir(&temp_cwd);
    command.arg(&context.model_root);
    if let Some(profile) = context.clone_profile.as_ref() {
        command.arg(&profile.reference_audio_path);
        command.arg(text);
        command.arg(&context.language);
        if let Some(transcript) = profile.transcript.as_deref() {
            command.arg(transcript);
        }
    } else {
        command.arg(text);
    }

    let output = command
        .output()
        .map_err(|err| format!("Failed to run Qwen3 TTS: {err}"))?;

    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            format!(
                "Qwen3 {} failed: {stderr}",
                if context.clone_profile.is_some() {
                    "voice cloning"
                } else {
                    "TTS"
                }
            )
        } else if !stdout.is_empty() {
            format!(
                "Qwen3 {} failed: {stdout}",
                if context.clone_profile.is_some() {
                    "voice cloning"
                } else {
                    "TTS"
                }
            )
        } else {
            format!(
                "Qwen3 {} failed without a detailed error.",
                if context.clone_profile.is_some() {
                    "voice cloning"
                } else {
                    "TTS"
                }
            )
        });
    }

    let out_wav = temp_cwd.join("output_voice_clone.wav");
    let out_wav_standard = temp_cwd.join("output.wav");
    let actual_out_wav = if out_wav.exists() {
        out_wav
    } else {
        out_wav_standard
    };

    if !actual_out_wav.exists() {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Err("Qwen3 TTS succeeded but no output wav file was found.".to_string());
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Ok(());
    }

    let play_result = audio_playback::play_audio_file_with_stop(
        &actual_out_wav,
        output_device,
        volume,
        stop_flag,
    )
    .map_err(|err| format!("Failed to play Qwen3 speech audio: {err}"));

    let _ = std::fs::remove_dir_all(&temp_cwd);
    play_result
}

/// Returns true when `id` matches a known TTS model/pack identifier from any
/// provider. Used to detect stale voice_id values that were actually model IDs
/// carried over from a previous provider selection.
fn is_known_tts_model_id(id: &str) -> bool {
    PACK_DEFINITIONS.iter().any(|p| p.id == id)
        || QWEN3_PACK_DEFINITIONS.iter().any(|p| p.id == id)
        || MLX_AUDIO_TTS_MODEL_DEFINITIONS
            .iter()
            .any(|d| d.model_id == id)
        || MANAGED_RUNTIME_MODEL_DEFINITIONS
            .iter()
            .any(|d| d.model_id == id)
}

/// Repair a WAV file whose RIFF header size doesn't match the actual file size.
/// mlx-audio can produce files where the RIFF size field is short by a few bytes,
/// causing symphonia/rodio to truncate or silently skip audio data.
fn repair_wav_riff_header(path: &Path) {
    use std::io::{Read, Seek, SeekFrom, Write};
    let Ok(mut file) = fs::OpenOptions::new().read(true).write(true).open(path) else {
        return;
    };
    let Ok(file_size) = file.seek(SeekFrom::End(0)) else {
        return;
    };
    if file_size < 8 {
        return;
    }
    let mut header = [0u8; 4];
    let _ = file.seek(SeekFrom::Start(0));
    if file.read_exact(&mut header).is_err() || &header != b"RIFF" {
        return;
    }
    let mut size_buf = [0u8; 4];
    if file.read_exact(&mut size_buf).is_err() {
        return;
    }
    let declared = u32::from_le_bytes(size_buf);
    let expected = (file_size - 8) as u32;
    if declared != expected {
        let _ = file.seek(SeekFrom::Start(4));
        let _ = file.write_all(&expected.to_le_bytes());
    }
}

fn speak_mlx_audio_chunk(
    text: &str,
    context: &MlxAudioContext,
    preferred_voice_id: Option<&str>,
    voice: Option<&VoiceInfo>,
    tuning: &TtsVoiceTuningSettings,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Ok(());
    }

    let mlx_target = format!(
        "MLX speech provider '{}' model '{}' ({})",
        context.provider_id, context.model_id, context.model_label
    );

    let temp_dir = std::env::temp_dir();
    let file_uuid = Uuid::new_v4().to_string();
    let temp_cwd = temp_dir.join(format!("mlx-audio-{}", file_uuid));
    std::fs::create_dir_all(&temp_cwd)
        .map_err(|err| format!("Failed to create temp MLX audio dir: {err}"))?;
    let output_path = temp_cwd.join("output.wav");

    let mut command = Command::new(&context.python_path);
    command
        .arg("-W")
        .arg("ignore")
        .arg(&context.bridge_script_path)
        .arg("--model")
        .arg(&context.model_source)
        .arg("--text")
        .arg(text)
        .arg("--output")
        .arg(&output_path)
        .arg("--lang-code")
        .arg(&context.language)
        .arg("--speed")
        .arg(tuning.tempo_rate.clamp(0.5, 2.0).to_string())
        .arg("--temperature")
        .arg(tuning.randomness.clamp(0.0, 2.0).to_string())
        .arg("--repetition-penalty")
        .arg(tuning.repetition_penalty.max(1.0).to_string())
        .current_dir(&temp_cwd)
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(voice_id) = preferred_voice_id
        .map(str::trim)
        .filter(|voice_id| !voice_id.is_empty())
        .or_else(|| {
            voice
                .map(|voice| voice.id.as_str())
                .filter(|voice_id| !voice_id.trim().is_empty())
        })
    {
        command.arg("--voice").arg(voice_id);
    }

    if let Some(instruct) = tuning
        .style_instructions
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && context.supports_instruction_prompt)
    {
        command.arg("--instruct").arg(instruct);
    }

    if let Some(profile) = context.clone_profile.as_ref() {
        command
            .arg("--ref-audio")
            .arg(&profile.reference_audio_path);
        if let Some(transcript) = profile
            .transcript
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            command.arg("--ref-text").arg(transcript);
        }
    }

    let output = command
        .output()
        .map_err(|err| format!("Failed to run MLX speech generation: {err}"))?;

    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            format!("{mlx_target} failed: {stderr}")
        } else if !stdout.is_empty() {
            format!("{mlx_target} failed: {stdout}")
        } else {
            format!("{mlx_target} failed without a detailed error.")
        });
    }

    if !output_path.exists() {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Err(format!(
            "{mlx_target} completed without producing an audio file."
        ));
    }

    // mlx-audio can produce WAV files with an incorrect RIFF size header.
    // Fix it in place so rodio/symphonia decodes the full audio.
    repair_wav_riff_header(&output_path);

    if stop_flag.load(Ordering::Relaxed) {
        let _ = std::fs::remove_dir_all(&temp_cwd);
        return Ok(());
    }

    let play_result =
        audio_playback::play_audio_file_with_stop(&output_path, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play MLX speech audio: {err}"));

    let _ = std::fs::remove_dir_all(&temp_cwd);
    play_result
}

fn speak_system_chunk(
    app_handle: &AppHandle,
    text: &str,
    locale: Option<&str>,
    voice: Option<&VoiceInfo>,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = locale;
        speak_system_chunk_macos(
            app_handle,
            text,
            voice,
            rate,
            volume,
            output_device,
            stop_flag,
        )
    }
    #[cfg(target_os = "windows")]
    {
        speak_system_chunk_windows(
            app_handle,
            text,
            locale,
            voice,
            rate,
            volume,
            output_device,
            stop_flag,
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (
            app_handle,
            text,
            locale,
            voice,
            rate,
            volume,
            output_device,
            stop_flag,
        );
        Err("System TTS is not supported on this platform.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn speak_system_chunk_macos(
    app_handle: &AppHandle,
    text: &str,
    voice: Option<&VoiceInfo>,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    // `say` on this macOS stack will happily synthesize AIFF, while our playback
    // path is happiest with PCM WAV. Generate AIFF first, then normalize with
    // `afconvert` before playback.
    let synthesized_file = tts_temp_file(app_handle, "aiff")?;
    let playback_file = tts_temp_file(app_handle, "wav")?;
    let rate_wpm = (rate_to_words_per_minute(rate)).to_string();
    let mut command = Command::new("/usr/bin/say");
    if let Some(voice) = voice {
        command.args(["-v", &voice.id]);
    }
    command
        .arg("-r")
        .arg(rate_wpm)
        .arg("-o")
        .arg(&synthesized_file)
        .arg(text)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to start macOS speech synthesis: {err}"))?;

    while !stop_flag.load(Ordering::Relaxed) {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let output = child.wait_with_output().map_err(|err| {
                        format!("Failed to read macOS speech synthesis error: {err}")
                    })?;
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    return Err(if stderr.is_empty() {
                        "macOS speech synthesis failed.".to_string()
                    } else {
                        format!("macOS speech synthesis failed: {stderr}")
                    });
                }
                break;
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
            Err(err) => return Err(format!("Failed to monitor speech synthesis: {err}")),
        }
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_file(&synthesized_file);
        let _ = fs::remove_file(&playback_file);
        return Ok(());
    }

    if !synthesized_file.exists() {
        return Err("macOS speech synthesis did not create an audio file.".to_string());
    }

    let afconvert_output = Command::new("/usr/bin/afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@22050"])
        .arg(&synthesized_file)
        .arg(&playback_file)
        .output()
        .map_err(|err| format!("Failed to start macOS audio conversion: {err}"))?;
    if !afconvert_output.status.success() {
        let stderr = String::from_utf8_lossy(&afconvert_output.stderr)
            .trim()
            .to_string();
        let _ = fs::remove_file(&synthesized_file);
        let _ = fs::remove_file(&playback_file);
        return Err(if stderr.is_empty() {
            "macOS audio conversion failed.".to_string()
        } else {
            format!("macOS audio conversion failed: {stderr}")
        });
    }

    audio_playback::play_audio_file_with_stop(&playback_file, output_device, volume, stop_flag)
        .map_err(|err| format!("Failed to play speech audio: {err}"))?;
    let _ = fs::remove_file(&synthesized_file);
    let _ = fs::remove_file(&playback_file);
    Ok(())
}

#[cfg(target_os = "windows")]
fn speak_system_chunk_windows(
    app_handle: &AppHandle,
    text: &str,
    locale: Option<&str>,
    voice: Option<&VoiceInfo>,
    rate: f32,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    let temp_file = tts_temp_file(app_handle, "wav")?;
    let mut script = String::from(
        "Add-Type -AssemblyName System.Speech\n$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer\n",
    );
    if let Some(voice) = voice {
        script.push_str(&format!(
            "$synth.SelectVoice('{}')\n",
            voice.id.replace('\'', "''")
        ));
    } else if let Some(locale) = locale {
        script.push_str(
            "$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq '",
        );
        script.push_str(&locale.replace('\'', "''"));
        script.push_str("' } | Select-Object -First 1\nif ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }\n");
    }
    script.push_str(&format!(
        "$synth.Rate = {}\n$synth.SetOutputToWaveFile('{}')\n$synth.Speak('{}')\n$synth.Dispose()\n",
        rate_to_windows_rate(rate),
        temp_file.display().to_string().replace('\'', "''"),
        text.replace('\'', "''")
    ));

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|err| format!("Failed to run Windows speech synthesis: {err}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    if stop_flag.load(Ordering::Relaxed) {
        let _ = fs::remove_file(&temp_file);
        return Ok(());
    }

    audio_playback::play_audio_file_with_stop(&temp_file, output_device, volume, stop_flag)
        .map_err(|err| format!("Failed to play speech audio: {err}"))?;
    let _ = fs::remove_file(&temp_file);
    Ok(())
}

fn speak_sidecar_chunk(
    text: &str,
    provider_id: &str,
    model_id: Option<&str>,
    profile_id: Option<&str>,
    locale: Option<&str>,
    preferred_voice_id: Option<&str>,
    voice: Option<&VoiceInfo>,
    tuning: &TtsVoiceTuningSettings,
    volume: f32,
    output_device: Option<String>,
    stop_flag: &AtomicBool,
) -> Result<(), String> {
    if stop_flag.load(Ordering::Relaxed) {
        return Ok(());
    }

    let runtime = tokio::runtime::Handle::current();
    let sidecar_url = std::env::var("VOX_JOT_TTS_SIDECAR_URL")
        .unwrap_or_else(|_| DEFAULT_SIDECAR_URL.to_string());
    let runtime_target = sidecar_runtime_target(provider_id, model_id);

    let payload = build_sidecar_request_payload(
        text,
        provider_id,
        model_id,
        profile_id,
        locale,
        preferred_voice_id,
        voice,
        tuning,
    );

    let http_timeout_secs = RUNTIME_TTS_REQUEST_TIMEOUT_SECS;

    let (bytes, content_type) = runtime.block_on(async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(http_timeout_secs))
            .build()
            .map_err(|err| format!("Failed to create TTS sidecar client: {err}"))?;
        let response = client
            .post(&sidecar_url)
            .json(&payload)
            .send()
            .await
            .map_err(|err| {
                if err.is_timeout() {
                    format!(
                        "{runtime_target} timed out after {}s while waiting for the local speech runtime to return audio.",
                        http_timeout_secs
                    )
                } else {
                    format!(
                        "Failed to call the local speech runtime for {runtime_target}: {err}"
                    )
                }
            })?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let detail = sidecar_error_detail(&body);
            return Err(if detail.is_empty() {
                format!("{runtime_target} returned HTTP {status}")
            } else {
                format!("{runtime_target} failed: {detail}")
            });
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        let bytes = response
            .bytes()
            .await
            .map_err(|err| format!("Failed to read audio from {runtime_target}: {err}"))?;
        Ok((bytes, content_type))
    })?;

    let extension = sidecar_audio_extension(content_type.as_deref(), &bytes);
    let temp_file =
        std::env::temp_dir().join(format!("vox-jot-sidecar-{}.{}", Uuid::new_v4(), extension));
    fs::write(&temp_file, &bytes).map_err(|err| format!("Failed to save sidecar audio: {err}"))?;
    let play_result =
        audio_playback::play_audio_file_with_stop(&temp_file, output_device, volume, stop_flag)
            .map_err(|err| format!("Failed to play sidecar speech audio: {err}"));
    let _ = fs::remove_file(&temp_file);
    play_result
}

fn sidecar_audio_extension(content_type: Option<&str>, bytes: &[u8]) -> &'static str {
    let normalized = content_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    match normalized.as_str() {
        "audio/mp3" | "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/ogg" => "ogg",
        _ if bytes.starts_with(b"ID3") => "mp3",
        _ if bytes.starts_with(b"RIFF") => "wav",
        _ if bytes.len() > 8 && &bytes[4..8] == b"ftyp" => "m4a",
        _ => "bin",
    }
}

fn sidecar_request_url_from_base(base_url: &str, path: &str) -> Option<reqwest::Url> {
    let mut url = reqwest::Url::parse(base_url).ok()?;
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    if path.is_empty() || path == "/" {
        return Some(url);
    }
    url.join(path).ok()
}

fn sidecar_runtime_target(provider_id: &str, model_id: Option<&str>) -> String {
    match (provider_id.trim(), model_id) {
        ("", Some(model_id)) => format!("Speech model '{model_id}'"),
        ("", None) => "The selected speech runtime".to_string(),
        (provider_id, Some(model_id)) => {
            format!("Speech runtime '{provider_id}' with model '{model_id}'")
        }
        (provider_id, None) => format!("Speech runtime '{provider_id}'"),
    }
}

fn sidecar_error_detail(body: &str) -> String {
    fn format_detail_value(value: &serde_json::Value) -> Option<String> {
        match value {
            serde_json::Value::Null => None,
            serde_json::Value::String(text) => {
                Some(text.trim().to_string()).filter(|text| !text.is_empty())
            }
            serde_json::Value::Number(number) => Some(number.to_string()),
            serde_json::Value::Bool(flag) => Some(flag.to_string()),
            serde_json::Value::Array(items) => {
                let parts = items
                    .iter()
                    .filter_map(format_detail_value)
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>();
                if parts.is_empty() {
                    None
                } else {
                    Some(parts.join("; "))
                }
            }
            serde_json::Value::Object(map) => {
                if let Some(detail) = map.get("detail").and_then(format_detail_value) {
                    return Some(detail);
                }

                if let Some(message) = map
                    .get("msg")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    let location = map.get("loc").and_then(|value| match value {
                        serde_json::Value::Array(parts) => {
                            let formatted = parts
                                .iter()
                                .filter_map(|part| match part {
                                    serde_json::Value::String(text) => Some(text.clone()),
                                    serde_json::Value::Number(number) => Some(number.to_string()),
                                    _ => None,
                                })
                                .collect::<Vec<_>>()
                                .join(".");
                            if formatted.is_empty() {
                                None
                            } else {
                                Some(formatted)
                            }
                        }
                        _ => None,
                    });

                    return Some(match location {
                        Some(location) => format!("{location}: {message}"),
                        None => message.to_string(),
                    });
                }

                Some(value.to_string())
            }
        }
    }

    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("detail")
                .and_then(format_detail_value)
                .or_else(|| format_detail_value(&value))
        })
        .unwrap_or_else(|| body.trim().to_string())
}

fn build_sidecar_request_payload(
    text: &str,
    provider_id: &str,
    model_id: Option<&str>,
    profile_id: Option<&str>,
    locale: Option<&str>,
    preferred_voice_id: Option<&str>,
    voice: Option<&VoiceInfo>,
    tuning: &TtsVoiceTuningSettings,
) -> serde_json::Value {
    let effective_model = if provider_is_mlx_audio(provider_id) {
        model_id
            .and_then(mlx_audio_tts_model_definition)
            .map(|definition| definition.hf_model_id)
            .or(model_id)
    } else {
        model_id
    };
    let mut sanitized_tuning = tuning.clone();
    let _ = sanitize_tts_voice_tuning_for_target(
        &mut sanitized_tuning,
        provider_id,
        effective_model.unwrap_or_default(),
    );

    serde_json::json!({
        "input": text,
        "text": text,
        "model": effective_model,
        "voice": preferred_voice_id
            .map(|voice_id| voice_id.to_string())
            .or_else(|| voice.map(|voice| voice.id.clone())),
        "locale": locale,
        "language": locale,
        "format": "wav",
        "profile_id": profile_id,
        "extra_controls": if provider_id.is_empty() || provider_id == TTS_PROVIDER_LOCAL_SIDECAR_API_ID {
            serde_json::json!({
                "tuning": sanitized_tuning,
            })
        } else {
            serde_json::json!({
                "provider_id": provider_id,
                "model_id": effective_model,
                "tuning": sanitized_tuning,
            })
        }
    })
}

fn is_valid_mlx_voice_id(voice_id: &str) -> bool {
    let trimmed = voice_id.trim();
    !(trimmed.is_empty()
        || trimmed == "__auto__"
        || trimmed.eq_ignore_ascii_case("automatic")
        || trimmed.eq_ignore_ascii_case("default")
        || is_known_tts_model_id(trimmed)
        || is_known_tts_provider_id(trimmed))
}

fn is_known_tts_provider_id(id: &str) -> bool {
    matches!(
        id,
        TTS_PROVIDER_SYSTEM_BUILTIN_ID
            | TTS_PROVIDER_SHERPA_PACK_ID
            | TTS_PROVIDER_LOCAL_SIDECAR_API_ID
            | TTS_PROVIDER_QWEN3_NATIVE_ID
            | TTS_PROVIDER_OPENVOICE_ID
            | TTS_PROVIDER_CHATTERBOX_ID
            | TTS_PROVIDER_KOKORO_ID
            | TTS_PROVIDER_XTTS_ID
            | TTS_PROVIDER_TADA_LOCAL_ID
            | TTS_PROVIDER_HF_S2S_LOCAL_ID
            | TTS_PROVIDER_MLX_KOKORO_ID
            | TTS_PROVIDER_MLX_CHATTERBOX_ID
            | TTS_PROVIDER_MLX_CSM_ID
            | TTS_PROVIDER_MLX_DIA_ID
            | TTS_PROVIDER_MLX_BARK_ID
            | TTS_PROVIDER_MLX_FISH_AUDIO_ID
            | TTS_PROVIDER_MLX_LFM_AUDIO_ID
            | TTS_PROVIDER_MLX_KUGEL_ID
            | TTS_PROVIDER_MLX_MING_OMNI_ID
            | TTS_PROVIDER_MLX_OUTE_ID
            | TTS_PROVIDER_MLX_POCKET_TTS_ID
            | TTS_PROVIDER_MLX_QWEN3TTS_ID
            | TTS_PROVIDER_MLX_SPARK_ID
            | TTS_PROVIDER_MLX_VOXCPM_ID
            | TTS_PROVIDER_MLX_VOXTRAL_TTS_ID
    )
}

fn tts_temp_file(app_handle: &AppHandle, extension: &str) -> Result<PathBuf, String> {
    let base_dir = portable::app_data_dir(app_handle)
        .map_err(|err| format!("Failed to resolve app data dir: {err}"))?;
    let tts_dir = base_dir.join("tts-cache");
    fs::create_dir_all(&tts_dir).map_err(|err| format!("Failed to create TTS cache dir: {err}"))?;
    Ok(tts_dir.join(format!("{}.{}", Uuid::new_v4(), extension)))
}

fn rate_to_words_per_minute(rate: f32) -> u32 {
    let normalized = rate.clamp(0.5, 2.0);
    let words_per_minute = 180.0 * normalized;
    words_per_minute.round() as u32
}

#[cfg(target_os = "windows")]
fn rate_to_windows_rate(rate: f32) -> i32 {
    let normalized = rate.clamp(0.5, 2.0);
    (((normalized - 1.0) * 10.0).round() as i32).clamp(-10, 10)
}

pub fn normalize_locale(locale: Option<&str>) -> Option<String> {
    locale
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.replace('_', "-"))
}

fn locale_language(locale: &str) -> String {
    locale
        .split(['-', '_'])
        .next()
        .unwrap_or(locale)
        .to_ascii_lowercase()
}

fn locale_matches(lhs: Option<&str>, rhs: Option<&str>) -> bool {
    match (lhs, rhs) {
        (Some(lhs), Some(rhs)) => lhs.eq_ignore_ascii_case(rhs),
        _ => false,
    }
}

pub fn chunk_text(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for paragraph in text.split("\n\n") {
        let trimmed = paragraph.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.chars().count() > 1200 {
            for sentence in split_sentences(trimmed) {
                push_chunk(&mut chunks, &mut current, &sentence, 1200);
            }
        } else {
            push_chunk(&mut chunks, &mut current, trimmed, 1200);
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(text.trim().to_string());
    }

    chunks
}

fn is_preview_trigger(trigger: Option<&str>) -> bool {
    matches!(trigger, Some(value) if value.starts_with("preview_tts_voice"))
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '.' | '!' | '?' | '\n') {
            if !current.trim().is_empty() {
                segments.push(current.trim().to_string());
            }
            current.clear();
        }
    }

    if !current.trim().is_empty() {
        segments.push(current.trim().to_string());
    }

    segments
}

fn push_chunk(chunks: &mut Vec<String>, current: &mut String, candidate: &str, max_len: usize) {
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return;
    }

    if current.is_empty() {
        if candidate.chars().count() <= max_len {
            current.push_str(candidate);
            return;
        }

        for hard_chunk in hard_split(candidate, max_len) {
            chunks.push(hard_chunk);
        }
        return;
    }

    let proposed = format!("{current}\n\n{candidate}");
    if proposed.chars().count() <= max_len {
        *current = proposed;
        return;
    }

    chunks.push(current.trim().to_string());
    current.clear();

    if candidate.chars().count() <= max_len {
        current.push_str(candidate);
    } else {
        for hard_chunk in hard_split(candidate, max_len) {
            chunks.push(hard_chunk);
        }
    }
}

fn hard_split(text: &str, max_len: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for word in text.split_whitespace() {
        let proposed = if current.is_empty() {
            word.to_string()
        } else {
            format!("{current} {word}")
        };

        if proposed.chars().count() <= max_len {
            current = proposed;
        } else {
            if !current.is_empty() {
                chunks.push(current.trim().to_string());
            }
            current = word.to_string();
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    chunks
}

pub fn build_auto_speak_plan(
    settings: &AppSettings,
    origin: TranslationOrigin,
    had_preview: bool,
    final_text: &str,
    translated_text: Option<&str>,
    locale: Option<String>,
) -> TtsAutoSpeakPlan {
    let scope_allows = match settings.tts_auto_readback_scope {
        TtsAutoReadbackScope::DictationOnly => matches!(origin, TranslationOrigin::Dictation),
        TtsAutoReadbackScope::DictationAndSelection => true,
    };
    let mode_allows = match settings.tts_auto_readback_mode {
        TtsAutoReadbackMode::Off => false,
        TtsAutoReadbackMode::AfterOutput => true,
        TtsAutoReadbackMode::AfterPreviewConfirm => had_preview,
    };

    let should_speak =
        settings.tts_enabled && scope_allows && mode_allows && !final_text.trim().is_empty();
    let text = match settings.tts_readback_text_mode {
        TtsReadbackTextMode::TranslatedBlock => translated_text
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(final_text)
            .to_string(),
        TtsReadbackTextMode::FinalOutput => final_text.to_string(),
    };

    let engine = if should_speak {
        Some(
            match settings.tts_engine_preference {
                TtsEnginePreference::Auto => "auto",
                TtsEnginePreference::System => "system",
                TtsEnginePreference::SherpaOnnx => "sherpa_onnx",
                TtsEnginePreference::Sidecar => "sidecar",
            }
            .to_string(),
        )
    } else {
        None
    };

    TtsAutoSpeakPlan {
        should_speak,
        text,
        locale: locale.clone(),
        trigger: match origin {
            TranslationOrigin::Dictation => "auto_readback_dictation".to_string(),
            TranslationOrigin::Selection => "auto_readback_selection".to_string(),
        },
        tts_requested: should_speak,
        tts_engine: engine,
        tts_voice_id: settings.tts_default_voice_id.clone(),
        tts_locale: locale,
        tts_status: if should_speak {
            Some("pending".to_string())
        } else {
            None
        },
    }
}

pub fn choose_readback_locale(
    settings: &AppSettings,
    origin: TranslationOrigin,
    source_language: Option<&str>,
    target_language: Option<&str>,
) -> Option<String> {
    match settings.tts_readback_text_mode {
        TtsReadbackTextMode::TranslatedBlock => {
            normalize_locale(target_language.or(source_language))
        }
        TtsReadbackTextMode::FinalOutput => {
            if matches!(origin, TranslationOrigin::Dictation)
                && settings.translation_output_mode
                    == crate::settings::TranslationOutputMode::Bilingual
            {
                normalize_locale(target_language.or(source_language))
            } else {
                normalize_locale(source_language.or(target_language))
            }
        }
    }
}

fn legacy_dev_models_root() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join("Apps").join("Models"))
}

fn legacy_dev_tts_store_dir() -> Option<PathBuf> {
    legacy_dev_models_root().map(|root| root.join("TTS"))
}

fn copy_legacy_path_if_missing(
    source: &Path,
    destination: &Path,
    label: &str,
) -> Result<(), String> {
    if !source.exists() || destination.exists() {
        return Ok(());
    }

    if source.is_dir() {
        copy_directory_recursive(source, destination).map_err(|err| {
            format!(
                "Failed to migrate {label} from '{}' to '{}': {err}",
                source.display(),
                destination.display()
            )
        })?;
    } else {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create '{}': {err}", parent.display()))?;
        }
        fs::copy(source, destination).map_err(|err| {
            format!(
                "Failed to migrate {label} from '{}' to '{}': {err}",
                source.display(),
                destination.display()
            )
        })?;
    }

    info!(
        "Migrated {label} from '{}' to '{}'",
        source.display(),
        destination.display()
    );
    Ok(())
}

fn migrate_legacy_tts_model_layout(app_handle: &AppHandle) -> Result<(), String> {
    let store_dir = crate::storage_paths::tts_model_store_dir(app_handle)
        .map_err(|err| format!("Failed to resolve TTS store dir: {err}"))?;
    fs::create_dir_all(&store_dir).map_err(|err| {
        format!(
            "Failed to create TTS store dir '{}': {err}",
            store_dir.display()
        )
    })?;

    let Some(legacy_root) = legacy_dev_models_root() else {
        return Ok(());
    };

    if let Some(legacy_tts_store) = legacy_dev_tts_store_dir() {
        if legacy_tts_store.exists() {
            for entry in fs::read_dir(&legacy_tts_store).map_err(|err| {
                format!(
                    "Failed to read legacy TTS store '{}': {err}",
                    legacy_tts_store.display()
                )
            })? {
                let entry =
                    entry.map_err(|err| format!("Failed to read legacy TTS entry: {err}"))?;
                copy_legacy_path_if_missing(
                    &entry.path(),
                    &store_dir.join(entry.file_name()),
                    "legacy TTS asset",
                )?;
            }
        }
    }

    let legacy_mlx_dir = legacy_root.join("MLX");
    let target_mlx_dir = store_dir.join("MLX");
    if legacy_mlx_dir.exists() {
        for entry in fs::read_dir(&legacy_mlx_dir).map_err(|err| {
            format!(
                "Failed to read legacy MLX store '{}': {err}",
                legacy_mlx_dir.display()
            )
        })? {
            let entry = entry.map_err(|err| format!("Failed to read legacy MLX entry: {err}"))?;
            copy_legacy_path_if_missing(
                &entry.path(),
                &target_mlx_dir.join(entry.file_name()),
                "legacy MLX TTS asset",
            )?;
        }
    }

    for definition in MLX_AUDIO_TTS_MODEL_DEFINITIONS {
        let hf_repo_basename = definition
            .hf_model_id
            .rsplit('/')
            .next()
            .unwrap_or(definition.model_id);

        for name in definition
            .local_dir_names
            .iter()
            .copied()
            .chain(std::iter::once(definition.model_id))
            .chain(std::iter::once(hf_repo_basename))
        {
            copy_legacy_path_if_missing(
                &legacy_root.join(name),
                &store_dir.join(name),
                "legacy MLX TTS model",
            )?;
            copy_legacy_path_if_missing(
                &legacy_root.join("MLX").join(name),
                &target_mlx_dir.join(name),
                "legacy MLX TTS model",
            )?;
        }
    }

    for definition in MANAGED_RUNTIME_MODEL_DEFINITIONS {
        let Some(source_repo_dir) = definition.source_repo_dir else {
            continue;
        };

        copy_legacy_path_if_missing(
            &legacy_root.join(source_repo_dir),
            &store_dir.join(source_repo_dir),
            "legacy runtime-backed TTS asset",
        )?;
    }

    Ok(())
}

pub fn default_preview_request(
    voice_id: Option<String>,
    preview_text: Option<String>,
) -> SpeakRequest {
    SpeakRequest {
        text: preview_text.unwrap_or_else(|| PREVIEW_SAMPLE_TEXT.to_string()),
        locale: None,
        preferred_voice_id: voice_id,
        preset_id: None,
        inline_preset: None,
        trigger: Some("preview_tts_voice".to_string()),
        remember_last_output: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_text_splits_long_input() {
        let text = format!("{}\n\n{}", "hello ".repeat(250), "world ".repeat(250));
        let chunks = chunk_text(&text);
        assert!(chunks.len() >= 2);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 1200));
    }

    #[test]
    fn auto_speak_plan_prefers_translated_block_when_requested() {
        let mut settings = crate::settings::get_default_settings();
        settings.tts_enabled = true;
        settings.tts_auto_readback_mode = TtsAutoReadbackMode::AfterOutput;
        settings.tts_auto_readback_scope = TtsAutoReadbackScope::DictationAndSelection;
        settings.tts_readback_text_mode = TtsReadbackTextMode::TranslatedBlock;

        let plan = build_auto_speak_plan(
            &settings,
            TranslationOrigin::Dictation,
            false,
            "hola\n\nhello",
            Some("hello"),
            Some("en".to_string()),
        );

        assert!(plan.should_speak);
        assert_eq!(plan.text, "hello");
        assert_eq!(plan.tts_status.as_deref(), Some("pending"));
    }

    #[test]
    fn auto_speak_plan_respects_preview_only_mode() {
        let mut settings = crate::settings::get_default_settings();
        settings.tts_enabled = true;
        settings.tts_auto_readback_mode = TtsAutoReadbackMode::AfterPreviewConfirm;

        let without_preview = build_auto_speak_plan(
            &settings,
            TranslationOrigin::Dictation,
            false,
            "hello",
            None,
            Some("en".to_string()),
        );
        assert!(!without_preview.should_speak);

        let with_preview = build_auto_speak_plan(
            &settings,
            TranslationOrigin::Dictation,
            true,
            "hello",
            None,
            Some("en".to_string()),
        );
        assert!(with_preview.should_speak);
    }

    #[test]
    fn qwen3_catalog_includes_clone_capable_base_pack() {
        let base_pack = QWEN3_PACK_DEFINITIONS
            .iter()
            .find(|definition| definition.id == "qwen3-0.6b-base")
            .expect("qwen3 clone-capable base pack should stay in the catalog");

        assert_eq!(base_pack.label, "Qwen3 0.6B Base");
        assert_eq!(base_pack.locale, "mul");
    }

    #[test]
    fn outetts_checkpoint_is_marked_unavailable() {
        let definition = mlx_audio_tts_model_definition("outetts-0.6b")
            .expect("OuteTTS model definition should remain discoverable");

        assert!(!mlx_audio_definition_available(definition));
        assert!(mlx_audio_model_unavailable_reason(definition.model_id)
            .expect("blocked MLX checkpoints should explain why")
            .contains("temporarily disabled"));
    }

    #[test]
    fn unavailable_mlx_provider_has_no_default_model() {
        assert!(first_mlx_audio_model_for_provider(TTS_PROVIDER_MLX_OUTE_ID).is_none());
    }

    #[test]
    fn sidecar_payload_uses_preset_owned_identity_and_tuning() {
        let tuning = TtsVoiceTuningSettings {
            tempo_rate: 1.25,
            expressiveness: 0.6,
            exaggeration: 0.7,
            randomness: 0.3,
            guidance: 0.8,
            stability: 0.5,
            repetition_penalty: 1.6,
            style_instructions: Some("warm and steady".to_string()),
        };

        let payload = build_sidecar_request_payload(
            "Hello world",
            "chatterbox",
            Some("chatterbox"),
            Some("profile-1"),
            Some("en-US"),
            Some("voice-123"),
            None,
            &tuning,
        );

        assert_eq!(payload["model"], "chatterbox");
        assert_eq!(payload["voice"], "voice-123");
        assert_eq!(payload["profile_id"], "profile-1");
        assert_eq!(payload["extra_controls"]["provider_id"], "chatterbox");
        assert_eq!(payload["extra_controls"]["model_id"], "chatterbox");
        assert_eq!(
            payload["extra_controls"]["tuning"]["tempo_rate"]
                .as_f64()
                .expect("tempo rate should serialize"),
            1.25
        );
        assert!(
            (payload["extra_controls"]["tuning"]["guidance"]
                .as_f64()
                .expect("guidance should serialize")
                - 0.8)
                .abs()
                < 0.0001
        );
        assert_eq!(
            payload["extra_controls"]["tuning"]["style_instructions"],
            "warm and steady"
        );
    }

    #[test]
    fn sidecar_payload_maps_mlx_model_ids_to_huggingface_ids() {
        let tuning = TtsVoiceTuningSettings {
            tempo_rate: 1.0,
            expressiveness: 0.5,
            exaggeration: 0.5,
            randomness: 0.2,
            guidance: 1.0,
            stability: 0.5,
            repetition_penalty: 1.2,
            style_instructions: None,
        };

        let payload = build_sidecar_request_payload(
            "Hello world",
            TTS_PROVIDER_MLX_KOKORO_ID,
            Some("kokoro-82m"),
            None,
            Some("en-US"),
            None,
            None,
            &tuning,
        );

        assert_eq!(payload["model"], "mlx-community/Kokoro-82M-bf16");
        assert_eq!(
            payload["extra_controls"]["model_id"],
            "mlx-community/Kokoro-82M-bf16"
        );
    }

    #[test]
    fn sidecar_payload_maps_new_mlx_model_ids_to_huggingface_ids() {
        let tuning = TtsVoiceTuningSettings {
            tempo_rate: 1.0,
            expressiveness: 0.5,
            exaggeration: 0.5,
            randomness: 0.2,
            guidance: 1.0,
            stability: 0.5,
            repetition_penalty: 1.2,
            style_instructions: None,
        };

        let payload = build_sidecar_request_payload(
            "Hello world",
            TTS_PROVIDER_MLX_POCKET_TTS_ID,
            Some("pocket-tts-4bit"),
            None,
            Some("en-US"),
            None,
            None,
            &tuning,
        );

        assert_eq!(payload["model"], "mlx-community/pocket-tts-4bit");
        assert_eq!(
            payload["extra_controls"]["model_id"],
            "mlx-community/pocket-tts-4bit"
        );
    }

    #[test]
    fn sidecar_request_url_uses_resolved_base_url() {
        let url = sidecar_request_url_from_base(
            "http://127.0.0.1:9123/v1/audio/speech?token=abc#fragment",
            "listen/prepare",
        )
        .expect("sidecar URL should resolve");

        assert_eq!(url.as_str(), "http://127.0.0.1:9123/listen/prepare");
    }

    #[test]
    fn sidecar_error_detail_extracts_validation_detail_arrays() {
        let body = r#"{"detail":[{"loc":["body","text"],"msg":"ensure this value has at least 24 characters"}]}"#;

        assert_eq!(
            sidecar_error_detail(body),
            "body.text: ensure this value has at least 24 characters"
        );
    }

    #[test]
    fn mlx_voice_sanitizer_rejects_placeholder_and_model_ids() {
        assert!(!is_valid_mlx_voice_id("__auto__"));
        assert!(!is_valid_mlx_voice_id("qwen3-tts-0.6b"));
        assert!(!is_valid_mlx_voice_id("pocket-tts-4bit"));
        assert!(!is_valid_mlx_voice_id(TTS_PROVIDER_MLX_KOKORO_ID));
        assert!(!is_valid_mlx_voice_id(TTS_PROVIDER_MLX_POCKET_TTS_ID));
        assert!(is_valid_mlx_voice_id("af_heart"));
    }

    #[test]
    fn mlx_voice_helpers_format_kokoro_voice_metadata() {
        assert_eq!(mlx_voice_label("af_heart"), "Heart");
        assert_eq!(mlx_voice_label("jf_gongitsune"), "Gongitsune");
        assert_eq!(mlx_voice_locale("af_heart"), Some("en-US"));
        assert_eq!(mlx_voice_locale("bf_isabella"), Some("en-GB"));
        assert_eq!(mlx_voice_locale("zf_xiaobei"), Some("zh-CN"));
    }
}
