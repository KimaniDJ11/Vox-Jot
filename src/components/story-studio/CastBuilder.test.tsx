import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import { CastBuilder } from "./CastBuilder";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "storyStudio.cast.action": "Action",
        "storyStudio.cast.addCharacter": "Add Character",
        "storyStudio.cast.character": "Character",
        "storyStudio.cast.characterPlaceholder": "Character name",
        "storyStudio.cast.chooseVoice": "Choose voice",
        "storyStudio.cast.description":
          "Assign saved Listen voices to script characters.",
        "storyStudio.cast.loadingVoices": "Loading voices",
        "storyStudio.cast.myVoices": "My voices",
        "storyStudio.cast.presetVoices": "Preset voices",
        "storyStudio.cast.removeCharacter": "Remove character",
        "storyStudio.cast.title": "Cast",
        "storyStudio.cast.voicePreset": "Voice Preset",
      };
      return labels[key] ?? key;
    },
  }),
}));

const preset = (patch: Partial<TtsVoicePreset> = {}): TtsVoicePreset => ({
  id: "preset-bark",
  label: "Bark",
  provider_id: "openvoice",
  model_id: "openvoice",
  voice_id: "bark",
  voice_profile_id: null,
  voice_label_snapshot: "Bark",
  locale_snapshot: "en-US",
  tuning: {
    tempo_rate: 1,
    expressiveness: 0.5,
    exaggeration: 0.5,
    randomness: 0.7,
    guidance: 0.5,
    stability: 0.5,
    repetition_penalty: 1.2,
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

describe("CastBuilder", () => {
  it("renders the voice picker listbox outside the clipped cast table", async () => {
    const view = await render(
      <CastBuilder
        cast={[
          {
            id: "narrator",
            characterName: "Narrator",
            presetId: "preset-bark",
          },
        ]}
        presets={[preset(), preset({ id: "preset-dia", label: "Dia" })]}
        presetVoices={[]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
        onCreatePresetFromVoice={vi.fn()}
      />,
    );

    const trigger = view.container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="listbox"]',
    );
    expect(trigger).not.toBeNull();
    trigger!.getBoundingClientRect = () =>
      ({
        bottom: 140,
        height: 40,
        left: 240,
        right: 640,
        top: 100,
        width: 400,
        x: 240,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.parentElement).toBe(document.body);
    expect(view.container.contains(listbox)).toBe(false);
    expect(listbox?.textContent).toContain("Dia");

    await view.cleanup();
  });
});
