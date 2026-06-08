import { useCallback, useEffect, useRef, useState } from "react";

import type { ReadingUnit } from "./readerReadingUnits";

export type ReaderPlaybackStatus = "idle" | "playing" | "paused";

export type ReaderPlaybackController = {
  status: ReaderPlaybackStatus;
  /** Index of the unit currently playing / paused on / queued to play next. */
  index: number;
  total: number;
  play: () => void;
  pause: () => void;
  resume: () => void;
  toggle: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  seek: (index: number) => void;
};

type UseReaderPlaybackOptions = {
  units: ReadingUnit[];
  /** Speak one unit; must resolve when that unit's audio finishes (or is stopped). */
  speak: (text: string) => Promise<void>;
  /** Stop any in-flight audio immediately. */
  stopAudio: () => Promise<void>;
  onError?: (error: unknown) => void;
};

/**
 * Sequential reader player built on the blocking `tts_speak` command (which has
 * no progress events): we play one unit at a time and treat each `speak`
 * resolution as the signal to advance. A monotonic generation token lets
 * pause/stop/seek invalidate an in-flight loop without racing — when the token
 * changes mid-`await`, the resolving iteration bails instead of advancing.
 */
export function useReaderPlayback({
  units,
  speak,
  stopAudio,
  onError,
}: UseReaderPlaybackOptions): ReaderPlaybackController {
  const [status, setStatus] = useState<ReaderPlaybackStatus>("idle");
  const [index, setIndex] = useState(0);

  const generationRef = useRef(0);
  const unitsRef = useRef(units);
  const speakRef = useRef(speak);
  const stopAudioRef = useRef(stopAudio);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);
  useEffect(() => {
    stopAudioRef.current = stopAudio;
  }, [stopAudio]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const runLoop = useCallback(async (generation: number, start: number) => {
    const list = unitsRef.current;
    for (let i = start; i < list.length; i += 1) {
      if (generation !== generationRef.current) return;
      setIndex(i);
      try {
        await speakRef.current(list[i].text);
      } catch (error) {
        if (generation === generationRef.current) {
          generationRef.current += 1;
          setStatus("idle");
          onErrorRef.current?.(error);
        }
        return;
      }
      if (generation !== generationRef.current) return;
    }
    if (generation === generationRef.current) {
      generationRef.current += 1;
      setStatus("idle");
      setIndex(0);
    }
  }, []);

  const startAt = useCallback(
    (start: number) => {
      const list = unitsRef.current;
      if (list.length === 0) return;
      const clamped = Math.max(0, Math.min(start, list.length - 1));
      const generation = (generationRef.current += 1);
      void stopAudioRef.current();
      setStatus("playing");
      setIndex(clamped);
      void runLoop(generation, clamped);
    },
    [runLoop],
  );

  const play = useCallback(() => {
    startAt(index);
  }, [startAt, index]);

  const pause = useCallback(() => {
    setStatus((current) => {
      if (current !== "playing") return current;
      generationRef.current += 1;
      void stopAudioRef.current();
      return "paused";
    });
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    void stopAudioRef.current();
    setStatus("idle");
    setIndex(0);
  }, []);

  const toggle = useCallback(() => {
    if (status === "playing") {
      pause();
    } else {
      startAt(index);
    }
  }, [status, pause, startAt, index]);

  const seek = useCallback(
    (target: number) => {
      const list = unitsRef.current;
      if (list.length === 0) return;
      const clamped = Math.max(0, Math.min(target, list.length - 1));
      if (status === "playing") {
        startAt(clamped);
      } else {
        setIndex(clamped);
      }
    },
    [status, startAt],
  );

  const next = useCallback(() => {
    seek(index + 1);
  }, [seek, index]);
  const prev = useCallback(() => {
    seek(index - 1);
  }, [seek, index]);

  // When the unit list changes (new document or the skip-headers toggle), keep
  // the ref current and reset playback so we never read a stale index.
  useEffect(() => {
    unitsRef.current = units;
    generationRef.current += 1;
    void stopAudioRef.current();
    setStatus("idle");
    setIndex(0);
  }, [units]);

  // Stop audio if the component using the hook unmounts mid-playback.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      void stopAudioRef.current();
    };
  }, []);

  return {
    status,
    index,
    total: units.length,
    play,
    pause,
    resume: play,
    toggle,
    stop,
    next,
    prev,
    seek,
  };
}
