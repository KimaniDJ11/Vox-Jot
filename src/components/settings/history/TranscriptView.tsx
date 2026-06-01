import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FolderOpen, SkipBack, SkipForward } from "lucide-react";

import { commands, type HistoryEntry } from "@/bindings";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { DockedAudioHud } from "@/components/ui/DockedAudioHud";
import {
  contentBodyClassName,
  contentHintClassName,
} from "@/lib/contentTypography";
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
        toast.error(t("settings.history.revealError", { error: result.error }));
      }
    } catch (error) {
      toast.error(t("settings.history.revealError", { error: String(error) }));
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
    <article className="flex flex-col gap-4 px-1 py-4 pb-[calc(11.5rem_+_env(safe-area-inset-bottom))]">
      <div className="max-h-[52vh] min-h-[14rem] flex-1 overflow-y-auto px-4 py-4">
        <p className={`mb-3 ${contentHintClassName}`}>
          {t("settings.history.transcript.hint")}
        </p>
        {hasTranscript ? (
          <p className={contentBodyClassName}>
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

      <DockedAudioHud
        audioRef={audioRef}
        audioSrc={audioSrc}
        isPlaying={isPlaying}
        isLoadingAudio={isLoadingAudio}
        hasAudio={hasAudio}
        currentTime={currentTime}
        duration={duration}
        progressPercent={progressPercent}
        currentTimeLabel={formatClock(currentTime)}
        durationLabel={formatClock(duration)}
        playLabel={t("common.play")}
        pauseLabel={t("common.pause")}
        timelineLabel={t("storyAudio.timelineAriaLabel")}
        className="history-transcript-docked-player"
        onTogglePlay={() => void togglePlayback()}
        onScrub={handleScrub}
        onAudioLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
        }}
        onAudioPlay={() => setIsPlaying(true)}
        onAudioPause={() => setIsPlaying(false)}
        onAudioEnded={() => {
          setIsPlaying(false);
          setCurrentTime(duration || 0);
        }}
        floatingTitle={
          <div
            className="inline-flex h-9 max-w-full items-center truncate rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-start text-sm font-semibold leading-6 text-[var(--text)] shadow-[var(--shadow-sm)] sm:text-base"
            title={entry.title}
          >
            <span className="truncate">{entry.title}</span>
          </div>
        }
        floatingControls={
          <>
            <ActionIconButton
              onClick={() =>
                previousEntry ? onSelectEntry(previousEntry.id) : undefined
              }
              disabled={!previousEntry}
              title={t("settings.history.transcript.previous")}
              aria-label={t("settings.history.transcript.previous")}
            >
              <SkipBack aria-hidden />
            </ActionIconButton>
            <ActionIconButton
              onClick={() =>
                nextEntry ? onSelectEntry(nextEntry.id) : undefined
              }
              disabled={!nextEntry}
              title={t("settings.history.transcript.next")}
              aria-label={t("settings.history.transcript.next")}
            >
              <SkipForward aria-hidden />
            </ActionIconButton>
            <ActionIconButton
              onClick={() => void revealRecording()}
              title={t("settings.history.showRecordingInFolder")}
              aria-label={t("settings.history.showRecordingInFolder")}
            >
              <FolderOpen aria-hidden />
            </ActionIconButton>
          </>
        }
      />
    </article>
  );
};
