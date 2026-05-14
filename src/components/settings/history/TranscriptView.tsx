import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FolderOpen,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";

import { commands, type HistoryEntry } from "@/bindings";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";

interface TranscriptViewProps {
  /** History entries, already sorted newest-first. */
  entries: HistoryEntry[];
  /** Currently focused entry id, or null to fall back to the most recent. */
  selectedId: number | null;
  /** Switch the focused entry (used by prev/next navigation). */
  onSelectEntry: (id: number) => void;
  /** Resolve a recording file name to a playable blob URL. */
  getAudioUrl: (fileName: string) => Promise<string | null>;
  /** Notify the parent that an entry's transcript text changed. */
  onTranscriptChange: (id: number, nextText: string) => void;
}

type Segment = { text: string; isWord: boolean };

// Split text into editable word segments and static separators (whitespace +
// punctuation). Words keep internal apostrophes so "don't" / "l'historique"
// stay a single token.
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu;

function tokenize(text: string): Segment[] {
  if (!text) return [];
  const segments: Segment[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const value = match[0];
    segments.push({ text: value, isWord: /[\p{L}\p{N}]/u.test(value) });
  }
  return segments;
}

const formatClock = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const DOCKED_TICK_COUNT = 64;
// Deterministic pseudo-waveform, matching the look of the generated-audio
// player's docked scrubber.
const DOCKED_TICK_HEIGHTS = Array.from({ length: DOCKED_TICK_COUNT }, (_, i) => {
  const phase = i / (DOCKED_TICK_COUNT - 1);
  const wave =
    0.4 +
    0.6 *
      Math.abs(
        Math.sin(i * 0.5 + 0.4) *
          Math.cos(i * 0.27 + 1.3) *
          (1 - 0.2 * Math.abs(phase - 0.5)),
      );
  return Math.max(20, Math.min(100, Math.round(wave * 100)));
});

const dockedActionButtonClassName = `inline-flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)] ${interactiveFocusRingClass}`;

export const TranscriptView: React.FC<TranscriptViewProps> = ({
  entries,
  selectedId,
  onSelectEntry,
  getAudioUrl,
  onTranscriptChange,
}) => {
  const { t } = useTranslation();

  const currentIndex = useMemo(() => {
    if (entries.length === 0) return -1;
    const found = entries.findIndex((entry) => entry.id === selectedId);
    return found >= 0 ? found : 0;
  }, [entries, selectedId]);

  const entry = currentIndex >= 0 ? entries[currentIndex] : null;
  // Newest-first list: the "newer" entry sits at a lower index.
  const previousEntry = currentIndex > 0 ? entries[currentIndex - 1] : null;
  const nextEntry =
    currentIndex >= 0 && currentIndex < entries.length - 1
      ? entries[currentIndex + 1]
      : null;

  const segments = useMemo(
    () => tokenize(entry?.transcription_text ?? ""),
    [entry?.transcription_text],
  );

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // Audio playback state.
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number>();

  // Reset editing + playback whenever the focused entry changes.
  useEffect(() => {
    setEditingIndex(null);
    setDraftValue("");
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(
      entry?.duration_ms && entry.duration_ms > 0
        ? entry.duration_ms / 1000
        : 0,
    );
    setAudioSrc((current) => {
      if (current?.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  }, [entry?.id, entry?.duration_ms]);

  useEffect(() => {
    return () => {
      if (audioSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(audioSrc);
      }
    };
  }, [audioSrc]);

  useEffect(() => {
    if (editingIndex !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingIndex]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
      return;
    }
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        setCurrentTime(audio.currentTime);
      }
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [isPlaying]);

  const loadAudio = useCallback(async () => {
    if (!entry) return null;
    if (audioSrc) return audioSrc;
    setIsLoadingAudio(true);
    try {
      const nextSrc = await getAudioUrl(entry.file_name);
      if (nextSrc) {
        setAudioSrc(nextSrc);
      }
      return nextSrc;
    } finally {
      setIsLoadingAudio(false);
    }
  }, [audioSrc, entry, getAudioUrl]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !entry || isLoadingAudio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    const src = await loadAudio();
    if (!src) return;
    if (audio.src !== src) {
      audio.src = src;
      audio.load();
    }
    try {
      await audio.play();
    } catch (error) {
      console.error("Transcript audio playback failed:", error);
    }
  }, [entry, isLoadingAudio, isPlaying, loadAudio]);

  const handleScrub = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number.parseFloat(event.target.value);
    setCurrentTime(nextTime);
    if (audioRef.current) {
      audioRef.current.currentTime = nextTime;
    }
  };

  const revealRecording = useCallback(async () => {
    if (!entry) return;
    try {
      const result = await commands.revealHistoryRecordingInFolder(
        entry.file_name,
      );
      if (result.status !== "ok") {
        toast.error(
          t("settings.history.revealError", { error: result.error }),
        );
      }
    } catch (error) {
      toast.error(
        t("settings.history.revealError", { error: String(error) }),
      );
    }
  }, [entry, t]);

  const beginEditing = (segmentIndex: number) => {
    const segment = segments[segmentIndex];
    if (!segment?.isWord) return;
    setEditingIndex(segmentIndex);
    setDraftValue(segment.text);
  };

  const cancelEditing = () => {
    setEditingIndex(null);
    setDraftValue("");
  };

  const commitEditing = async () => {
    if (editingIndex === null || !entry) return;
    const segmentIndex = editingIndex;
    const originalWord = segments[segmentIndex]?.text ?? "";
    const correctedWord = draftValue.trim();
    setEditingIndex(null);
    setDraftValue("");

    if (!correctedWord || correctedWord === originalWord) {
      return;
    }

    const nextText = segments
      .map((segment, index) =>
        index === segmentIndex ? correctedWord : segment.text,
      )
      .join("");
    const previousText = entry.transcription_text;

    // Optimistically update so the edit feels instant, then persist.
    onTranscriptChange(entry.id, nextText);
    try {
      const result = await commands.updateHistoryEntryTranscription(
        entry.id,
        nextText,
      );
      if (result.status !== "ok") {
        throw new Error(result.error);
      }
    } catch (error) {
      onTranscriptChange(entry.id, previousText);
      toast.error(
        t("settings.history.transcript.saveError", { error: String(error) }),
      );
      return;
    }

    // The transcript edit is saved. Let the backend decide whether the change
    // is a genuine misrecognition worth adding to the dictionary.
    try {
      const result = await commands.addTranscriptWordCorrection(
        originalWord,
        correctedWord,
      );
      if (result.status === "ok" && result.data) {
        toast.success(
          t("settings.history.transcript.dictionaryAdded", {
            original: originalWord,
            corrected: correctedWord,
          }),
        );
      }
    } catch (error) {
      console.error("Failed to add transcript word correction:", error);
    }
  };

  if (!entry) {
    return (
      <div className="flat-card overflow-visible">
        <div className="px-5 py-8 text-center">
          <p className="text-sm leading-6 text-[var(--muted)]">
            {t("settings.history.transcript.noSelection")}
          </p>
        </div>
      </div>
    );
  }

  const hasAudio = duration > 0;
  const progressPercent =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;
  const hasTranscript = segments.length > 0;

  return (
    <article className="flex flex-col gap-4 py-4">
      <div className="max-h-[52vh] min-h-[14rem] flex-1 overflow-y-auto rounded-2xl border border-mid-gray/20 bg-[var(--panel-bg)] px-4 py-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          {t("settings.history.transcript.hint")}
        </p>
        {hasTranscript ? (
          <p className="whitespace-pre-wrap break-words text-[17px] font-medium leading-8 text-[var(--text)]">
            {segments.map((segment, index) => {
              if (!segment.isWord) {
                return (
                  <React.Fragment key={index}>{segment.text}</React.Fragment>
                );
              }
              if (editingIndex === index) {
                return (
                  <input
                    key={index}
                    ref={editInputRef}
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    onBlur={() => void commitEditing()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEditing();
                      }
                    }}
                    className={`mx-[1px] inline-block rounded-md border border-[var(--accent)] bg-[var(--input)] px-1 py-0 text-[17px] font-medium leading-7 text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--accent-glow)] ${interactiveFocusRingClass}`}
                    style={{
                      width: `${Math.max(draftValue.length, 2) + 1}ch`,
                    }}
                    aria-label={t("settings.history.transcript.editWordLabel", {
                      word: segments[index]?.text ?? "",
                    })}
                  />
                );
              }
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => beginEditing(index)}
                  className={`mx-[-1px] rounded-md px-[1px] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] ${interactiveFocusRingClass}`}
                  aria-label={t("settings.history.transcript.editWordLabel", {
                    word: segment.text,
                  })}
                >
                  {segment.text}
                </button>
              );
            })}
          </p>
        ) : (
          <p className="text-base font-medium leading-7 text-[var(--muted)]">
            {t("settings.history.transcript.empty")}
          </p>
        )}
      </div>

      {/* Docked player — mirrors the generated-audio player's docked controls. */}
      <div className="z-20 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[0_22px_60px_-18px_rgba(0,0,0,0.32)]">
        <audio
          ref={audioRef}
          src={audioSrc ?? undefined}
          preload="metadata"
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || 0);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(duration || 0);
          }}
        />

        <div className="flex items-center gap-4 px-4 pt-4">
          <button
            type="button"
            onClick={() => void togglePlayback()}
            disabled={isLoadingAudio}
            aria-label={isPlaying ? t("common.pause") : t("common.play")}
            title={isPlaying ? t("common.pause") : t("common.play")}
            className={`relative inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--inverse-text)] transition-all duration-200 ease-out hover:scale-[1.03] hover:bg-[var(--accent-hover)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:opacity-50 disabled:hover:scale-100 ${
              isPlaying
                ? "shadow-[0_14px_36px_-12px_color-mix(in_srgb,var(--accent),transparent_25%)]"
                : "shadow-[0_8px_22px_-10px_color-mix(in_srgb,var(--accent),transparent_45%)]"
            }`}
          >
            {isLoadingAudio ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-7 w-7" fill="currentColor" />
            ) : (
              <Play className="h-7 w-7 translate-x-[1px]" fill="currentColor" />
            )}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p
              className="min-w-0 truncate text-base font-semibold leading-6 text-[var(--text)]"
              title={entry.title}
            >
              {entry.title}
            </p>
            <div className="flex min-w-0 items-center gap-1.5 truncate text-[12px] leading-5 text-[var(--muted)]">
              <span className="tabular-nums text-[var(--text)]">
                {formatClock(currentTime)}
              </span>
              <span aria-hidden>/</span>
              <span className="tabular-nums">{formatClock(duration)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() =>
                previousEntry ? onSelectEntry(previousEntry.id) : undefined
              }
              disabled={!previousEntry}
              className={dockedActionButtonClassName}
              title={t("settings.history.transcript.previous")}
              aria-label={t("settings.history.transcript.previous")}
            >
              <SkipBack width={16} height={16} />
            </button>
            <button
              type="button"
              onClick={() =>
                nextEntry ? onSelectEntry(nextEntry.id) : undefined
              }
              disabled={!nextEntry}
              className={dockedActionButtonClassName}
              title={t("settings.history.transcript.next")}
              aria-label={t("settings.history.transcript.next")}
            >
              <SkipForward width={16} height={16} />
            </button>
            <button
              type="button"
              onClick={() => void revealRecording()}
              className={dockedActionButtonClassName}
              title={t("settings.history.showRecordingInFolder")}
              aria-label={t("settings.history.showRecordingInFolder")}
            >
              <FolderOpen width={15} height={15} />
            </button>
          </div>
        </div>

        <div className="px-4 pb-4 pt-3">
          <div className="group/scrub relative flex h-7 cursor-pointer items-center">
            <div
              aria-hidden
              className="absolute inset-0 flex items-center gap-[2px]"
            >
              {DOCKED_TICK_HEIGHTS.map((heightPercent, index) => {
                const tickProgress =
                  ((index + 0.5) / DOCKED_TICK_COUNT) * 100;
                const isFilled = hasAudio && tickProgress <= progressPercent;
                return (
                  <span
                    key={index}
                    className="flex-1 rounded-full transition-colors duration-100"
                    style={{
                      height: `${heightPercent}%`,
                      background: isFilled
                        ? "var(--accent)"
                        : audioSrc
                          ? "color-mix(in srgb, var(--muted), transparent 55%)"
                          : "color-mix(in srgb, var(--muted), transparent 75%)",
                    }}
                  />
                );
              })}
            </div>
            {hasAudio ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 h-7 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-0 shadow-[0_2px_8px_color-mix(in_srgb,var(--accent),transparent_55%)] transition-opacity duration-150 group-hover/scrub:opacity-100"
                style={{ left: `${progressPercent}%` }}
              />
            ) : null}
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={currentTime}
              onChange={handleScrub}
              disabled={!hasAudio}
              className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
              aria-label={t("storyAudio.timelineAriaLabel")}
            />
          </div>
        </div>
      </div>
    </article>
  );
};
