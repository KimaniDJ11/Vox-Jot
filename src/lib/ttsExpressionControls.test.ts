import { describe, expect, it } from "vitest";
import { expressionCapabilityForModel } from "./ttsExpressionControls";

const baseCapabilities = {
  downloadable: false,
  loadable: true,
  local_only: true,
  supports_translation: false,
  supports_streaming: false,
  supports_voice_cloning: false,
  supports_instruction_prompt: false,
  supports_inline_tags: false,
  coming_soon: false,
};

function model(
  id: string,
  providerId = "provider",
  capabilityOverrides: Partial<typeof baseCapabilities> = {},
) {
  return {
    id,
    provider_id: providerId,
    label: id,
    capabilities: {
      ...baseCapabilities,
      ...capabilityOverrides,
    },
  };
}

describe("ttsExpressionControls", () => {
  it("marks Fish S2 Pro as free-form inline tags", () => {
    const capability = expressionCapabilityForModel(
      model("fish-audio-s2-pro"),
    );

    expect(capability.kind).toBe("freeform_inline_tags");
    expect(capability.allowCustomTags).toBe(true);
    expect(capability.tags.some((tag) => tag.value === "[sigh]")).toBe(true);
    expect(capability.tags.some((tag) => tag.value === "[determined]")).toBe(true);
    expect(capability.tags.some((tag) => tag.value === "[rustling sound]")).toBe(true);
  });

  it("includes the complete Chatterbox Turbo added-token set", () => {
    const capability = expressionCapabilityForModel(
      model("chatterbox-turbo"),
    );

    expect(capability.kind).toBe("fixed_inline_tags");
    expect(capability.tags).toHaveLength(19);
    expect(capability.tags.some((tag) => tag.value === "[advertisement]")).toBe(true);
    expect(capability.tags.some((tag) => tag.value === "[whispering]")).toBe(true);
  });

  it("keeps Qwen models as instruction prompts", () => {
    const capability = expressionCapabilityForModel(
      model("qwen3-tts-1.7b", "mlx_qwen3tts", {
        supports_instruction_prompt: true,
      }),
    );

    expect(capability.kind).toBe("instruction_prompt");
    expect(capability.supportsInstructions).toBe(true);
    expect(capability.tags).toEqual([]);
  });

  it("marks Dia as fixed inline tags", () => {
    const capability = expressionCapabilityForModel(model("dia-1.6b"));

    expect(capability.kind).toBe("fixed_inline_tags");
    expect(capability.tags.some((tag) => tag.value === "(sighs)")).toBe(true);
    expect(capability.tags.some((tag) => tag.value === "(beep)")).toBe(true);
    expect(capability.tags.some((tag) => tag.value === "(burps)")).toBe(true);
  });

  it("returns none for unsupported models", () => {
    const capability = expressionCapabilityForModel(model("system-default"));

    expect(capability.kind).toBe("none");
  });
});
