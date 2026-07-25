import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventCallback = (event: { payload: unknown }) => void;
type AppSettingsResult = {
  status: string;
  data: { screen_context_enabled?: boolean };
};
type DiagnosticsResult = { status: string; data: { status: string } };

// `@/i18n` subscribes and reads settings at import time, so the mocks need
// working defaults before the first test installs its own behavior.
const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(async (_eventName: string, _callback: EventCallback) =>
    vi.fn(),
  ),
}));

const commandMocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(async (): Promise<AppSettingsResult> => ({
    status: "ok",
    data: {},
  })),
  getScreenContextDiagnostics: vi.fn(async (): Promise<DiagnosticsResult> => ({
    status: "ok",
    data: { status: "captured" },
  })),
  showDetailView: vi.fn(async () => ({ status: "ok", data: null })),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

vi.mock("@/bindings", () => ({
  commands: commandMocks,
}));

import RecordingOverlay from "./RecordingOverlay";

const OVERLAY_EVENTS = [
  "show-overlay",
  "show-correction-overlay",
  "hide-overlay",
  "mic-level",
  "partial-transcription",
  "write-rule-matched",
  "write-rule-cleared",
  "settings-changed",
  "screen-context-status",
  "screen-context-capture",
];

describe("RecordingOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;
  let callbacks: Map<string, EventCallback>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    callbacks = new Map();
    eventMocks.listen.mockImplementation(
      async (eventName: string, callback: EventCallback) => {
        callbacks.set(eventName, callback);
        return vi.fn();
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  // Regression: the overlay used to register its listeners only after
  // awaiting getAppSettings/getScreenContextDiagnostics, so a failing or
  // slow settings read left the overlay permanently deaf to `show-overlay`.
  it("subscribes to every overlay event even when the settings read rejects", async () => {
    commandMocks.getAppSettings.mockRejectedValue(new Error("ipc offline"));
    commandMocks.getScreenContextDiagnostics.mockRejectedValue(
      new Error("ipc offline"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await act(async () => {
      root.render(<RecordingOverlay />);
    });

    for (const eventName of OVERLAY_EVENTS) {
      expect(callbacks.has(eventName)).toBe(true);
    }

    await act(async () => {
      callbacks.get("show-overlay")?.({
        payload: { state: "recording", style: "compact" },
      });
    });

    expect(container.querySelector(".recording-overlay")).not.toBeNull();
    consoleError.mockRestore();
  });

  it("shows the overlay for a show-overlay event that arrives before settings resolve", async () => {
    let resolveSettings!: (value: AppSettingsResult) => void;
    commandMocks.getAppSettings.mockReturnValue(
      new Promise<AppSettingsResult>((resolve) => {
        resolveSettings = resolve;
      }),
    );
    commandMocks.getScreenContextDiagnostics.mockResolvedValue({
      status: "ok",
      data: { status: "captured" },
    });

    await act(async () => {
      root.render(<RecordingOverlay />);
    });

    await act(async () => {
      callbacks.get("show-overlay")?.({
        payload: { state: "recording", style: "compact" },
      });
    });
    expect(container.querySelector(".recording-overlay")).not.toBeNull();

    await act(async () => {
      resolveSettings({
        status: "ok",
        data: { screen_context_enabled: true },
      });
    });
    expect(container.querySelector(".recording-overlay")).not.toBeNull();
  });
});
