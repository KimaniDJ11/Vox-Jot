import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listenCalls: string[] = [];
const storeState = vi.hoisted(() => ({
  selectModel: vi.fn(),
  listenHandlers: {} as Record<string, (event: { payload: unknown }) => void>,
  statusButtonProps: null as Record<string, unknown> | null,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (eventName: string, handler: (event: { payload: unknown }) => void) => {
      listenCalls.push(eventName);
      storeState.listenHandlers[eventName] = handler;
      return Promise.resolve(() => {
        delete storeState.listenHandlers[eventName];
      });
    },
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./ModelStatusButton", () => ({
  default: (props: Record<string, unknown>) => {
    storeState.statusButtonProps = props;
    return React.createElement("button", null, String(props.displayText ?? ""));
  },
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
    storeState.listenHandlers = {};
    storeState.statusButtonProps = null;
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

  it("surfaces unloaded model-state errors from the backend", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<ModelSelector />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      storeState.listenHandlers["model-state-changed"]?.({
        payload: {
          event_type: "unloaded",
          error: "Partial transcription engine panicked: mock panic",
        },
      });
    });

    expect(storeState.statusButtonProps?.status).toBe("error");
    expect(storeState.statusButtonProps?.displayText).toBe(
      "Partial transcription engine panicked: mock panic",
    );

    await act(async () => {
      root.unmount();
    });
  });
});
