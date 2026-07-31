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
import { Button } from "@/components/ui/Button";
import { DockedAudioHud } from "@/components/ui/DockedAudioHud";
import { openModelHub } from "@/components/model-hub/modelHubTabs";
import {
  contentBodyClassName,
  contentHintClassName,
} from "@/lib/contentTypography";
import {
  buildSpeakerTranscriptTurns,
  humanizeSpeakerId,
  parseSpeakerDisplayNames,
  resolveHistoryDisplayTitle,
} from "@/lib/historyDisplay";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import { formatTime } from "@/utils/dateFormat";

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
  /** Merge a full entry update (speaker analysis, title, labels). */
  onEntryUpdate?: (entry: HistoryEntry) => void;
  /** Apply an optimistic partial update without replacing concurrent fields. */
  onEntryPatch?: (id: number, patch: Partial<HistoryEntry>) => void;
  /** Main History / Transcript switcher shown on the leading side of the toolbar. */
  viewSwitcher: React.ReactNode;
}

type Segment = { text: string; isWord: boolean };

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

const floatingPlayerActionClassName =
  "border border-[var(--border)] !bg-[var(--panel-bg)] shadow-[var(--shadow-sm)] hover:border-[var(--accent)] hover:!bg-[var(--accent-soft)] disabled:hover:border-[var(--border)] disabled:hover:!bg-[var(--panel-bg)]";

function speakerErrorMessage(
  error: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const trimmed = error?.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (lower.includes("model required")) {
    return t("settings.history.speakers.status.modelRequired", {
      defaultValue: "Choose a Speaker Isolation model first.",
    });
  }

  if (
    lower.includes("traceback") ||
    lower.includes("[broadcast_shapes]") ||
    lower.includes("cannot be broadcast")
  ) {
    return t("settings.history.speakers.status.failed", {
      defaultValue: "Speaker analysis failed.",
    });
  }

  const firstLine =
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? trimmed;
  return firstLine.length > 240 ? `${firstLine.slice(0, 240)}…` : firstLine;
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({
  entries,
  selectedId,
  onSelectEntry,
  getAudioUrl,
  onTranscriptChange,
  onEntryUpdate,
  onEntryPatch,
  viewSwitcher,
}) => {
  const { t, i18n } = useTranslation();

  const currentIndex = useMemo(() => {
    if (entries.length === 0) return -1;
    const found = entries.findIndex((entry) => entry.id === selectedId);
    return found >= 0 ? found : 0;
  }, [entries, selectedId]);

  const entry = currentIndex >= 0 ? entries[currentIndex] : null;
  const previousEntry = currentIndex > 0 ? entries[currentIndex - 1] : null;
  const nextEntry =
    currentIndex >= 0 && currentIndex < entries.length - 1
      ? entries[currentIndex + 1]
      : null;

  const displayTitle = entry ? resolveHistoryDisplayTitle(entry) : "";
  const timeLabel = entry
    ? formatTime(String(entry.timestamp), i18n.language)
    : "";

  const segments = useMemo(
    () => tokenize(entry?.transcription_text ?? ""),
    [entry?.transcription_text],
  );

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [renamingSpeakerId, setRenamingSpeakerId] = useState<string | null>(
    null,
  );
  const [renamingTurnIndex, setRenamingTurnIndex] = useState<number | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [isSavingSpeakerName, setIsSavingSpeakerName] = useState(false);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setEditingIndex(null);
    setDraftValue("");
    setIsEditingTitle(false);
    setTitleDraft("");
    setIsAnalyzing(false);
    setRenamingSpeakerId(null);
    setRenamingTurnIndex(null);
    setRenameDraft("");
    setIsSavingSpeakerName(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioSrc((current) => {
      if (current?.startsWith("blob:")) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  }, [entry?.id]);

  useEffect(() => {
    setDuration(
      entry?.duration_ms && entry.duration_ms > 0
        ? entry.duration_ms / 1000
        : 0,
    );
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
    if (renamingSpeakerId !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingSpeakerId]);

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

  const commitTitle = async () => {
    if (!entry) return;
    const nextTitle = titleDraft.trim();
    setIsEditingTitle(false);
    if (!nextTitle || nextTitle === displayTitle) return;
    try {
      const result = await commands.updateHistoryEntryDisplayTitle(
        entry.id,
        nextTitle,
      );
      if (result.status !== "ok") {
        throw new Error(result.error);
      }
      onEntryPatch?.(entry.id, {
        display_title: nextTitle,
        display_title_source: "user",
      });
    } catch (error) {
      toast.error(
        t("settings.history.displayTitle.saveError", {
          error: String(error),
          defaultValue: "Could not save title: {{error}}",
        }),
      );
    }
  };

  const analyzeSpeakers = async () => {
    if (!entry || isAnalyzing) return;
    setIsAnalyzing(true);
    onEntryPatch?.(entry.id, {
      speaker_status: "running",
      speaker_error: null,
    });
    try {
      const result = await commands.analyzeHistoryEntrySpeakers(entry.id);
      if (result.status !== "ok") {
        const message = String(result.error);
        const displayMessage = speakerErrorMessage(message, t) ?? message;
        onEntryPatch?.(entry.id, {
          speaker_status: "failed",
          speaker_error: message,
        });
        toast.error(
          t("settings.history.speakers.analyzeError", {
            error: displayMessage,
            defaultValue: "Speaker analysis failed: {{error}}",
          }),
        );
        return;
      }
      onEntryUpdate?.(result.data);
    } catch (error) {
      const message = String(error);
      const displayMessage = speakerErrorMessage(message, t) ?? message;
      onEntryPatch?.(entry.id, {
        speaker_status: "failed",
        speaker_error: message,
      });
      toast.error(
        t("settings.history.speakers.analyzeError", {
          error: displayMessage,
          defaultValue: "Speaker analysis failed: {{error}}",
        }),
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const beginRenameSpeaker = (
    speakerId: string,
    currentLabel: string,
    turnIndex: number,
  ) => {
    if (isSavingSpeakerName) return;
    setEditingIndex(null);
    setRenamingSpeakerId(speakerId);
    setRenamingTurnIndex(turnIndex);
    setRenameDraft(currentLabel);
  };

  const cancelRenameSpeaker = () => {
    setRenamingSpeakerId(null);
    setRenamingTurnIndex(null);
    setRenameDraft("");
  };

  const commitRenameSpeaker = async () => {
    if (!entry || !renamingSpeakerId || isSavingSpeakerName) return;
    const speakerId = renamingSpeakerId;
    const nextName = renameDraft.trim();
    const defaultLabel = humanizeSpeakerId(speakerId);
    const names = {
      ...parseSpeakerDisplayNames(entry.speaker_display_names_json),
    };
    const previousName = names[speakerId]?.trim() ?? "";
    const clearingToDefault = !nextName || nextName === defaultLabel;

    if (clearingToDefault) {
      if (!previousName) {
        cancelRenameSpeaker();
        return;
      }
      delete names[speakerId];
    } else if (nextName === previousName) {
      cancelRenameSpeaker();
      return;
    } else {
      names[speakerId] = nextName;
    }

    setIsSavingSpeakerName(true);
    try {
      const result = await commands.updateHistoryEntrySpeakerDisplayNames(
        entry.id,
        names,
      );
      if (result.status !== "ok") {
        throw new Error(String(result.error));
      }
      onEntryUpdate?.(result.data);
      toast.success(
        t("settings.history.speakers.namesSaved", {
          defaultValue: "Speaker names saved",
        }),
      );
      cancelRenameSpeaker();
    } catch (error) {
      toast.error(
        t("settings.history.speakers.namesError", {
          error: String(error),
          defaultValue: "Could not save speaker names: {{error}}",
        }),
      );
    } finally {
      setIsSavingSpeakerName(false);
    }
  };

  const speakerStatus = entry?.speaker_status ?? "not_analyzed";
  const speakerCount = entry?.speaker_count ?? 0;
  const speakerModelId = entry?.speaker_model_id?.trim() || null;
  const modelRequired =
    speakerStatus === "failed" &&
    (entry?.speaker_error ?? "").toLowerCase().includes("model required");
  const speakerTurns = useMemo(
    () =>
      speakerStatus === "complete" && speakerCount > 1 && entry
        ? buildSpeakerTranscriptTurns(
            entry.speaker_segments_json,
            entry.speaker_display_names_json,
          )
        : [],
    [
      entry,
      entry?.speaker_display_names_json,
      entry?.speaker_segments_json,
      speakerCount,
      speakerStatus,
    ],
  );
  const speakerTranscript =
    speakerStatus === "complete" && speakerCount > 1
      ? (entry?.speaker_transcript_text?.trim() ?? "")
      : "";
  const hasSpeakerTurns = speakerTurns.length > 0;
  const hasCustomSpeakerNames = useMemo(() => {
    if (!entry?.speaker_display_names_json) return false;
    return Object.values(
      parseSpeakerDisplayNames(entry.speaker_display_names_json),
    ).some((name) => name.trim().length > 0);
  }, [entry?.speaker_display_names_json]);
  const speakerStatusText = (() => {
    if (isAnalyzing || speakerStatus === "running") {
      return t("settings.history.speakers.status.running", {
        defaultValue: "Analyzing speakers…",
      });
    }
    if (speakerStatus === "complete") {
      const withModel = (label: string) =>
        speakerModelId ? `${label} · ${speakerModelId}` : label;
      if (speakerCount > 1) {
        return withModel(
          t("settings.history.speakers.status.complete", {
            count: speakerCount,
            defaultValue: `${speakerCount} speakers identified`,
          }),
        );
      }
      if (speakerCount === 1) {
        return withModel(
          t("settings.history.speakers.status.oneSpeaker", {
            defaultValue: "1 speaker detected",
          }),
        );
      }
      return t("settings.history.speakers.status.completeEmpty", {
        defaultValue:
          "Speaker analysis finished, but no speakers were labeled.",
      });
    }
    if (speakerStatus === "failed") {
      return (
        speakerErrorMessage(entry?.speaker_error, t) ??
        t("settings.history.speakers.status.failed", {
          defaultValue: "Speaker analysis failed.",
        })
      );
    }
    return t("settings.history.transcript.hint");
  })();
  const toolbar = (
    <div className="history-transcript-toolbar sticky top-0 z-20 -mx-5 flex items-center justify-between gap-3 px-5 pb-3 pt-0">
      {viewSwitcher}
      {entry ? (
        modelRequired ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="control"
              onClick={() =>
                void openModelHub("analysis", { scope: "analysis" })
              }
            >
              {t("settings.history.speakers.openModelHub", {
                defaultValue: "Choose speaker model",
              })}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={isAnalyzing}
              onClick={() => void analyzeSpeakers()}
            >
              {t("settings.history.speakers.reanalyze", {
                defaultValue: "Re-analyze speakers",
              })}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={speakerStatus === "complete" ? "control" : "primary"}
            disabled={isAnalyzing || speakerStatus === "running"}
            onClick={() => void analyzeSpeakers()}
            title={
              speakerStatus === "failed"
                ? (speakerErrorMessage(entry.speaker_error, t) ?? undefined)
                : undefined
            }
          >
            {isAnalyzing || speakerStatus === "running"
              ? t("settings.history.speakers.status.running", {
                  defaultValue: "Analyzing speakers…",
                })
              : speakerStatus === "complete"
                ? t("settings.history.speakers.reanalyze", {
                    defaultValue: "Re-analyze speakers",
                  })
                : t("settings.history.speakers.analyze", {
                    defaultValue: "Analyze speakers",
                  })}
          </Button>
        )
      ) : null}
    </div>
  );

  if (!entry) {
    return (
      <>
        {toolbar}
        <div className="flat-card overflow-visible">
          <div className="px-5 py-8 text-center">
            <p className="text-sm leading-6 text-[var(--muted)]">
              {t("settings.history.transcript.noSelection")}
            </p>
          </div>
        </div>
      </>
    );
  }

  const hasAudio = duration > 0;
  const progressPercent =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;
  const hasTranscript = segments.length > 0;

  return (
    <>
      {toolbar}
      <article className="flex flex-col gap-4 px-1 py-4 pb-[calc(11.5rem_+_env(safe-area-inset-bottom))]">
        <div className="history-transcript-content min-h-[14rem] flex-1 px-4 py-2">
          {entry.summary?.trim() ? (
            <section className="mb-5 space-y-1 border-b border-[var(--ring-hairline)] pb-4">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                {t("settings.history.modes.summary", {
                  defaultValue: "Summary",
                })}
              </h2>
              <p className="text-sm leading-6 text-[var(--muted)]">
                {entry.summary}
              </p>
            </section>
          ) : null}
          <p
            className={`mb-3 ${contentHintClassName}`}
            aria-live="polite"
            role="status"
          >
            {speakerStatusText}
          </p>
          {speakerStatus === "complete" && speakerCount === 1 ? (
            <p className={`mb-3 ${contentHintClassName}`}>
              {t("settings.history.speakers.oneSpeakerHint", {
                defaultValue:
                  "1 speaker detected. Labels are hidden. Re-analyze if this recording should have multiple speakers.",
              })}
            </p>
          ) : null}
          {hasSpeakerTurns ? (
            <>
              {!hasCustomSpeakerNames ? (
                <p className={`mb-3 ${contentHintClassName}`}>
                  {t("settings.history.speakers.renameHint", {
                    defaultValue:
                      "Select a speaker label to rename. The new name applies to every turn from that speaker.",
                  })}
                </p>
              ) : null}
              <div
                className={`${contentBodyClassName} space-y-3 font-sans`}
                data-testid="speaker-transcript-turns"
              >
                {speakerTurns.map((turn, index) => {
                  const isRenaming =
                    renamingSpeakerId === turn.speakerId &&
                    renamingTurnIndex === index;
                  return (
                    <p key={`${turn.speakerId}-${index}`} className="leading-7">
                      {isRenaming ? (
                        <>
                          <input
                            ref={renameInputRef}
                            value={renameDraft}
                            disabled={isSavingSpeakerName}
                            onChange={(event) =>
                              setRenameDraft(event.target.value)
                            }
                            onBlur={() => void commitRenameSpeaker()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                event.currentTarget.blur();
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                cancelRenameSpeaker();
                              }
                            }}
                            className={`mr-1 inline-block max-w-[12rem] rounded-md border border-[var(--accent)] bg-[var(--input)] px-1.5 py-0 text-[17px] font-bold leading-7 text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--accent-glow)] ${interactiveFocusRingClass}`}
                            style={{
                              width: `${Math.max(renameDraft.length, 4) + 2}ch`,
                            }}
                            aria-label={t(
                              "settings.history.speakers.renameField",
                              {
                                id: turn.speakerId,
                                defaultValue: `Display name for ${turn.speakerId}`,
                              },
                            )}
                            placeholder={t(
                              "settings.history.speakers.renamePlaceholder",
                              {
                                defaultValue: "e.g. Me, Lawyer",
                              },
                            )}
                          />
                          <span className="font-bold">:</span>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            beginRenameSpeaker(
                              turn.speakerId,
                              turn.label,
                              index,
                            )
                          }
                          className={`mr-1 rounded-md px-1 font-bold text-[var(--text)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] ${interactiveFocusRingClass}`}
                          aria-label={t(
                            "settings.history.speakers.renameField",
                            {
                              id: turn.speakerId,
                              defaultValue: `Display name for ${turn.speakerId}`,
                            },
                          )}
                          title={t("settings.history.speakers.renameHint", {
                            defaultValue:
                              "Select a speaker label to rename. The new name applies to every turn from that speaker.",
                          })}
                        >
                          {turn.label}:
                        </button>
                      )}{" "}
                      <span className="font-medium text-[var(--text)]">
                        {turn.text}
                      </span>
                    </p>
                  );
                })}
              </div>
            </>
          ) : speakerTranscript ? (
            <pre
              className={`${contentBodyClassName} whitespace-pre-wrap font-sans`}
            >
              {speakerTranscript}
            </pre>
          ) : hasTranscript ? (
            <div className={contentBodyClassName}>
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
                      aria-label={t(
                        "settings.history.transcript.editWordLabel",
                        {
                          word: segments[index]?.text ?? "",
                        },
                      )}
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
            </div>
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
            <div className="flex max-w-full min-w-0 items-center gap-2">
              <span className="history-transcript-floating-timestamp inline-flex h-9 shrink-0 items-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-sm font-bold tabular-nums leading-6 text-[var(--muted)] shadow-[var(--shadow-sm)]">
                {timeLabel}
              </span>
              {isEditingTitle ? (
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={() => void commitTitle()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setIsEditingTitle(false);
                    }
                  }}
                  className={`history-transcript-floating-title h-9 min-w-0 max-w-full flex-1 rounded-full border border-[var(--accent)] bg-[var(--input)] px-3 text-sm font-semibold leading-6 text-[var(--text)] shadow-[var(--shadow-sm)] outline-none focus:ring-2 focus:ring-[var(--accent-glow)] sm:text-base ${interactiveFocusRingClass}`}
                  aria-label={t("settings.history.displayTitle.editLabel", {
                    defaultValue: "Edit recording title",
                  })}
                  maxLength={120}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(displayTitle);
                    setIsEditingTitle(true);
                  }}
                  className={`history-transcript-floating-title inline-flex h-9 min-w-0 max-w-full items-center truncate rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-start text-sm font-semibold leading-6 text-[var(--text)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] sm:text-base ${interactiveFocusRingClass}`}
                  title={displayTitle}
                  aria-label={t("settings.history.displayTitle.editLabel", {
                    defaultValue: "Edit recording title",
                  })}
                >
                  <span className="truncate">{displayTitle}</span>
                </button>
              )}
            </div>
          }
          floatingControls={
            <>
              <ActionIconButton
                className={floatingPlayerActionClassName}
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
                className={floatingPlayerActionClassName}
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
                className={floatingPlayerActionClassName}
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
    </>
  );
};
