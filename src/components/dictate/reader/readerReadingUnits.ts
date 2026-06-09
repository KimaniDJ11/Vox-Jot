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
  /** 0-based source section index, or null when not section-derived. */
  sectionIndex: number | null;
  /** Voice preset to read this unit with (null = the reader's default voice). */
  presetId: string | null;
};

export type ReaderSectionLike = {
  index: number;
  text: string;
};

export type BuildSectionReadingUnitsOptions = {
  /** Voice preset id for a section (null = default voice). */
  voiceForSection: (sectionIndex: number) => string | null;
  /** Whether a section should be read aloud at all. */
  isSectionEnabled: (sectionIndex: number) => boolean;
};

/**
 * Section-aligned reading units: each enabled section is chunked into units
 * tagged with its section index and the voice preset chosen for that section.
 * This lets the player switch voices per section and skip sections the user
 * turned off. Sections come from the extractor's content text, so running
 * headers/footers are already excluded upstream.
 */
export function buildSectionReadingUnits(
  sections: ReaderSectionLike[],
  options: BuildSectionReadingUnitsOptions,
): ReadingUnit[] {
  const units: ReadingUnit[] = [];
  for (const section of sections) {
    if (!options.isSectionEnabled(section.index)) continue;
    const presetId = options.voiceForSection(section.index);
    const chunks = chunkText(section.text ?? "");
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      units.push({
        id: `section-${section.index}-chunk-${chunkIndex}`,
        text: chunk,
        pageIndex: null,
        sectionIndex: section.index,
        presetId,
      });
    }
  }
  return units;
}

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
      units.push({
        id: `unit-${counter++}`,
        text: chunk,
        pageIndex,
        sectionIndex: null,
        presetId: null,
      });
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
