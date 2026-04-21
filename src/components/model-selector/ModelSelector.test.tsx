import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listenCalls: string[] = [];
const storeState = vi.hoisted(() => ({
  selectModel: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string) => {
    listenCalls.push(eventName);
    return Promise.resolve(() => {});
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./ModelStatusButton", () => ({
  default: () => React.createElement("button", null),
}));

vi.mock("./ModelDropdown", () => ({
  default: () => null,
}));

vi.mock("./DownloadProgressDisplay", () => ({
  default: () => null,
}));

vi.mock("../../stores/modelStore", () => ({
  useModelStore: () => ({
    models: [
      {
        id: "small",
        name: "Small",
        description: "Small model",
        is_downloaded: true,
        is_downloading: false,
        is_custom: false,
        engine_type: "whisper",
      },
    ],
    currentModel: "small",
    downloadProgress: {},
    downloadStats: {},
    extractingModels: {},
    selectModel: storeState.selectModel,
  }),
}));

import ModelSelector from "@/components/model-selector/ModelSelector";

describe("ModelSelector", () => {
  beforeEach(() => {
    listenCalls.length = 0;
    storeState.selectModel.mockReset();
  });

  it("does not auto-switch on model download completion", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<ModelSelector />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(listenCalls).toContain("model-state-changed");
    expect(listenCalls).not.toContain("model-download-complete");
    expect(storeState.selectModel).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
