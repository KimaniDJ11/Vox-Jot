import type { ReaderDocument, ReaderStoredDocument } from "@/bindings";
import type { ReaderLibraryItem } from "@/lib/readerLibraryStorage";
import type { ReaderLibrarySort } from "../file-workspace/types";

export function readerItemFromDocument(
  document: ReaderDocument,
): ReaderLibraryItem {
  return {
    id: document.id,
    path: document.path,
    name: document.name,
    kind: document.kind,
    sizeBytes: document.size_bytes,
    sourceModifiedMs: document.source_modified_ms,
    wordCount: document.word_count,
    pageCount: document.page_count,
    sectionCount: document.sections.length,
    extractionEngine: document.extraction_engine,
    thumbnailDataUrl: document.thumbnail_data_url,
    openedAt: Date.now(),
  };
}

export function readerItemFromStoredDocument(
  document: ReaderStoredDocument,
): ReaderLibraryItem {
  return {
    id: document.id,
    path: document.path,
    name: document.name,
    kind: document.kind,
    sizeBytes: document.size_bytes,
    sourceModifiedMs: document.source_modified_ms,
    wordCount: document.word_count,
    pageCount: document.page_count,
    sectionCount: document.section_count,
    extractionEngine: document.extraction_engine,
    thumbnailDataUrl: document.thumbnail_data_url,
    openedAt: document.updated_at_ms,
  };
}

export function upsertReaderLibraryItem(
  items: ReaderLibraryItem[],
  item: ReaderLibraryItem,
): ReaderLibraryItem[] {
  return [
    item,
    ...items.filter(
      (existing) => existing.id !== item.id && existing.path !== item.path,
    ),
  ].slice(0, 48);
}

export function sortReaderLibrary(
  items: ReaderLibraryItem[],
  sort: ReaderLibrarySort,
): ReaderLibraryItem[] {
  const sorted = [...items];
  switch (sort) {
    case "name_asc":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "name_desc":
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case "oldest":
      return sorted.sort((a, b) => a.openedAt - b.openedAt);
    case "largest":
      return sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
    case "smallest":
      return sorted.sort((a, b) => a.sizeBytes - b.sizeBytes);
    case "recent":
    default:
      return sorted.sort((a, b) => b.openedAt - a.openedAt);
  }
}
