use crate::settings::{
    TTS_PROVIDER_CHATTERBOX_ID, TTS_PROVIDER_KOKORO_ID, TTS_PROVIDER_LFM_AUDIO_GGUF_ID,
    TTS_PROVIDER_LOCAL_SIDECAR_API_ID, TTS_PROVIDER_MLX_BARK_ID, TTS_PROVIDER_MLX_CHATTERBOX_ID,
    TTS_PROVIDER_MLX_CSM_ID, TTS_PROVIDER_MLX_DIA_ID, TTS_PROVIDER_MLX_FISH_AUDIO_ID,
    TTS_PROVIDER_MLX_HIGGS_AUDIO_ID, TTS_PROVIDER_MLX_INDEXTTS_ID, TTS_PROVIDER_MLX_IRODORI_TTS_ID,
    TTS_PROVIDER_MLX_KOKORO_ID, TTS_PROVIDER_MLX_KUGEL_ID, TTS_PROVIDER_MLX_LFM_AUDIO_ID,
    TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID, TTS_PROVIDER_MLX_MELOTTS_ID,
    TTS_PROVIDER_MLX_MING_OMNI_ID, TTS_PROVIDER_MLX_MOSS_TTS_ID, TTS_PROVIDER_MLX_OMNIVOICE_ID,
    TTS_PROVIDER_MLX_OUTE_ID, TTS_PROVIDER_MLX_POCKET_TTS_ID, TTS_PROVIDER_MLX_QWEN3TTS_ID,
    TTS_PROVIDER_MLX_SOPRANO_ID, TTS_PROVIDER_MLX_SPARK_ID, TTS_PROVIDER_MLX_VIBEVOICE_ID,
    TTS_PROVIDER_MLX_VOXCPM_ID, TTS_PROVIDER_MLX_VOXTRAL_TTS_ID, TTS_PROVIDER_OPENVOICE_ID,
    TTS_PROVIDER_QWEN3_NATIVE_ID, TTS_PROVIDER_SHERPA_PACK_ID, TTS_PROVIDER_SUPERTONIC_ID,
    TTS_PROVIDER_SYSTEM_BUILTIN_ID, TTS_PROVIDER_VIBEVOICE_ID, TTS_PROVIDER_XTTS_ID,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeListenProviderCatalogEntry {
    pub id: String,
    pub label: String,
    pub description: String,
    pub source_label: String,
    pub provider: RuntimeListenProviderDefinition,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeListenProviderDefinition {
    pub id: String,
    pub label: String,
    pub engine_family: String,
    pub supported_platforms: Vec<String>,
    pub license_label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeStyleControlOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeStyleControl {
    pub id: String,
    #[serde(default)]
    pub group: Option<String>,
    pub label: String,
    pub description: Option<String>,
    pub kind: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub unit: Option<String>,
    #[serde(default, alias = "default")]
    pub default_value: Option<f64>,
    pub options: Option<Vec<RuntimeStyleControlOption>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeListenModelCatalogEntry {
    pub id: String,
    pub provider_id: String,
    pub label: String,
    pub description: String,
    pub source_label: String,
    pub capabilities: RuntimeListenCapabilities,
    pub readiness: RuntimeListenReadiness,
    pub supported_languages: Vec<String>,
    #[serde(default)]
    pub style_controls: Vec<RuntimeStyleControl>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeListenCapabilities {
    pub supports_basic_tts: bool,
    pub supports_voice_cloning: bool,
    pub supports_instruction_prompt: bool,
    #[serde(default)]
    pub supports_inline_tags: bool,
    pub supports_streaming: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeListenReadiness {
    pub status: String,
    pub runtime_label: String,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeListenSelection {
    pub selected_provider_id: Option<String>,
    pub selected_model_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeListenCatalogResponse {
    pub providers: Vec<RuntimeListenProviderCatalogEntry>,
    pub models: Vec<RuntimeListenModelCatalogEntry>,
    pub selection: RuntimeListenSelection,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeListenVoiceEntry {
    pub id: String,
    pub label: String,
    pub locale: Option<String>,
    pub installed: bool,
    pub available: bool,
}

#[derive(Debug, Clone)]
pub struct RuntimeListenState {
    pub providers: Vec<RuntimeListenProviderCatalogEntry>,
    pub models: Vec<RuntimeListenModelCatalogEntry>,
    pub selection: Option<RuntimeListenSelection>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SherpaModelFamily {
    Vits,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SherpaPackManifest {
    pub id: String,
    pub label: String,
    pub locale: String,
    pub source_url: String,
    pub source_name: String,
    pub model_family: SherpaModelFamily,
    pub model_file: String,
    pub tokens_file: String,
    pub data_dir: Option<String>,
    pub lexicon_file: Option<String>,
    pub rule_fsts: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct PackDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub locale: &'static str,
    pub voice_id: &'static str,
    pub archive_name: &'static str,
    pub source_name: &'static str,
    pub source_url: &'static str,
    pub model_family: SherpaModelFamily,
    pub model_file: &'static str,
    pub tokens_file: &'static str,
    pub data_dir: Option<&'static str>,
    pub lexicon_file: Option<&'static str>,
    pub rule_fsts: &'static [&'static str],
}

#[derive(Debug, Clone)]
pub struct Qwen3PackDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub locale: &'static str,
    /// HuggingFace repo ID for models too large for GitHub release assets (>2 GB).
    /// When set, the installer downloads individual files from HuggingFace as a
    /// fallback when the GitHub release archive is unavailable.
    pub hf_repo_id: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
pub struct Qwen3PackFeatures {
    pub description: &'static str,
    pub supports_voice_cloning: bool,
    pub supports_instruction_prompt: bool,
}

pub const QWEN3_PACK_DEFINITIONS: &[Qwen3PackDefinition] = &[Qwen3PackDefinition {
    id: "qwen3-0.6b-base",
    label: "Qwen3 0.6B Base",
    locale: "mul",
    hf_repo_id: Some("Qwen/Qwen3-TTS-12Hz-0.6B-Base"),
}];

const RETIRED_TTS_MODEL_IDS: &[&str] = &[
    "qwen3-0.6b-customvoice",
    "qwen3-1.7b-customvoice",
    "qwen3-tts-0.6b",
    "qwen3-tts-1.7b-base",
    "qwen3-tts-0.6b-customvoice",
    "qwen3-tts-1.7b-customvoice",
];

pub const PACK_DEFINITIONS: &[PackDefinition] = &[
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
        id: "tts-sherpa-en-us-amy-medium",
        label: "English (US) - Amy",
        locale: "en-US",
        voice_id: "amy-medium",
        archive_name: "tts-sherpa-en-us-amy-medium.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-medium.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "en_US-amy-medium.onnx",
        tokens_file: "tokens.txt",
        data_dir: Some("espeak-ng-data"),
        lexicon_file: None,
        rule_fsts: &[],
    },
    PackDefinition {
        id: "tts-sherpa-en-gb-alan-medium",
        label: "English (UK) - Alan",
        locale: "en-GB",
        voice_id: "alan-medium",
        archive_name: "tts-sherpa-en-gb-alan-medium.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_GB-alan-medium.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "en_GB-alan-medium.onnx",
        tokens_file: "tokens.txt",
        data_dir: Some("espeak-ng-data"),
        lexicon_file: None,
        rule_fsts: &[],
    },
    PackDefinition {
        id: "tts-sherpa-de-de-thorsten-medium",
        label: "German - Thorsten",
        locale: "de-DE",
        voice_id: "thorsten-medium",
        archive_name: "tts-sherpa-de-de-thorsten-medium.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-de_DE-thorsten-medium.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "de_DE-thorsten-medium.onnx",
        tokens_file: "tokens.txt",
        data_dir: Some("espeak-ng-data"),
        lexicon_file: None,
        rule_fsts: &[],
    },
    PackDefinition {
        id: "tts-sherpa-es-es-davefx-medium",
        label: "Spanish (Spain) - DaveFX",
        locale: "es-ES",
        voice_id: "davefx-medium",
        archive_name: "tts-sherpa-es-es-davefx-medium.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-es_ES-davefx-medium.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "es_ES-davefx-medium.onnx",
        tokens_file: "tokens.txt",
        data_dir: Some("espeak-ng-data"),
        lexicon_file: None,
        rule_fsts: &[],
    },
    PackDefinition {
        id: "tts-sherpa-fr-fr-siwis-medium",
        label: "French - Siwis",
        locale: "fr-FR",
        voice_id: "siwis-medium",
        archive_name: "tts-sherpa-fr-fr-siwis-medium.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-fr_FR-siwis-medium.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "fr_FR-siwis-medium.onnx",
        tokens_file: "tokens.txt",
        data_dir: Some("espeak-ng-data"),
        lexicon_file: None,
        rule_fsts: &[],
    },
    PackDefinition {
        id: "tts-sherpa-it-it-paola-medium",
        label: "Italian - Paola",
        locale: "it-IT",
        voice_id: "paola-medium",
        archive_name: "tts-sherpa-it-it-paola-medium.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-it_IT-paola-medium.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "it_IT-paola-medium.onnx",
        tokens_file: "tokens.txt",
        data_dir: Some("espeak-ng-data"),
        lexicon_file: None,
        rule_fsts: &[],
    },
    PackDefinition {
        id: "tts-sherpa-pt-br-faber-medium",
        label: "Portuguese (Brazil) - Faber",
        locale: "pt-BR",
        voice_id: "faber-medium",
        archive_name: "tts-sherpa-pt-br-faber-medium.tar.gz",
        source_name: "k2-fsa sherpa-onnx tts-models",
        source_url:
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-pt_BR-faber-medium.tar.bz2",
        model_family: SherpaModelFamily::Vits,
        model_file: "pt_BR-faber-medium.onnx",
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
pub struct ManagedRuntimeModelDefinition {
    pub provider_id: &'static str,
    pub model_id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub archive_name: &'static str,
    pub install_subdir: &'static str,
    pub source_repo_dir: Option<&'static str>,
    pub engine_family: &'static str,
    pub license_label: Option<&'static str>,
    pub locale: Option<&'static str>,
    pub supported_languages: &'static [&'static str],
    pub supports_voice_cloning: bool,
    pub supports_instruction_prompt: bool,
    pub supports_inline_tags: bool,
    /// HuggingFace repo ID for models too large for GitHub release assets (>2 GB).
    pub hf_repo_id: Option<&'static str>,
}

pub const MANAGED_RUNTIME_MODEL_DEFINITIONS: &[ManagedRuntimeModelDefinition] = &[
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
        supports_inline_tags: false,
        hf_repo_id: Some("IrieDinamik/OpenVoice"),
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
        supports_inline_tags: false,
        hf_repo_id: Some("ResembleAI/chatterbox"),
    },
    ManagedRuntimeModelDefinition {
        provider_id: TTS_PROVIDER_CHATTERBOX_ID,
        model_id: "chatterbox-turbo",
        label: "Chatterbox Turbo",
        description: "Lower-latency Chatterbox voice cloning with native paralinguistic tags.",
        archive_name: "tts-chatterbox-turbo.tar.gz",
        install_subdir: "chatterbox-turbo",
        source_repo_dir: Some("chatterbox-turbo"),
        engine_family: "chatterbox",
        license_label: Some("MIT"),
        locale: Some("en"),
        supported_languages: &["en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
        supports_inline_tags: true,
        hf_repo_id: Some("ResembleAI/chatterbox-turbo"),
    },
    ManagedRuntimeModelDefinition {
        provider_id: TTS_PROVIDER_CHATTERBOX_ID,
        model_id: "chatterbox-multilingual",
        label: "Chatterbox Multilingual",
        description: "Zero-shot multilingual Chatterbox TTS with 23 language tags.",
        archive_name: "tts-chatterbox-multilingual.tar.gz",
        install_subdir: "chatterbox-multilingual",
        source_repo_dir: Some("chatterbox"),
        engine_family: "chatterbox",
        license_label: Some("MIT"),
        locale: Some("mul"),
        supported_languages: &[
            "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms",
            "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh",
        ],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
        supports_inline_tags: false,
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
        supports_inline_tags: false,
        hf_repo_id: Some("IrieDinamik/kokoro"),
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
        supports_inline_tags: false,
        hf_repo_id: Some("coqui/XTTS-v2"),
    },
    ManagedRuntimeModelDefinition {
        provider_id: TTS_PROVIDER_SUPERTONIC_ID,
        model_id: "supertonic-3",
        label: "Supertonic 3",
        description:
            "Ultra-fast multilingual ONNX TTS with fixed voice styles and inline expression tags.",
        archive_name: "tts-supertonic-3.tar.gz",
        install_subdir: "supertonic-3",
        source_repo_dir: Some("supertonic-3"),
        engine_family: "supertonic",
        license_label: Some("OpenRAIL-M"),
        locale: Some("mul"),
        supported_languages: &[
            "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi",
            "hr", "hu", "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv",
            "tr", "uk", "vi",
        ],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
        supports_inline_tags: true,
        hf_repo_id: Some("Supertone/supertonic-3"),
    },
];

#[derive(Debug, Clone)]
pub struct MlxAudioTtsModelDefinition {
    pub provider_id: &'static str,
    pub provider_label: &'static str,
    pub provider_description: &'static str,
    pub model_id: &'static str,
    pub hf_model_id: &'static str,
    pub local_dir_names: &'static [&'static str],
    pub label: &'static str,
    pub description: &'static str,
    pub engine_family: &'static str,
    pub license_label: Option<&'static str>,
    pub supported_languages: &'static [&'static str],
    pub supports_voice_cloning: bool,
    pub supports_instruction_prompt: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct VoiceProfileCompatibility {
    pub provider_ids: Vec<String>,
    pub model_ids: Vec<String>,
}

pub const MLX_AUDIO_TTS_MODEL_DEFINITIONS: &[MlxAudioTtsModelDefinition] = &[
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
        provider_description: "OuteTTS synthesis via mlx-audio.",
        model_id: "outetts-1b-4bit",
        hf_model_id: "mlx-community/Llama-OuteTTS-1.0-1B-4bit",
        local_dir_names: &["Llama-OuteTTS-1.0-1B-4bit"],
        label: "Llama OuteTTS 1B 4-bit",
        description: "Working 4-bit Llama OuteTTS checkpoint with multilingual zero-shot cloning.",
        engine_family: "mlx_audio",
        license_label: Some("CC-BY-NC-SA-4.0"),
        supported_languages: &[
            "en", "ar", "zh", "nl", "fr", "de", "it", "ja", "ko", "lt", "ru", "es", "pt", "be",
            "bn", "ka", "hu", "lv", "fa", "pl", "sw", "ta", "uk",
        ],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_MING_OMNI_ID,
        provider_label: "MLX Ming Omni",
        provider_description: "Ming Omni synthesis with style controls via mlx-audio.",
        model_id: "ming-omni-0.5b",
        hf_model_id: "mlx-community/Ming-omni-tts-0.5B-4bit",
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
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID,
        provider_label: "MLX LongCat AudioDiT",
        provider_description: "LongCat AudioDiT diffusion TTS with zero-shot voice cloning.",
        model_id: "longcat-audiodit-1b-4bit",
        hf_model_id: "mlx-community/LongCat-AudioDiT-1B-4bit",
        local_dir_names: &["LongCat-AudioDiT-1B-4bit"],
        label: "LongCat AudioDiT 1B 4-bit",
        description: "Quantized Chinese and English diffusion TTS with reference-audio cloning.",
        engine_family: "mlx_audio",
        license_label: Some("MIT"),
        supported_languages: &["zh", "en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID,
        provider_label: "MLX LongCat AudioDiT",
        provider_description: "LongCat AudioDiT diffusion TTS with zero-shot voice cloning.",
        model_id: "longcat-audiodit-1b-bf16",
        hf_model_id: "mlx-community/LongCat-AudioDiT-1B-bf16",
        local_dir_names: &["LongCat-AudioDiT-1B-bf16"],
        label: "LongCat AudioDiT 1B bf16",
        description: "Full precision LongCat AudioDiT 1B for higher-quality local voice cloning.",
        engine_family: "mlx_audio",
        license_label: Some("MIT"),
        supported_languages: &["zh", "en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID,
        provider_label: "MLX LongCat AudioDiT",
        provider_description: "LongCat AudioDiT diffusion TTS with zero-shot voice cloning.",
        model_id: "longcat-audiodit-3-5b-4bit",
        hf_model_id: "mlx-community/LongCat-AudioDiT-3.5B-4bit",
        local_dir_names: &["LongCat-AudioDiT-3.5B-4bit"],
        label: "LongCat AudioDiT 3.5B 4-bit",
        description: "Larger quantized LongCat AudioDiT checkpoint for higher-quality cloning.",
        engine_family: "mlx_audio",
        license_label: Some("MIT"),
        supported_languages: &["zh", "en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_SOPRANO_ID,
        provider_label: "MLX Soprano",
        provider_description: "Tiny Soprano TTS checkpoints running through mlx-audio.",
        model_id: "soprano-80m-4bit",
        hf_model_id: "mlx-community/Soprano-80M-4bit",
        local_dir_names: &["Soprano-80M-4bit"],
        label: "Soprano 80M 4-bit",
        description: "Very small English TTS checkpoint for fast local speech generation.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["en"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_SOPRANO_ID,
        provider_label: "MLX Soprano",
        provider_description: "Tiny Soprano TTS checkpoints running through mlx-audio.",
        model_id: "soprano-1-1-80m-bf16",
        hf_model_id: "mlx-community/Soprano-1.1-80M-bf16",
        local_dir_names: &["Soprano-1.1-80M-bf16"],
        label: "Soprano 1.1 80M bf16",
        description: "Updated Soprano 80M checkpoint for lightweight English TTS.",
        engine_family: "mlx_audio",
        license_label: None,
        supported_languages: &["en"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_MELOTTS_ID,
        provider_label: "MLX MeloTTS",
        provider_description: "MeloTTS English served through mlx-audio.",
        model_id: "melotts-english",
        hf_model_id: "mlx-community/MeloTTS-English-MLX",
        local_dir_names: &["MeloTTS-English-MLX"],
        label: "MeloTTS English",
        description: "Lightweight MIT-licensed English TTS model.",
        engine_family: "mlx_audio",
        license_label: Some("MIT"),
        supported_languages: &["en"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_HIGGS_AUDIO_ID,
        provider_label: "MLX Higgs Audio",
        provider_description: "Higgs Audio v2 voice cloning through mlx-audio.",
        model_id: "higgs-audio-v2-3b-q6",
        hf_model_id: "mlx-community/higgs-audio-v2-3B-mlx-q6",
        local_dir_names: &["higgs-audio-v2-3B-mlx-q6"],
        label: "Higgs Audio v2 3B q6",
        description: "Lower-priority Higgs Audio v2 variant; q8 tested more reliable.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["en", "zh", "ko", "de", "es"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_HIGGS_AUDIO_ID,
        provider_label: "MLX Higgs Audio",
        provider_description: "Higgs Audio v2 voice cloning through mlx-audio.",
        model_id: "higgs-audio-v2-3b-q8",
        hf_model_id: "mlx-community/higgs-audio-v2-3B-mlx-q8",
        local_dir_names: &["higgs-audio-v2-3B-mlx-q8"],
        label: "Higgs Audio v2 3B q8",
        description: "Preferred Higgs Audio v2 checkpoint after full hard-suite testing.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["en", "zh", "ko", "de", "es"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_MOSS_TTS_ID,
        provider_label: "MLX MOSS-TTS",
        provider_description: "MOSS-TTS multilingual speech generation through mlx-audio.",
        model_id: "moss-tts-nano-100m",
        hf_model_id: "mlx-community/MOSS-TTS-Nano-100M",
        local_dir_names: &["MOSS-TTS-Nano-100M"],
        label: "MOSS-TTS Nano 100M",
        description: "Tiny multilingual MOSS-TTS checkpoint with voice-cloning support.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &[
            "zh", "en", "de", "es", "fr", "ja", "it", "he", "ko", "ru", "fa", "ar", "pl", "pt",
            "cs", "da", "sv", "hu", "el", "tr",
        ],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_IRODORI_TTS_ID,
        provider_label: "MLX Irodori TTS",
        provider_description: "Japanese Irodori TTS voice cloning through mlx-audio.",
        model_id: "irodori-tts-500m-v2-4bit",
        hf_model_id: "mlx-community/Irodori-TTS-500M-v2-4bit",
        local_dir_names: &["Irodori-TTS-500M-v2-4bit"],
        label: "Irodori TTS 500M v2 4-bit",
        description: "Japanese TTS checkpoint with reference-audio voice cloning.",
        engine_family: "mlx_audio",
        license_label: Some("MIT"),
        supported_languages: &["ja"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_INDEXTTS_ID,
        provider_label: "MLX IndexTTS",
        provider_description: "IndexTTS voice cloning through mlx-audio.",
        model_id: "indextts-1-5",
        hf_model_id: "mlx-community/IndexTTS-1.5",
        local_dir_names: &["IndexTTS-1.5"],
        label: "IndexTTS 1.5",
        description: "Apache-licensed IndexTTS voice-cloning checkpoint.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["zh", "en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_OMNIVOICE_ID,
        provider_label: "MLX OmniVoice",
        provider_description: "OmniVoice multilingual TTS and cloning through mlx-audio.",
        model_id: "omnivoice",
        hf_model_id: "k2-fsa/OmniVoice",
        local_dir_names: &["OmniVoice", "OmniVoice-bf16"],
        label: "OmniVoice",
        description:
            "Omnilingual zero-shot TTS and voice cloning with the full upstream audio tokenizer.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_VIBEVOICE_ID,
        provider_label: "MLX VibeVoice",
        provider_description: "VibeVoice Realtime TTS running through mlx-audio.",
        model_id: "vibevoice-realtime-0-5b-4bit-mlx",
        hf_model_id: "mlx-community/VibeVoice-Realtime-0.5B-4bit",
        local_dir_names: &["VibeVoice-Realtime-0.5B-4bit"],
        label: "VibeVoice Realtime 0.5B 4-bit",
        description: "MIT-licensed streaming-oriented English VibeVoice TTS checkpoint.",
        engine_family: "mlx_audio",
        license_label: Some("MIT"),
        supported_languages: &["en"],
        supports_voice_cloning: false,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_QWEN3TTS_ID,
        provider_label: "MLX Qwen3 TTS",
        provider_description: "Qwen3 voice design and multilingual synthesis via mlx-audio.",
        model_id: "qwen3-tts-1.7b-base-8bit",
        hf_model_id: "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit",
        local_dir_names: &["Qwen3-TTS-12Hz-1.7B-Base-8bit"],
        label: "Qwen3 TTS 1.7B Base 8-bit",
        description: "Quantized 1.7B Qwen3 base checkpoint for multilingual synthesis.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["zh", "en", "ja", "ko", "mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_DIA_ID,
        provider_label: "MLX Dia",
        provider_description: "Dialogue-focused Dia voices running through mlx-audio.",
        model_id: "dia-1.6b-4bit",
        hf_model_id: "mlx-community/Dia-1.6B-4bit",
        local_dir_names: &["Dia-1.6B-4bit"],
        label: "Dia 1.6B 4-bit",
        description: "Quantized Dia checkpoint for lower-memory dialogue TTS.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["en"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_CSM_ID,
        provider_label: "MLX CSM",
        provider_description: "Sesame CSM voice cloning through mlx-audio.",
        model_id: "csm-1b-8bit",
        hf_model_id: "mlx-community/csm-1b-8bit",
        local_dir_names: &["csm-1b-8bit"],
        label: "CSM 1B 8-bit",
        description: "Quantized CSM checkpoint for lighter reference-audio cloning.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["en"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_SPARK_ID,
        provider_label: "MLX Spark",
        provider_description: "Spark-TTS served from the shared mlx-audio runtime.",
        model_id: "spark-tts-0.5b-4-6bit",
        hf_model_id: "mlx-community/Spark-TTS-0.5B-4-6bit",
        local_dir_names: &["Spark-TTS-0.5B-4-6bit"],
        label: "Spark TTS 0.5B 4/6-bit",
        description: "Quantized bilingual Spark TTS checkpoint for English and Chinese.",
        engine_family: "mlx_audio",
        license_label: Some("CC-BY-NC-SA-4.0"),
        supported_languages: &["en", "zh"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_VOXCPM_ID,
        provider_label: "MLX VoxCPM2",
        provider_description:
            "VoxCPM2 voice cloning and voice design through a patched MLX bridge.",
        model_id: "voxcpm2-8bit",
        hf_model_id: "mlx-community/VoxCPM2-8bit",
        local_dir_names: &["VoxCPM2-8bit"],
        label: "VoxCPM2 8-bit",
        description: "Higher quality quantized VoxCPM2 with voice design and cloning support.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["en", "zh", "id", "ja", "ko", "mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_VOXCPM_ID,
        provider_label: "MLX VoxCPM2",
        provider_description:
            "VoxCPM2 voice cloning and voice design through a patched MLX bridge.",
        model_id: "voxcpm2-bf16",
        hf_model_id: "mlx-community/VoxCPM2-bf16",
        local_dir_names: &["VoxCPM2-bf16"],
        label: "VoxCPM2 bf16",
        description: "Full precision VoxCPM2 for high-memory Apple Silicon Macs.",
        engine_family: "mlx_audio",
        license_label: Some("Apache-2.0"),
        supported_languages: &["en", "zh", "id", "ja", "ko", "mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: true,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_VOXTRAL_TTS_ID,
        provider_label: "MLX Voxtral TTS",
        provider_description: "Voxtral multilingual TTS exposed through mlx-audio.",
        model_id: "voxtral-tts-4b-4bit",
        hf_model_id: "mlx-community/Voxtral-4B-TTS-2603-mlx-4bit",
        local_dir_names: &["Voxtral-4B-TTS-2603-mlx-4bit"],
        label: "Voxtral TTS 4B 4-bit",
        description: "Quantized Voxtral multilingual TTS with preset voices.",
        engine_family: "mlx_audio",
        license_label: Some("CC-BY-NC-4.0"),
        supported_languages: &["en", "fr", "es", "de", "it", "pt", "nl", "ar", "hi"],
        supports_voice_cloning: false,
        supports_instruction_prompt: false,
    },
    MlxAudioTtsModelDefinition {
        provider_id: TTS_PROVIDER_MLX_FISH_AUDIO_ID,
        provider_label: "MLX Fish Audio",
        provider_description: "Fish Audio S2 synthesis and cloning through mlx-audio.",
        model_id: "fish-audio-s2-pro-8bit",
        hf_model_id: "mlx-community/fish-audio-s2-pro-8bit",
        local_dir_names: &["fish-audio-s2-pro-8bit"],
        label: "Fish Audio S2 Pro 8-bit",
        description: "Quantized Fish Audio S2 Pro with reference-audio voice cloning.",
        engine_family: "mlx_audio",
        license_label: Some("Other"),
        supported_languages: &["mul"],
        supports_voice_cloning: true,
        supports_instruction_prompt: false,
    },
];

pub fn provider_uses_managed_speech_runtime(provider_id: &str) -> bool {
    matches!(
        provider_id,
        TTS_PROVIDER_OPENVOICE_ID
            | TTS_PROVIDER_CHATTERBOX_ID
            | TTS_PROVIDER_KOKORO_ID
            | TTS_PROVIDER_SUPERTONIC_ID
            | TTS_PROVIDER_XTTS_ID
    )
}

pub fn provider_is_mlx_audio(provider_id: &str) -> bool {
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
            | TTS_PROVIDER_MLX_HIGGS_AUDIO_ID
            | TTS_PROVIDER_MLX_INDEXTTS_ID
            | TTS_PROVIDER_MLX_IRODORI_TTS_ID
            | TTS_PROVIDER_MLX_LFM_AUDIO_ID
            | TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID
            | TTS_PROVIDER_MLX_MELOTTS_ID
            | TTS_PROVIDER_MLX_POCKET_TTS_ID
            | TTS_PROVIDER_MLX_MOSS_TTS_ID
            | TTS_PROVIDER_MLX_OMNIVOICE_ID
            | TTS_PROVIDER_MLX_SOPRANO_ID
            | TTS_PROVIDER_MLX_VIBEVOICE_ID
            | TTS_PROVIDER_MLX_VOXCPM_ID
            | TTS_PROVIDER_MLX_VOXTRAL_TTS_ID
    )
}

pub fn mlx_audio_runtime_supported() -> bool {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        true
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        false
    }
}

pub fn mlx_audio_tts_model_definition(
    model_id: &str,
) -> Option<&'static MlxAudioTtsModelDefinition> {
    MLX_AUDIO_TTS_MODEL_DEFINITIONS
        .iter()
        .find(|definition| definition.model_id == model_id)
}

pub fn tts_model_id_for_hf_repo(repo_id: &str) -> Option<&'static str> {
    MANAGED_RUNTIME_MODEL_DEFINITIONS
        .iter()
        .find(|definition| {
            definition
                .hf_repo_id
                .is_some_and(|hf_repo_id| hf_repo_id.eq_ignore_ascii_case(repo_id))
        })
        .map(|definition| definition.model_id)
        .or_else(|| {
            MLX_AUDIO_TTS_MODEL_DEFINITIONS
                .iter()
                .find(|definition| definition.hf_model_id.eq_ignore_ascii_case(repo_id))
                .map(|definition| definition.model_id)
        })
}

pub fn mlx_audio_model_unavailable_reason(_model_id: &str) -> Option<&'static str> {
    None
}

pub fn mlx_audio_definition_available(definition: &MlxAudioTtsModelDefinition) -> bool {
    mlx_audio_model_unavailable_reason(definition.model_id).is_none()
}

pub fn mlx_audio_model_supports_inline_tags(model_id: &str) -> bool {
    matches!(model_id, "dia-1.6b" | "bark-small")
}

pub fn ensure_mlx_audio_definition_available(
    definition: &MlxAudioTtsModelDefinition,
) -> Result<(), String> {
    match mlx_audio_model_unavailable_reason(definition.model_id) {
        Some(reason) => Err(reason.to_string()),
        None => Ok(()),
    }
}

pub fn first_mlx_audio_model_for_provider(
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

/// Returns true when `id` matches a known TTS model/pack identifier from any
/// provider. Used to detect stale voice_id values that were actually model IDs
/// carried over from a previous provider selection.
pub fn is_known_tts_model_id(id: &str) -> bool {
    PACK_DEFINITIONS.iter().any(|p| p.id == id)
        || QWEN3_PACK_DEFINITIONS.iter().any(|p| p.id == id)
        || RETIRED_TTS_MODEL_IDS.contains(&id)
        || MLX_AUDIO_TTS_MODEL_DEFINITIONS
            .iter()
            .any(|d| d.model_id == id)
        || MANAGED_RUNTIME_MODEL_DEFINITIONS
            .iter()
            .any(|d| d.model_id == id)
}

pub fn retired_tts_model_ids() -> &'static [&'static str] {
    RETIRED_TTS_MODEL_IDS
}

pub fn is_known_tts_provider_id(id: &str) -> bool {
    matches!(
        id,
        TTS_PROVIDER_SYSTEM_BUILTIN_ID
            | TTS_PROVIDER_SHERPA_PACK_ID
            | TTS_PROVIDER_LOCAL_SIDECAR_API_ID
            | TTS_PROVIDER_QWEN3_NATIVE_ID
            | TTS_PROVIDER_OPENVOICE_ID
            | TTS_PROVIDER_CHATTERBOX_ID
            | TTS_PROVIDER_KOKORO_ID
            | TTS_PROVIDER_SUPERTONIC_ID
            | TTS_PROVIDER_XTTS_ID
            | TTS_PROVIDER_MLX_KOKORO_ID
            | TTS_PROVIDER_MLX_CHATTERBOX_ID
            | TTS_PROVIDER_MLX_CSM_ID
            | TTS_PROVIDER_MLX_DIA_ID
            | TTS_PROVIDER_MLX_BARK_ID
            | TTS_PROVIDER_MLX_FISH_AUDIO_ID
            | TTS_PROVIDER_MLX_HIGGS_AUDIO_ID
            | TTS_PROVIDER_MLX_INDEXTTS_ID
            | TTS_PROVIDER_MLX_IRODORI_TTS_ID
            | TTS_PROVIDER_MLX_LFM_AUDIO_ID
            | TTS_PROVIDER_MLX_KUGEL_ID
            | TTS_PROVIDER_MLX_LONGCAT_AUDIODIT_ID
            | TTS_PROVIDER_MLX_MELOTTS_ID
            | TTS_PROVIDER_MLX_MING_OMNI_ID
            | TTS_PROVIDER_MLX_MOSS_TTS_ID
            | TTS_PROVIDER_MLX_OMNIVOICE_ID
            | TTS_PROVIDER_MLX_OUTE_ID
            | TTS_PROVIDER_MLX_POCKET_TTS_ID
            | TTS_PROVIDER_MLX_QWEN3TTS_ID
            | TTS_PROVIDER_MLX_SOPRANO_ID
            | TTS_PROVIDER_MLX_SPARK_ID
            | TTS_PROVIDER_MLX_VIBEVOICE_ID
            | TTS_PROVIDER_MLX_VOXCPM_ID
            | TTS_PROVIDER_MLX_VOXTRAL_TTS_ID
            | TTS_PROVIDER_LFM_AUDIO_GGUF_ID
            | TTS_PROVIDER_VIBEVOICE_ID
    )
}
