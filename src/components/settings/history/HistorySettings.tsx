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
  Clock3,
  CircleAlert,
  CheckCircle2,
  Waves,
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

type HistoryTab = "recordings" | "jots";

interface OpenRecordingsButtonProps {
  onClick: () => void;
  label: string;
}

const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
  onClick,
  label,
}) => (
  <Button
    onClick={onClick}
    variant="secondary"
    size="sm"
    className="flex items-center gap-2"
    title={label}
  >
    <FolderOpen className="w-4 h-4" />
    <span>{label}</span>
  </Button>
);

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const osType = useOsType();
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<HistoryTab>("recordings");
  const [searchQuery, setSearchQuery] = useState("");
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

  const recordingsEntries = historyEntries;
  const jotsEntries = historyEntries.filter((entry) =>
    Boolean(entry.post_processed_text?.trim()),
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filterEntries = useCallback(
    (entries: HistoryEntry[], viewMode: HistoryTab) => {
      if (!normalizedQuery) {
        return entries;
      }

      return entries.filter((entry) => {
        const raw = entry.transcription_text.toLowerCase();
        const jot = entry.post_processed_text?.toLowerCase() ?? "";
        const activeText = viewMode === "jots" ? jot : raw;
        return activeText.includes(normalizedQuery);
      });
    },
    [normalizedQuery],
  );

  const visibleRecordingsEntries = filterEntries(
    recordingsEntries,
    "recordings",
  );
  const visibleJotsEntries = filterEntries(jotsEntries, "jots");

  const renderEntries = (
    entries: HistoryEntry[],
    viewMode: HistoryTab,
    emptyMessage: string,
  ) => {
    if (entries.length === 0) {
      return (
        <div className="px-4 py-3 text-center text-text/60">{emptyMessage}</div>
      );
    }

    return (
      <div className="divide-y divide-mid-gray/20">
        {entries.map((entry) => {
          const fallbackText = entry.transcription_text;
          const jotText = entry.post_processed_text?.trim();
          const displayText =
            viewMode === "jots" && jotText ? jotText : fallbackText;

          return (
            <HistoryEntryComponent
              key={entry.id}
              entry={entry}
              displayMode={viewMode}
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
          <div className="px-4 flex items-center justify-between">
            <div>
              <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
                {t("settings.history.title")}
              </h2>
            </div>
            <OpenRecordingsButton
              onClick={openRecordingsFolder}
              label={t("settings.history.openFolder")}
            />
          </div>
          <div className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
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
        <div className="px-4 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-medium text-mid-gray uppercase tracking-wide">
              {t("settings.history.title")}
            </h2>
          </div>
          <OpenRecordingsButton
            onClick={openRecordingsFolder}
            label={t("settings.history.openFolder")}
          />
        </div>
        <div className="bg-background border border-mid-gray/20 rounded-lg overflow-visible">
          <div
            className="border-b border-mid-gray/20 px-3 py-2 flex items-center gap-4"
            role="tablist"
            aria-label={t("settings.history.title")}
          >
            <button
              type="button"
              id="history-tab-recordings"
              role="tab"
              data-testid="history-tab-recordings"
              aria-selected={activeTab === "recordings"}
              aria-controls="history-panel-recordings"
              onClick={() => setActiveTab("recordings")}
              className={`pb-2 -mb-[9px] text-sm font-medium transition-colors border-b-2 cursor-pointer ${
                activeTab === "recordings"
                  ? "border-logo-primary text-logo-primary"
                  : "border-transparent text-text/70 hover:text-text hover:border-text/30"
              }`}
            >
              {t("settings.history.tabs.recordings", {
                defaultValue: "Recordings",
              })}
              <span className="ml-2 text-xs text-text/70">
                ({recordingsEntries.length})
              </span>
            </button>
            <button
              type="button"
              id="history-tab-jots"
              role="tab"
              data-testid="history-tab-jots"
              aria-selected={activeTab === "jots"}
              aria-controls="history-panel-jots"
              onClick={() => setActiveTab("jots")}
              className={`pb-2 -mb-[9px] text-sm font-medium transition-colors border-b-2 cursor-pointer ${
                activeTab === "jots"
                  ? "border-logo-primary text-logo-primary"
                  : "border-transparent text-text/70 hover:text-text hover:border-text/30"
              }`}
            >
              {t("settings.history.tabs.jots", { defaultValue: "Jots" })}
              <span className="ml-2 text-xs text-text/70">
                ({jotsEntries.length})
              </span>
            </button>
          </div>
          <div className="px-4 py-3 border-b border-mid-gray/20 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-text/60">
              {activeTab === "recordings"
                ? t("settings.history.summary.recordings", {
                    defaultValue: "Showing {{visible}} of {{total}} recordings",
                    visible: visibleRecordingsEntries.length,
                    total: recordingsEntries.length,
                  })
                : t("settings.history.summary.jots", {
                    defaultValue: "Showing {{visible}} of {{total}} jots",
                    visible: visibleJotsEntries.length,
                    total: jotsEntries.length,
                  })}
            </p>
            <div className="relative w-full sm:w-72">
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("settings.history.searchPlaceholder")}
                className="w-full rounded-md border border-mid-gray/30 bg-[var(--input)] px-3 py-2 pr-8 text-sm text-text hover:bg-[color-mix(in_srgb,var(--accent),transparent_92%)] hover:border-[var(--accent)] focus:bg-[color-mix(in_srgb,var(--accent),transparent_85%)] focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-glow)] transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text/40 hover:text-text/70 transition-colors cursor-pointer"
                  aria-label={t("common.close")}
                >
                  <X width={14} height={14} />
                </button>
              )}
            </div>
          </div>
          {activeTab === "recordings" ? (
            <div
              id="history-panel-recordings"
              role="tabpanel"
              aria-labelledby="history-tab-recordings"
            >
              {renderEntries(
                visibleRecordingsEntries,
                "recordings",
                t("settings.history.empty"),
              )}
            </div>
          ) : (
            <div
              id="history-panel-jots"
              role="tabpanel"
              aria-labelledby="history-tab-jots"
            >
              {renderEntries(
                visibleJotsEntries,
                "jots",
                t("settings.history.emptyJots", {
                  defaultValue:
                    "No jots yet. Enable post-processing to see completed results.",
                }),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  displayMode: HistoryTab;
  displayText: string;
  onToggleSaved: () => void;
  onCopyText: () => void;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
}

const sectionLabelClassName =
  "text-[11px] font-medium uppercase tracking-[0.16em] text-text/55";
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
  displayMode,
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
  const fieldCheckUnchanged =
    fieldSnapshotStatus === "captured" &&
    Boolean(observedText) &&
    pastedText.length > 0 &&
    observedText === pastedText;
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
    <div className="px-4 py-2 pb-5 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <p className="text-sm font-medium">{formattedDate}</p>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopyText}
            className="text-text/50 hover:text-logo-primary hover:border-logo-primary transition-colors cursor-pointer"
            title={t("settings.history.copyToClipboard")}
            aria-label={t("settings.history.copyToClipboard")}
          >
            {showCopied ? (
              <Check width={16} height={16} />
            ) : (
              <Copy width={16} height={16} />
            )}
          </button>
          <button
            onClick={onToggleSaved}
            className={`p-2 rounded-md transition-colors cursor-pointer ${
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
              width={16}
              height={16}
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
              className="text-text/50 hover:text-[var(--danger)] transition-colors cursor-pointer"
              title={t("settings.history.delete")}
              aria-label={t("settings.history.delete")}
            >
              <Trash2 width={16} height={16} />
            </button>
          )}
        </div>
      </div>
      <div
        className={`rounded-xl border px-3 py-3 ${
          displayMode === "jots"
            ? "border-logo-primary/20 bg-[color-mix(in_srgb,var(--color-logo-primary),transparent_95%)]"
            : "border-mid-gray/20 bg-mid-gray/5"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={sectionLabelClassName}>
            {displayMode === "jots"
              ? t("settings.history.primary.jot", {
                  defaultValue: "Jot view",
                })
              : t("settings.history.primary.recording", {
                  defaultValue: "Recording view",
                })}
          </span>
          <span className="rounded-full border border-mid-gray/20 px-2 py-0.5 text-[11px] text-text/70">
            {postProcessApplied
              ? t("settings.history.badges.postProcessOn", {
                  defaultValue: "Post process on",
                })
              : t("settings.history.badges.postProcessOff", {
                  defaultValue: "Raw transcript",
                })}
          </span>
          <span className="rounded-full border border-mid-gray/20 px-2 py-0.5 text-[11px] text-text/70">
            {dictionaryApplied
              ? t("settings.history.badges.dictionaryOn", {
                  defaultValue: "Dictionary applied",
                })
              : t("settings.history.badges.dictionaryOff", {
                  defaultValue: "No dictionary hits",
                })}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${snapshotToneClasses[fieldSnapshotStatus]}`}
          >
            {fieldStatusLabel}
          </span>
        </div>
        <p className="mt-3 text-sm text-text/95 select-text cursor-text">
          {displayText}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <HistoryDetailSection
          title={t("settings.history.sections.sound", {
            defaultValue: "Sound",
          })}
          icon={<Waves className="h-4 w-4" />}
        >
          <AudioPlayer onLoadRequest={handleLoadAudio} className="w-full" />
        </HistoryDetailSection>

        <HistoryDetailSection
          title={t("settings.history.sections.text", {
            defaultValue: "Transcribed text",
          })}
          icon={<Type className="h-4 w-4" />}
        >
          <p className="text-sm text-text/90 italic select-text cursor-text">
            {rawText}
          </p>
        </HistoryDetailSection>

        <HistoryDetailSection
          title={t("settings.history.sections.inserted", {
            defaultValue: "Final text",
          })}
          icon={<ArrowRight className="h-4 w-4" />}
        >
          <div className="space-y-2">
            <p className="text-sm text-text/90 select-text cursor-text">
              {pastedText}
            </p>
            {!insertedText && (
              <p className="text-xs text-text/55">
                {t("settings.history.sections.insertedFallback", {
                  defaultValue:
                    "Showing the best final text available for this entry. No explicit paste record was saved.",
                })}
              </p>
            )}
          </div>
        </HistoryDetailSection>

        <HistoryDetailSection
          title={t("settings.history.sections.postProcess", {
            defaultValue: "Post process",
          })}
          icon={<Sparkles className="h-4 w-4" />}
        >
          {postProcessApplied ? (
            <div className="space-y-3">
              <p className="text-sm text-text/90 select-text cursor-text">
                {polishedText}
              </p>
              {entry.post_process_prompt && (
                <div className="rounded-lg border border-logo-primary/20 bg-[color-mix(in_srgb,var(--color-logo-primary),transparent_96%)] px-3 py-2">
                  <p className={sectionLabelClassName}>
                    {t("settings.history.promptUsed", {
                      defaultValue: "Prompt used",
                    })}
                  </p>
                  <p className="mt-1 text-xs text-text/80 select-text cursor-text">
                    {entry.post_process_prompt}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-text/60">
              {t("settings.history.sections.postProcessEmpty", {
                defaultValue: "Post-processing was not applied for this entry.",
              })}
            </p>
          )}
        </HistoryDetailSection>

        <HistoryDetailSection
          title={t("settings.history.sections.dictionary", {
            defaultValue: "Dictionary",
          })}
          icon={<CheckCircle2 className="h-4 w-4" />}
        >
          {dictionaryApplied ? (
            <div className="space-y-2">
              <p className="text-sm text-text/90">
                {t("settings.history.correctionsApplied", {
                  defaultValue: "Corrections applied",
                })}
              </p>
              <p className="text-xs text-text/80 select-text cursor-text">
                {entry.dictionary_hits.join(", ")}
              </p>
            </div>
          ) : (
            <p className="text-sm text-text/60">
              {t("settings.history.sections.dictionaryEmpty", {
                defaultValue: "No personal dictionary corrections were applied.",
              })}
            </p>
          )}
        </HistoryDetailSection>

        <HistoryDetailSection
          title={t("settings.history.fieldObservation.title", {
            defaultValue: "Text field check",
          })}
          icon={
            fieldSnapshotStatus === "failed" ? (
              <CircleAlert className="h-4 w-4" />
            ) : fieldSnapshotStatus === "pending" ? (
              <Clock3 className="h-4 w-4" />
            ) : fieldSnapshotStatus === "skipped" ? (
              <ArrowRight className="h-4 w-4" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )
          }
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] ${snapshotToneClasses[fieldSnapshotStatus]}`}
              >
                {fieldStatusLabel}
              </span>
              {entry.field_snapshot_at && (
                <span className="text-[11px] text-text/50">
                  {t("settings.history.fieldObservation.timestamp", {
                    defaultValue: "Checked at {{time}}",
                    time: formatDateTime(String(entry.field_snapshot_at), i18n.language),
                  })}
                </span>
              )}
            </div>

            {fieldSnapshotStatus === "pending" && (
              <p className="text-sm text-text/60">
                {t("settings.history.fieldObservation.pendingDescription", {
                  defaultValue:
                    "Vox Jot started checking this field right after paste and will keep watching for up to 15 seconds while the same field stays focused.",
                })}
              </p>
            )}

            {fieldSnapshotStatus === "skipped" && (
              <div className="space-y-2">
                <p className="text-sm text-text/60">
                  {t("settings.history.fieldObservation.skippedDescription", {
                    defaultValue:
                      "Monitoring stopped because focus moved away from the original field before the full 15-second window ended.",
                  })}
                </p>
                {Boolean(observedText) && (
                  <div className="flex items-center gap-2 text-xs text-text/80 select-text cursor-text">
                    <span className="font-mono truncate max-w-[40%]" title={pastedText}>
                      {pastedText}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-text/50 shrink-0" />
                    <span className="font-mono truncate flex-1" title={observedText}>
                      {observedText}
                    </span>
                  </div>
                )}
              </div>
            )}

            {fieldSnapshotStatus === "failed" && (
              <p className="text-sm text-[var(--danger)]">
                {entry.field_snapshot_error ||
                  t("settings.history.fieldObservation.failed", {
                    defaultValue:
                      "Could not read field text for observation.",
                  })}
              </p>
            )}

            {fieldSnapshotStatus === "captured" && Boolean(observedText) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-text/80 select-text cursor-text">
                  <span className="font-mono truncate max-w-[40%]" title={pastedText}>
                    {pastedText}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-text/50 shrink-0" />
                  <span className="font-mono truncate flex-1" title={observedText}>
                    {observedText}
                  </span>
                </div>
                <p className="text-sm text-text/60">
                  {fieldCheckChanged
                    ? t("settings.history.fieldObservation.changedDescription", {
                        defaultValue:
                          "The observed field text differed from what Vox Jot inserted.",
                      })
                    : fieldCheckUnchanged
                      ? t("settings.history.fieldObservation.unchangedDescription", {
                          defaultValue:
                            "The observed field text still matched the inserted text when the delayed check ran.",
                        })
                      : t("settings.history.fieldObservation.capturedDescription", {
                          defaultValue:
                            "Vox Jot captured the field contents after the delayed check completed.",
                        })}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 w-fit px-2"
                  onClick={() => {
                    const payload = `spoken: ${pastedText}\nwritten: ${observedText}`;
                    void navigator.clipboard
                      .writeText(payload)
                      .then(() => {
                        toast.success(
                          t("settings.history.fieldObservation.copied", {
                            defaultValue: "Copied correction pair",
                          }),
                        );
                      })
                      .catch((error) => {
                        console.error("Failed to copy correction pair:", error);
                      });
                  }}
                  title={t("settings.history.fieldObservation.copyPair", {
                    defaultValue: "Copy correction pair",
                  })}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  {t("settings.history.fieldObservation.copyPair", {
                    defaultValue: "Copy pair",
                  })}
                </Button>
              </div>
            )}

            {fieldSnapshotStatus === "not_requested" && (
              <p className="text-sm text-text/60">
                {t("settings.history.fieldObservation.notRequestedDescription", {
                  defaultValue:
                    "No delayed text-field check was recorded for this history item.",
                })}
              </p>
            )}
          </div>
        </HistoryDetailSection>
      </div>
    </div>
  );
};
