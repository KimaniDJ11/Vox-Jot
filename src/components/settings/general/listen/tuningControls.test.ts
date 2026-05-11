import { describe, expect, it } from "vitest";

import type {
  CatalogModelDescriptor,
  TtsAdvancedControlDescriptor,
} from "@/lib/modelPlatform";
import { resolvedTuningControlsForModel } from "./tuningControls";

const defaultCapabilities = {
  downloadable: true,
  loadable: true,
  local_only: true,
  supports_translation: false,
  supports_streaming: false,
  supports_voice_cloning: false,
  supports_instruction_prompt: false,
  supports_inline_tags: false,
  coming_soon: false,
};

const styleInstructionsControl: TtsAdvancedControlDescriptor = {
  id: "style_instructions",
  group: "steering",
  label: "Style Instructions",
  description: "Optional style prompt.",
  kind: "text",
  min: null,
  max: null,
  step: null,
  unit: null,
  options: [],
  default_value: null,
};

function model(
  providerId: string,
  modelId: string,
  controls: TtsAdvancedControlDescriptor[] = [],
): CatalogModelDescriptor {
  return {
    id: modelId,
    provider_id: providerId,
    domain: "tts",
    source_kind: "runtime",
    label: modelId,
    description: "",
    installed: true,
    selected: false,
    active: false,
    runnable: true,
    downloadable: true,
    source_label: "Test",
    runtime: {
      id: providerId,
      label: providerId,
      engine_family: providerId,
      auto_routed: true,
    },
    license_label: null,
    locale: "en",
    supported_languages: ["en"],
    readiness_status: "ready",
    readiness_issues: [],
    capabilities: {
      ...defaultCapabilities,
      supports_instruction_prompt: true,
    },
    delivery_support: {
      expressiveness_mode: "unsupported",
      advanced_controls: controls,
    },
  };
}

describe("resolvedTuningControlsForModel", () => {
  it("keeps MLX Qwen sliders when catalog style instructions are present", () => {
    const controls = resolvedTuningControlsForModel(
      model("mlx_qwen3tts", "qwen3-tts-1.7b", [styleInstructionsControl]),
    );

    expect(controls.map((control) => control.id)).toEqual([
      "tempo_rate",
      "randomness",
      "repetition_penalty",
      "top_p",
      "top_k",
      "style_instructions",
    ]);
  });

  it("does not duplicate catalog style instructions", () => {
    const controls = resolvedTuningControlsForModel(
      model("mlx_qwen3tts", "qwen3-tts-1.7b", [styleInstructionsControl]),
    );

    expect(
      controls.filter((control) => control.id === "style_instructions"),
    ).toHaveLength(1);
  });
});
