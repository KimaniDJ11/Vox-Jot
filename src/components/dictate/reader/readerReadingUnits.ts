// Turns an extracted Reader document into the ordered list of short text units
// that the playback engine reads one at a time. Header/footer blocks (tagged by
// the Python extractor's repeated-band detection) are skipped by default so the
// narration doesn't repeat running heads and page numbers on every page.

export type ReadingUnit = {
  id: string;
  /** Normalized text spoken for this unit. */
  text: string;
  /** 0-based source page index, or null when derived from flat document text. */
  pageIndex: number | null;
};

// Structural shape — the panel's ReaderDocument satisfies this without coupling
// to its exact type. We only need the page/block text + kind and a flat-text
// fallback.
export type ReadableDocument = {
  text?: string | null;
  pages?: Array<{
    index: number;
    blocks: Array<{ text: string; kind: string }>;
  }> | null;
};

export type BuildReadingUnitsOptions = {
  skipHeadersFooters: boolean;
};

// Smaller than the backend's 1200-char chunk so pause/seek feel responsive and
// progress is granular, while still long enough to amortize per-utterance TTS
// synthesis latency.
const MAX_UNIT_CHARS = 480;
const SKIPPABLE_BLOCK_KINDS = new Set(["header", "footer"]);

export function buildReadingUnits(
  doc: ReadableDocument,
  options: BuildReadingUnitsOptions,
): ReadingUnit[] {
  const units: ReadingUnit[] = [];
  let counter = 0;

  const push = (text: string, pageIndex: number | null) => {
    for (const chunk of chunkText(text)) {
      units.push({ id: `unit-${counter++}`, text: chunk, pageIndex });
    }
  };

  const pages = doc.pages ?? [];
  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      if (options.skipHeadersFooters && SKIPPABLE_BLOCK_KINDS.has(block.kind)) {
        continue;
      }
      const text = (block.text ?? "").trim();
      if (text) push(text, page.index);
    }
  }

  // Fallback for documents that produced no structured blocks (e.g. the Rust
  // text-only extraction path): read the flat document text.
  if (units.length === 0) {
    push(doc.text ?? "", null);
  }

  return units;
}

/** Distinct, in-order page indices covered by the units (for progress display). */
export function readingUnitPageNumbers(units: ReadingUnit[]): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const unit of units) {
    if (unit.pageIndex !== null && !seen.has(unit.pageIndex)) {
      seen.add(unit.pageIndex);
      ordered.push(unit.pageIndex);
    }
  }
  return ordered;
}

export function chunkText(text: string, maxLen = MAX_UNIT_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= maxLen) return [normalized];

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  for (const sentence of splitSentences(normalized)) {
    if (sentence.length > maxLen) {
      flush();
      chunks.push(...hardSplit(sentence, maxLen));
      continue;
    }
    if (current && current.length + 1 + sentence.length > maxLen) {
      flush();
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  flush();
  return chunks;
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?…]+[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g);
  if (!matches) return [text.trim()].filter(Boolean);
  return matches.map((part) => part.trim()).filter(Boolean);
}

function hardSplit(text: string, maxLen: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (word.length > maxLen) {
      if (current) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxLen) {
        out.push(word.slice(i, i + maxLen));
      }
      continue;
    }
    if (current && current.length + 1 + word.length > maxLen) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}
