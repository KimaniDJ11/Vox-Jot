import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoredCorrection } from "@/bindings";
import { CorrectionDictionaryView } from "./CorrectionDictionaryView";

type EventCallback = (event: { payload: unknown }) => void;

const mockState = vi.hoisted(() => ({
  getCorrections: vi.fn(),
  listeners: new Map<string, Set<EventCallback>>(),
  t: (
    _key: string,
    options?: Record<string, string | number | undefined>,
  ) => {
    let value = String(options?.defaultValue ?? _key);
    for (const [name, replacement] of Object.entries(options ?? {})) {
      value = value.split(`{{${name}}}`).join(String(replacement));
    }
    return value;
  },
}));

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    commands: {
      ...actual.commands,
      getCorrections: mockState.getCorrections,
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, callback: EventCallback) => {
    const listeners = mockState.listeners.get(eventName) ?? new Set();
    listeners.add(callback);
    mockState.listeners.set(eventName, listeners);
    return () => listeners.delete(callback);
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@/lib/installedApps", () => ({
  humanizeBundleId: (bundleId: string) => bundleId,
  readCachedInstalledApps: () => [],
  refreshInstalledApps: vi.fn(async () => []),
  subscribeInstalledApps: vi.fn(() => () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en-US" },
    t: mockState.t,
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const observedCorrection = (id: number): StoredCorrection => ({
  id,
  original: "VoxChart",
  corrected: "Vox Jot",
  frequency: 1,
  confidence: 0.92,
  exact_only: false,
  source_app: "com.apple.TextEdit",
  source_kind: "observed_edit",
  disabled_bundle_ids: [],
  first_seen: 1000,
  last_seen: 1001,
  is_active: true,
  user_approved: false,
  auto_apply: {
    status: "active",
    eligible: true,
    effective_confidence: 0.92,
    min_frequency: 1,
    min_confidence: 0.74,
    confirmations_remaining: 0,
  },
});

const candidateCorrection = (id: number): StoredCorrection => ({
  ...observedCorrection(id),
  original: "recieve",
  corrected: "receive",
  source_kind: "auto_learned",
  auto_apply: {
    status: "candidate",
    eligible: false,
    effective_confidence: 0.9,
    min_frequency: 3,
    min_confidence: 0.74,
    confirmations_remaining: 2,
  },
});

const renderView = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <CorrectionDictionaryView
        sectionTitle="Dictionary"
        showHeaderTitle
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });

  return container;
};

describe("CorrectionDictionaryView correction learning", () => {
  beforeEach(() => {
    mockState.getCorrections.mockReset();
    mockState.listeners.clear();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  it("shows the number of pending corrections while Dictionary is selected", async () => {
    mockState.getCorrections.mockResolvedValue({
      status: "ok",
      data: [candidateCorrection(1)],
    });

    const view = await renderView();

    expect(view.textContent).toContain("Corrections (1)");
  });

  it("shows an active observed edit in the Dictionary immediately", async () => {
    mockState.getCorrections.mockResolvedValue({
      status: "ok",
      data: [observedCorrection(1)],
    });

    const view = await renderView();
    const correctedInput = Array.from(view.querySelectorAll("input")).find(
      (input) => input.value === "Vox Jot",
    );

    expect(correctedInput).toBeDefined();
    expect(view.textContent).not.toContain("Corrections (1)");
  });

  it("refreshes and reports when the field monitor captures a correction", async () => {
    mockState.getCorrections
      .mockResolvedValueOnce({ status: "ok", data: [] })
      .mockResolvedValue({
        status: "ok",
        data: [observedCorrection(1)],
      });

    const view = await renderView();
    const listeners = mockState.listeners.get("correction-learning-status");
    expect(listeners?.size).toBe(1);

    await act(async () => {
      listeners?.forEach((listener) =>
        listener({
          payload: {
            status: "captured",
            appName: "TextEdit",
            correctionsAdded: 1,
          },
        }),
      );
      await Promise.resolve();
    });

    expect(view.textContent).toContain(
      "Learned one correction. It is active in your Dictionary.",
    );
    expect(
      Array.from(view.querySelectorAll("input")).some(
        (input) => input.value === "Vox Jot",
      ),
    ).toBe(true);
    expect(mockState.getCorrections).toHaveBeenCalledTimes(2);
  });

  it("explains when the destination field cannot be read", async () => {
    mockState.getCorrections.mockResolvedValue({ status: "ok", data: [] });

    const view = await renderView();
    const listeners = mockState.listeners.get("correction-learning-status");

    await act(async () => {
      listeners?.forEach((listener) =>
        listener({
          payload: {
            status: "unavailable",
            appName: "Notes",
            correctionsAdded: 0,
          },
        }),
      );
    });

    expect(view.textContent).toContain(
      "Vox Jot could not read the text field in Notes, so edits there may not be learned.",
    );
    expect(view.querySelector('[role="alert"]')).not.toBeNull();
  });
});
