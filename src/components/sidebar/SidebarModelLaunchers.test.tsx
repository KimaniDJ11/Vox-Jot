import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sidebarState = vi.hoisted(() => ({
  currentModel: "small",
  llmProviderId: "openai",
  llmProviders: [
    { id: "openai", label: "OpenAI" },
    { id: "apple_intelligence", label: "Apple Intelligence" },
  ],
  llmModels: {
    openai: "gpt-4.1-mini",
  } as Record<string, string>,
  selectedTtsModelId: "xtts-v2",
  selectedTtsProviderId: "xtts",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("@/bindings", () => ({
  commands: {
    showDetailView: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/stores/modelStore", () => ({
  useModelStore: () => ({
    models: [
      {
        id: "small",
        name: "Small",
      },
      {
        id: "large-v3",
        name: "Large v3",
      },
    ],
    currentModel: sidebarState.currentModel,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettingsSlice: () => ({
    post_process_provider_id: sidebarState.llmProviderId,
    post_process_providers: sidebarState.llmProviders,
    post_process_models: sidebarState.llmModels,
    selected_tts_model_id: sidebarState.selectedTtsModelId,
    selected_tts_provider_id: sidebarState.selectedTtsProviderId,
  }),
}));

import SidebarModelLaunchers from "@/components/sidebar/SidebarModelLaunchers";

describe("SidebarModelLaunchers", () => {
  beforeEach(() => {
    sidebarState.currentModel = "small";
    sidebarState.llmProviderId = "openai";
    sidebarState.llmProviders = [
      { id: "openai", label: "OpenAI" },
      { id: "apple_intelligence", label: "Apple Intelligence" },
    ];
    sidebarState.llmModels = { openai: "gpt-4.1-mini" };
    sidebarState.selectedTtsModelId = "xtts-v2";
    sidebarState.selectedTtsProviderId = "xtts";
  });

  it("refreshes the LLM launcher label when the active model changes", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SidebarModelLaunchers />);
    });

    expect(container.textContent).toContain("gpt-4.1-mini");

    sidebarState.llmModels = { openai: "gpt-5.4-mini" };

    await act(async () => {
      root.render(<SidebarModelLaunchers />);
    });

    expect(container.textContent).toContain("gpt-5.4-mini");
    expect(container.textContent).not.toContain("gpt-4.1-mini");

    await act(async () => {
      root.unmount();
    });
  });
});
