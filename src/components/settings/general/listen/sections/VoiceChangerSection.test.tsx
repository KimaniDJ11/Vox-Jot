import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CatalogModelDescriptor,
  ProviderDescriptor,
} from "@/lib/modelPlatform";
import { VoiceChangerSection } from "./VoiceChangerSection";

const commandMocks = vi.hoisted(() => ({
  convoStopAudioCapture: vi.fn(),
  downloadTtsPack: vi.fn(),
  cancelArtifactDownload: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(),
}));

vi.mock("@/bindings", () => ({
  commands: commandMocks,
}));

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
    },
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: globalThis.localStorage,
  });
}

const runtime = {
  id: "speech-runtime",
  label: "Speech runtime",
  engine_family: "openvoice",
  auto_routed: true,
};

const capabilities = {
  downloadable: true,
  loadable: true,
  local_only: true,
  supports_translation: false,
  supports_streaming: false,
  supports_voice_cloning: true,
  supports_instruction_prompt: false,
  supports_inline_tags: false,
};

const provider: ProviderDescriptor = {
  id: "openvoice",
  domain: "tts",
  source_kind: "runtime",
  label: "OpenVoice",
  description: "OpenVoice",
  source_label: "OpenVoice",
  source_url: null,
  runtime,
  available: true,
  local_only: true,
  license_label: null,
  capabilities,
};

const openVoiceModel: CatalogModelDescriptor = {
  id: "openvoice",
  provider_id: "openvoice",
  domain: "tts",
  source_kind: "runtime",
  label: "OpenVoice",
  description: "OpenVoice",
  installed: true,
  selected: false,
  active: false,
  runnable: true,
  downloadable: true,
  source_label: "OpenVoice",
  source_url: null,
  runtime,
  license_label: null,
  locale: null,
  supported_languages: ["en"],
  readiness_status: null,
  readiness_issues: [],
  capabilities,
  delivery_support: {
    expressiveness_mode: "unsupported",
    advanced_controls: [],
  },
};

describe("VoiceChangerSection", () => {
  const voiceChangerDraftKey = "vox-jot-voice-changer-draft-v1";

  beforeEach(() => {
    installLocalStorageMock();
    window.localStorage.clear();
    commandMocks.downloadTtsPack.mockResolvedValue({
      status: "ok",
      data: null,
    });
    commandMocks.cancelArtifactDownload.mockResolvedValue({
      status: "ok",
      data: null,
    });
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

  const unavailableOpenVoiceModel: CatalogModelDescriptor = {
    ...openVoiceModel,
    installed: false,
    runnable: false,
  };

  it("renders the voice changer panel without blanking the app", async () => {
    const view = await render(
      <VoiceChangerSection
        showTitle={false}
        speech={
          {
            profiles: [
              {
                id: "profile-1",
                label: "Target",
                description: null,
                sample_path: "/tmp/target.wav",
                transcript: null,
                provider_id: "openvoice",
                model_id: "openvoice",
                ready: true,
              },
            ],
            visibleModels: [openVoiceModel],
            visibleProviders: [provider],
            packs: [{ id: "openvoice", label: "OpenVoice", installed: true }],
            refreshAll: vi.fn(),
          } as never
        }
      />,
    );

    expect(view.container.textContent).toContain("OpenVoice");
    expect(view.container.textContent).toContain("Tone blend");

    await view.cleanup();
  });

  it("renders while voice changer models are still loading", async () => {
    const view = await render(
      <VoiceChangerSection
        showTitle={false}
        speech={
          {
            profiles: [],
            visibleModels: [],
            visibleProviders: [],
            packs: [],
            refreshAll: vi.fn(),
          } as never
        }
      />,
    );

    expect(view.container.textContent).toContain("No model selected");
    expect(view.container.textContent).toContain("No ready profiles");
    expect(view.container.textContent).toContain("Tone blend");

    await view.cleanup();
  });

  it("does not auto-select a voice changer catalog model that is not downloaded", async () => {
    window.localStorage.removeItem(voiceChangerDraftKey);

    const view = await render(
      <VoiceChangerSection
        showTitle={false}
        speech={
          {
            profiles: [
              {
                id: "profile-1",
                label: "Target",
                description: null,
                sample_path: "/tmp/target.wav",
                transcript: null,
                provider_id: "openvoice",
                model_id: "openvoice",
                ready: true,
              },
            ],
            visibleModels: [unavailableOpenVoiceModel],
            visibleProviders: [provider],
            packs: [],
            refreshAll: vi.fn(),
          } as never
        }
      />,
    );

    expect(view.container.textContent).toContain("No model selected");
    expect(view.container.textContent).not.toContain("Ready");

    await view.cleanup();
  });

  it("shows downloadable voice changer models without marking them selected", async () => {
    window.localStorage.setItem(
      voiceChangerDraftKey,
      JSON.stringify({ providerId: "openvoice", modelId: "openvoice" }),
    );

    const view = await render(
      <VoiceChangerSection
        showTitle={false}
        speech={
          {
            profiles: [],
            visibleModels: [unavailableOpenVoiceModel],
            visibleProviders: [provider],
            packs: [],
            refreshAll: vi.fn(),
          } as never
        }
      />,
    );

    const modelsButton = Array.from(
      view.container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Models"));

    await act(async () => {
      modelsButton?.click();
    });

    expect(document.body.textContent).toContain("OpenVoice");
    expect(document.body.textContent).not.toContain("Downloaded Models");
    expect(document.body.textContent).toContain("Available to Download");
    expect(document.body.textContent).toContain("Download required");
    expect(document.body.textContent).not.toContain("Selected");

    const downloadButton = document.body.querySelector(
      'button[aria-label="Download {{modelLabel}} for Voice Changer"]',
    );

    await act(async () => {
      (downloadButton as HTMLButtonElement | null)?.click();
    });

    expect(commandMocks.downloadTtsPack).toHaveBeenCalledWith("openvoice");

    await view.cleanup();
    window.localStorage.removeItem(voiceChangerDraftKey);
  });
});
