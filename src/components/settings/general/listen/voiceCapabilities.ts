import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import { expressionCapabilityForModel } from "@/lib/ttsExpressionControls";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";

export interface VoiceCapabilityFlags {
  supportsExpressions: boolean;
  supportsPrompts: boolean;
}

type VoiceCapabilityModel = Pick<
  CatalogModelDescriptor,
  "id" | "provider_id" | "label" | "capabilities" | "delivery_support"
>;

const emptyCapabilities: VoiceCapabilityFlags = {
  supportsExpressions: false,
  supportsPrompts: false,
};

export function voiceCapabilityFlagsForModel(
  model: VoiceCapabilityModel | null | undefined,
): VoiceCapabilityFlags {
  if (!model) return emptyCapabilities;

  const expressionCapability = expressionCapabilityForModel(model);
  const supportsExpressionTags =
    expressionCapability.kind === "fixed_inline_tags" ||
    expressionCapability.kind === "freeform_inline_tags" ||
    expressionCapability.kind === "both";
  const supportsExpressiveness =
    (model.delivery_support.expressiveness_mode ?? "unsupported") !==
    "unsupported";

  return {
    supportsExpressions: supportsExpressionTags || supportsExpressiveness,
    supportsPrompts: expressionCapability.supportsInstructions,
  };
}

export function voiceCapabilityFlagsForPreset(
  preset: TtsVoicePreset,
  model: VoiceCapabilityModel | null | undefined,
): VoiceCapabilityFlags {
  return voiceCapabilityFlagsForModel(model ?? fallbackModelForPreset(preset));
}

export function hasVoiceCapability(flags: VoiceCapabilityFlags) {
  return flags.supportsExpressions || flags.supportsPrompts;
}

function fallbackModelForPreset(preset: TtsVoicePreset): VoiceCapabilityModel {
  const modelId = preset.model_id.toLowerCase();
  const providerId = preset.provider_id.toLowerCase();
  const supportsInstructionPrompt =
    providerId.includes("qwen") ||
    modelId.includes("qwen") ||
    modelId.includes("ming-omni") ||
    modelId.includes("lfm2-5-audio");
  const supportsInlineTags =
    modelId.includes("fish-audio-s2-pro") ||
    modelId.includes("chatterbox-turbo") ||
    modelId === "dia-1.6b" ||
    modelId === "bark-small" ||
    providerId.includes("dia") ||
    providerId.includes("bark");

  return {
    id: preset.model_id,
    provider_id: preset.provider_id,
    label: preset.voice_label_snapshot ?? preset.model_id,
    capabilities: {
      downloadable: false,
      loadable: true,
      local_only: true,
      supports_translation: false,
      supports_streaming: false,
      supports_voice_cloning: false,
      supports_instruction_prompt: supportsInstructionPrompt,
      supports_inline_tags: supportsInlineTags,
    },
    delivery_support: {
      expressiveness_mode: "unsupported",
      advanced_controls: [],
    },
  };
}
