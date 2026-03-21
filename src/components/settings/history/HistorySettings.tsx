import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AudioPlayer } from "../../ui/AudioPlayer";
import {
  Copy,
  Star,
  Check,
  Trash2,
  FolderOpen,
  X,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Type,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  commands,
  type FieldSnapshotStatus,
  type HistoryEntry,
} from "@/bindings";
import { formatDate, formatTime } from "@/utils/dateFormat";
import { useOsType } from "@/hooks/useOsType";

const getHistoryDateKey = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);

  if (Number.isNaN(date.getTime())) {
    return String(timestamp);
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const isSameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const formatHistoryGroupLabel = (
  timestamp: number,
  locale: string,
  todayLabel: string,
): string => {
  const date = new Date(timestamp * 1000);

  if (Number.isNaN(date.getTime())) {
    return String(timestamp);
  }

  if (isSameLocalDay(date, new Date())) {
    return todayLabel;
  }

  return formatDate(String(timestamp), locale);
};

export const HistorySettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const osType = useOsType();
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistoryEntries = useCallback(async () => {
    try {
      const result = await commands.getHistoryEntries();
      if (result.status === "ok") {
        setHistoryEntries(result.data);
      } else {
        console.error("Failed to load history entries:", result.error);
        toast.error(
          t("settings.history.loadError", {
            defaultValue: "Failed to load history: {{error}}",
            error: result.error,
          }),
        );
      }
    } catch (error) {
      console.error("Failed to load history entries:", error);
      toast.error(
        t("settings.history.loadError", {
          defaultValue: "Failed to load history: {{error}}",
          error: String(error),
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadHistoryEntries();

    // Listen for history update events
    const setupListeners = async () => {
      const unlistenUpdated = await listen("history-updated", () => {
        loadHistoryEntries();
      });

      // Listen for save failures so the user knows when history couldn't be saved
      const unlistenFailed = await listen<string>(
        "history-save-failed",
        (event) => {
          console.error("History save failed:", event.payload);
          toast.error(
            t("settings.history.saveError", {
              defaultValue: "Failed to save recording to history: {{error}}",
              error: event.payload,
            }),
          );
        },
      );

      const unlistenSnapshotFailed = await listen<string>(
        "field-snapshot-failed",
        (event) => {
          console.error("Field snapshot failed:", event.payload);
          toast.error(
            t("settings.history.fieldObservation.failed", {
              defaultValue: "Could not read field text for observation: {{error}}",
              error: event.payload,
            }),
          );
        },
      );

      return () => {
        unlistenUpdated();
        unlistenFailed();
        unlistenSnapshotFailed();
      };
    };

    const cleanupPromise = setupListeners();

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [loadHistoryEntries, t]);

  const toggleSaved = async (id: number) => {
    try {
      const result = await commands.toggleHistoryEntrySaved(id);
      if (result.status !== "ok") {
        toast.error(
          t("settings.history.saveToggleError", {
            defaultValue: "Failed to update saved status: {{error}}",
            error: result.error,
          }),
        );
      }
      // No need to reload here - the event listener will handle it
    } catch (error) {
      console.error("Failed to toggle saved status:", error);
      toast.error(
        t("settings.history.saveToggleError", {
          defaultValue: "Failed to update saved status: {{error}}",
          error: String(error),
        }),
      );
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const getAudioUrl = useCallback(
    async (fileName: string) => {
      try {
        const result = await commands.getAudioFilePath(fileName);
        if (result.status === "ok") {
          if (osType === "linux") {
            const fileData = await readFile(result.data);
            const blob = new Blob([fileData], { type: "audio/wav" });

            return URL.createObjectURL(blob);
          }

          return convertFileSrc(result.data, "asset");
        }
        return null;
      } catch (error) {
        console.error("Failed to get audio file path:", error);
        return null;
      }
    },
    [osType],
  );

  const deleteAudioEntry = async (id: number) => {
    try {
      await commands.deleteHistoryEntry(id);
    } catch (error) {
      console.error("Failed to delete audio entry:", error);
      throw error;
    }
  };

  const revealRecordingInFolder = useCallback(
    async (fileName: string) => {
      const result = await commands.revealHistoryRecordingInFolder(fileName);
      if (result.status !== "ok") {
        toast.error(
          t("settings.history.revealError", {
            defaultValue: "Could not show recording: {{error}}",
            error: result.error,
          }),
        );
      }
    },
    [t],
  );

  const renderEntries = (entries: HistoryEntry[], emptyMessage: string) => {
    if (entries.length === 0) {
      return (
        <div className="px-4 py-3 text-center text-text/60">{emptyMessage}</div>
      );
    }

    const sortedEntries = [...entries].sort((left, right) => {
      return right.timestamp - left.timestamp;
    });
    const todayLabel = t("settings.history.today", {
      defaultValue: "Today",
    });
    const groupedEntries = sortedEntries.reduce<
      Array<{ key: string; label: string; entries: HistoryEntry[] }>
    >((groups, entry) => {
      const key = getHistoryDateKey(entry.timestamp);
      const lastGroup = groups[groups.length - 1];

      if (lastGroup?.key === key) {
        lastGroup.entries.push(entry);
        return groups;
      }

      groups.push({
        key,
        label: formatHistoryGroupLabel(entry.timestamp, i18n.language, todayLabel),
        entries: [entry],
      });

      return groups;
    }, []);

    return (
      <div className="space-y-5 px-4 py-4" data-testid="history-entries">
        {groupedEntries.map((group) => (
          <section key={group.key} className="space-y-2.5">
            <p className="px-1 text-sm font-bold uppercase tracking-[0.2em] text-[var(--text)]">
              {group.label}
            </p>
            <div className="flat-card overflow-hidden rounded-[22px] divide-y divide-mid-gray/20">
              {group.entries.map((entry) => {
                const fallbackText = entry.transcription_text;
                const displayText =
                  entry.pasted_text?.trim() ||
                  entry.post_processed_text?.trim() ||
                  fallbackText;

                return (
                  <HistoryEntryComponent
                    key={entry.id}
                    entry={entry}
                    displayText={displayText}
                    onToggleSaved={() => toggleSaved(entry.id)}
                    onCopyText={() => copyToClipboard(displayText)}
                    onRevealInFolder={() =>
                      void revealRecordingInFolder(entry.file_name)
                    }
                    getAudioUrl={getAudioUrl}
                    deleteAudio={deleteAudioEntry}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="w-full space-y-6">
        <div className="flat-card overflow-visible">
          <div className="px-4 py-3 text-center text-text/60">
            {t("settings.history.loading")}
          </div>
        </div>
      </div>
    );
  }

  return <div className="w-full">{renderEntries(historyEntries, t("settings.history.empty"))}</div>;
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  displayText: string;
  onToggleSaved: () => void;
  onCopyText: () => void;
  onRevealInFolder: () => void;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
}

const sectionLabelClassName =
  "text-[11px] font-bold uppercase tracking-[0.16em] text-text/55";
const sectionCardClassName =
  "rounded-xl border border-mid-gray/20 bg-[color-mix(in_srgb,var(--background),white_2%)] px-3 py-3";

/** Time + main transcript line: same font, size, and line-height for alignment. */
const historyEntryPrimaryLineClass =
  "font-[var(--font-body)] text-base font-normal leading-6 text-black dark:text-[var(--text)]";

const HistoryDetailSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <div className={sectionCardClassName}>
    <div className="mb-2 flex items-center gap-2">
      <span className="text-text/55">{icon}</span>
      <p className={sectionLabelClassName}>{title}</p>
    </div>
    {children}
  </div>
);

const snapshotToneClasses: Record<FieldSnapshotStatus, string> = {
  not_requested:
    "border-mid-gray/20 bg-mid-gray/8 text-text/70 dark:bg-white/5 dark:text-text/75",
  pending:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  captured:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  skipped:
    "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  failed:
    "border-[var(--danger)]/25 bg-[var(--danger-soft)] text-[var(--danger)]",
};

const HistoryEntryComponent: React.FC<HistoryEntryProps> = ({
  entry,
  displayText,
  onToggleSaved,
  onCopyText,
  onRevealInFolder,
  getAudioUrl,
  deleteAudio,
}) => {
  const { t, i18n } = useTranslation();
  const [showCopied, setShowCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleLoadAudio = useCallback(
    () => getAudioUrl(entry.file_name),
    [getAudioUrl, entry.file_name],
  );

  const handleCopyText = () => {
    onCopyText();
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleDeleteEntry = async () => {
    try {
      await deleteAudio(entry.id);
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      toast.error(t("settings.history.deleteError"));
      setShowDeleteConfirm(false);
    }
  };

  const formattedTime = formatTime(String(entry.timestamp), i18n.language);
  const rawText = entry.transcription_text.trim();
  const polishedText = entry.post_processed_text?.trim() || "";
  const insertedText = entry.pasted_text?.trim() || "";
  const pastedText = insertedText || polishedText || rawText || displayText.trim();
  const observedText = entry.field_snapshot_text?.trim() || "";
  const dictionaryApplied = entry.dictionary_hits.length > 0;
  const postProcessApplied = polishedText.length > 0;
  const fieldSnapshotStatus = entry.field_snapshot_status;
  const fieldCheckChanged =
    fieldSnapshotStatus === "captured" &&
    Boolean(observedText) &&
    pastedText.length > 0 &&
    observedText !== pastedText;
  const fieldStatusLabel =
    fieldSnapshotStatus === "pending"
      ? t("settings.history.fieldObservation.pending", {
          defaultValue: "Observing text field",
        })
      : fieldSnapshotStatus === "captured"
        ? fieldCheckChanged
          ? t("settings.history.fieldObservation.changed", {
              defaultValue: "Checked, changes detected",
            })
          : t("settings.history.fieldObservation.unchanged", {
              defaultValue: "Checked, no changes detected",
            })
        : fieldSnapshotStatus === "skipped"
          ? t("settings.history.fieldObservation.skipped", {
              defaultValue: "Stopped when focus changed",
            })
        : fieldSnapshotStatus === "failed"
          ? t("settings.history.fieldObservation.failedStatus", {
              defaultValue: "Text field check failed",
            })
          : t("settings.history.fieldObservation.notRequested", {
              defaultValue: "No text field check recorded",
            });

  return (
    <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2.5 px-4 py-4">
      <div className={`min-w-0 ${historyEntryPrimaryLineClass}`}>
        {formattedTime}
      </div>

      <p
        className={`m-0 min-w-0 cursor-text select-text ${historyEntryPrimaryLineClass}`}
      >
        {displayText}
      </p>

      <div className="col-start-2 flex flex-wrap items-center justify-between gap-2">
        <AudioPlayer
          onLoadRequest={handleLoadAudio}
          className="min-w-0 flex-1 sm:min-w-[220px]"
        />

        <div className="flex items-center gap-1">
            <button
              onClick={handleCopyText}
              className="text-text/50 hover:text-logo-primary transition-colors cursor-pointer p-1"
              title={t("settings.history.copyToClipboard")}
              aria-label={t("settings.history.copyToClipboard")}
            >
              {showCopied ? (
                <Check width={14} height={14} />
              ) : (
                <Copy width={14} height={14} />
              )}
            </button>
            <button
              type="button"
              onClick={onRevealInFolder}
              className="text-text/50 hover:text-logo-primary transition-colors cursor-pointer p-1"
              title={t("settings.history.showRecordingInFolder")}
              aria-label={t("settings.history.showRecordingInFolder")}
            >
              <FolderOpen width={14} height={14} aria-hidden />
            </button>
            <button
              onClick={onToggleSaved}
              className={`p-1 transition-colors cursor-pointer ${
                entry.saved
                  ? "text-logo-primary hover:text-logo-primary/80"
                  : "text-text/50 hover:text-logo-primary"
              }`}
              title={
                entry.saved
                  ? t("settings.history.unsave")
                  : t("settings.history.save")
              }
              aria-label={
                entry.saved
                  ? t("settings.history.unsave")
                  : t("settings.history.save")
              }
            >
              <Star
                width={14}
                height={14}
                fill={entry.saved ? "currentColor" : "none"}
              />
            </button>
            {showDeleteConfirm ? (
              <div className="flex items-center gap-1 rounded-md border border-[var(--danger)] bg-[var(--danger-soft)] px-2 py-0.5">
                <span className="text-xs text-[var(--danger)]">
                  {t("common.delete")}?
                </span>
                <button
                  onClick={() => void handleDeleteEntry()}
                  className="text-[var(--danger)] hover:text-red-700 transition-colors cursor-pointer p-0.5"
                  aria-label={t("settings.history.delete")}
                >
                  <Check width={14} height={14} />
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="text-text/50 hover:text-text transition-colors cursor-pointer p-0.5"
                  aria-label={t("common.cancel")}
                >
                  <X width={14} height={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-text/50 hover:text-[var(--danger)] transition-colors cursor-pointer p-1"
                title={t("settings.history.delete")}
                aria-label={t("settings.history.delete")}
              >
                <Trash2 width={14} height={14} />
              </button>
            )}
          </div>
      </div>

      <div className="col-start-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-mid-gray/20 px-2 py-0.5 text-[10px] text-text/60">
            {postProcessApplied
              ? t("settings.history.badges.postProcessOn", {
                  defaultValue: "Post process on",
                })
              : t("settings.history.badges.postProcessOff", {
                  defaultValue: "Raw transcript",
                })}
          </span>
          {dictionaryApplied && (
            <span className="rounded-full border border-mid-gray/20 px-2 py-0.5 text-[10px] text-text/60">
              {t("settings.history.badges.dictionaryOn", {
                defaultValue: "Dictionary applied",
              })}
            </span>
          )}
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${snapshotToneClasses[fieldSnapshotStatus]}`}
          >
            {fieldStatusLabel}
          </span>
      </div>

      {(postProcessApplied ||
        dictionaryApplied ||
        (fieldCheckChanged && observedText)) && (
        <div className="col-start-2 mt-1 grid gap-2 lg:grid-cols-2">
            {rawText !== displayText && (
              <HistoryDetailSection
                title={t("settings.history.sections.text", {
                  defaultValue: "Transcribed text",
                })}
                icon={<Type className="h-3.5 w-3.5" />}
              >
                <p className="text-xs text-text/80 italic select-text cursor-text">
                  {rawText}
                </p>
              </HistoryDetailSection>
            )}

            {postProcessApplied && polishedText !== displayText && (
              <HistoryDetailSection
                title={t("settings.history.sections.postProcess", {
                  defaultValue: "Post process",
                })}
                icon={<Sparkles className="h-3.5 w-3.5" />}
              >
                <p className="text-xs text-text/80 select-text cursor-text">
                  {polishedText}
                </p>
              </HistoryDetailSection>
            )}

            {dictionaryApplied && (
              <HistoryDetailSection
                title={t("settings.history.sections.dictionary", {
                  defaultValue: "Dictionary",
                })}
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              >
                <p className="text-xs text-text/80 select-text cursor-text">
                  {entry.dictionary_hits.join(", ")}
                </p>
              </HistoryDetailSection>
            )}

            {fieldCheckChanged && observedText && (
              <HistoryDetailSection
                title={t("settings.history.fieldObservation.title", {
                  defaultValue: "Text field check",
                })}
                icon={<Sparkles className="h-3.5 w-3.5" />}
              >
                <div className="flex items-start gap-2 overflow-hidden text-xs text-text/80 select-text cursor-text">
                  <span
                    className="min-w-0 max-w-[45%] break-words font-mono"
                    title={pastedText}
                  >
                    {pastedText}
                  </span>
                  <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-text/50" />
                  <span
                    className="min-w-0 flex-1 break-words font-mono"
                    title={observedText}
                  >
                    {observedText}
                  </span>
                </div>
              </HistoryDetailSection>
            )}
        </div>
      )}
    </div>
  );
};
