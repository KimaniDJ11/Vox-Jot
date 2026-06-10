import { useCallback, useEffect, useRef, useState } from "react";

import type { ReadingUnit } from "./readerReadingUnits";

export type ReaderPlaybackStatus = "idle" | "playing" | "paused";

/** Per-word timing for a unit, index-aligned with its whitespace tokens. */
export type ReaderWordTiming = {
  text: string;
  startMs: number;
  endMs: number;
};

/** A unit's synthesized audio: a blob URL the `<audio>` element plays, its
 *  duration, and per-word timings for word-by-word highlighting. */
export type ReaderUnitAudio = {
  src: string;
  durationMs: number;
  words: ReaderWordTiming[];
};

export type ReaderPlaybackController = {
  status: ReaderPlaybackStatus;
  /** Index of the unit currently playing / paused on / queued to play next. */
  index: number;
  total: number;
  /** Position within the current unit, in milliseconds. */
  positionMs: number;
  /** Duration of the current unit, in milliseconds. */
  durationMs: number;
  /** Active word index within the current unit, or -1 when none. */
  activeWordIndex: number;
  /** Word timings for the current unit (empty until its audio loads). */
  currentWords: ReaderWordTiming[];
  play: () => void;
  pause: () => void;
  resume: () => void;
  toggle: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  /** Seek to a unit (plays it when currently playing, else just selects it). */
  seek: (index: number) => void;
  /** Start playing from a specific unit, regardless of current status. */
  playAt: (index: number, positionMs?: number) => void;
  /** Scrub within the current unit's audio (milliseconds). */
  seekWithinUnit: (positionMs: number) => void;
};

type UseReaderPlaybackOptions = {
  units: ReadingUnit[];
  initialIndex?: number;
  initialPositionMs?: number;
  resetKey?: string | null;
  /** Ensure a unit is synthesized; resolve to its blob audio + word timings. */
  loadUnit: (unit: ReadingUnit) => Promise<ReaderUnitAudio>;
  /** Warm the cache for an upcoming unit (background preloading). */
  prefetchUnit?: (unit: ReadingUnit) => void;
  onError?: (error: unknown) => void;
  onIndexChange?: (index: number) => void;
  /** Persist fine-grained progress (unit index + position) for resume. */
  onProgress?: (index: number, positionMs: number) => void;
};

function findActiveWordIndex(
  words: ReaderWordTiming[],
  positionMs: number,
): number {
  if (words.length === 0) return -1;
  // Scan from the end: the active word is the last one that has started. If the
  // playhead sits in a gap before the next word, the last started word stays lit.
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (positionMs >= words[i].startMs) return i;
  }
  return 0;
}

/**
 * Frontend-owned reader player built on an `<audio>` element fed by per-unit
 * synthesized blobs. Owning the media timeline (instead of the old blocking
 * Rust playback) is what makes word-by-word highlighting, true pause/resume,
 * gapless preloading, and resume-from-position possible. A monotonic generation
 * token invalidates an in-flight async unit load when pause/stop/seek supersede
 * it.
 */
export function useReaderPlayback({
  units,
  initialIndex = 0,
  initialPositionMs = 0,
  resetKey = null,
  loadUnit,
  prefetchUnit,
  onError,
  onIndexChange,
  onProgress,
}: UseReaderPlaybackOptions): ReaderPlaybackController {
  const [status, setStatus] = useState<ReaderPlaybackStatus>("idle");
  const [index, setIndex] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [currentWords, setCurrentWords] = useState<ReaderWordTiming[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generationRef = useRef(0);
  const resetKeyRef = useRef(resetKey);
  const unitsRef = useRef(units);
  const indexRef = useRef(0);
  const positionRef = useRef(0);
  const wordsRef = useRef<ReaderWordTiming[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastPushRef = useRef(0);

  const loadUnitRef = useRef(loadUnit);
  const prefetchUnitRef = useRef(prefetchUnit);
  const onErrorRef = useRef(onError);
  const onIndexChangeRef = useRef(onIndexChange);
  const onProgressRef = useRef(onProgress);

  useEffect(() => {
    loadUnitRef.current = loadUnit;
  }, [loadUnit]);
  useEffect(() => {
    prefetchUnitRef.current = prefetchUnit;
  }, [prefetchUnit]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  // One audio element for the lifetime of the hook.
  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
    }
    return audioRef.current;
  }, []);

  const setPlaybackIndex = useCallback((nextIndex: number) => {
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    onIndexChangeRef.current?.(nextIndex);
  }, []);

  const setPlaybackPosition = useCallback((nextPositionMs: number) => {
    positionRef.current = nextPositionMs;
    setPositionMs(nextPositionMs);
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Drive smooth position + active-word updates from the audio clock while
  // playing. Throttled to ~12 Hz for position; word index updates on change.
  const tick = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const pos = audio.currentTime * 1000;
    const word = findActiveWordIndex(wordsRef.current, pos);
    setActiveWordIndex((current) => (current === word ? current : word));
    const now = performance.now();
    if (now - lastPushRef.current >= 80) {
      lastPushRef.current = now;
      setPlaybackPosition(pos);
      onProgressRef.current?.(indexRef.current, pos);
    }
    rafRef.current = window.requestAnimationFrame(tick);
  }, [setPlaybackPosition]);

  const startRaf = useCallback(() => {
    stopRaf();
    lastPushRef.current = 0;
    rafRef.current = window.requestAnimationFrame(tick);
  }, [stopRaf, tick]);

  const advanceFrom = useRef<(generation: number, start: number) => void>(
    () => {},
  );

  const startAt = useCallback(
    (start: number, fromPositionMs = 0) => {
      const list = unitsRef.current;
      if (list.length === 0) return;
      const clamped = Math.max(0, Math.min(start, list.length - 1));
      const generation = (generationRef.current += 1);
      const audio = ensureAudio();
      audio.pause();
      setStatus("playing");
      setPlaybackIndex(clamped);
      setPlaybackPosition(fromPositionMs);
      setActiveWordIndex(-1);
      const unit = list[clamped];
      // Warm the next units while this one plays (gapless preloading).
      prefetchUnitRef.current?.(list[clamped + 1]);
      prefetchUnitRef.current?.(list[clamped + 2]);
      void loadUnitRef.current(unit).then(
        (loaded) => {
          if (generation !== generationRef.current) return;
          wordsRef.current = loaded.words;
          setCurrentWords(loaded.words);
          setDurationMs(loaded.durationMs);
          audio.src = loaded.src;
          const safeStartMs =
            fromPositionMs > 0
              ? Math.min(fromPositionMs, Math.max(loaded.durationMs - 50, 0))
              : 0;
          setPlaybackPosition(safeStartMs);
          audio.currentTime = safeStartMs / 1000;
          void audio
            .play()
            .then(() => {
              if (generation === generationRef.current) startRaf();
            })
            .catch((error) => {
              if (generation === generationRef.current) {
                stopRaf();
                setStatus("idle");
                onErrorRef.current?.(error);
              }
            });
        },
        (error) => {
          if (generation === generationRef.current) {
            setStatus("idle");
            onErrorRef.current?.(error);
          }
        },
      );
    },
    [ensureAudio, setPlaybackIndex, setPlaybackPosition, startRaf, stopRaf],
  );

  // Keep a stable callback the 'ended' handler can call without re-binding.
  advanceFrom.current = (generation: number, start: number) => {
    if (generation !== generationRef.current) return;
    const list = unitsRef.current;
    if (start < list.length) {
      startAt(start);
    } else {
      generationRef.current += 1;
      stopRaf();
      setStatus("idle");
      setPlaybackPosition(0);
      setActiveWordIndex(-1);
      setPlaybackIndex(0);
      onProgressRef.current?.(0, 0);
    }
  };

  // Wire audio element events once.
  useEffect(() => {
    const audio = ensureAudio();
    const handleEnded = () => {
      stopRaf();
      setActiveWordIndex(-1);
      advanceFrom.current(generationRef.current, indexRef.current + 1);
    };
    const handleError = () => {
      if (!audio.src) return;
      stopRaf();
      setStatus("idle");
      onErrorRef.current?.(
        new Error(audio.error?.message || "Audio playback error."),
      );
    };
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [ensureAudio, stopRaf]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    // Resume in place when paused mid-unit; otherwise (re)start the unit.
    if (status === "paused" && audio && audio.src && audio.currentTime > 0) {
      setStatus("playing");
      void audio.play().then(
        () => startRaf(),
        (error) => {
          setStatus("idle");
          onErrorRef.current?.(error);
        },
      );
      return;
    }
    startAt(indexRef.current, positionRef.current);
  }, [status, startAt, startRaf]);

  const pause = useCallback(() => {
    setStatus((current) => {
      if (current !== "playing") return current;
      generationRef.current += 1;
      stopRaf();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        onProgressRef.current?.(indexRef.current, audio.currentTime * 1000);
      }
      return "paused";
    });
  }, [stopRaf]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    stopRaf();
    const audio = audioRef.current;
    if (audio) audio.pause();
    setStatus("idle");
    setPlaybackPosition(0);
    setActiveWordIndex(-1);
    setPlaybackIndex(0);
    onProgressRef.current?.(0, 0);
  }, [setPlaybackIndex, setPlaybackPosition, stopRaf]);

  const toggle = useCallback(() => {
    if (status === "playing") {
      pause();
    } else {
      play();
    }
  }, [status, pause, play]);

  const seek = useCallback(
    (target: number) => {
      const list = unitsRef.current;
      if (list.length === 0) return;
      const clamped = Math.max(0, Math.min(target, list.length - 1));
      if (status === "playing") {
        startAt(clamped);
      } else {
        generationRef.current += 1;
        stopRaf();
        audioRef.current?.pause();
        setStatus("paused" === status ? "paused" : "idle");
        setPlaybackPosition(0);
        setActiveWordIndex(-1);
        wordsRef.current = [];
        setCurrentWords([]);
        setPlaybackIndex(clamped);
        onProgressRef.current?.(clamped, 0);
      }
    },
    [status, startAt, setPlaybackIndex, setPlaybackPosition, stopRaf],
  );

  const next = useCallback(() => {
    seek(indexRef.current + 1);
  }, [seek]);
  const prev = useCallback(() => {
    seek(indexRef.current - 1);
  }, [seek]);

  const seekWithinUnit = useCallback(
    (nextPositionMs: number) => {
      const audio = audioRef.current;
      if (!audio || !audio.src) return;
      const clamped = Math.max(0, nextPositionMs);
      audio.currentTime = clamped / 1000;
      setPlaybackPosition(clamped);
      setActiveWordIndex(findActiveWordIndex(wordsRef.current, clamped));
    },
    [setPlaybackPosition],
  );

  // When the unit list or document changes, reset playback. A resetKey change
  // means a new document, so restore that document's saved index.
  useEffect(() => {
    unitsRef.current = units;
    generationRef.current += 1;
    stopRaf();
    audioRef.current?.pause();
    setStatus("idle");
    const isNewResetKey = resetKeyRef.current !== resetKey;
    const maxIndex = Math.max(units.length - 1, 0);
    const nextIndex = isNewResetKey ? initialIndex : indexRef.current;
    const clamped = Math.max(0, Math.min(nextIndex, maxIndex));
    const nextPosition =
      isNewResetKey && clamped === Math.max(0, Math.min(initialIndex, maxIndex))
        ? Math.max(0, initialPositionMs)
        : 0;
    setPlaybackPosition(nextPosition);
    setActiveWordIndex(-1);
    wordsRef.current = [];
    setCurrentWords([]);
    resetKeyRef.current = resetKey;
    indexRef.current = clamped;
    setIndex(clamped);
    onIndexChangeRef.current?.(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    units,
    resetKey,
    initialIndex,
    initialPositionMs,
    setPlaybackPosition,
    stopRaf,
  ]);

  // Stop audio if the component using the hook unmounts mid-playback.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      stopRaf();
      audioRef.current?.pause();
    };
  }, [stopRaf]);

  return {
    status,
    index,
    total: units.length,
    positionMs,
    durationMs,
    activeWordIndex,
    currentWords,
    play,
    pause,
    resume: play,
    toggle,
    stop,
    next,
    prev,
    seek,
    playAt: (target: number, targetPositionMs = 0) =>
      startAt(target, targetPositionMs),
    seekWithinUnit,
  };
}
