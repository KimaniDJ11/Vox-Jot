import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadReaderDocumentState,
  saveReaderDocumentState,
  loadReaderLastDocumentVoice,
  saveReaderLastDocumentVoice,
} from "./readerDocumentState";
import { normalizeReaderPlaybackRate } from "./readerPresentation";

describe("Reader saved state", () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  it("keeps resume position when voice, rate or language changes", () => {
    const progress = {
      sectionIndex: 2,
      unitIndex: 7,
      positionMs: 1500,
      updatedAt: 1,
    };
    saveReaderDocumentState("book", { progress });
    saveReaderDocumentState("book", {
      selectedPresetId: "voice",
      playbackRate: 1.5,
      language: "fr",
      sectionDisabled: { 1: true },
    });
    expect(loadReaderDocumentState("book")).toEqual(
      expect.objectContaining({
        progress,
        selectedPresetId: "voice",
        playbackRate: 1.5,
        language: "fr",
        sectionDisabled: { 1: true },
      }),
    );
    expect(values.has("voxjot:reader-document-state:v1")).toBe(true);
  });

  it("retains only the 96 most recently updated documents", () => {
    const now = vi.spyOn(Date, "now");
    for (let i = 0; i < 100; i++) {
      now.mockReturnValue(i);
      saveReaderDocumentState(`book-${i}`, { language: "en" });
    }
    expect(loadReaderDocumentState("book-0")).toEqual({});
    expect(loadReaderDocumentState("book-4").language).toBe("en");
    expect(loadReaderDocumentState("book-99").language).toBe("en");
    expect(
      Object.keys(JSON.parse(values.get("voxjot:reader-document-state:v1")!)),
    ).toHaveLength(96);
  });

  it("loads old state and handles missing or unreadable storage", () => {
    values.set(
      "voxjot:reader-document-state:v1",
      JSON.stringify({
        book: { progress: { sectionIndex: 0, unitIndex: 3, updatedAt: 1 } },
      }),
    );
    expect(loadReaderDocumentState("book").progress?.unitIndex).toBe(3);
    values.set("voxjot:reader-document-state:v1", "malformed");
    expect(loadReaderDocumentState("book")).toEqual({});
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Blocked");
      },
    });
    expect(loadReaderDocumentState("book")).toEqual({});
    expect(() =>
      saveReaderDocumentState("book", { language: "en" }),
    ).not.toThrow();
  });

  it("preserves the last Reader voice and supported playback speeds", () => {
    saveReaderLastDocumentVoice("voice");
    expect(loadReaderLastDocumentVoice()).toBe("voice");
    saveReaderLastDocumentVoice(null);
    expect(loadReaderLastDocumentVoice()).toBeNull();
    for (const rate of [0.75, 1, 1.25, 1.5, 1.75, 2])
      expect(normalizeReaderPlaybackRate(rate)).toBe(rate);
    for (const invalid of [NaN, null, "1.5", 5])
      expect(normalizeReaderPlaybackRate(invalid)).toBe(1);
  });
});
