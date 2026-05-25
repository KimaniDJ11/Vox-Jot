import { invoke } from "@tauri-apps/api/core";

export type CatalogSourceKind = "builtin" | "runtime";

export interface CapabilityFlags {
  downloadable: boolean;
  loadable: boolean;
  local_only: boolean;
  supports_translation: boolean;
  supports_streaming: boolean;
  supports_voice_cloning: boolean;
  supports_instruction_prompt: boolean;
  supports_inline_tags: boolean;
}

export interface RuntimeRequirement {
  id: string;
  label: string;
  engine_family: string;
  auto_routed: boolean;
}

export type TtsExpressivenessMode = "native" | "mapped" | "unsupported";

export type TtsAdvancedControlKind = "slider" | "toggle" | "select" | "text";
export type TtsControlGroup =
  | "identity"
  | "tempo"
  | "style"
  | "sampler"
  | "guidance"
  | "steering";

export interface TtsAdvancedControlOption {
  value: string;
  label: string;
}

export interface TtsAdvancedControlDescriptor {
  id: string;
  group: TtsControlGroup;
  label: string;
  description?: string | null;
  kind: TtsAdvancedControlKind;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  unit?: string | null;
  options: TtsAdvancedControlOption[];
  default_value?:
    | { kind: "number"; value: number }
    | { kind: "boolean"; value: boolean }
    | { kind: "text"; value: string }
    | null;
}

export interface TtsDeliverySupport {
  expressiveness_mode: TtsExpressivenessMode;
  advanced_controls: TtsAdvancedControlDescriptor[];
}

export interface ProviderDescriptor {
  id: string;
  domain: "stt" | "tts" | "llm";
  source_kind: CatalogSourceKind;
  label: string;
  description: string;
  source_label: string;
  source_url?: string | null;
  runtime: RuntimeRequirement;
  available: boolean;
  local_only: boolean;
  license_label?: string | null;
  capabilities: CapabilityFlags;
}

export interface CatalogModelDescriptor {
  id: string;
  provider_id: string;
  domain: "stt" | "tts" | "llm";
  source_kind: CatalogSourceKind;
  label: string;
  description: string;
  installed: boolean;
  selected: boolean;
  active: boolean;
  runnable: boolean;
  downloadable: boolean;
  source_label: string;
  source_url?: string | null;
  runtime: RuntimeRequirement;
  license_label?: string | null;
  locale?: string | null;
  supported_languages: string[];
  readiness_status?: string | null;
  readiness_issues: string[];
  capabilities: CapabilityFlags;
  delivery_support: TtsDeliverySupport;
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
  active_tts_provider_id?: string | null;
  active_tts_model_id?: string | null;
}

export interface ModelPlatformOverview {
  stt: DomainCatalog;
  llm: DomainCatalog;
  tts: DomainCatalog;
  selection: ModelPlatformSelectionState;
}

function parseInvokeJson<T>(command: string, json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid JSON returned.";
    throw new Error(`${command} returned malformed data: ${message}`);
  }
}

export async function getModelPlatformOverview(): Promise<ModelPlatformOverview> {
  const json = await invoke<string>("get_model_platform_overview_json");
  return parseInvokeJson<ModelPlatformOverview>(
    "get_model_platform_overview_json",
    json,
  );
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
