import { useCallback, useEffect, useMemo } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import { ReaderAudioCache } from "./ReaderAudioCache";
import { synthesizeReaderUnit } from "./readerCommands";
import type { ReadingUnit } from "./readerReadingUnits";

export function useReaderUnitAudio({
  documentId,
  playbackRate,
  language,
  onRendered,
}: {
  documentId: string | null;
  playbackRate: number;
  language: string | null;
  onRendered: () => Promise<unknown>;
}) {
  const cache = useMemo(() => new ReaderAudioCache(), [documentId]);
  useEffect(() => () => cache.clear(), [cache]);

  const loadUnit = useCallback(
    (unit: ReadingUnit) => {
      if (!documentId) return Promise.reject(new Error("No document is open."));
      const key = JSON.stringify([
        unit.id,
        unit.text,
        unit.presetId,
        playbackRate,
        language,
      ]);
      return cache.load(key, async () => {
        const render = await synthesizeReaderUnit(
          documentId,
          { id: unit.id, text: unit.text, preset_id: unit.presetId },
          playbackRate,
          language,
        );
        const bytes = await readFile(render.path);
        const value = {
          src: URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
          ),
          durationMs: render.duration_ms,
          words: render.words.map((word) => ({
            text: word.text,
            startMs: word.start_ms,
            endMs: word.end_ms,
          })),
        };
        if (!render.cache_hit) void onRendered();
        return value;
      });
    },
    [cache, documentId, playbackRate, language, onRendered],
  );

  const prefetchUnit = useCallback(
    (unit: ReadingUnit | undefined) => {
      if (!unit?.text.trim()) return;
      // Playback retries a failed speculative load and reports its error there.
      void loadUnit(unit).catch(() => {});
    },
    [loadUnit],
  );

  return { loadUnit, prefetchUnit };
}
