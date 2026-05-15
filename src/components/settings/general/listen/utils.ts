import { invoke } from "@tauri-apps/api/core";
import type { useTranslation } from "react-i18next";
import type { VoiceInfo } from "@/bindings";
import type {
  CatalogModelDescriptor,
  ProviderDescriptor,
} from "@/lib/modelPlatform";
import type {
  TtsVoicePreset,
  TtsVoicePresetInput,
  TtsVoiceTuningSettings,
} from "@/lib/ttsVoicePresets";
import type { TtsVoiceProfileDescriptor } from "@/lib/ttsVoiceProfiles";

export const HIDDEN_TTS_PROVIDER_IDS = new Set<string>();

export const DEFAULT_TTS_PREVIEW_TEXT =
  "The morning light fell softly across the old stone bridge. She paused, took a breath, and said — quite simply — that she'd never felt more alive. Was it the crisp air? The silence? Perhaps both. Either way, something had shifted, quietly and for good.";

export const TTS_MODEL_SIZE_HINTS: Record<string, string> = {
  openvoice: "~1.6 GB",
  "iriedinamik/openvoice": "~1.6 GB",
  chatterbox: "~3.0 GB",
  "resembleai/chatterbox": "~3.0 GB",
  "mlx-community/chatterbox-fp16": "~3.0 GB",
  "chatterbox-turbo": "~4.1 GB",
  "resembleai/chatterbox-turbo": "~4.1 GB",
  "chatterbox-multilingual": "~6.5 GB",
  "kokoro-82m-v1.0": "~350 MB",
  "kokoro-82m": "~350 MB",
  "iriedinamik/kokoro": "~350 MB",
  "mlx-community/kokoro-82m-bf16": "~372 MB",
  "xtts-v2": "~1.9 GB",
  "coqui/xtts-v2": "~1.9 GB",
  "lfm2-5-audio-1-5b-q4-0": "~1.0 GB",
  "vibevoice-realtime-0-5b": "~1.1 GB",
  "qwen3-0.6b-base": "~1.2 GB",
  "qwen/qwen3-tts-12hz-0.6b-base": "~1.2 GB",
  "supertonic-3": "~385 MB",
  "tts-sherpa-en-us-lessac-medium": "~60 MB",
  "tts-sherpa-zh-cn-melo": "~120 MB",
  "qwen3-tts-0.6b-4bit": "~450 MB",
  "mlx-community/qwen3-tts-12hz-0.6b-base-4bit": "~1.6 GB",
  "qwen3-tts-1.7b": "~3.4 GB",
  "mlx-community/qwen3-tts-12hz-1.7b-voicedesign-bf16": "~4.2 GB",
  "qwen3-tts-1.7b-base-8bit": "~2.3 GB",
  "mlx-community/qwen3-tts-12hz-1.7b-base-8bit": "~2.9 GB",
  "dia-1.6b": "~3.2 GB",
  "mlx-community/dia-1.6b-fp16": "~3.2 GB",
  "dia-1.6b-4bit": "~3.0 GB",
  "mlx-community/dia-1.6b-4bit": "~3.0 GB",
  "csm-1b": "~2.0 GB",
  "mlx-community/csm-1b": "~2.0 GB",
  "csm-1b-8bit": "~1.6 GB",
  "mlx-community/csm-1b-8bit": "~1.6 GB",
  "spark-tts-0.5b": "~1.0 GB",
  "mlx-community/spark-tts-0.5b-bf16": "~1.0 GB",
  "spark-tts-0.5b-4-6bit": "~2.1 GB",
  "mlx-community/spark-tts-0.5b-4-6bit": "~2.1 GB",
  "outetts-1b-4bit": "~700 MB",
  "mlx-community/llama-outetts-1.0-1b-4bit": "~689 MB",
  "ming-omni-0.5b": "~500 MB",
  "mlx-community/ming-omni-tts-0.5b-4bit": "~500 MB",
  "kugel-audio-7b": "~14 GB",
  "kugelaudio/kugelaudio-0-open": "~14 GB",
  "bark-small": "~1.5 GB",
  "mlx-community/bark-small": "~1.5 GB",
  "fish-audio-s2-pro": "~4.0 GB",
  "mlx-community/fish-audio-s2-pro-bf16": "~4.0 GB",
  "fish-audio-s2-pro-8bit": "~6.3 GB",
  "mlx-community/fish-audio-s2-pro-8bit": "~6.3 GB",
  "lfm2-5-audio-1-5b": "~3.0 GB",
  "mlx-community/lfm2.5-audio-1.5b-bf16": "~3.0 GB",
  "pocket-tts": "~1.0 GB",
  "mlx-community/pocket-tts": "~229 MB",
  "pocket-tts-4bit": "~500 MB",
  "mlx-community/pocket-tts-4bit": "~500 MB",
  "pocket-tts-8bit": "~900 MB",
  "mlx-community/pocket-tts-8bit": "~900 MB",
  "voxcpm2-4bit": "~2.5 GB",
  "mlx-community/voxcpm2-4bit": "~2.5 GB",
  "voxcpm2-8bit": "~3.0 GB",
  "mlx-community/voxcpm2-8bit": "~3.0 GB",
  "voxcpm2-bf16": "~4.6 GB",
  "mlx-community/voxcpm2-bf16": "~4.6 GB",
  "voxtral-tts-4b": "~8.0 GB",
  "mlx-community/voxtral-4b-tts-2603-mlx-bf16": "~8.0 GB",
  "voxtral-tts-4b-4bit": "~2.4 GB",
  "mlx-community/voxtral-4b-tts-2603-mlx-4bit": "~2.4 GB",
  "longcat-audiodit-1b-4bit": "~1.3 GB",
  "mlx-community/longcat-audiodit-1b-4bit": "~1.3 GB",
  "longcat-audiodit-1b-bf16": "~5.3 GB",
  "mlx-community/longcat-audiodit-1b-bf16": "~5.3 GB",
  "longcat-audiodit-3-5b-4bit": "~2.7 GB",
  "mlx-community/longcat-audiodit-3.5b-4bit": "~2.7 GB",
  "soprano-80m-4bit": "~57 MB",
  "mlx-community/soprano-80m-4bit": "~57 MB",
  "soprano-1-1-80m-bf16": "~271 MB",
  "mlx-community/soprano-1.1-80m-bf16": "~271 MB",
  "melotts-english": "~616 MB",
  "mlx-community/melotts-english-mlx": "~616 MB",
  "higgs-audio-v2-3b-q6": "~4.4 GB",
  "mlx-community/higgs-audio-v2-3b-mlx-q6": "~4.4 GB",
  "higgs-audio-v2-3b-q8": "~5.8 GB",
  "mlx-community/higgs-audio-v2-3b-mlx-q8": "~5.8 GB",
  "moss-tts-nano-100m": "~272 MB",
  "mlx-community/moss-tts-nano-100m": "~272 MB",
  "irodori-tts-500m-v2-4bit": "~849 MB",
  "mlx-community/irodori-tts-500m-v2-4bit": "~849 MB",
  "indextts-1-5": "~1.3 GB",
  "mlx-community/indextts-1.5": "~1.3 GB",
  omnivoice: "~3.0 GB",
  "k2-fsa/omnivoice": "~3.0 GB",
  "vibevoice-realtime-0-5b-4bit-mlx": "~699 MB",
  "mlx-community/vibevoice-realtime-0.5b-4bit": "~699 MB",
  "tada-1b": "~2.0 GB",
  "tada-3b-ml": "~6.0 GB",
  "rhasspy/piper-voices": "~1.0 GB",
  "microsoft/speecht5_tts": "~1.1 GB",
  "onnx-community/kokoro-82m-v1.0-onnx": "~350 MB",
  "hexgrad/kokoro-82m": "~350 MB",
  "parler-tts/parler-tts-mini-v1.1": "~2.4 GB",
  "parler-tts/parler-tts-mini-multilingual-v1.1": "~2.4 GB",
  "outeai/outetts-0.3-1b": "~2.0 GB",
  "outeai/outetts-0.3-1b-gguf": "~0.8 GB",
  "swivid/f5-tts": "~3.0 GB",
  "iriedinamik/microsoft_vibevoice-realtime-0.5b": "~1.1 GB",
  "iriedinamik/microsoft-vibevoice-realtime-0.5b": "~1.1 GB",
  "supertone/supertonic-3": "~385 MB",
};

export function scoreCatalogModel(model: CatalogModelDescriptor): number {
  return (
    Number(model.active) * 16 +
    Number(model.selected) * 8 +
    Number(model.installed) * 4 +
    Number(model.runnable) * 2 +
    Number(model.source_kind === "runtime")
  );
}

export function dedupeCatalogModels(
  models: CatalogModelDescriptor[],
): CatalogModelDescriptor[] {
  const deduped = new Map<string, CatalogModelDescriptor>();

  for (const model of models) {
    const key = `${model.provider_id}::${model.id}`;
    const existing = deduped.get(key);
    if (!existing || scoreCatalogModel(model) > scoreCatalogModel(existing)) {
      deduped.set(key, model);
    }
  }

  return Array.from(deduped.values());
}

export function resolveVoiceModelSelection(
  models: CatalogModelDescriptor[],
  providerId: string,
  modelId: string,
): CatalogModelDescriptor | null {
  return (
    models.find(
      (model) => model.provider_id === providerId && model.id === modelId,
    ) ??
    models.find((model) => model.provider_id === providerId) ??
    models[0] ??
    null
  );
}

export function isDraftVoiceModelAvailable(model: CatalogModelDescriptor) {
  return model.runnable && (!model.downloadable || model.installed);
}

export function emptyVoiceInventoryLabel(_providerId: string) {
  return "No preset voices";
}

export async function getTtsVoicesForSelection(
  providerId: string,
  modelId: string | null,
) {
  return invoke<VoiceInfo[]>("get_tts_voices_for_selection", {
    providerId,
    modelId,
  });
}

export function localeLabel(locale: string | null | undefined) {
  return locale ? ` (${locale})` : "";
}

export function sourceKindLabel(
  sourceKind: CatalogModelDescriptor["source_kind"],
) {
  return sourceKind === "runtime" ? "Runtime" : "Built-in";
}

export function formatLanguageAbbreviation(language: string) {
  const trimmed = language.trim();
  if (!trimmed) return language;
  return trimmed.split(/[-_]/)[0].slice(0, 3).toUpperCase();
}

export function getModelLanguageItems(model: CatalogModelDescriptor) {
  if (model.supported_languages.length === 0) {
    return model.locale ? [formatLanguageAbbreviation(model.locale)] : [];
  }
  return model.supported_languages.map(formatLanguageAbbreviation);
}

export function formatLanguageCoverage(model: CatalogModelDescriptor) {
  const languages = getModelLanguageItems(model);
  if (languages.length === 0) return "";
  if (languages.length === 1) return languages[0];
  return `${languages[0]}+${languages.length - 1}`;
}

export function ttsStorageSizeLabel(
  model: CatalogModelDescriptor,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const normalizedId = model.id.toLowerCase();
  const normalizedLabel = model.label.toLowerCase();
  const sizeHint =
    TTS_MODEL_SIZE_HINTS[model.id] ??
    TTS_MODEL_SIZE_HINTS[normalizedId] ??
    TTS_MODEL_SIZE_HINTS[model.label] ??
    TTS_MODEL_SIZE_HINTS[normalizedLabel];

  if (sizeHint) {
    return sizeHint;
  }

  if (!model.downloadable) {
    return model.capabilities.local_only
      ? t("modelHub.chips.internalStorage", { defaultValue: "Internal" })
      : t("modelHub.chips.externalStorage", {
          defaultValue: "External storage",
        });
  }

  return t("modelHub.chips.sizeUnknown", { defaultValue: "Size unknown" });
}

export function ttsModelSupportsLanguage(
  model: CatalogModelDescriptor,
  languageCode: string,
) {
  if (model.supported_languages.includes(languageCode)) {
    return true;
  }

  return model.locale?.split(/[-_]/)[0] === languageCode;
}

export function defaultPresetInput(): TtsVoicePresetInput {
  return {
    label: "Default Voice",
    provider_id: "system_builtin",
    model_id: "system-default",
    voice_id: null,
    voice_profile_id: null,
    voice_label_snapshot: "System Voice",
    locale_snapshot: null,
    tuning: defaultVoiceTuning(),
  };
}

export function defaultVoiceTuning(): TtsVoiceTuningSettings {
  return {
    tempo_rate: 1,
    expressiveness: 0.5,
    exaggeration: 0.5,
    randomness: 0.7,
    guidance: 0.5,
    stability: 0.5,
    repetition_penalty: 1.2,
    style_instructions: null,
    advanced_overrides: {},
  };
}

export function profileSupportsModel(
  profile: TtsVoiceProfileDescriptor,
  model: CatalogModelDescriptor | null | undefined,
) {
  if (!profile || !model) return false;

  const providerCompatible =
    profile.compatible_provider_ids.length === 0 ||
    profile.compatible_provider_ids.includes(model.provider_id);
  const modelCompatible =
    profile.compatible_model_ids.length === 0 ||
    profile.compatible_model_ids.includes(model.id);

  return providerCompatible && modelCompatible;
}

export function cloneModelSelectionValue(
  model: CatalogModelDescriptor | null | undefined,
) {
  return model ? `${model.provider_id}::${model.id}` : "__none__";
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function buildPresetInput(preset: TtsVoicePreset): TtsVoicePresetInput {
  return {
    label: preset.label,
    provider_id: preset.provider_id,
    model_id: preset.model_id,
    voice_id: preset.voice_id ?? null,
    voice_profile_id: preset.voice_profile_id ?? null,
    voice_label_snapshot: preset.voice_label_snapshot ?? null,
    locale_snapshot: preset.locale_snapshot ?? null,
    tuning: { ...preset.tuning },
  };
}

export function isVoiceFixedToModel(providerId: string) {
  return providerId === "sherpa_pack" || providerId === "qwen3_native";
}

export function isMlxProvider(providerId: string) {
  return providerId.startsWith("mlx_");
}

export function providerOptionContext(_provider: ProviderDescriptor) {
  return null;
}

export function modelOptionContext(_model: CatalogModelDescriptor) {
  return null;
}

export function formatSelectableLabel(label: string, detail: string | null) {
  if (!detail) return label;
  return `${label} (${detail})`;
}

export function previewPreparationMessage(model: CatalogModelDescriptor) {
  if (model.source_kind === "runtime") {
    return `Getting ${model.label} ready for first preview…`;
  }
  return `Preparing ${model.label} preview…`;
}

export function previewErrorMessage(
  error: unknown,
  model?: CatalogModelDescriptor | null,
  fallback = "Failed to preview voice preset",
) {
  const raw = error instanceof Error ? error.message : fallback;
  if (
    raw.startsWith("Speech runtime") ||
    raw.startsWith("MLX speech") ||
    raw.startsWith("MLX bridge")
  ) {
    return raw;
  }

  if (model?.source_kind === "runtime") {
    return `Preview failed while starting ${model.label}: ${raw}`;
  }
  if (model && isMlxProvider(model.provider_id)) {
    return `MLX preview failed: ${raw}`;
  }
  return `Preview failed: ${raw}`;
}

export function ttsHubModelCanRemove(model: CatalogModelDescriptor): boolean {
  if (!model.installed) return false;
  if (model.provider_id === "system_builtin") return false;
  return true;
}
