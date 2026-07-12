import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/bindings";
import {
  buildSpeakerTranscriptTurns,
  formatHistoryDuration,
  humanizeSpeakerId,
  isSnippetRedundant,
  parseSpeakerIdsFromSegments,
  resolveHistorySpeakerIds,
  resolveHistoryDisplayTitle,
  resolveHistorySnippet,
  resolveHistoryTranscriptText,
  resolveSpeakerDisplayLabel,
  shouldShowHistorySpeakerBadge,
} from "./historyDisplay";

const baseEntry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 1,
  file_name: "vox-jot-1.wav",
  timestamp: 1_700_000_000,
  saved: false,
  title: "January 1, 2024 - 12:00PM",
  transcription_text: "",
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
  display_title: "",
  display_title_source: "timestamp",
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

describe("historyDisplay", () => {
  it("prefers display_title over transcript snippet", () => {
    expect(
      resolveHistoryDisplayTitle(
        baseEntry({
          display_title: "Conversation with my lawyer",
          transcription_text: "hello world",
        }),
      ),
    ).toBe("Conversation with my lawyer");
  });

  it("never returns blank or ellipsis-only identity", () => {
    expect(
      resolveHistoryDisplayTitle(
        baseEntry({
          display_title: "...",
          transcription_text: "...",
          title: "Fallback title",
        }),
      ),
    ).toBe("Fallback title");
  });

  it("formats duration and gates speaker badge", () => {
    expect(formatHistoryDuration(125_000)).toBe("2:05");
    expect(
      shouldShowHistorySpeakerBadge(
        baseEntry({
          speaker_status: "complete",
          speaker_count: 2,
          speaker_labels_visible: true,
        }),
      ),
    ).toBe(true);
    expect(
      shouldShowHistorySpeakerBadge(
        baseEntry({
          speaker_status: "complete",
          speaker_count: 1,
          speaker_labels_visible: true,
        }),
      ),
    ).toBe(false);
    expect(
      shouldShowHistorySpeakerBadge(
        baseEntry({
          speaker_status: "complete",
          speaker_count: 3,
          speaker_labels_visible: false,
        }),
      ),
    ).toBe(false);
  });

  it("builds a short snippet", () => {
    expect(
      resolveHistorySnippet(baseEntry({ transcription_text: "Short note" })),
    ).toBe("Short note");
  });

  it("keeps the complete transcript separate from its display snippet", () => {
    const text = "A".repeat(200);
    const entry = baseEntry({ transcription_text: text });

    expect(resolveHistorySnippet(entry)).toHaveLength(141);
    expect(resolveHistoryTranscriptText(entry)).toBe(text);
  });

  it("extracts unique speaker ids from stored segments", () => {
    expect(
      parseSpeakerIdsFromSegments(
        JSON.stringify([
          { speaker_id: "A", text: "Hello" },
          { speaker_id: "B", text: "Hi" },
          { speaker_id: "A", text: "Again" },
        ]),
      ),
    ).toEqual(["A", "B"]);
  });

  it("unions saved names with newly detected speaker ids", () => {
    expect(
      resolveHistorySpeakerIds(
        JSON.stringify({ SPEAKER_00: "Me" }),
        JSON.stringify([
          { speaker_id: "SPEAKER_00", text: "Hello" },
          { speaker_id: "SPEAKER_01", text: "Hi" },
        ]),
        2,
      ),
    ).toEqual(["SPEAKER_00", "SPEAKER_01"]);
  });

  it("humanizes numeric and SPEAKER_ ids", () => {
    expect(humanizeSpeakerId("0")).toBe("Speaker 1");
    expect(humanizeSpeakerId("1")).toBe("Speaker 2");
    expect(humanizeSpeakerId("SPEAKER_00")).toBe("Speaker 1");
    expect(resolveSpeakerDisplayLabel("0", { "0": "Alex" })).toBe("Alex");
  });

  it("builds coalesced speaker turns with display names applied to every turn", () => {
    expect(
      buildSpeakerTranscriptTurns(
        JSON.stringify([
          { speaker_id: "0", text: "Hello" },
          { speaker_id: "0", text: "again" },
          { speaker_id: "1", text: "Hi" },
          { speaker_id: "0", text: "Back" },
        ]),
        JSON.stringify({ "0": "Alex" }),
      ),
    ).toEqual([
      { speakerId: "0", label: "Alex", text: "Hello again" },
      { speakerId: "1", label: "Speaker 2", text: "Hi" },
      { speakerId: "0", label: "Alex", text: "Back" },
    ]);
  });

  describe("isSnippetRedundant", () => {
    it("returns true for exact match", () => {
      expect(isSnippetRedundant("Hello world", "Hello world")).toBe(true);
    });

    it("returns true when snippet is title plus trailing punctuation", () => {
      expect(
        isSnippetRedundant(
          "Cancel my trash service",
          "Cancel my trash service.",
        ),
      ).toBe(true);
    });

    it("returns true when title is a truncated prefix of snippet", () => {
      expect(
        isSnippetRedundant(
          "I need to cancel my trash service…",
          "I need to cancel my trash service, what should I do?",
        ),
      ).toBe(true);
    });

    it("returns false when snippet adds genuinely new content", () => {
      expect(
        isSnippetRedundant(
          "Meeting notes",
          "We discussed the Q4 roadmap and assigned action items.",
        ),
      ).toBe(false);
    });

    it("returns true for empty/blank inputs", () => {
      expect(isSnippetRedundant("", "something")).toBe(true);
      expect(isSnippetRedundant("title", "")).toBe(true);
    });
  });
});
