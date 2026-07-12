import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/bindings";
import { TranscriptView } from "./TranscriptView";

const mockState = vi.hoisted(() => ({
  analyzeHistoryEntrySpeakers: vi.fn(),
  updateHistoryEntrySpeakerDisplayNames: vi.fn(),
}));

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    commands: {
      ...actual.commands,
      analyzeHistoryEntrySpeakers: mockState.analyzeHistoryEntrySpeakers,
      updateHistoryEntrySpeakerDisplayNames:
        mockState.updateHistoryEntrySpeakerDisplayNames,
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en-US" },
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("@/components/ui/DockedAudioHud", () => ({
  DockedAudioHud: ({
    floatingTitle,
    floatingControls,
  }: {
    floatingTitle?: React.ReactNode;
    floatingControls?: React.ReactNode;
  }) => (
    <div data-testid="docked-audio-hud">
      <div data-testid="floating-title">{floatingTitle}</div>
      <div data-testid="floating-controls">{floatingControls}</div>
    </div>
  ),
}));

vi.mock("@/components/model-hub/modelHubTabs", () => ({
  openModelHub: vi.fn(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const baseEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 1,
  file_name: "recording.wav",
  timestamp: 1_700_000_000,
  saved: false,
  title: "Recording",
  transcription_text: "Audit code for issues.",
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
  duration_ms: 3_000,
  display_title: "Audit code for issues",
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
  ...overrides,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const render = async (node: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
};

const clickButton = async (view: HTMLElement, text: string) => {
  const button = Array.from(view.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
};

const Harness: React.FC<{ initialEntry: HistoryEntry }> = ({
  initialEntry,
}) => {
  const [entry, setEntry] = useState(initialEntry);
  return (
    <TranscriptView
      entries={[entry]}
      selectedId={entry.id}
      onSelectEntry={() => undefined}
      getAudioUrl={async () => null}
      onTranscriptChange={() => undefined}
      onEntryUpdate={setEntry}
      onEntryPatch={(id, patch) =>
        setEntry((current) =>
          current.id === id ? { ...current, ...patch } : current,
        )
      }
      viewSwitcher={<div data-testid="view-switcher" />}
    />
  );
};

describe("TranscriptView speaker analysis", () => {
  beforeEach(() => {
    mockState.analyzeHistoryEntrySpeakers.mockReset();
    mockState.updateHistoryEntrySpeakerDisplayNames.mockReset();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it("keeps the main view switcher and speaker action in one toolbar", async () => {
    const view = await render(<Harness initialEntry={baseEntry()} />);

    const toolbar = view.querySelector(".history-transcript-toolbar");
    expect(
      toolbar?.querySelector('[data-testid="view-switcher"]'),
    ).not.toBeNull();
    expect(toolbar?.textContent).toContain("Analyze speakers");
    expect(view.querySelector('[role="tablist"]')).toBeNull();
    expect(view.textContent).not.toContain("Save names");
    const transcriptContent = view.querySelector(".history-transcript-content");
    expect(transcriptContent?.classList.contains("overflow-y-auto")).toBe(
      false,
    );
    expect(transcriptContent?.className).not.toContain("max-h-");
  });

  it("places only the recording timestamp beside the floating title", async () => {
    const view = await render(<Harness initialEntry={baseEntry()} />);

    expect(view.querySelector("article > header")).toBeNull();
    const floatingTimestamp = view.querySelector(
      ".history-transcript-floating-timestamp",
    );
    expect(floatingTimestamp).not.toBeNull();
    expect(floatingTimestamp?.classList.contains("font-bold")).toBe(true);
    expect(floatingTimestamp?.textContent).not.toContain("0:03");
    expect(
      floatingTimestamp?.closest('[data-testid="floating-title"]'),
    ).not.toBeNull();
    expect(
      floatingTimestamp?.nextElementSibling?.classList.contains(
        "history-transcript-floating-title",
      ),
    ).toBe(true);
    expect(
      view.querySelector('[data-testid="floating-controls"]')?.textContent,
    ).not.toContain(floatingTimestamp?.textContent);
    const floatingActions = view.querySelectorAll(
      '[data-testid="floating-controls"] button',
    );
    expect(floatingActions).toHaveLength(3);
    floatingActions.forEach((action) => {
      expect(action.classList.contains("border")).toBe(true);
      expect(action.className).toContain("shadow-[var(--shadow-sm)]");
    });

    await clickButton(view, "Audit code for issues");
    expect(
      view.querySelector(
        '[data-testid="floating-title"] input[aria-label="Edit recording title"]',
      ),
    ).not.toBeNull();
  });

  it("shows analyzed speaker output in the single transcript surface", async () => {
    const completed = baseEntry({
      speaker_status: "complete",
      speaker_model_id: "test-speakers",
      speaker_count: 2,
      speaker_segments_json: JSON.stringify([
        { speaker_id: "SPEAKER_00", text: "Hello" },
        { speaker_id: "SPEAKER_01", text: "Hi" },
      ]),
      speaker_transcript_text: "Speaker 1: Hello\nSpeaker 2: Hi",
      speaker_display_names_json: "{}",
    });
    mockState.analyzeHistoryEntrySpeakers.mockResolvedValue({
      status: "ok",
      data: completed,
    });
    const view = await render(<Harness initialEntry={baseEntry()} />);

    await clickButton(view, "Analyze speakers");

    expect(view.textContent).toContain("Speaker 1: Hello");
    expect(view.textContent).toContain("Re-analyze speakers");
    expect(view.textContent).toContain("2 speakers identified");
    expect(view.textContent).toContain("test-speakers");
    expect(view.textContent).toContain("Select a speaker label to rename");
    expect(view.textContent).not.toContain("Save names");
    expect(
      view.querySelector('[data-testid="speaker-transcript-turns"]'),
    ).not.toBeNull();
    expect(view.querySelector('[role="tablist"]')).toBeNull();
  });

  it("renames one speaker label across every turn for that speaker", async () => {
    const completed = baseEntry({
      speaker_status: "complete",
      speaker_model_id: "mlx-sortformer-4spk-v2-1",
      speaker_count: 2,
      speaker_segments_json: JSON.stringify([
        { speaker_id: "0", text: "Hello" },
        { speaker_id: "1", text: "Hi" },
        { speaker_id: "0", text: "Again" },
      ]),
      speaker_transcript_text:
        "Speaker 1: Hello\nSpeaker 2: Hi\nSpeaker 1: Again",
      speaker_display_names_json: "{}",
    });
    const renamed = {
      ...completed,
      speaker_display_names_json: JSON.stringify({ "0": "Alex" }),
      speaker_transcript_text: "Alex: Hello\nSpeaker 2: Hi\nAlex: Again",
    };
    mockState.updateHistoryEntrySpeakerDisplayNames.mockResolvedValue({
      status: "ok",
      data: renamed,
    });
    const view = await render(<Harness initialEntry={completed} />);

    await clickButton(view, "Speaker 1:");
    const input = view.querySelector(
      'input[aria-label="Display name for 0"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Alex");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
    });

    expect(
      mockState.updateHistoryEntrySpeakerDisplayNames,
    ).toHaveBeenCalledWith(1, { "0": "Alex" });
    expect(view.textContent).toContain("Alex:");
    expect(view.textContent).toContain("Again");
    expect(view.textContent).not.toContain("Select a speaker label to rename");
    const alexLabels = Array.from(view.querySelectorAll("button")).filter(
      (button) => button.textContent?.trim() === "Alex:",
    );
    expect(alexLabels).toHaveLength(2);
  });

  it("shows one-speaker status instead of hiding the result", async () => {
    const completed = baseEntry({
      speaker_status: "complete",
      speaker_model_id: "mlx-sortformer-4spk-v2-1",
      speaker_count: 1,
      speaker_segments_json: JSON.stringify([
        { speaker_id: "SPEAKER_00", text: "Hello alone" },
      ]),
      speaker_transcript_text: "Hello alone",
      speaker_display_names_json: "{}",
    });
    const view = await render(<Harness initialEntry={completed} />);

    expect(view.textContent).toContain("1 speaker detected");
    expect(view.textContent).toContain("mlx-sortformer-4spk-v2-1");
    expect(view.textContent).toContain("Labels are hidden");
    expect(view.textContent).toContain("Re-analyze speakers");
  });

  it("offers model selection when analysis reports that a model is required", async () => {
    mockState.analyzeHistoryEntrySpeakers.mockResolvedValue({
      status: "error",
      error: "Speaker Isolation model required",
    });
    const view = await render(<Harness initialEntry={baseEntry()} />);

    await clickButton(view, "Analyze speakers");

    expect(view.textContent).toContain("Choose speaker model");
    expect(view.textContent).toContain("Re-analyze speakers");
  });
});
