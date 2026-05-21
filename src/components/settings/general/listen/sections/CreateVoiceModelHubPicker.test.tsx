import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceInfo } from "@/bindings";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import type { ListenSpeechState } from "../useListenSpeechState";
import CreateVoiceModelHubPicker from "./CreateVoiceModelHubPicker";

const getTtsVoicesForSelection = vi.fn();

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return {
    ...actual,
    getTtsVoicesForSelection: (providerId: string, modelId: string | null) =>
      getTtsVoicesForSelection(providerId, modelId),
  };
});

const model = (
  patch: Partial<CatalogModelDescriptor> = {},
): CatalogModelDescriptor => ({
  id: "kokoro-82m-v1.0",
  provider_id: "mlx_kokoro",
  domain: "tts",
  source_kind: "runtime",
  label: "Kokoro 82M",
  description: "Small preset voice model",
  installed: true,
  selected: false,
  active: false,
  runnable: true,
  downloadable: true,
  source_label: "Test",
  runtime: {
    id: "mlx",
    label: "MLX",
    engine_family: "mlx",
    auto_routed: true,
  },
  license_label: null,
  locale: "en-US",
  supported_languages: ["en"],
  readiness_status: "ready",
  readiness_issues: [],
  capabilities: {
    downloadable: true,
    loadable: true,
    local_only: true,
    supports_translation: false,
    supports_streaming: false,
    supports_voice_cloning: false,
    supports_instruction_prompt: false,
    supports_inline_tags: false,
    coming_soon: false,
  },
  delivery_support: {
    expressiveness_mode: "unsupported",
    advanced_controls: [],
  },
  ...patch,
});

const voice = (patch: Partial<VoiceInfo> = {}): VoiceInfo => ({
  id: "af_heart",
  label: "Heart",
  locale: "en-US",
  engine: "mlx_native",
  installed: true,
  available: true,
  ...patch,
});

const preset = (patch: Partial<TtsVoicePreset> = {}): TtsVoicePreset => ({
  id: "preset-1",
  label: "Warm narrator",
  provider_id: "mlx_kokoro",
  model_id: "kokoro-82m-v1.0",
  voice_id: "af_heart",
  voice_profile_id: null,
  voice_label_snapshot: "Heart",
  locale_snapshot: "en-US",
  tuning: {
    tempo_rate: 1,
    expressiveness: 0,
    exaggeration: 0,
    randomness: 0,
    guidance: 0,
    stability: 0,
    repetition_penalty: 1,
    style_instructions: null,
    advanced_overrides: {},
  },
  ...patch,
});

const speech = {
  ttsEnabled: true,
  statusMessage: null,
  presets: [],
  previewingPresetId: null,
  previewPreset: vi.fn(),
  previewPresetDraft: vi.fn(),
  setStatusMessage: vi.fn(),
} as unknown as ListenSpeechState;

const flushPickerEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const render = async (
  props: Partial<React.ComponentProps<typeof CreateVoiceModelHubPicker>> = {},
) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const sourceModel = model();
  const onSelectVoice = vi.fn();
  const onSelectPreset = vi.fn();
  const onClose = vi.fn();

  await act(async () => {
    root = createRoot(container);
    root.render(
      <CreateVoiceModelHubPicker
        open
        speech={speech}
        models={[sourceModel]}
        providers={[
          {
            id: "mlx_kokoro",
            domain: "tts",
            source_kind: "runtime",
            label: "MLX Kokoro",
            description: "Provider",
            source_label: "Test",
            runtime: sourceModel.runtime,
            available: true,
            local_only: true,
            coming_soon: false,
            license_label: null,
            capabilities: sourceModel.capabilities,
          },
        ]}
        selectedProviderId="mlx_kokoro"
        selectedModelId="kokoro-82m-v1.0"
        selectedVoiceId="__auto__"
        searchQuery=""
        onSearchQueryChange={vi.fn()}
        providerFilter="all"
        providerOptions={[{ value: "all", label: "Provider" }]}
        selectedProviderLabel="Provider"
        onProviderFilterChange={vi.fn()}
        languageFilter="all"
        languageOptions={[
          { value: "all", label: "Language" },
          { value: "en", label: "English" },
        ]}
        selectedLanguageLabel="Language"
        onLanguageFilterChange={vi.fn()}
        sortMode="best_match"
        sortOptions={[
          { value: "best_match", label: "Best Match" },
          { value: "alphabetical", label: "Alphabetical" },
        ]}
        selectedSortLabel="Best Match"
        onSortModeChange={vi.fn()}
        orderedModels={[sourceModel]}
        filteredModelCount={1}
        onSelectVoice={onSelectVoice}
        selectedVoiceProfileId={null}
        onSelectPreset={onSelectPreset}
        onClose={onClose}
        {...props}
      />,
    );
  });

  return {
    container,
    sourceModel,
    onSelectVoice,
    onSelectPreset,
    async cleanup() {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
      document.body.innerHTML = "";
    },
  };
};

describe("CreateVoiceModelHubPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  beforeEach(() => {
    getTtsVoicesForSelection.mockReset();
    getTtsVoicesForSelection.mockResolvedValue([voice()]);
  });

  it("opens on voices and selects a preset voice", async () => {
    const view = await render();

    await flushPickerEffects();

    expect(getTtsVoicesForSelection).toHaveBeenCalledWith(
      "mlx_kokoro",
      "kokoro-82m-v1.0",
    );
    expect(document.body.textContent).toContain("Heart");

    await act(async () => {
      (
        Array.from(
          document.body.querySelectorAll('button, [role="button"]'),
        ).find((button) =>
          button.textContent?.includes("Heart"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(view.onSelectVoice).toHaveBeenCalledWith({
      model: view.sourceModel,
      voiceId: "af_heart",
      voiceLabel: "Heart",
      locale: "en-US",
    });

    await view.cleanup();
  });

  it("filters voices by gender", async () => {
    getTtsVoicesForSelection.mockResolvedValue([
      voice({ id: "af_heart", label: "Heart" }),
      voice({ id: "am_adam", label: "Adam" }),
    ]);
    const onSearchQueryChange = vi.fn();
    const view = await render({ onSearchQueryChange });

    await flushPickerEffects();

    const genderFilter = Array.from(document.body.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Gender"))
      ?.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      genderFilter.value = "male";
      genderFilter.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.body.textContent).not.toContain("Heart");
    expect(document.body.textContent).toContain("Adam");

    await view.cleanup();
  });

  it("reuses a saved voice from My Voices without selecting a raw voice row", async () => {
    const savedPreset = preset();
    const view = await render({
      speech: {
        ...speech,
        presets: [savedPreset],
      } as unknown as ListenSpeechState,
    });

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "My Voices",
        ) as HTMLButtonElement
      ).click();
    });

    expect(document.body.textContent).toContain("Warm narrator");

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Warm narrator"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(view.onSelectPreset).toHaveBeenCalledWith(savedPreset);
    expect(view.onSelectVoice).not.toHaveBeenCalled();

    await view.cleanup();
  });

  it("filters voices by provider", async () => {
    const firstModel = model();
    const secondModel = model({
      id: "chatterbox",
      provider_id: "mlx_chatterbox",
      label: "Chatterbox",
    });
    getTtsVoicesForSelection.mockImplementation((providerId: string) =>
      Promise.resolve([
        providerId === "mlx_chatterbox"
          ? voice({ id: "bf_bella", label: "Bella" })
          : voice({ id: "af_heart", label: "Heart" }),
      ]),
    );
    const view = await render({
      models: [firstModel, secondModel],
      orderedModels: [firstModel, secondModel],
      providerFilter: "mlx_chatterbox",
      providerOptions: [
        { value: "all", label: "Provider" },
        { value: "mlx_kokoro", label: "MLX Kokoro" },
        { value: "mlx_chatterbox", label: "Chatterbox" },
      ],
      selectedProviderLabel: "Chatterbox",
    });

    await flushPickerEffects();

    expect(document.body.textContent).not.toContain("Heart");
    expect(document.body.textContent).toContain("Bella");

    await view.cleanup();
  });

  it("pins the selected draft voice to the top of the voice list", async () => {
    const firstModel = model();
    const secondModel = model({
      id: "chatterbox",
      provider_id: "mlx_chatterbox",
      label: "Chatterbox",
    });
    getTtsVoicesForSelection.mockImplementation((providerId: string) =>
      Promise.resolve([
        providerId === "mlx_chatterbox"
          ? voice({ id: "bf_bella", label: "Bella" })
          : voice({ id: "af_heart", label: "Heart" }),
      ]),
    );
    const view = await render({
      models: [firstModel, secondModel],
      orderedModels: [firstModel, secondModel],
      selectedProviderId: "mlx_chatterbox",
      selectedModelId: "chatterbox",
      selectedVoiceId: "bf_bella",
      filteredModelCount: 2,
    });

    await flushPickerEffects();

    const text = document.body.textContent ?? "";
    expect(text.indexOf("Bella")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Heart")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Bella")).toBeLessThan(text.indexOf("Heart"));
    expect(text).toContain("Selected voice");

    await view.cleanup();
  });

  it("shows ramp-up status while a voice preview starts", async () => {
    const previewPresetDraft = vi.fn(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 7000)),
    );
    const view = await render({
      speech: {
        ...speech,
        previewPresetDraft,
      } as ListenSpeechState,
    });

    await flushPickerEffects();
    vi.useFakeTimers();

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find((button) =>
          button.className.includes("absolute inset-0"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(document.body.textContent).toContain("Preparing preview");
    expect(document.body.textContent).not.toContain("Preview running");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(document.body.textContent).toContain("Preview running");

    await act(async () => {
      vi.advanceTimersByTime(5500);
      await Promise.resolve();
    });

    await view.cleanup();
    vi.useRealTimers();
  });

  it("uses model card selection as a toggleable voice filter, not a draft selection", async () => {
    const firstModel = model();
    const secondModel = model({
      id: "chatterbox",
      provider_id: "mlx_chatterbox",
      label: "Chatterbox",
    });
    getTtsVoicesForSelection.mockImplementation((providerId: string) =>
      Promise.resolve([
        providerId === "mlx_chatterbox"
          ? voice({ id: "bf_bella", label: "Bella" })
          : voice({ id: "af_heart", label: "Heart" }),
      ]),
    );
    const view = await render({
      models: [firstModel, secondModel],
      orderedModels: [firstModel, secondModel],
      filteredModelCount: 2,
    });

    expect(document.body.textContent).not.toContain("Selected");

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "Models",
        ) as HTMLButtonElement
      ).click();
    });

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll('[role="button"]')).find(
          (button) => button.textContent?.includes("Chatterbox"),
        ) as HTMLElement
      ).click();
    });

    expect(document.body.textContent).toContain("Selected");

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "Voices",
        ) as HTMLButtonElement
      ).click();
    });
    await flushPickerEffects();

    expect(document.body.textContent).not.toContain("Heart");
    expect(document.body.textContent).toContain("Bella");
    expect(view.onSelectVoice).not.toHaveBeenCalled();

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "Models",
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        Array.from(document.body.querySelectorAll('[role="button"]')).find(
          (button) => button.textContent?.includes("Chatterbox"),
        ) as HTMLElement
      ).click();
    });
    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "Voices",
        ) as HTMLButtonElement
      ).click();
    });

    expect(document.body.textContent).toContain("Heart");
    expect(document.body.textContent).toContain("Bella");

    await view.cleanup();
  });

  it("keeps preview status visible inside the hub", async () => {
    const view = await render({
      speech: {
        ...speech,
        statusMessage: "Preparing Chatterbox preview...",
      } as ListenSpeechState,
    });

    expect(document.body.textContent).toContain(
      "Preparing Chatterbox preview...",
    );

    await view.cleanup();
  });
});
