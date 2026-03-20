import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AudioPlayer } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
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
import { formatDateTime } from "@/utils/dateFormat";
import { useOsType } from "@/hooks/useOsType";

interface OpenRecordingsButtonProps {
  onClick: () => void;
  label: string;
}

const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
  onClick,
  label,
}) => (
  <Button
    type="button"
    onClick={onClick}
    variant="ghost"
    size="sm"
    className="p-1.5 text-text/50 hover:text-logo-primary"
    title={label}
    aria-label={label}
  >
    <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
  </Button>
);

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
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

  const openRecordingsFolder = async () => {
    try {
      await commands.openRecordingsFolder();
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  };

  const renderEntries = (entries: HistoryEntry[], emptyMessage: string) => {
    if (entries.length === 0) {
      return (
        <div className="px-4 py-3 text-center text-text/60">{emptyMessage}</div>
      );
    }

    return (
      <div className="divide-y divide-mid-gray/20" data-testid="history-entries">
        {entries.map((entry) => {
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
              getAudioUrl={getAudioUrl}
              deleteAudio={deleteAudioEntry}
            />
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="w-full space-y-6">
        <div className="space-y-2">
          <div className="px-5 flex items-center justify-between">
            <h2 className="text-[13px] font-bold uppercase tracking-widest text-[var(--text)]">
              {t("settings.history.title")}
            </h2>
            <OpenRecordingsButton
              onClick={openRecordingsFolder}
              label={t("settings.history.openFolder")}
            />
          </div>
          <div className="flat-card overflow-visible">
            <div className="px-4 py-3 text-center text-text/60">
              {t("settings.history.loading")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2">
        <div className="px-5 flex items-center justify-between">
          <h2 className="text-[13px] font-bold uppercase tracking-widest text-[var(--text)]">
            {t("settings.history.title")}
          </h2>
          <OpenRecordingsButton
            onClick={openRecordingsFolder}
            label={t("settings.history.openFolder")}
          />
        </div>
        <div className="flat-card overflow-visible">
          {renderEntries(historyEntries, t("settings.history.empty"))}
        </div>
      </div>
    </div>
  );
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  displayText: string;
  onToggleSaved: () => void;
  onCopyText: () => void;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
}

const sectionLabelClassName =
  "text-[11px] font-semibold uppercase tracking-[0.16em] text-text/55";
const sectionCardClassName =
  "rounded-xl border border-mid-gray/20 bg-[color-mix(in_srgb,var(--background),white_2%)] px-3 py-3";

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

  const formattedDate = formatDateTime(String(entry.timestamp), i18n.language);
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
    <div className="px-4 py-3 flex flex-col gap-2.5">
      {/* Header: date + actions */}
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold">{formattedDate}</p>
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

      {/* Display text */}
      <p className="text-sm text-text/95 select-text cursor-text leading-relaxed">
        {displayText}
      </p>

      {/* Audio player */}
      <AudioPlayer onLoadRequest={handleLoadAudio} className="w-full" />

      {/* Compact detail badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-mid-gray/20 px-2 py-0.5 text-[10px] text-text/60">
          {postProcessApplied
            ? t("settings.history.badges.postProcessOn", { defaultValue: "Post process on" })
            : t("settings.history.badges.postProcessOff", { defaultValue: "Raw transcript" })}
        </span>
        {dictionaryApplied && (
          <span className="rounded-full border border-mid-gray/20 px-2 py-0.5 text-[10px] text-text/60">
            {t("settings.history.badges.dictionaryOn", { defaultValue: "Dictionary applied" })}
          </span>
        )}
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] ${snapshotToneClasses[fieldSnapshotStatus]}`}
        >
          {fieldStatusLabel}
        </span>
      </div>

      {/* Conditional detail sections — only show when there's data */}
      {(postProcessApplied || dictionaryApplied || (fieldCheckChanged && observedText)) && (
        <div className="grid gap-2 lg:grid-cols-2 mt-1">
          {rawText !== displayText && (
            <HistoryDetailSection
              title={t("settings.history.sections.text", { defaultValue: "Transcribed text" })}
              icon={<Type className="h-3.5 w-3.5" />}
            >
              <p className="text-xs text-text/80 italic select-text cursor-text">
                {rawText}
              </p>
            </HistoryDetailSection>
          )}

          {postProcessApplied && polishedText !== displayText && (
            <HistoryDetailSection
              title={t("settings.history.sections.postProcess", { defaultValue: "Post process" })}
              icon={<Sparkles className="h-3.5 w-3.5" />}
            >
              <p className="text-xs text-text/80 select-text cursor-text">
                {polishedText}
              </p>
            </HistoryDetailSection>
          )}

          {dictionaryApplied && (
            <HistoryDetailSection
              title={t("settings.history.sections.dictionary", { defaultValue: "Dictionary" })}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            >
              <p className="text-xs text-text/80 select-text cursor-text">
                {entry.dictionary_hits.join(", ")}
              </p>
            </HistoryDetailSection>
          )}

          {fieldCheckChanged && observedText && (
            <HistoryDetailSection
              title={t("settings.history.fieldObservation.title", { defaultValue: "Text field check" })}
              icon={<Sparkles className="h-3.5 w-3.5" />}
            >
              <div className="flex items-start gap-2 text-xs text-text/80 select-text cursor-text overflow-hidden">
                <span className="font-mono break-words min-w-0 max-w-[45%]" title={pastedText}>
                  {pastedText}
                </span>
                <ArrowRight className="w-3 h-3 text-text/50 shrink-0 mt-0.5" />
                <span className="font-mono break-words min-w-0 flex-1" title={observedText}>
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
