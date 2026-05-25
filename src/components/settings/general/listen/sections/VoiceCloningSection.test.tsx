import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";

import type {
  CatalogModelDescriptor,
  ProviderDescriptor,
} from "@/lib/modelPlatform";
import { VoiceCloningSection } from "./VoiceCloningSection";

vi.mock("react-i18next", () => ({
  Trans: () => null,
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async () => vi.fn()),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/bindings", () => ({
  commands: {
    convoStartAudioCapture: vi.fn(),
    convoStopAudioCapture: vi.fn(),
    saveTtsVoiceProfileReferenceAudio: vi.fn(),
  },
}));

vi.mock("@/lib/ttsVoiceProfiles", () => ({
  createTtsVoiceProfile: vi.fn(),
  importTtsVoiceProfileSample: vi.fn(),
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

const cloneModel: CatalogModelDescriptor = {
  id: "openvoice",
  provider_id: "openvoice",
  domain: "tts",
  source_kind: "runtime",
  label: "OpenVoice",
  description: "OpenVoice",
  installed: true,
  selected: false,
  active: true,
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

describe("VoiceCloningSection", () => {
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

  it("renders with an existing clone profile", async () => {
    const view = await render(
      <VoiceCloningSection
        showTitle={false}
        speech={
          {
            settings: { tts_enabled: true },
            ttsEnabled: true,
            cloneCapableModels: [cloneModel],
            allProviders: [provider],
            activeModel: cloneModel,
            profiles: [
              {
                id: "profile-1",
                label: "Target",
                description: null,
                transcript: null,
                compatible_provider_ids: ["openvoice"],
                compatible_model_ids: ["openvoice"],
                has_reference_audio: true,
                reference_audio_path: "/tmp/target.wav",
                sample_rate_hz: 24000,
                ready: true,
                continuous_improvement_enabled: false,
                collected_audio_duration_secs: 0,
                satisfactory_threshold_secs: 0,
                fully_optimized: false,
              },
            ],
            busyProfileAction: null,
            loadingPlatform: false,
            statusMessage: null,
            setStatusMessage: vi.fn(),
            setBusyProfileAction: vi.fn(),
            refreshProfiles: vi.fn(),
            createPresetFromProfile: vi.fn(),
          } as never
        }
      />,
    );

    expect(view.container.textContent).toContain("Generate");
    expect(view.container.textContent).toContain("OpenVoice");
    expect(view.container.textContent).toContain("Add reference");

    await view.cleanup();
  });
});
