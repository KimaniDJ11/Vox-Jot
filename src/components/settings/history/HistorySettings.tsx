import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AudioPlayer } from "../../ui/AudioPlayer";
import Badge from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
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
import { listen } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  commands,
  type FieldSnapshotStatus,
  type HistoryEntry,
} from "@/bindings";
import { humanizeBundleId } from "@/lib/installedApps";
import { formatDate, formatTime } from "@/utils/dateFormat";
import { AppMonogram } from "@/components/settings/write-rules/AppMonogram";

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

const HISTORY_PAGE_SIZE = 50;

export const HistorySettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const loadHistoryEntries = useCallback(
    async (reset = true) => {
      const offset = reset ? 0 : historyEntries.length;
      if (reset) {
        setLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const result = await commands.getHistoryEntriesPage(
          offset,
          HISTORY_PAGE_SIZE,
        );
        if (result.status === "ok") {
          setHistoryEntries((current) =>
            reset ? result.data.entries : [...current, ...result.data.entries],
          );
          setHasMore(result.data.has_more);
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
        if (reset) {
          setLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    },
    [historyEntries.length, t],
  );

  useEffect(() => {
    void loadHistoryEntries(true);

    // Listen for history update events
    const setupListeners = async () => {
      const unlistenUpdated = await listen("history-updated", () => {
        void loadHistoryEntries(true);
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
              defaultValue:
                "Could not read field text for observation: {{error}}",
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

  const getAudioUrl = useCallback(async (fileName: string) => {
    try {
      const result = await commands.getAudioFilePath(fileName);
      if (result.status === "ok") {
        const fileData = await readFile(result.data);
        const blob = new Blob([fileData], { type: "audio/wav" });

        return URL.createObjectURL(blob);
      }
      return null;
    } catch (error) {
      console.error("Failed to get audio file path:", error);
      return null;
    }
  }, []);

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
        <div className="flat-card overflow-visible">
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-semibold text-[var(--text)]">
              {emptyMessage}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {t("settings.history.emptyDescription", {
                defaultValue:
                  "Your recordings and final text will appear here after you dictate.",
              })}
            </p>
          </div>
        </div>
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
        label: formatHistoryGroupLabel(
          entry.timestamp,
          i18n.language,
          todayLabel,
        ),
        entries: [entry],
      });

      return groups;
    }, []);

    return (
      <div className="space-y-5 px-4 py-4" data-testid="history-entries">
        {groupedEntries.map((group) => (
          <section key={group.key} className="space-y-2.5">
            <div className="sticky top-0 z-10 -mx-1 px-1 py-1 backdrop-blur-md">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                {group.label}
              </p>
            </div>
            <div className="card-linear overflow-hidden divide-y divide-[var(--ring-hairline,var(--border))]">
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
        <div className="card-linear overflow-hidden px-5 py-5">
          <div className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <div className="space-y-3">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 rounded-xl border border-[var(--ring-hairline)] px-4 py-4"
                >
                  <Skeleton className="h-3.5 w-12" />
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <div className="flex gap-2">
                      <Skeleton className="h-6 w-24 rounded-full" />
                      <Skeleton className="h-6 w-36 rounded-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {renderEntries(historyEntries, t("settings.history.empty"))}
      {hasMore ? (
        <div className="mt-5 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void loadHistoryEntries(false)}
            disabled={isLoadingMore}
          >
            {isLoadingMore
              ? t("settings.history.loadingMore", {
                  defaultValue: "Loading…",
                })
              : t("settings.history.loadMore", {
                  defaultValue: "Load more",
                })}
          </Button>
        </div>
      ) : null}
    </div>
  );
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
  "text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]";
const sectionCardClassName =
  "rounded-xl border border-mid-gray/20 bg-[color-mix(in_srgb,var(--background),white_2%)] px-3 py-3";

/** Time + main transcript line: same font, size, and line-height for alignment. */
const historyEntryPrimaryLineClass =
  "font-[var(--font-body)] text-base font-normal leading-6 text-[var(--text)]";
const historyActionButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]";
const historyDangerActionButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]";

const HistoryDetailSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <div className={sectionCardClassName}>
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[var(--muted)]">{icon}</span>
      <p className={sectionLabelClassName}>{title}</p>
    </div>
    {children}
  </div>
);

const HISTORY_BADGE_POPOVER_PAD = 12;
const HISTORY_BADGE_POPOVER_GAP = 8;

const HistoryBadgePopoverPortal: React.FC<{
  anchorRef: React.RefObject<HTMLElement | null>;
  onPointerEnterPanel: () => void;
  onPointerLeavePanel: () => void;
  children: React.ReactNode;
}> = ({ anchorRef, onPointerEnterPanel, onPointerLeavePanel, children }) => {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: -9999,
    left: -9999,
  });

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;

    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let top = r.bottom + HISTORY_BADGE_POPOVER_GAP;
    let left = r.left + r.width / 2 - pr.width / 2;
    left = Math.max(
      HISTORY_BADGE_POPOVER_PAD,
      Math.min(left, window.innerWidth - pr.width - HISTORY_BADGE_POPOVER_PAD),
    );
    if (top + pr.height > window.innerHeight - HISTORY_BADGE_POPOVER_PAD) {
      top = Math.max(
        HISTORY_BADGE_POPOVER_PAD,
        r.top - pr.height - HISTORY_BADGE_POPOVER_GAP,
      );
    }
    setPos((prev) =>
      Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5
        ? prev
        : { top, left },
    );
  }, [anchorRef]);

  useLayoutEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [reposition]);

  return createPortal(
    <div
      ref={popRef}
      role="tooltip"
      className="pointer-events-auto z-[10000] max-h-[min(70vh,24rem)] w-max max-w-[min(90vw,28rem)] overflow-y-auto rounded-xl border border-mid-gray/20 bg-[var(--card)] p-3 shadow-xl"
      style={{ position: "fixed", top: pos.top, left: pos.left }}
      onMouseEnter={onPointerEnterPanel}
      onMouseLeave={onPointerLeavePanel}
    >
      {children}
    </div>,
    document.body,
  );
};

const HistoryBadgeHoverPanel: React.FC<{
  children: React.ReactNode;
  panel: React.ReactNode;
}> = ({ children, panel }) => {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, 120);
  }, [cancelClose]);

  const handleOpen = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex cursor-help"
        onMouseEnter={handleOpen}
        onMouseLeave={scheduleClose}
      >
        {children}
      </span>
      {open ? (
        <HistoryBadgePopoverPortal
          anchorRef={triggerRef}
          onPointerEnterPanel={handleOpen}
          onPointerLeavePanel={scheduleClose}
        >
          {panel}
        </HistoryBadgePopoverPortal>
      ) : null}
    </>
  );
};

const snapshotToneClasses: Record<FieldSnapshotStatus, string> = {
  not_requested: "border-[var(--border)] bg-[var(--input)] text-[var(--muted)]",
  pending:
    "border-[var(--warning)]/25 bg-[var(--warning-soft)] text-[var(--warning)]",
  captured:
    "border-[var(--success)]/25 bg-[var(--success-soft)] text-[var(--success)]",
  skipped: "border-[var(--info)]/25 bg-[var(--info-soft)] text-[var(--info)]",
  failed:
    "border-[var(--danger)]/25 bg-[var(--danger-soft)] text-[var(--danger)]",
};

const getHistoryEntryAppLabel = (entry: HistoryEntry): string | null => {
  const metadata = entry.screen_context_metadata;
  const appName = metadata?.active_app_name?.trim();
  const bundleId = metadata?.active_app_bundle_id?.trim();

  return appName || bundleId || null;
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
  const pastedText =
    insertedText || polishedText || rawText || displayText.trim();
  const observedText = entry.field_snapshot_text?.trim() || "";
  const dictionaryHits = entry.dictionary_hits ?? [];
  const dictionaryApplied = dictionaryHits.length > 0;
  const postProcessApplied = polishedText.length > 0;
  const appLabel = getHistoryEntryAppLabel(entry);
  const appBundleId =
    entry.screen_context_metadata?.active_app_bundle_id?.trim() || null;
  const appNameFromMeta =
    entry.screen_context_metadata?.active_app_name?.trim() || null;
  const appDisplayName =
    appNameFromMeta ||
    (appBundleId ? humanizeBundleId(appBundleId) : null) ||
    appLabel;
  const fieldSnapshotStatus = entry.field_snapshot_status ?? "not_requested";
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

  const showFieldObservationBadge =
    fieldSnapshotStatus !== "not_requested" &&
    fieldSnapshotStatus !== "skipped";

  const postProcessBadgePanel = (
    <div className="space-y-2">
      <HistoryDetailSection
        title={t("settings.history.sections.text", {
          defaultValue: "Transcribed text",
        })}
        icon={<Type className="h-3.5 w-3.5" />}
      >
        <p className="text-sm leading-6 text-[var(--text)] italic select-text cursor-text">
          {rawText}
        </p>
      </HistoryDetailSection>
      {postProcessApplied ? (
        <HistoryDetailSection
          title={t("settings.history.sections.postProcess", {
            defaultValue: "Post process",
          })}
          icon={<Sparkles className="h-3.5 w-3.5" />}
        >
          <p className="text-sm leading-6 text-[var(--text)] select-text cursor-text">
            {polishedText}
          </p>
        </HistoryDetailSection>
      ) : null}
    </div>
  );

  const dictionaryBadgePanel = (
    <HistoryDetailSection
      title={t("settings.history.sections.dictionary", {
        defaultValue: "Dictionary",
      })}
      icon={<CheckCircle2 className="h-3.5 w-3.5" />}
    >
      <p className="text-sm leading-6 text-[var(--text)] select-text cursor-text">
        {dictionaryHits.join(", ")}
      </p>
    </HistoryDetailSection>
  );

  const fieldBadgePanel = (
    <div className="space-y-2">
      {fieldCheckChanged && observedText ? (
        <HistoryDetailSection
          title={t("settings.history.fieldObservation.title", {
            defaultValue: "Text field check",
          })}
          icon={<Sparkles className="h-3.5 w-3.5" />}
        >
          <div className="flex items-start gap-2 overflow-hidden text-sm leading-6 text-[var(--text)] select-text cursor-text">
            <span
              className="min-w-0 max-w-[45%] break-words font-mono"
              title={pastedText}
            >
              {pastedText}
            </span>
            <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-[var(--muted)]" />
            <span
              className="min-w-0 flex-1 break-words font-mono"
              title={observedText}
            >
              {observedText}
            </span>
          </div>
        </HistoryDetailSection>
      ) : (
        <>
          <p className={`${sectionLabelClassName} mb-0`}>{fieldStatusLabel}</p>
          {observedText ? (
            <p className="cursor-text select-text break-words font-mono text-sm leading-6 text-[var(--text)]">
              {observedText}
            </p>
          ) : null}
        </>
      )}
    </div>
  );

  return (
    <div className="group/history-row relative grid grid-cols-1 gap-y-3 px-4 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] md:grid-cols-[5.75rem_minmax(0,1fr)] md:items-baseline md:gap-x-4 md:gap-y-2.5">
      <div
        className={`min-w-0 tabular text-[12px] font-medium leading-5 text-[var(--muted)]`}
      >
        {formattedTime}
      </div>

      <p
        className={`m-0 min-w-0 cursor-text select-text ${historyEntryPrimaryLineClass}`}
      >
        {displayText}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 md:col-start-2">
        <AudioPlayer
          onLoadRequest={handleLoadAudio}
          className="min-w-0 flex-1 sm:min-w-[220px]"
        />

        <div className="flex items-center gap-1 opacity-100 transition-opacity duration-150">
          <button
            type="button"
            onClick={handleCopyText}
            className={historyActionButtonClassName}
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
            className={historyActionButtonClassName}
            title={t("settings.history.showRecordingInFolder")}
            aria-label={t("settings.history.showRecordingInFolder")}
          >
            <FolderOpen width={14} height={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onToggleSaved}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
              entry.saved
                ? "bg-[var(--accent-soft)] text-[var(--accent)] hover:text-[var(--accent)]/80"
                : "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
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
            <div className="flex items-center gap-1 rounded-full border border-[var(--danger)] bg-[var(--danger-soft)] px-2 py-1">
              <span className="text-sm text-[var(--danger)]">
                {t("common.delete")}?
              </span>
              <Button
                type="button"
                size="sm"
                variant="danger-ghost"
                onClick={() => void handleDeleteEntry()}
                className="h-8 w-8 rounded-full p-0"
                aria-label={t("settings.history.delete")}
              >
                <Check width={14} height={14} />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowDeleteConfirm(false)}
                className="h-8 w-8 rounded-full p-0 text-[var(--muted)]"
                aria-label={t("common.cancel")}
              >
                <X width={14} height={14} />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className={historyDangerActionButtonClassName}
              title={t("settings.history.delete")}
              aria-label={t("settings.history.delete")}
            >
              <Trash2 width={14} height={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 md:col-start-2">
        {appLabel && appDisplayName && (
          <span
            title={appBundleId ?? appLabel}
            aria-label={t("settings.history.badges.appA11y", {
              appName: appDisplayName,
              defaultValue: "Application: {{appName}}",
            })}
          >
            <Badge
              variant="secondary"
              className="inline-flex max-w-full min-w-0 items-center gap-1.5 border border-mid-gray/20 px-2.5 py-1 text-[var(--muted)]"
            >
              {appBundleId ? (
                <AppMonogram
                  bundleId={appBundleId}
                  name={appDisplayName}
                  size="sm"
                />
              ) : null}
              <span className="min-w-0 max-w-[14rem] truncate sm:max-w-[18rem]">
                {appDisplayName}
              </span>
            </Badge>
          </span>
        )}
        <HistoryBadgeHoverPanel panel={postProcessBadgePanel}>
          <Badge
            variant="secondary"
            className="border border-mid-gray/20 px-2.5 py-1 text-[var(--muted)]"
          >
            {postProcessApplied
              ? t("settings.history.badges.postProcessOn", {
                  defaultValue: "Post process on",
                })
              : t("settings.history.badges.postProcessOff", {
                  defaultValue: "Raw transcript",
                })}
          </Badge>
        </HistoryBadgeHoverPanel>
        {dictionaryApplied && (
          <HistoryBadgeHoverPanel panel={dictionaryBadgePanel}>
            <Badge
              variant="secondary"
              className="border border-mid-gray/20 px-2.5 py-1 text-[var(--muted)]"
            >
              {t("settings.history.badges.dictionaryOn", {
                defaultValue: "Dictionary applied",
              })}
            </Badge>
          </HistoryBadgeHoverPanel>
        )}
        {showFieldObservationBadge ? (
          <HistoryBadgeHoverPanel panel={fieldBadgePanel}>
            <Badge
              variant="secondary"
              className={`border px-2.5 py-1 ${snapshotToneClasses[fieldSnapshotStatus]}`}
            >
              {fieldStatusLabel}
            </Badge>
          </HistoryBadgeHoverPanel>
        ) : null}
      </div>
    </div>
  );
};
