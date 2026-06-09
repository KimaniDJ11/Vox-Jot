// Tidies extracted document text for the reader: reflows hard-wrapped lines into
// flowing paragraphs, de-hyphenates line breaks, and drops standalone OCR
// checkbox markers (a lone "x"/"X"), which otherwise render as choppy lines and
// get read aloud as "ex, ex, ex".

function isJunkLine(line: string): boolean {
  const stripped = line.replace(/[\s.\-_•·*]/g, "");
  return stripped === "" || /^[xX]{1,3}$/.test(stripped);
}

/**
 * Reflow a section's extracted text into clean paragraphs: keep blank-line
 * paragraph breaks, join hard-wrapped lines within a paragraph (de-hyphenating
 * trailing "-"), and drop junk marker lines.
 */
export function cleanReaderText(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !isJunkLine(line));
      let out = "";
      for (const line of lines) {
        if (!out) {
          out = line;
        } else if (out.endsWith("-") && !out.endsWith("--")) {
          out = `${out.slice(0, -1)}${line}`;
        } else {
          out = `${out} ${line}`;
        }
      }
      return out.trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

/** First meaningful line of a section, used as its nav title. */
export function deriveSectionTitle(text: string, fallback: string): string {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line && !isJunkLine(line) && line.length >= 3) {
      return line.length > 80 ? `${line.slice(0, 80).trimEnd()}…` : line;
    }
  }
  return fallback;
}
