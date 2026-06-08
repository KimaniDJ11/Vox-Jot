import { describe, expect, it } from "vitest";

import {
  buildReadingUnits,
  buildSectionReadingUnits,
  chunkText,
  readingUnitPageNumbers,
} from "./readerReadingUnits";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("Hello world.")).toEqual(["Hello world."]);
  });

  it("collapses whitespace", () => {
    expect(chunkText("Hello   \n  world")).toEqual(["Hello world"]);
  });

  it("splits long text on sentence boundaries within the limit", () => {
    const sentence = `${"a".repeat(300)}. ${"b".repeat(300)}.`;
    const chunks = chunkText(sentence, 480);
    expect(chunks.length).toBe(2);
    expect(chunks[0].endsWith(".")).toBe(true);
  });

  it("hard-splits a single oversized token", () => {
    const chunks = chunkText("x".repeat(1000), 480);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 480)).toBe(true);
  });
});

describe("buildReadingUnits", () => {
  const doc = {
    text: "fallback text",
    pages: [
      {
        index: 0,
        blocks: [
          { text: "Running Head", kind: "header" },
          { text: "Body paragraph one.", kind: "content" },
          { text: "Page 1", kind: "footer" },
        ],
      },
      {
        index: 1,
        blocks: [{ text: "Body paragraph two.", kind: "content" }],
      },
    ],
  };

  it("skips header/footer blocks by default", () => {
    const units = buildReadingUnits(doc, { skipHeadersFooters: true });
    expect(units.map((u) => u.text)).toEqual([
      "Body paragraph one.",
      "Body paragraph two.",
    ]);
    expect(units.map((u) => u.pageIndex)).toEqual([0, 1]);
  });

  it("includes header/footer blocks when skipping is disabled", () => {
    const units = buildReadingUnits(doc, { skipHeadersFooters: false });
    expect(units.map((u) => u.text)).toEqual([
      "Running Head",
      "Body paragraph one.",
      "Page 1",
      "Body paragraph two.",
    ]);
  });

  it("falls back to flat text when there are no structured blocks", () => {
    const units = buildReadingUnits(
      { text: "just flat text", pages: [] },
      { skipHeadersFooters: true },
    );
    expect(units).toHaveLength(1);
    expect(units[0].text).toBe("just flat text");
    expect(units[0].pageIndex).toBeNull();
  });

  it("reports distinct page numbers in order", () => {
    const units = buildReadingUnits(doc, { skipHeadersFooters: true });
    expect(readingUnitPageNumbers(units)).toEqual([0, 1]);
  });
});

describe("buildSectionReadingUnits", () => {
  const sections = [
    { index: 0, text: "Narrator intro." },
    { index: 1, text: "Character reply." },
    { index: 2, text: "Skipped notes." },
  ];

  it("tags chunks with section indexes and voice preset ids", () => {
    const units = buildSectionReadingUnits(sections, {
      voiceForSection: (sectionIndex) =>
        sectionIndex === 1 ? "voice-character" : "voice-narrator",
      isSectionEnabled: () => true,
    });

    expect(units.map((unit) => unit.sectionIndex)).toEqual([0, 1, 2]);
    expect(units.map((unit) => unit.presetId)).toEqual([
      "voice-narrator",
      "voice-character",
      "voice-narrator",
    ]);
  });

  it("omits disabled sections from the playback queue", () => {
    const units = buildSectionReadingUnits(sections, {
      voiceForSection: () => null,
      isSectionEnabled: (sectionIndex) => sectionIndex !== 2,
    });

    expect(units.map((unit) => unit.text)).toEqual([
      "Narrator intro.",
      "Character reply.",
    ]);
  });
});
