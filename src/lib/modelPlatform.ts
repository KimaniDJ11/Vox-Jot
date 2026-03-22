import { invoke } from "@tauri-apps/api/core";

export interface CapabilityFlags {
  downloadable: boolean;
  loadable: boolean;
  local_only: boolean;
  supports_translation: boolean;
  supports_streaming: boolean;
  supports_voice_cloning: boolean;
  supports_instruction_prompt: boolean;
  supports_inline_tags: boolean;
  coming_soon: boolean;
}

export interface RuntimeRequirement {
  id: string;
  label: string;
  engine_family: string;
  auto_routed: boolean;
}

export interface ProviderDescriptor {
  id: string;
  domain: "stt" | "tts" | "llm";
  label: string;
  description: string;
  source_label: string;
  runtime: RuntimeRequirement;
  available: boolean;
  local_only: boolean;
  coming_soon: boolean;
  license_label?: string | null;
  capabilities: CapabilityFlags;
}

export interface CatalogModelDescriptor {
  id: string;
  provider_id: string;
  domain: "stt" | "tts" | "llm";
  label: string;
  description: string;
  installed: boolean;
  selected: boolean;
  downloadable: boolean;
  source_label: string;
  runtime: RuntimeRequirement;
  license_label?: string | null;
  locale?: string | null;
  supported_languages: string[];
  capabilities: CapabilityFlags;
}

export interface DomainCatalog {
  providers: ProviderDescriptor[];
  models: CatalogModelDescriptor[];
}

export interface ModelPlatformSelectionState {
  selected_stt_provider_id?: string | null;
  selected_stt_model_id?: string | null;
  selected_llm_provider_id?: string | null;
  selected_llm_model_id?: string | null;
  selected_tts_provider_id?: string | null;
  selected_tts_model_id?: string | null;
  selected_tts_voice_id?: string | null;
  selected_tts_profile_id?: string | null;
}

export interface ModelPlatformOverview {
  stt: DomainCatalog;
  llm: DomainCatalog;
  tts: DomainCatalog;
  selection: ModelPlatformSelectionState;
}

export async function getModelPlatformOverview(): Promise<ModelPlatformOverview> {
  return invoke<ModelPlatformOverview>("get_model_platform_overview");
}

export async function setSttPlatformSelection(
  providerId: string,
  modelId: string,
): Promise<void> {
  return invoke("set_stt_platform_selection", {
    providerId,
    modelId,
  });
}

export async function setTtsPlatformSelection(
  providerId: string,
  modelId?: string | null,
): Promise<void> {
  return invoke("set_tts_platform_selection", {
    providerId,
    modelId: modelId ?? null,
  });
}
