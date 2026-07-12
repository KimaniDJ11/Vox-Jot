import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AudioPlayer } from "../../ui/AudioPlayer";
import { ActionIconButton } from "../../ui/ActionIconButton";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { SegmentedControl } from "../../ui/SegmentedControl";
import {
  Copy,
  Star,
  Check,
  Trash2,
  FileText,
  FolderOpen,
  X,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Type,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import { commands, type HistoryEntry } from "@/bindings";
import { TranscriptView } from "./TranscriptView";
import { humanizeBundleId } from "@/lib/installedApps";
import {
  formatHistoryDuration,
  resolveHistoryDisplayTitle,
  resolveHistorySnippet,
  resolveHistoryTranscriptText,
  shouldShowHistorySpeakerBadge,
  isSnippetRedundant,
} from "@/lib/historyDisplay";
import { formatDate, formatTime } from "@/utils/dateFormat";
import { AppMonogram } from "@/components/settings/write-rules/AppMonogram";
import { useRefreshOnWindowFocus } from "@/hooks/useRefreshOnWindowFocus";
import { useSetting } from "@/hooks/useSettings";

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
  const showTechnicalFeatures = useSetting("show_technical_features") ?? true;
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [view, setView] = useState<"list" | "transcript">("list");
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const historyEntryCountRef = useRef(0);
  const historyLoadRequestRef = useRef(0);

  const loadHistoryEntries = useCallback(
    async (reset = true, showLoading = true) => {
      const requestId = ++historyLoadRequestRef.current;
      const offset = reset ? 0 : historyEntryCountRef.current;
      const limit = reset
        ? Math.max(HISTORY_PAGE_SIZE, historyEntryCountRef.current)
        : HISTORY_PAGE_SIZE;
      if (reset) {
        if (showLoading) {
          setLoading(true);
        }
      } else {
        setIsLoadingMore(true);
      }

      try {
        const result = await commands.getHistoryEntriesPage(offset, limit);
        if (requestId !== historyLoadRequestRef.current) return;
        if (result.status === "ok") {
          setHistoryEntries((current) => {
            const next = reset
              ? result.data.entries
              : [...current, ...result.data.entries];
            historyEntryCountRef.current = next.length;
            return next;
          });
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
        if (requestId !== historyLoadRequestRef.current) return;
        console.error("Failed to load history entries:", error);
        toast.error(
          t("settings.history.loadError", {
            defaultValue: "Failed to load history: {{error}}",
            error: String(error),
          }),
        );
      } finally {
        if (requestId !== historyLoadRequestRef.current) return;
        setLoading(false);
        setIsLoadingMore(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadHistoryEntries(true);

    // Listen for history update events
    const setupListeners = async () => {
      const unlistenUpdated = await listen("history-updated", () => {
        void loadHistoryEntries(true, false);
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

  useRefreshOnWindowFocus(() => loadHistoryEntries(true, false));

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

  const sortedEntries = useMemo(
    () =>
      [...historyEntries].sort(
        (left, right) => right.timestamp - left.timestamp,
      ),
    [historyEntries],
  );

  const handleOpenTranscript = useCallback((id: number) => {
    setSelectedEntryId(id);
    setView("transcript");
  }, []);

  const handleTranscriptChange = useCallback((id: number, nextText: string) => {
    setHistoryEntries((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              transcription_text: nextText,
            }
          : entry,
      ),
    );
  }, []);

  const handleEntryUpdate = useCallback((next: HistoryEntry) => {
    setHistoryEntries((current) =>
      current.map((entry) => (entry.id === next.id ? next : entry)),
    );
  }, []);

  const handleEntryPatch = useCallback(
    (id: number, patch: Partial<HistoryEntry>) => {
      setHistoryEntries((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, ...patch } : entry,
        ),
      );
    },
    [],
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

    // `entries` is already sorted newest-first by the caller.
    const sortedEntries = entries;
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
      <div className="space-y-5 px-1 py-4" data-testid="history-entries">
        {groupedEntries.map((group) => (
          <section key={group.key} className="space-y-2.5">
            <div className="sticky top-0 z-10 -mx-1 px-1 py-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                {group.label}
              </p>
            </div>
            <div className="space-y-3">
              {group.entries.map((entry) => {
                const displayTitle = resolveHistoryDisplayTitle(entry);
                const transcriptText = resolveHistoryTranscriptText(entry);
                const audioOnlyLabel = t("settings.history.audioOnlyEntry", {
                  defaultValue: "Audio saved — transcription did not complete",
                });
                const snippet = resolveHistorySnippet(entry) || audioOnlyLabel;

                return (
                  <HistoryEntryComponent
                    key={entry.id}
                    entry={entry}
                    displayTitle={displayTitle}
                    snippet={snippet}
                    onToggleSaved={() => toggleSaved(entry.id)}
                    onCopyText={() =>
                      copyToClipboard(transcriptText || audioOnlyLabel)
                    }
                    onRevealInFolder={() =>
                      void revealRecordingInFolder(entry.file_name)
                    }
                    onOpenTranscript={() => handleOpenTranscript(entry.id)}
                    getAudioUrl={getAudioUrl}
                    deleteAudio={deleteAudioEntry}
                    showTechnicalFeatures={showTechnicalFeatures}
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
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 rounded-xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] px-4 py-4"
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

  const viewSwitcher = (
    <SegmentedControl
      items={[
        {
          value: "list",
          label: t("settings.history.viewSwitcher.list"),
        },
        {
          value: "transcript",
          label: t("settings.history.viewSwitcher.transcript"),
        },
      ]}
      value={view}
      onChange={setView}
      ariaLabel={t("settings.history.viewSwitcher.ariaLabel")}
    />
  );

  return (
    <div className="w-full">
      {view === "list" ? (
        <>
          <div className="sticky top-0 z-20 -mx-5 flex items-center px-5 pb-3 pt-0">
            {viewSwitcher}
          </div>
          {renderEntries(sortedEntries, t("settings.history.empty"))}
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
        </>
      ) : (
        <TranscriptView
          entries={sortedEntries}
          selectedId={selectedEntryId}
          onSelectEntry={setSelectedEntryId}
          getAudioUrl={getAudioUrl}
          onTranscriptChange={handleTranscriptChange}
          onEntryUpdate={handleEntryUpdate}
          onEntryPatch={handleEntryPatch}
          viewSwitcher={viewSwitcher}
        />
      )}
    </div>
  );
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  displayTitle: string;
  snippet: string;
  onToggleSaved: () => void;
  onCopyText: () => void;
  onRevealInFolder: () => void;
  onOpenTranscript: () => void;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
  showTechnicalFeatures: boolean;
}

const sectionLabelClassName =
  "text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]";
const sectionCardClassName =
  "rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-3";

const historyMetaSeparatorClassName =
  "shrink-0 text-[color-mix(in_srgb,var(--muted),transparent_50%)]";

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
      className="pointer-events-auto z-[10000] max-h-[min(70vh,24rem)] w-max max-w-[min(90vw,28rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--popover-shadow)]"
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

const getHistoryEntryAppLabel = (entry: HistoryEntry): string | null => {
  const metadata = entry.screen_context_metadata;
  const appName = metadata?.active_app_name?.trim();
  const bundleId = metadata?.active_app_bundle_id?.trim();

  return appName || bundleId || null;
};

const HistoryEntryComponent: React.FC<HistoryEntryProps> = ({
  entry,
  displayTitle,
  snippet,
  onToggleSaved,
  onCopyText,
  onRevealInFolder,
  onOpenTranscript,
  getAudioUrl,
  deleteAudio,
  showTechnicalFeatures,
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
  const durationLabel = formatHistoryDuration(entry.duration_ms);
  const rawText = entry.transcription_text.trim();
  const polishedText = entry.post_processed_text?.trim() || "";
  const insertedText = entry.pasted_text?.trim() || "";
  const pastedText = insertedText || polishedText || rawText || snippet.trim();
  const observedText = entry.field_snapshot_text?.trim() || "";
  const dictionaryHits = entry.dictionary_hits ?? [];
  const dictionaryApplied = dictionaryHits.length > 0;
  const postProcessApplied = polishedText.length > 0;
  const showSpeakerBadge = shouldShowHistorySpeakerBadge(entry);
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

  const actions = (
    <>
      <ActionIconButton
        onClick={onOpenTranscript}
        title={t("settings.history.transcript.openLabel")}
        aria-label={t("settings.history.transcript.openLabel")}
      >
        <FileText aria-hidden />
      </ActionIconButton>
      <ActionIconButton
        onClick={handleCopyText}
        title={t("settings.history.copyToClipboard")}
        aria-label={t("settings.history.copyToClipboard")}
      >
        {showCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </ActionIconButton>
      <ActionIconButton
        onClick={onRevealInFolder}
        title={t("settings.history.showRecordingInFolder")}
        aria-label={t("settings.history.showRecordingInFolder")}
      >
        <FolderOpen aria-hidden />
      </ActionIconButton>
      <ActionIconButton
        onClick={onToggleSaved}
        active={entry.saved}
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
        <Star fill={entry.saved ? "currentColor" : "none"} />
      </ActionIconButton>
      {showDeleteConfirm ? (
        <>
          <ActionIconButton
            onClick={() => void handleDeleteEntry()}
            tone="confirm"
            title={t("settings.history.delete")}
            aria-label={t("settings.history.delete")}
          >
            <Trash2 aria-hidden />
          </ActionIconButton>
          <ActionIconButton
            onClick={() => setShowDeleteConfirm(false)}
            title={t("common.cancel")}
            aria-label={t("common.cancel")}
          >
            <X aria-hidden />
          </ActionIconButton>
        </>
      ) : (
        <ActionIconButton
          onClick={() => setShowDeleteConfirm(true)}
          tone="danger"
          title={t("settings.history.delete")}
          aria-label={t("settings.history.delete")}
        >
          <Trash2 aria-hidden />
        </ActionIconButton>
      )}
    </>
  );

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
              className="min-w-0 max-w-[45%] break-words font-mono-token"
              title={pastedText}
            >
              {pastedText}
            </span>
            <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-[var(--muted)]" />
            <span
              className="min-w-0 flex-1 break-words font-mono-token"
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
            <p className="cursor-text select-text break-words font-mono-token text-sm leading-6 text-[var(--text)]">
              {observedText}
            </p>
          ) : null}
        </>
      )}
    </div>
  );

  const metaParts: React.ReactNode[] = [
    <span key="time" className="font-medium">
      {formattedTime}
    </span>,
  ];

  if (durationLabel) {
    metaParts.push(
      <span key="duration" className="font-medium tabular-nums">
        {durationLabel}
      </span>,
    );
  }

  if (showSpeakerBadge) {
    metaParts.push(
      <span
        key="speakers"
        className="inline-flex items-center gap-1 font-semibold text-[var(--accent)]"
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
        />
        {t("settings.history.badges.speakers", {
          count: entry.speaker_count ?? 0,
          defaultValue: "{{count}} speakers",
        })}
      </span>,
    );
  }

  if (showTechnicalFeatures && postProcessApplied) {
    metaParts.push(
      <HistoryBadgeHoverPanel key="post-process" panel={postProcessBadgePanel}>
        <span className="inline-flex items-center gap-1 font-semibold text-[var(--success)]">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[var(--success)]"
          />
          {t("settings.history.badges.postProcessOn", {
            defaultValue: "Post processed",
          })}
        </span>
      </HistoryBadgeHoverPanel>,
    );
  }

  if (showTechnicalFeatures && dictionaryApplied) {
    metaParts.push(
      <HistoryBadgeHoverPanel key="dictionary" panel={dictionaryBadgePanel}>
        <span className="inline-flex items-center gap-1 font-semibold text-[var(--success)]">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[var(--success)]"
          />
          {t("settings.history.badges.dictionaryOn", {
            defaultValue: "Dictionary applied",
          })}
        </span>
      </HistoryBadgeHoverPanel>,
    );
  }

  if (showTechnicalFeatures && showFieldObservationBadge) {
    const fieldToneClass =
      fieldSnapshotStatus === "failed"
        ? "font-semibold text-[var(--danger)]"
        : fieldSnapshotStatus === "pending"
          ? "font-semibold text-[var(--warning)]"
          : "font-semibold text-[var(--success)]";
    metaParts.push(
      <HistoryBadgeHoverPanel key="field" panel={fieldBadgePanel}>
        <span className={fieldToneClass}>{fieldStatusLabel}</span>
      </HistoryBadgeHoverPanel>,
    );
  }

  return (
    <article
      className="card-linear group/history-row relative cursor-pointer px-4 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text)_4%,transparent)]"
      onClick={(event) => {
        // Let the embedded controls (play, scrubber, action buttons) handle
        // their own clicks; clicking anywhere else opens the transcript.
        if ((event.target as HTMLElement).closest("button, a, input")) {
          return;
        }
        onOpenTranscript();
      }}
    >
      <div>
        <AudioPlayer
          onLoadRequest={handleLoadAudio}
          className="min-w-0"
          initialDuration={
            entry.duration_ms ? entry.duration_ms / 1000 : undefined
          }
          title={
            <div className="min-w-0 space-y-0.5">
              <span
                className="block min-w-0 truncate select-text font-semibold text-[var(--text)]"
                title={displayTitle}
              >
                {displayTitle}
              </span>
              {snippet && !isSnippetRedundant(displayTitle, snippet) ? (
                <span
                  className="block min-w-0 truncate select-text text-sm font-normal text-[var(--muted)]"
                  title={snippet}
                >
                  {snippet}
                </span>
              ) : null}
            </div>
          }
          meta={
            <>
              {metaParts.map((part, index) => (
                <React.Fragment key={index}>
                  {index > 0 ? (
                    <span aria-hidden className={historyMetaSeparatorClassName}>
                      ·
                    </span>
                  ) : null}
                  {part}
                </React.Fragment>
              ))}
            </>
          }
          actions={actions}
          starred={entry.saved}
          artwork={
            appDisplayName && appBundleId ? (
              <AppMonogram
                bundleId={appBundleId}
                name={appDisplayName}
                size="xl"
                className="rounded-xl"
              />
            ) : undefined
          }
        />
      </div>
    </article>
  );
};
