import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadReaderLibrary,
  READER_LIBRARY_STORAGE_KEY,
  saveReaderLibrary,
  type ReaderLibraryItem,
} from "@/lib/readerLibraryStorage";

const item: ReaderLibraryItem = {
  id: "reader-1",
  path: "/tmp/book.pdf",
  name: "book.pdf",
  kind: "pdf",
  sizeBytes: 1024,
  sourceModifiedMs: 123,
  wordCount: 200,
  pageCount: 2,
  sectionCount: 2,
  extractionEngine: "pymupdf",
  thumbnailDataUrl: "data:image/png;base64,large-thumbnail",
  openedAt: 456,
};

describe("Reader library storage", () => {
  let storage: Storage;

  beforeEach(() => {
    const values = new Map<string, string>();
    storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
  });

  it("stores only compact metadata and restores thumbnails from the backend", () => {
    expect(saveReaderLibrary([item], storage)).toBe(true);

    const raw = storage.getItem(READER_LIBRARY_STORAGE_KEY);
    expect(raw).not.toContain("large-thumbnail");
    expect(raw).not.toContain("thumbnailDataUrl");
    expect(loadReaderLibrary(storage)).toEqual([
      expect.objectContaining({
        id: item.id,
        path: item.path,
        thumbnailDataUrl: null,
      }),
    ]);
  });

  it("contains quota failures without interrupting Reader state updates", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unavailableStorage = {
      setItem: () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
    } as unknown as Storage;

    expect(saveReaderLibrary([item], unavailableStorage)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("ignores malformed cached entries", () => {
    storage.setItem(
      READER_LIBRARY_STORAGE_KEY,
      JSON.stringify([{ path: 42 }, { ...item, kind: "unknown" }]),
    );

    expect(loadReaderLibrary(storage)).toEqual([]);
  });
});
