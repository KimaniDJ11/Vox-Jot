import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryAudioSidebar, type StoryAudioItem } from "./StoryAudioHistory";

const mockState = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, Set<() => void>>(),
  t: (key: string, options?: { defaultValue?: string }) =>
    options?.defaultValue ?? key,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockState.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, callback: () => void) => {
    const listeners = mockState.listeners.get(eventName) ?? new Set();
    listeners.add(callback);
    mockState.listeners.set(eventName, listeners);
    return () => listeners.delete(callback);
  }),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
    t: mockState.t,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const makeItem = (
  id: string,
  title: string,
  createdAtMs: number,
): StoryAudioItem => ({
  id,
  kind: "story_render",
  title,
  script_text: title,
  output_path: `/tmp/${id}.wav`,
  created_at_ms: createdAtMs,
  duration_ms: 1000,
  line_count: 1,
  starred: false,
});

const render = async (node: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(node);
  });

  return container;
};

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("StoryAudioSidebar", () => {
  beforeEach(() => {
    mockState.invoke.mockReset();
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

  it("keeps generated audio visible while handling story audio updates", async () => {
    const initialItem = makeItem("audio-1", "Initial generated audio", 1_000);
    const newItem = makeItem("audio-2", "Newest generated audio", 2_000);
    let resolveRefresh: ((items: StoryAudioItem[]) => void) | null = null;
    let storyAudioCalls = 0;

    mockState.invoke.mockImplementation((command: string) => {
      if (command === "list_story_render_jobs") {
        return Promise.resolve([]);
      }

      if (command !== "list_story_audio") {
        return Promise.resolve(null);
      }

      storyAudioCalls += 1;
      if (storyAudioCalls === 1) {
        return Promise.resolve([initialItem]);
      }

      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    });

    const view = await render(<StoryAudioSidebar />);
    await flushEffects();

    expect(view.textContent).toContain("Initial generated audio");

    const updateListeners = mockState.listeners.get("story-audio-updated");
    expect(updateListeners?.size).toBe(1);

    await act(async () => {
      updateListeners?.forEach((listener) => listener());
    });

    expect(view.textContent).toContain("Initial generated audio");
    expect(view.textContent).not.toContain("storyAudio.loading");

    await act(async () => {
      resolveRefresh?.([newItem, initialItem]);
    });

    expect(view.textContent).toContain("Newest generated audio");
    expect(view.textContent).toContain("Initial generated audio");
  });
});
