use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ModelDomain {
    Stt,
    Tts,
    Llm,
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
    pub coming_soon: bool,
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
    pub label: String,
    pub description: String,
    pub source_label: String,
    pub runtime: RuntimeRequirement,
    pub available: bool,
    pub local_only: bool,
    pub coming_soon: bool,
    pub license_label: Option<String>,
    pub capabilities: CapabilityFlags,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CatalogModelDescriptor {
    pub id: String,
    pub provider_id: String,
    pub domain: ModelDomain,
    pub label: String,
    pub description: String,
    pub installed: bool,
    pub selected: bool,
    pub downloadable: bool,
    pub source_label: String,
    pub runtime: RuntimeRequirement,
    pub license_label: Option<String>,
    pub locale: Option<String>,
    pub supported_languages: Vec<String>,
    pub capabilities: CapabilityFlags,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ModelPlatformOverview {
    pub stt: DomainCatalog,
    pub llm: DomainCatalog,
    pub tts: DomainCatalog,
    pub selection: ModelPlatformSelectionState,
}
