export type ReaderDocumentKind = "pdf" | "docx" | "epub" | "markdown" | "text";

export type ReaderLibraryItem = {
  id: string;
  path: string;
  name: string;
  kind: ReaderDocumentKind;
  sizeBytes: number;
  sourceModifiedMs: number | null;
  wordCount: number;
  pageCount: number;
  sectionCount: number;
  extractionEngine: string;
  thumbnailDataUrl: string | null;
  openedAt: number;
};

export const READER_LIBRARY_STORAGE_KEY = "voxjot:reader-document-library:v2";
const MAX_READER_LIBRARY_ITEMS = 48;
const READER_DOCUMENT_KINDS = new Set<ReaderDocumentKind>([
  "pdf",
  "docx",
  "epub",
  "markdown",
  "text",
]);

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadReaderLibrary(
  storage: Storage | null = browserStorage(),
): ReaderLibraryItem[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(READER_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ReaderLibraryItem | null => {
        if (
          !item ||
          typeof item !== "object" ||
          typeof item.path !== "string" ||
          typeof item.name !== "string" ||
          typeof item.kind !== "string" ||
          !READER_DOCUMENT_KINDS.has(item.kind as ReaderDocumentKind) ||
          typeof item.sizeBytes !== "number" ||
          typeof item.wordCount !== "number" ||
          typeof item.openedAt !== "number"
        ) {
          return null;
        }
        return {
          id: typeof item.id === "string" ? item.id : item.path,
          path: item.path,
          name: item.name,
          kind: item.kind as ReaderDocumentKind,
          sizeBytes: item.sizeBytes,
          sourceModifiedMs:
            typeof item.sourceModifiedMs === "number"
              ? item.sourceModifiedMs
              : null,
          wordCount: item.wordCount,
          pageCount: typeof item.pageCount === "number" ? item.pageCount : 1,
          sectionCount:
            typeof item.sectionCount === "number" ? item.sectionCount : 1,
          extractionEngine:
            typeof item.extractionEngine === "string"
              ? item.extractionEngine
              : "unknown",
          // Thumbnails live in the backend Reader library. Keeping base64
          // images out of localStorage prevents quota failures.
          thumbnailDataUrl: null,
          openedAt: item.openedAt,
        };
      })
      .filter((item): item is ReaderLibraryItem => item !== null)
      .slice(0, MAX_READER_LIBRARY_ITEMS);
  } catch {
    return [];
  }
}

export function saveReaderLibrary(
  items: ReaderLibraryItem[],
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const minimizedItems = items
    .slice(0, MAX_READER_LIBRARY_ITEMS)
    .map(({ thumbnailDataUrl: _thumbnailDataUrl, ...item }) => item);
  try {
    storage.setItem(READER_LIBRARY_STORAGE_KEY, JSON.stringify(minimizedItems));
    return true;
  } catch (error) {
    console.warn("Failed to cache Reader document library metadata:", error);
    return false;
  }
}
