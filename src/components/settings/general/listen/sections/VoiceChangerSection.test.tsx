import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";

import type {
  CatalogModelDescriptor,
  ProviderDescriptor,
} from "@/lib/modelPlatform";
import { VoiceChangerSection } from "./VoiceChangerSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(),
}));

vi.mock("@/bindings", () => ({
  commands: {
    convoStopAudioCapture: vi.fn(),
  },
}));

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
});
