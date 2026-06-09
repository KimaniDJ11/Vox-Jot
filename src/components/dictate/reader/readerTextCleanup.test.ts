import { describe, expect, it } from "vitest";

import { cleanReaderText, deriveSectionTitle } from "./readerTextCleanup";

describe("cleanReaderText", () => {
  it("reflows hard-wrapped lines into a single paragraph", () => {
    const input =
      "A motion is a formal request to the court\nso the court is aware\nof the reasons.";
    expect(cleanReaderText(input)).toBe(
      "A motion is a formal request to the court so the court is aware of the reasons.",
    );
  });

  it("keeps blank-line paragraph breaks", () => {
    const input = "First paragraph line one\nline two\n\nSecond paragraph.";
    expect(cleanReaderText(input)).toBe(
      "First paragraph line one line two\n\nSecond paragraph.",
    );
  });

  it("drops lone OCR checkbox markers", () => {
    const input =
      "X\nMotion: review and sign.\nx\nAffidavit: supports the motion.";
    expect(cleanReaderText(input)).toBe(
      "Motion: review and sign. Affidavit: supports the motion.",
    );
  });

  it("de-hyphenates split words", () => {
    expect(cleanReaderText("inter-\nnational")).toBe("international");
  });
});

describe("deriveSectionTitle", () => {
  it("skips junk first lines", () => {
    expect(
      deriveSectionTitle("X\nMotion: a formal request.", "Section 3"),
    ).toBe("Motion: a formal request.");
  });

  it("falls back when there is no meaningful line", () => {
    expect(deriveSectionTitle("x\nX\n.", "Section 3")).toBe("Section 3");
  });

  it("truncates very long titles", () => {
    const long = "a".repeat(120);
    expect(deriveSectionTitle(long, "fallback")).toHaveLength(81);
  });
});
