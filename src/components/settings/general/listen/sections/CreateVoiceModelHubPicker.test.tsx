import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceInfo } from "@/bindings";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import type { ListenSpeechState } from "../useListenSpeechState";
import CreateVoiceModelHubPicker from "./CreateVoiceModelHubPicker";

const getTtsVoicesForSelection = vi.fn();

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return {
    ...actual,
    getTtsVoicesForSelection: (
      providerId: string,
      modelId: string | null,
    ) => getTtsVoicesForSelection(providerId, modelId),
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

const speech = {
  ttsEnabled: true,
} as ListenSpeechState;

const render = async (
  props: Partial<React.ComponentProps<typeof CreateVoiceModelHubPicker>> = {},
) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const sourceModel = model();
  const onSelectModel = vi.fn();
  const onSelectVoice = vi.fn();
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
        onSelectModel={onSelectModel}
        onSelectVoice={onSelectVoice}
        onClose={onClose}
        {...props}
      />,
    );
  });

  return {
    container,
    sourceModel,
    onSelectModel,
    onSelectVoice,
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
  beforeEach(() => {
    getTtsVoicesForSelection.mockReset();
    getTtsVoicesForSelection.mockResolvedValue([voice()]);
  });

  it("switches from models to voices and selects a preset voice", async () => {
    const view = await render();

    expect(document.body.textContent).toContain("Kokoro 82M");
    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "Voices",
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getTtsVoicesForSelection).toHaveBeenCalledWith(
      "mlx_kokoro",
      "kokoro-82m-v1.0",
    );
    expect(document.body.textContent).toContain("Heart");

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find((button) =>
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

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "Voices",
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const genderFilter = document.body.querySelector(
      '[aria-label="Filter voices by gender: Gender"] select',
    ) as HTMLSelectElement;
    await act(async () => {
      genderFilter.value = "male";
      genderFilter.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.body.textContent).not.toContain("Heart");
    expect(document.body.textContent).toContain("Adam");

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

    await act(async () => {
      (
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "Voices",
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("Heart");
    expect(document.body.textContent).toContain("Bella");

    await view.cleanup();
  });
});
