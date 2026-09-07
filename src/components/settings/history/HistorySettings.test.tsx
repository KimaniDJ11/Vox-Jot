import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "@/bindings";
import { HistorySettings } from "./HistorySettings";

const mockState = vi.hoisted(() => ({
  getHistoryEntriesPage: vi.fn(),
  retryHistoryMarkdownExport: vi.fn(),
  revealHistoryMarkdownExport: vi.fn(),
  listeners: new Map<string, Set<() => void>>(),
  t: (key: string, options?: Record<string, unknown>) => {
    let translated =
      typeof options?.defaultValue === "string" ? options.defaultValue : key;
    for (const [name, value] of Object.entries(options ?? {})) {
      if (name !== "defaultValue") {
        translated = translated.split(`{{${name}}}`).join(String(value));
      }
    }
    return translated;
  },
}));

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    commands: {
      ...actual.commands,
      getAudioFilePath: vi.fn(),
      getHistoryEntriesPage: mockState.getHistoryEntriesPage,
      revealHistoryRecordingInFolder: vi.fn(async () => ({
        status: "ok",
        data: null,
      })),
      retryHistoryMarkdownExport: mockState.retryHistoryMarkdownExport,
      revealHistoryMarkdownExport: mockState.revealHistoryMarkdownExport,
      toggleHistoryEntrySaved: vi.fn(async () => ({
        status: "ok",
        data: null,
      })),
      deleteHistoryEntry: vi.fn(async () => ({ status: "ok", data: null })),
    },
  };
});

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
    i18n: { language: "en-US" },
    t: mockState.t,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSetting: () => true,
}));

vi.mock("../../ui/AudioPlayer", () => ({
  AudioPlayer: ({
    title,
    meta,
    actions,
  }: {
    title: React.ReactNode;
    meta: React.ReactNode;
    actions: React.ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      <div>{meta}</div>
      <div>{actions}</div>
    </div>
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const makeEntry = (
  id: number,
  transcriptionText: string,
  timestamp: number,
): HistoryEntry => ({
  id,
  file_name: `recording-${id}.wav`,
  timestamp,
  saved: false,
  title: transcriptionText,
  transcription_text: transcriptionText,
  post_processed_text: null,
  post_process_prompt: null,
  dictionary_hits: [],
  pasted_text: null,
  field_snapshot_text: null,
  field_snapshot_at: null,
  field_snapshot_status: "not_requested",
  field_snapshot_error: null,
  source_language_detected: null,
  translation_target_language: null,
  translated_text: null,
  translation_route: null,
  translation_provider_id: null,
  translation_model_id: null,
  translation_origin: null,
  translation_destination: null,
  tts_requested: null,
  tts_engine: null,
  tts_voice_id: null,
  tts_locale: null,
  tts_trigger: null,
  tts_status: null,
  screen_context_metadata: null,
  duration_ms: null,
  display_title: transcriptionText,
  display_title_source: "heuristic",
  summary: null,
  speaker_status: "not_analyzed",
  speaker_error: null,
  speaker_model_id: null,
  speaker_analyzed_at: null,
  speaker_count: null,
  speaker_labels_visible: true,
  speaker_segments_json: null,
  speaker_transcript_text: null,
  speaker_display_names_json: null,
  markdown_export_status: "not_requested",
  markdown_export_path: null,
  markdown_export_error: null,
  markdown_exported_at: null,
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

describe("HistorySettings", () => {
  beforeEach(() => {
    mockState.getHistoryEntriesPage.mockReset();
    mockState.retryHistoryMarkdownExport.mockReset();
    mockState.retryHistoryMarkdownExport.mockResolvedValue({
      status: "ok",
      data: null,
    });
    mockState.revealHistoryMarkdownExport.mockReset();
    mockState.revealHistoryMarkdownExport.mockResolvedValue({
      status: "ok",
      data: null,
    });
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

  it("keeps visible history mounted while handling history update events", async () => {
    const initialEntry = makeEntry(1, "Initial transcript", 1_780_000_000);
    const newEntry = makeEntry(2, "Newest transcript", 1_780_000_010);
    let resolveRefresh:
      | ((value: {
          status: "ok";
          data: { entries: HistoryEntry[]; has_more: boolean };
        }) => void)
      | null = null;

    mockState.getHistoryEntriesPage
      .mockResolvedValueOnce({
        status: "ok",
        data: { entries: [initialEntry], has_more: false },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );

    const view = await render(<HistorySettings />);
    await flushEffects();

    expect(view.textContent).toContain("Initial transcript");

    const historyListeners = mockState.listeners.get("history-updated");
    expect(historyListeners?.size).toBe(1);

    await act(async () => {
      historyListeners?.forEach((listener) => listener());
    });

    expect(view.textContent).toContain("Initial transcript");
    expect(
      view.querySelector('[data-testid="history-entries"]'),
    ).not.toBeNull();

    await act(async () => {
      resolveRefresh?.({
        status: "ok",
        data: { entries: [newEntry, initialEntry], has_more: false },
      });
    });

    expect(view.textContent).toContain("Newest transcript");
    expect(view.textContent).toContain("Initial transcript");
  });

  it("ignores stale history refreshes that finish out of order", async () => {
    const initialEntry = makeEntry(1, "Initial transcript", 1_780_000_000);
    const staleEntry = makeEntry(1, "Stale running transcript", 1_780_000_000);
    const latestEntry = makeEntry(1, "Completed transcript", 1_780_000_000);
    let resolveStale:
      | ((value: {
          status: "ok";
          data: { entries: HistoryEntry[]; has_more: boolean };
        }) => void)
      | null = null;
    let resolveLatest:
      | ((value: {
          status: "ok";
          data: { entries: HistoryEntry[]; has_more: boolean };
        }) => void)
      | null = null;

    mockState.getHistoryEntriesPage
      .mockResolvedValueOnce({
        status: "ok",
        data: { entries: [initialEntry], has_more: false },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLatest = resolve;
          }),
      );

    const view = await render(<HistorySettings />);
    await flushEffects();
    const historyListeners = mockState.listeners.get("history-updated");

    await act(async () => {
      historyListeners?.forEach((listener) => {
        listener();
        listener();
      });
    });
    await act(async () => {
      resolveLatest?.({
        status: "ok",
        data: { entries: [latestEntry], has_more: false },
      });
    });
    expect(view.textContent).toContain("Completed transcript");

    await act(async () => {
      resolveStale?.({
        status: "ok",
        data: { entries: [staleEntry], has_more: false },
      });
    });
    expect(view.textContent).toContain("Completed transcript");
    expect(view.textContent).not.toContain("Stale running transcript");
  });

  it("shows Markdown failure details and offers a retry", async () => {
    const failedEntry = {
      ...makeEntry(3, "Export this transcript", 1_780_000_020),
      markdown_export_status: "failed" as const,
      markdown_export_error: "Destination folder is unavailable.",
    };
    mockState.getHistoryEntriesPage.mockResolvedValue({
      status: "ok",
      data: { entries: [failedEntry], has_more: false },
    });

    const view = await render(<HistorySettings />);
    await flushEffects();

    expect(view.textContent).toContain("Markdown save failed");
    expect(view.textContent).toContain("Destination folder is unavailable.");
    const retryButton = view.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry Markdown export"]',
    );
    expect(retryButton).not.toBeNull();

    await act(async () => {
      retryButton?.click();
    });
    expect(mockState.retryHistoryMarkdownExport).toHaveBeenCalledWith(3);
  });
});
