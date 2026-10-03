import {
  type ReaderDocument,
  type ReaderAudioCacheUnit,
  type ReaderAudiobookChapter,
  commands,
} from "@/bindings";
import type { ReaderLibraryItem } from "@/lib/readerLibraryStorage";
import type { ReaderRenderedPage } from "./ReaderPageView";
import { unwrapCommandResult } from "@/lib/commandResult";
import { readerItemFromStoredDocument } from "./readerLibrary";
import { readerErrorMessage } from "../file-workspace/errors";

export async function readReaderDocument(
  path: string,
): Promise<ReaderDocument> {
  return unwrapCommandResult(commands.readReaderDocument(path));
}

export async function listReaderDocuments(): Promise<ReaderLibraryItem[]> {
  const documents = await unwrapCommandResult(commands.listReaderDocuments());
  return documents.map(readerItemFromStoredDocument);
}

export async function removeStoredReaderDocument(id: string): Promise<void> {
  await unwrapCommandResult(commands.removeReaderDocument(id));
}

export function synthesizeReaderUnit(
  documentId: string,
  unit: ReaderAudioCacheUnit,
  playbackRate: number,
  language: string | null,
) {
  return unwrapCommandResult(
    commands.synthesizeReaderAudioUnit(
      documentId,
      unit,
      playbackRate,
      language,
    ),
  );
}

function pageCoordinate(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    throw new Error("Reader page contains invalid geometry.");
  }
  return value;
}

/** Convert native geometry once, before it reaches the page renderer. */
export async function renderReaderPage(
  documentId: string,
  pageIndex: number,
): Promise<ReaderRenderedPage> {
  const page = await unwrapCommandResult(
    commands.renderReaderPage(documentId, pageIndex, 2),
  );
  return {
    index: page.index,
    width: pageCoordinate(page.width),
    height: pageCoordinate(page.height),
    scale: pageCoordinate(page.scale),
    imageDataUrl: page.image_data_url,
    words: page.words.map((word) => ({
      text: word.text,
      x0: pageCoordinate(word.x0),
      y0: pageCoordinate(word.y0),
      x1: pageCoordinate(word.x1),
      y1: pageCoordinate(word.y1),
    })),
  };
}

export type ReaderAudiobookFormat = "wav" | "mp3" | "m4b";

export function exportReaderAudiobook(request: {
  documentId: string;
  chapters: ReaderAudiobookChapter[];
  outputPath: string;
  format: ReaderAudiobookFormat;
  playbackRate: number;
  language: string | null;
  title: string;
  author: string | null;
  coverDataUrl: string | null;
}) {
  return unwrapCommandResult(
    commands.exportReaderAudiobook(
      request.documentId,
      request.chapters,
      request.outputPath,
      request.format,
      request.playbackRate,
      request.language,
      request.title,
      request.author,
      request.coverDataUrl,
    ),
  );
}

export async function speakReaderTextWithPreset(
  text: string,
  presetId: string | null,
  playbackRate = 1,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const fallback = "Reader playback failed.";
  const result = await commands.ttsSpeakReader(
    trimmed,
    null,
    presetId,
    playbackRate,
    "reader_document",
    false,
  );
  if (result.status === "error") {
    throw new Error(readerErrorMessage(result.error, fallback));
  }
}
