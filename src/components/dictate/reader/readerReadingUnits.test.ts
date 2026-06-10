import { describe, expect, it } from "vitest";

import {
  buildReadingUnits,
  buildSectionReadingUnits,
  chunkText,
  readingUnitPageNumbers,
  sectionChunks,
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

describe("sectionChunks", () => {
  it("keeps paragraphs separate and never merges across blank lines", () => {
    const chunks = sectionChunks("First paragraph.\n\nSecond paragraph.");
    expect(chunks).toEqual([
      { paragraphIndex: 0, chunkIndex: 0, text: "First paragraph." },
      { paragraphIndex: 1, chunkIndex: 0, text: "Second paragraph." },
    ]);
  });

  it("chunks a long paragraph into ordered chunks under one paragraph index", () => {
    const long = `${"a".repeat(300)}. ${"b".repeat(300)}.`;
    const chunks = sectionChunks(long);
    expect(chunks.map((c) => c.paragraphIndex)).toEqual([0, 0]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it("skips blank paragraphs without advancing the paragraph index", () => {
    const chunks = sectionChunks("One.\n\n\n\nTwo.");
    expect(chunks.map((c) => c.paragraphIndex)).toEqual([0, 1]);
  });

  it("treats CRLF and whitespace-only blank lines as paragraph breaks", () => {
    const chunks = sectionChunks("One.\r\n  \r\nTwo.");
    expect(chunks).toEqual([
      { paragraphIndex: 0, chunkIndex: 0, text: "One." },
      { paragraphIndex: 1, chunkIndex: 0, text: "Two." },
    ]);
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
    expect(units.map((unit) => unit.paragraphIndex)).toEqual([0, 0, 0]);
    expect(units.map((unit) => unit.presetId)).toEqual([
      "voice-narrator",
      "voice-character",
      "voice-narrator",
    ]);
    expect(units.map((unit) => unit.id)).toEqual([
      "s0-p0-c0",
      "s1-p0-c0",
      "s2-p0-c0",
    ]);
  });

  it("ids encode paragraph and chunk position within a section", () => {
    const units = buildSectionReadingUnits(
      [{ index: 0, text: "Para one sentence.\n\nPara two sentence." }],
      { voiceForSection: () => null, isSectionEnabled: () => true },
    );
    expect(units.map((unit) => unit.id)).toEqual(["s0-p0-c0", "s0-p1-c0"]);
    expect(units.map((unit) => unit.paragraphIndex)).toEqual([0, 1]);
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
