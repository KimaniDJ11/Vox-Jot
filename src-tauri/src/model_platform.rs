use crate::external_model_storage::ModelStorageLocation;
use crate::settings::TtsStyleControlValue;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ModelDomain {
    Stt,
    Tts,
    Llm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CatalogSourceKind {
    Builtin,
    Runtime,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CapabilityFlags {
    pub downloadable: bool,
    pub loadable: bool,
    pub local_only: bool,
    pub supports_translation: bool,
    pub supports_streaming: bool,
    pub supports_voice_cloning: bool,
    pub supports_instruction_prompt: bool,
    pub supports_inline_tags: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsExpressivenessMode {
    Native,
    Mapped,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsAdvancedControlKind {
    Slider,
    Toggle,
    Select,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TtsControlGroup {
    Identity,
    Tempo,
    Style,
    Sampler,
    Guidance,
    Steering,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TtsAdvancedControlOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TtsAdvancedControlDescriptor {
    pub id: String,
    pub group: TtsControlGroup,
    pub label: String,
    pub description: Option<String>,
    pub kind: TtsAdvancedControlKind,
    pub min: Option<f32>,
    pub max: Option<f32>,
    pub step: Option<f32>,
    pub unit: Option<String>,
    pub options: Vec<TtsAdvancedControlOption>,
    pub default_value: Option<TtsStyleControlValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TtsDeliverySupport {
    pub expressiveness_mode: TtsExpressivenessMode,
    pub advanced_controls: Vec<TtsAdvancedControlDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RuntimeRequirement {
    pub id: String,
    pub label: String,
    pub engine_family: String,
    pub auto_routed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProviderDescriptor {
    pub id: String,
    pub domain: ModelDomain,
    pub source_kind: CatalogSourceKind,
    pub label: String,
    pub description: String,
    pub source_label: String,
    pub source_url: Option<String>,
    pub runtime: RuntimeRequirement,
    pub available: bool,
    pub local_only: bool,
    pub license_label: Option<String>,
    pub capabilities: CapabilityFlags,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CatalogModelDescriptor {
    pub id: String,
    pub provider_id: String,
    pub domain: ModelDomain,
    pub source_kind: CatalogSourceKind,
    pub label: String,
    pub description: String,
    pub installed: bool,
    pub selected: bool,
    pub active: bool,
    pub runnable: bool,
    pub downloadable: bool,
    pub source_label: String,
    pub source_url: Option<String>,
    pub runtime: RuntimeRequirement,
    pub license_label: Option<String>,
    pub locale: Option<String>,
    pub supported_languages: Vec<String>,
    pub readiness_status: Option<String>,
    pub readiness_issues: Vec<String>,
    pub capabilities: CapabilityFlags,
    pub delivery_support: TtsDeliverySupport,
    #[serde(default)]
    pub storage_location: Option<ModelStorageLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DomainCatalog {
    pub providers: Vec<ProviderDescriptor>,
    pub models: Vec<CatalogModelDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ModelPlatformSelectionState {
    pub selected_stt_provider_id: Option<String>,
    pub selected_stt_model_id: Option<String>,
    pub selected_llm_provider_id: Option<String>,
    pub selected_llm_model_id: Option<String>,
    pub selected_tts_provider_id: Option<String>,
    pub selected_tts_model_id: Option<String>,
    pub selected_tts_voice_id: Option<String>,
    pub selected_tts_profile_id: Option<String>,
    pub active_tts_provider_id: Option<String>,
    pub active_tts_model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ModelPlatformOverview {
    pub stt: DomainCatalog,
    pub llm: DomainCatalog,
    pub tts: DomainCatalog,
    pub selection: ModelPlatformSelectionState,
}
