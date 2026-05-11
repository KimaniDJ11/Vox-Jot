import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Plus,
  Search,
  Trash2,
  X,
  SpellCheck,
  FileJson,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import type { StoredCorrection } from "@/bindings";
import Badge from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Input } from "../../ui/Input";
import { SwitchControl } from "../../ui/SwitchControl";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { pickJsonFileText } from "@/lib/fileIo";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
import { modal } from "@/motion/springs";

type CorrectionViewMode = "corrections" | "dictionary";

/**
 * A group of corrections that share the same corrected word.
 * Multiple originals -> one corrected target.
 */
interface CorrectionGroup {
  corrected: string;
  entries: StoredCorrection[];
  totalFrequency: number;
  avgEffectiveConfidence: number;
  allActive: boolean;
  manualCount: number;
  eligibleCount: number;
  lowConfidenceCount: number;
  blockedCount: number;
  disabledCount: number;
}

const getCorrectionGroupKey = (group: CorrectionGroup): string => {
  return group.entries
    .map((entry) => entry.id)
    .sort((left, right) => left - right)
    .join("-");
};

function groupCorrections(corrections: StoredCorrection[]): CorrectionGroup[] {
  const map = new Map<string, StoredCorrection[]>();

  for (const correction of corrections) {
    const key = correction.corrected.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.push(correction);
    } else {
      map.set(key, [correction]);
    }
  }

  const groups: CorrectionGroup[] = [];
  for (const entries of map.values()) {
    const totalFrequency = entries.reduce(
      (sum, entry) => sum + entry.frequency,
      0,
    );
    const avgEffectiveConfidence =
      entries.reduce(
        (sum, entry) =>
          sum + (entry.auto_apply?.effective_confidence ?? entry.confidence),
        0,
      ) / entries.length;
    const allActive = entries.every((entry) => entry.is_active);
    const manualCount = entries.filter((entry) => entry.user_approved).length;
    const eligibleCount = entries.filter(
      (entry) => !entry.user_approved && entry.auto_apply?.eligible,
    ).length;
    const lowConfidenceCount = entries.filter(
      (entry) => entry.auto_apply?.status === "low_confidence",
    ).length;
    const blockedCount = entries.filter(
      (entry) => entry.auto_apply?.status === "blocked",
    ).length;
    const disabledCount = entries.filter(
      (entry) => entry.auto_apply?.status === "disabled",
    ).length;

    groups.push({
      corrected: entries[0].corrected,
      entries,
      totalFrequency,
      avgEffectiveConfidence,
      allActive,
      manualCount,
      eligibleCount,
      lowConfidenceCount,
      blockedCount,
      disabledCount,
    });
  }

  groups.sort((a, b) => {
    const aMax = Math.max(...a.entries.map((entry) => entry.last_seen));
    const bMax = Math.max(...b.entries.map((entry) => entry.last_seen));
    return bMax - aMax;
  });

  return groups;
}

type CorrectionAutoApply = NonNullable<StoredCorrection["auto_apply"]>;

const getEntryAutoApply = (entry: StoredCorrection): CorrectionAutoApply => {
  return (
    entry.auto_apply ?? {
      status: entry.user_approved ? "manual" : "candidate",
      eligible: entry.user_approved,
      effective_confidence: entry.user_approved ? 1 : entry.confidence,
      min_frequency: 3,
      min_confidence: 0.74,
      confirmations_remaining: entry.user_approved
        ? 0
        : Math.max(0, 3 - entry.frequency),
    }
  );
};

const getEntryAutoStatus = (
  entry: StoredCorrection,
): CorrectionAutoApply["status"] => {
  return getEntryAutoApply(entry).status;
};

const getEntryStatusLabel = (entry: StoredCorrection): string => {
  const status = getEntryAutoStatus(entry);
  switch (status) {
    case "manual":
      return "Manual";
    case "active":
      return "Auto";
    case "candidate":
      return getEntryAutoApply(entry).confirmations_remaining > 0
        ? `Needs ${getEntryAutoApply(entry).confirmations_remaining}`
        : "Learning";
    case "low_confidence":
      return "Low conf";
    case "blocked":
      return "Review";
    case "disabled":
      return "Off";
    default:
      return "Learning";
  }
};

const getEntryStatusTitle = (entry: StoredCorrection): string => {
  const status = getEntryAutoStatus(entry);
  switch (status) {
    case "manual":
      return "Manually approved. Applies whenever enabled.";
    case "active":
      return "Auto-learned and eligible to apply.";
    case "candidate":
      return getEntryAutoApply(entry).confirmations_remaining > 0
        ? `Needs ${getEntryAutoApply(entry).confirmations_remaining} more confirmation(s) before auto-applying.`
        : "Still learning before auto-applying.";
    case "low_confidence":
      return "Seen enough times, but confidence is below the auto-apply threshold.";
    case "blocked":
      return "Will not auto-apply because it looks like a rewrite, partial capture, or unsafe correction.";
    case "disabled":
      return "Disabled. This correction will not apply.";
    default:
      return "Learning status unavailable.";
  }
};

const getEntryStatusClassName = (entry: StoredCorrection): string => {
  const status = getEntryAutoStatus(entry);
  switch (status) {
    case "manual":
      return "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]";
    case "active":
      return "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]";
    case "blocked":
    case "low_confidence":
      return "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]";
    case "disabled":
      return "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)]";
    case "candidate":
    default:
      return "border-[var(--border)] bg-[var(--input)] text-[var(--muted)]";
  }
};

const getGroupStatus = (group: CorrectionGroup) => {
  const total = group.entries.length;
  if (group.disabledCount === total) {
    return {
      label: "Off",
      title: "All corrections in this group are disabled.",
      className:
        "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)]",
    };
  }
  if (group.manualCount === total) {
    return {
      label: "Manual",
      title: "All corrections in this group are manually approved.",
      className:
        "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]",
    };
  }
  if (group.manualCount + group.eligibleCount === total) {
    return {
      label: "Applying",
      title: "Every enabled correction in this group is eligible to apply.",
      className:
        "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]",
    };
  }
  if (group.blockedCount > 0) {
    return {
      label: "Review",
      title:
        "At least one correction in this group is blocked from auto-apply until approved.",
      className:
        "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]",
    };
  }
  if (group.lowConfidenceCount > 0) {
    return {
      label: "Low conf",
      title:
        "At least one correction has enough observations but low confidence.",
      className:
        "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]",
    };
  }

  return {
    label: "Learning",
    title: "Waiting for more confirmations before auto-applying.",
    className: "border-[var(--border)] bg-[var(--input)] text-[var(--muted)]",
  };
};

function groupMatchesSearch(group: CorrectionGroup, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  return (
    group.corrected.toLowerCase().includes(normalizedQuery) ||
    group.entries.some((entry) =>
      entry.original.toLowerCase().includes(normalizedQuery),
    )
  );
}

interface CorrectionDictionaryViewProps {
  sectionTitle: string;
  showHeaderTitle?: boolean;
}

type ManualCorrectionDraft = {
  original: string;
  corrected: string;
  exactOnly: boolean;
};

const emptyManualCorrectionDraft = (): ManualCorrectionDraft => ({
  original: "",
  corrected: "",
  exactOnly: false,
});

export const CorrectionDictionaryView: React.FC<
  CorrectionDictionaryViewProps
> = ({ sectionTitle, showHeaderTitle = true }) => {
  const { t } = useTranslation();
  const [corrections, setCorrections] = useState<StoredCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newOriginal, setNewOriginal] = useState("");
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualCorrectionDraft>(
    emptyManualCorrectionDraft,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<CorrectionViewMode>("dictionary");
  const [importError, setImportError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const manualOriginalRef = useRef<HTMLInputElement>(null);

  const loadCorrections = useCallback(async () => {
    try {
      const result = await commands.getCorrections();
      if (result.status === "ok") {
        setCorrections(result.data);
      }
    } catch (error) {
      console.error("Failed to load corrections:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCorrections();
  }, [loadCorrections]);

  useEffect(() => {
    if (addingTo && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [addingTo]);

  useEffect(() => {
    if (showManualEditor && manualOriginalRef.current) {
      manualOriginalRef.current.focus();
    }
  }, [showManualEditor]);

  useEffect(() => {
    if (!showManualEditor) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        resetManualEditor();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showManualEditor]);

  const handleDelete = async (id: number) => {
    const entry = corrections.find((correction) => correction.id === id);
    const phrase =
      entry?.original ?? t("common.delete", { defaultValue: "Delete" });
    if (
      !confirmDestructiveAction(
        t("settings.corrections.dictionary.deleteConfirm", {
          phrase,
          defaultValue: 'Delete correction "{{phrase}}"?',
        }),
      )
    ) {
      return;
    }

    try {
      const result = await commands.deleteCorrection(id);
      if (result.status === "ok") {
        setCorrections((prev) =>
          prev.filter((correction) => correction.id !== id),
        );
      }
    } catch (error) {
      console.error("Failed to delete correction:", error);
    }
  };

  const handleDeleteGroup = async (group: CorrectionGroup) => {
    if (
      !confirmDestructiveAction(
        t("settings.corrections.dictionary.deleteGroupConfirm", {
          phrase: group.corrected,
          count: group.entries.length,
          defaultValue:
            'Delete "{{phrase}}" and its {{count}} correction entries?',
        }),
      )
    ) {
      return;
    }

    try {
      for (const entry of group.entries) {
        await commands.deleteCorrection(entry.id);
      }
      const ids = new Set(group.entries.map((entry) => entry.id));
      setCorrections((prev) =>
        prev.filter((correction) => !ids.has(correction.id)),
      );
    } catch (error) {
      console.error("Failed to delete group:", error);
    }
  };

  const handleToggleGroup = async (
    group: CorrectionGroup,
    newActive: boolean,
  ) => {
    try {
      for (const entry of group.entries) {
        await commands.toggleCorrection(entry.id, newActive);
      }
      await loadCorrections();
    } catch (error) {
      console.error("Failed to toggle group:", error);
    }
  };

  const handleUpdateCorrected = async (
    group: CorrectionGroup,
    newCorrected: string,
  ) => {
    const trimmed = newCorrected.trim();
    if (!trimmed || trimmed === group.corrected) return;

    try {
      for (const entry of group.entries) {
        await commands.updateCorrection(entry.id, entry.original, trimmed);
      }
      await loadCorrections();
    } catch (error) {
      console.error("Failed to update corrected text:", error);
    }
  };

  const handleUpdateOriginal = async (
    entry: StoredCorrection,
    newOriginal: string,
  ) => {
    const trimmed = newOriginal.trim();
    if (!trimmed || trimmed === entry.original) return;

    try {
      const result = await commands.updateCorrection(
        entry.id,
        trimmed,
        entry.corrected,
      );
      if (result.status === "ok") {
        await loadCorrections();
      }
    } catch (error) {
      console.error("Failed to update original:", error);
    }
  };

  const handleApprove = async (entry: StoredCorrection) => {
    try {
      const result = await commands.addManualCorrection(
        entry.original,
        entry.corrected,
        entry.exact_only ?? false,
      );
      if (result.status === "ok") {
        setViewMode("dictionary");
        await loadCorrections();
      }
    } catch (error) {
      console.error("Failed to approve correction:", error);
    }
  };

  const handleAddOriginal = async (corrected: string) => {
    const trimmed = newOriginal.trim();
    if (!trimmed) return;

    try {
      const result = await commands.addManualCorrection(
        trimmed,
        corrected,
        false,
      );
      if (result.status === "ok") {
        setNewOriginal("");
        setAddingTo(null);
        setViewMode("dictionary");
        await loadCorrections();
      }
    } catch (error) {
      console.error("Failed to add correction:", error);
    }
  };

  function resetManualEditor() {
    setShowManualEditor(false);
    setManualDraft(emptyManualCorrectionDraft());
  }

  const openManualEditor = useCallback(() => {
    setShowManualEditor(true);
    setManualDraft(emptyManualCorrectionDraft());
  }, []);

  const handleAddManualCorrection = async () => {
    const original = manualDraft.original.trim();
    const corrected = manualDraft.corrected.trim();

    if (!original || !corrected) {
      return;
    }

    try {
      const result = await commands.addManualCorrection(
        original,
        corrected,
        manualDraft.exactOnly,
      );
      if (result.status === "ok") {
        resetManualEditor();
        setViewMode("dictionary");
        await loadCorrections();
      }
    } catch (error) {
      console.error("Failed to add manual correction:", error);
    }
  };

  const handleImport = useCallback(async () => {
    const text = await pickJsonFileText();
    if (text === null) return;
    setImportError("");
    setImportMessage("");
    try {
      const result = await commands.importCorrections(text);
      if (result.status === "ok") {
        setViewMode("dictionary");
        setImportMessage(
          t("settings.corrections.dictionary.importSuccess", {
            count: result.data,
            defaultValue: "Imported {{count}} corrections.",
          }),
        );
        void loadCorrections();
      } else {
        setImportError(result.error);
      }
    } catch (error) {
      console.error("Failed to import corrections:", error);
      setImportError(
        error instanceof Error
          ? error.message
          : t("settings.corrections.dictionary.importFailed", {
              defaultValue: "Failed to import corrections.",
            }),
      );
    }
  }, [loadCorrections, t]);

  const visibleCorrections = useMemo(
    () =>
      corrections.filter((correction) =>
        viewMode === "dictionary"
          ? correction.user_approved
          : !correction.user_approved,
      ),
    [corrections, viewMode],
  );
  const groups = useMemo(
    () => (loading ? [] : groupCorrections(visibleCorrections)),
    [visibleCorrections, loading],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredGroups = useMemo(
    () =>
      groups.filter((group) =>
        groupMatchesSearch(group, normalizedSearchQuery),
      ),
    [groups, normalizedSearchQuery],
  );

  const viewItems = useMemo(
    () => [
      {
        value: "dictionary" as const,
        label: t("settings.corrections.dictionary.views.dictionary", {
          defaultValue: "Dictionary",
        }),
      },
      {
        value: "corrections" as const,
        label: t("settings.corrections.dictionary.views.corrections", {
          defaultValue: "Corrections",
        }),
      },
    ],
    [t],
  );

  const searchField = (
    <label
      className="relative flex h-9 w-[min(20rem,100%)] min-w-[12rem] items-center"
      aria-label={
        viewMode === "dictionary"
          ? t("settings.corrections.dictionary.search.dictionaryAriaLabel", {
              defaultValue: "Search dictionary",
            })
          : t("settings.corrections.dictionary.search.ariaLabel", {
              defaultValue: "Search learned corrections",
            })
      }
    >
      <Search
        className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--muted)]"
        aria-hidden
      />
      <Input
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && searchQuery) {
            setSearchQuery("");
            event.preventDefault();
          }
        }}
        placeholder={
          viewMode === "dictionary"
            ? t(
                "settings.corrections.dictionary.search.dictionaryPlaceholder",
                {
                  defaultValue: "Search dictionary",
                },
              )
            : t("settings.corrections.dictionary.search.placeholder", {
                defaultValue: "Search corrections",
              })
        }
        className="h-9 w-full pl-8 pr-8 text-xs text-[var(--text)] placeholder:text-[var(--muted)]"
      />
      {searchQuery ? (
        <button
          type="button"
          className="absolute right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => setSearchQuery("")}
          aria-label={t("settings.corrections.dictionary.search.clear", {
            defaultValue: "Clear search",
          })}
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </label>
  );

  const actionButtons = (
    <div className="correction-dictionary-actions flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary-soft"
          onClick={openManualEditor}
          aria-haspopup="dialog"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t("settings.postProcessing.dictionary.add", {
            defaultValue: "Add entry",
          })}
        </Button>
        <SegmentedControl<CorrectionViewMode>
          value={viewMode}
          onChange={setViewMode}
          layoutId="corrections-view-toggle"
          ariaLabel={t("settings.corrections.dictionary.views.ariaLabel", {
            defaultValue: "Dictionary view",
          })}
          items={viewItems}
        />
      </div>
      <div className="correction-dictionary-actions__trailing ms-auto flex min-w-[min(100%,20rem)] justify-end">
        {searchField}
      </div>
    </div>
  );

  const addDialog = createPortal(
    <AnimatePresence>
      {showManualEditor ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={resetManualEditor}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-correction-title"
            className="relative w-full max-w-[560px] rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2
                id="add-correction-title"
                className="min-w-0 truncate text-base font-semibold text-[var(--text)]"
              >
                {t("settings.postProcessing.dictionary.add", {
                  defaultValue: "Add entry",
                })}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={resetManualEditor}
                aria-label={t("common.close", { defaultValue: "Close" })}
                title={t("common.close", { defaultValue: "Close" })}
              >
                <X />
              </Button>
            </div>
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t("settings.postProcessing.dictionary.columns.spoken")}
                </span>
                <input
                  ref={manualOriginalRef}
                  value={manualDraft.original}
                  onChange={(event) =>
                    setManualDraft((current) => ({
                      ...current,
                      original: event.target.value,
                    }))
                  }
                  className="w-full rounded-full border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm font-semibold text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted)] hover:border-[var(--accent)] focus:border-[var(--accent)] focus:bg-[var(--accent-soft)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t("settings.postProcessing.dictionary.columns.written")}
                </span>
                <Input
                  value={manualDraft.corrected}
                  onChange={(event) =>
                    setManualDraft((current) => ({
                      ...current,
                      corrected: event.target.value,
                    }))
                  }
                  className="w-full bg-[var(--input)] text-[var(--text)]"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={manualDraft.exactOnly}
                  onChange={(event) =>
                    setManualDraft((current) => ({
                      ...current,
                      exactOnly: event.target.checked,
                    }))
                  }
                />
                <span>
                  {t("settings.postProcessing.dictionary.columns.exactOnly")}
                </span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={resetManualEditor}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleAddManualCorrection()}
                disabled={
                  !manualDraft.original.trim() || !manualDraft.corrected.trim()
                }
              >
                {t("common.save")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );

  const emptyStateText =
    viewMode === "dictionary"
      ? {
          title: t("settings.corrections.dictionary.emptyDictionary", {
            defaultValue: "No dictionary entries yet.",
          }),
          description: t(
            "settings.corrections.dictionary.emptyDictionaryDescription",
            {
              defaultValue:
                "Add or import correction entries to make Vox Jot prefer those spellings.",
            },
          ),
          example: t("settings.corrections.dictionary.emptyDictionaryExample", {
            defaultValue: "For example, map “swift ui” to “SwiftUI.”",
          }),
        }
      : {
          title: t("settings.corrections.dictionary.empty"),
          description: t("settings.corrections.dictionary.emptyDescription"),
          example: t("settings.corrections.dictionary.emptyExample"),
        };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="px-5 py-4 text-sm text-[var(--muted)]">
          {t("common.loading")}
        </div>
      );
    }

    if (groups.length === 0) {
      return (
        <EmptyState
          framed={false}
          icon={<SpellCheck className="h-5 w-5" aria-hidden />}
          title={emptyStateText.title}
          description={emptyStateText.description}
          example={emptyStateText.example}
          action={
            <Button
              type="button"
              size="sm"
              variant="primary-soft"
              onClick={
                viewMode === "dictionary" ? handleImport : openManualEditor
              }
            >
              {viewMode === "dictionary" ? (
                <>
                  <FileJson className="h-3.5 w-3.5" aria-hidden />
                  {t("settings.corrections.dictionary.import")}
                </>
              ) : (
                t("settings.postProcessing.dictionary.add", {
                  defaultValue: "Add entry",
                })
              )}
            </Button>
          }
        />
      );
    }

    if (filteredGroups.length === 0) {
      return (
        <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">
          {viewMode === "dictionary"
            ? t("settings.corrections.dictionary.search.dictionaryEmpty", {
                query: searchQuery.trim(),
                defaultValue:
                  "No dictionary entries match your search for '{{query}}'.",
              })
            : t("settings.corrections.dictionary.search.empty", {
                query: searchQuery.trim(),
                defaultValue:
                  "No corrections match your search for '{{query}}'.",
              })}
        </div>
      );
    }

    return (
      <div className="divide-y divide-[var(--border)]">
        <div className="hidden grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_10rem_5.75rem] items-center gap-4 bg-[var(--surface-muted)] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] md:grid">
          <span>{t("settings.corrections.dictionary.columns.original")}</span>
          <span>{t("settings.corrections.dictionary.columns.corrected")}</span>
          <span>{t("common.status", { defaultValue: "Stats" })}</span>
          <span className="text-right">
            {t("common.actions", { defaultValue: "Actions" })}
          </span>
        </div>
        {filteredGroups.map((group) => (
          <div
            key={getCorrectionGroupKey(group)}
            className={`grid grid-cols-1 gap-3 px-5 py-3.5 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_10rem_5.75rem] md:items-center md:gap-4 ${
              !group.allActive
                ? "bg-[color-mix(in_srgb,var(--text)_3%,transparent)]"
                : ""
            }`}
          >
            <div className="min-w-0 space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] md:hidden">
                {t("settings.corrections.dictionary.columns.original")}
              </span>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {group.entries.map((entry) => (
                  <OriginalChip
                    key={entry.id}
                    entry={entry}
                    onUpdate={handleUpdateOriginal}
                    onDelete={handleDelete}
                    onApprove={handleApprove}
                  />
                ))}
                {addingTo === group.corrected ? (
                  <form
                    className="inline-flex items-center gap-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleAddOriginal(group.corrected);
                    }}
                  >
                    <input
                      ref={addInputRef}
                      type="text"
                      value={newOriginal}
                      onChange={(event) => setNewOriginal(event.target.value)}
                      onBlur={() => {
                        if (!newOriginal.trim()) {
                          setAddingTo(null);
                          setNewOriginal("");
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setAddingTo(null);
                          setNewOriginal("");
                        }
                      }}
                      className="h-7 w-28 rounded-full border border-[var(--border-strong)] bg-[var(--input)] px-2 text-xs text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:bg-[var(--accent-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                      placeholder={t("common.add", {
                        defaultValue: "Add...",
                      })}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    onClick={() => {
                      setAddingTo(group.corrected);
                      setNewOriginal("");
                    }}
                    title={t("common.add", { defaultValue: "Add" })}
                    aria-label={t("common.add", { defaultValue: "Add" })}
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            <div className="min-w-0 space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] md:hidden">
                {t("settings.corrections.dictionary.columns.corrected")}
              </span>
              <Input
                variant="compact"
                aria-label={t(
                  "settings.corrections.dictionary.columns.corrected",
                )}
                className="min-h-9 w-full min-w-0 rounded-[999px] px-3 font-semibold text-[var(--text)]"
                defaultValue={group.corrected}
                onBlur={(event) =>
                  handleUpdateCorrected(group, event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    (event.target as HTMLInputElement).blur();
                  }
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[var(--muted)] md:block md:space-y-1">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getGroupStatus(group).className}`}
                title={getGroupStatus(group).title}
              >
                {getGroupStatus(group).label}
              </span>
              <span className="block text-[var(--text)]">
                {t("settings.corrections.dictionary.columns.frequency", {
                  defaultValue: "Uses",
                })}
                : {group.totalFrequency}
              </span>
              <span className="block">
                {t("settings.corrections.dictionary.columns.confidence", {
                  defaultValue: "Confidence",
                })}
                : {(group.avgEffectiveConfidence * 100).toFixed(0)}%
              </span>
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <SwitchControl
                checked={group.allActive}
                onChange={(checked) => handleToggleGroup(group, checked)}
                size="compact"
                frame="icon"
                title={
                  group.allActive
                    ? t("common.disable", { defaultValue: "Disable" })
                    : t("common.enable", { defaultValue: "Enable" })
                }
                ariaLabel={
                  group.allActive
                    ? t("common.disable", { defaultValue: "Disable" })
                    : t("common.enable", { defaultValue: "Enable" })
                }
              />
              <Button
                type="button"
                variant="danger-ghost"
                size="icon-sm"
                onClick={() => handleDeleteGroup(group)}
                title={t("common.delete")}
                aria-label={t("common.delete")}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <section className="space-y-4">
      {addDialog}
      {showHeaderTitle ? (
        <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3 px-5">
          <h2 className="min-w-0 truncate text-sm font-bold uppercase tracking-widest text-[var(--text)]">
            {sectionTitle}
          </h2>
          {actionButtons}
        </div>
      ) : (
        <SettingsGroup
          noCard
          title={sectionTitle}
          description={t("settings.corrections.description")}
        >
          {actionButtons}
        </SettingsGroup>
      )}

      {importMessage ? (
        <div
          className="px-1 text-xs font-medium text-[var(--accent)]"
          role="status"
        >
          {importMessage}
        </div>
      ) : null}
      {importError ? (
        <div className="px-1 text-xs text-[var(--danger)]" role="alert">
          {importError}
        </div>
      ) : null}

      <div className="flat-card overflow-visible">{renderContent()}</div>
    </section>
  );
};

/**
 * Editable chip for an original word.
 * Click to edit inline, blur to auto-save.
 */
const OriginalChip: React.FC<{
  entry: StoredCorrection;
  onUpdate: (entry: StoredCorrection, newOriginal: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onApprove: (entry: StoredCorrection) => Promise<void>;
}> = ({ entry, onUpdate, onDelete, onApprove }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(entry.original);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitEdit = () => {
    setEditing(false);
    if (value.trim() && value.trim() !== entry.original) {
      void onUpdate(entry, value.trim());
    } else {
      setValue(entry.original);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commitEdit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitEdit();
          if (event.key === "Escape") {
            setValue(entry.original);
            setEditing(false);
          }
        }}
        className="min-w-[3rem] rounded-full border border-[var(--accent)]/60 bg-mid-gray/10 px-2 py-0.5 font-mono text-xs focus:border-[var(--accent)] focus:outline-none"
        style={{ width: `${Math.max(value.length, 3) + 2}ch` }}
      />
    );
  }

  return (
    <Badge
      variant="secondary"
      className="group min-w-0 gap-1 border border-[var(--border)] bg-[var(--input)] px-2 py-1 font-mono text-[var(--text)] hover:border-[var(--border-strong)]"
    >
      <button
        type="button"
        className="min-w-0 max-w-[18rem] cursor-text truncate text-left"
        onClick={() => setEditing(true)}
        title={entry.source_app || undefined}
      >
        {entry.original}
      </button>
      <span
        className={`ml-1 shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${getEntryStatusClassName(entry)}`}
        title={getEntryStatusTitle(entry)}
      >
        {getEntryStatusLabel(entry)}
      </span>
      {!entry.user_approved ? (
        <button
          type="button"
          className="shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--success)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => void onApprove(entry)}
          aria-label={`Approve correction ${entry.original} to ${entry.corrected}`}
          title="Approve and always apply"
        >
          <CheckCircle2 className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        className="-mr-0.5 shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        onClick={() => void onDelete(entry.id)}
        aria-label="Delete original phrase"
      >
        <X className="h-2.5 w-2.5" aria-hidden />
      </button>
    </Badge>
  );
};
