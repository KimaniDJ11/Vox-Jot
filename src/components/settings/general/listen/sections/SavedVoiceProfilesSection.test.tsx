import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import type { ListenSpeechState } from "../useListenSpeechState";
import { SavedVoiceProfilesSection } from "./SavedVoiceProfilesSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

const preset = (patch: Partial<TtsVoicePreset> = {}): TtsVoicePreset => ({
  id: "preset-1",
  label: "Cat",
  provider_id: "pocket-tts",
  model_id: "pocket-tts",
  voice_id: "fantine",
  voice_profile_id: null,
  voice_label_snapshot: "Fantine",
  locale_snapshot: "en-US",
  tuning: {
    tempo_rate: 1,
    expressiveness: 0.5,
    exaggeration: 0.5,
    randomness: 0.7,
    guidance: 0.5,
    stability: 0.5,
    repetition_penalty: 1.2,
    style_instructions: null,
    advanced_overrides: {},
  },
  ...patch,
});

const model = (
  patch: Partial<CatalogModelDescriptor> = {},
): CatalogModelDescriptor => ({
  id: "pocket-tts",
  provider_id: "pocket-tts",
  domain: "tts",
  source_kind: "runtime",
  label: "Pocket TTS",
  description: "Test model",
  installed: true,
  selected: false,
  active: false,
  runnable: true,
  downloadable: false,
  source_label: "Test",
  runtime: {
    id: "test",
    label: "Test",
    engine_family: "test",
    auto_routed: true,
  },
  license_label: null,
  locale: "en-US",
  supported_languages: ["en"],
  readiness_status: "ready",
  readiness_issues: [],
  capabilities: {
    downloadable: false,
    loadable: true,
    local_only: true,
    supports_translation: false,
    supports_streaming: false,
    supports_voice_cloning: false,
    supports_instruction_prompt: true,
    supports_inline_tags: true,
  },
  delivery_support: {
    expressiveness_mode: "unsupported",
    advanced_controls: [],
  },
  ...patch,
});

const render = async (node: React.ReactNode) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });

  return {
    container,
    async cleanup() {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    },
  };
};

describe("SavedVoiceProfilesSection", () => {
  it("shows capability chips for saved Voice Design voices", async () => {
    const activePreset = preset();
    const speech = {
      settings: {},
      activePreset,
      allModels: [model()],
      presets: [activePreset],
      ttsEnabled: true,
      previewingPresetId: null,
      statusMessage: null,
      setActivePreset: vi.fn(),
      setStatusMessage: vi.fn(),
      previewPreset: vi.fn(),
      removePreset: vi.fn(),
    } as unknown as ListenSpeechState;

    const view = await render(
      <SavedVoiceProfilesSection speech={speech} showTitle={false} />,
    );

    expect(view.container.textContent).toContain("Cat");
    expect(view.container.textContent).toContain("Expressions");
    expect(view.container.textContent).toContain("Prompts");

    await view.cleanup();
  });
});
