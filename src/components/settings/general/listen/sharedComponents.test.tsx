import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { TtsAdvancedControlDescriptor } from "@/lib/modelPlatform";
import type {
  TtsVoicePresetInput,
  TtsVoiceTuningSettings,
} from "@/lib/ttsVoicePresets";
import { VoiceTuningCard } from "./sharedComponents";

vi.mock("react-i18next", () => ({
  Trans: () => null,
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

const styleInstructionsControl: TtsAdvancedControlDescriptor = {
  id: "style_instructions",
  group: "style",
  label: "Style notes",
  description: null,
  kind: "text",
  min: null,
  max: null,
  step: null,
  unit: null,
  options: [],
  default_value: null,
};

const defaultTuning = (): TtsVoiceTuningSettings => ({
  tempo_rate: 1,
  expressiveness: 0.5,
  exaggeration: 0.5,
  randomness: 0.7,
  guidance: 0.5,
  stability: 0.5,
  repetition_penalty: 1.2,
  style_instructions: null,
});

const buildPreset = (
  tuning: TtsVoiceTuningSettings = defaultTuning(),
): TtsVoicePresetInput => ({
  provider_id: "test-provider",
  model_id: "test-model",
  tuning,
});

const setTextareaValue = (textarea: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
};

describe("VoiceTuningCard", () => {
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

  it("preserves typed trailing spaces in style notes", async () => {
    let latestStyleInstructions: string | null | undefined;

    function Harness() {
      const [preset, setPreset] = useState(buildPreset());

      return (
        <VoiceTuningCard
          preset={preset}
          onUpdatePreset={(patch) => {
            latestStyleInstructions = patch.tuning?.style_instructions;
            setPreset((current) => ({
              ...current,
              ...patch,
              tuning: {
                ...current.tuning,
                ...(patch.tuning ?? {}),
              },
            }));
          }}
          ttsEnabled
          controls={[styleInstructionsControl]}
          supportsExpressiveness={false}
          title="Tuning"
        />
      );
    }

    const view = await render(<Harness />);
    const textarea = view.container.querySelector("textarea");
    expect(textarea).not.toBeNull();

    await act(async () => {
      setTextareaValue(textarea!, "Speak warmly ");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(textarea?.value).toBe("Speak warmly ");
    expect(latestStyleInstructions).toBe("Speak warmly ");

    await view.cleanup();
  });

  it("uses a preview play control instead of a visible title when preview is available", async () => {
    const onPreview = vi.fn();

    const view = await render(
      <VoiceTuningCard
        preset={buildPreset()}
        onUpdatePreset={vi.fn()}
        ttsEnabled
        controls={[]}
        supportsExpressiveness={false}
        title="Tuning"
        modelLabel="Chatterbox"
        previewButtonGradient="linear-gradient(135deg, #4f46e5, #ec4899)"
        onPreview={onPreview}
      />,
    );

    const previewButton = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Preview current tuning"]',
    );
    expect(previewButton).not.toBeNull();
    expect(view.container.querySelector("h3")?.textContent).not.toBe(
      "Tuning",
    );
    expect(view.container.textContent).toContain("Chatterbox");

    await act(async () => {
      previewButton?.click();
    });

    expect(onPreview).toHaveBeenCalledOnce();

    await view.cleanup();
  });

  it("keeps the preview control tappable and shows a status chip while previewing", async () => {
    const onPreview = vi.fn();

    const view = await render(
      <VoiceTuningCard
        preset={buildPreset()}
        onUpdatePreset={vi.fn()}
        ttsEnabled
        controls={[]}
        supportsExpressiveness={false}
        title="Tuning"
        modelLabel="Chatterbox"
        previewing
        previewRunning
        onPreview={onPreview}
      />,
    );

    const stopButton = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop tuning preview"]',
    );
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(false);
    expect(view.container.textContent).toContain("Preview running");

    await act(async () => {
      stopButton?.click();
    });

    expect(onPreview).toHaveBeenCalledOnce();

    await view.cleanup();
  });
});
