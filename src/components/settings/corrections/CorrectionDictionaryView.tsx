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
  Ban,
  CheckCircle2,
  FileInput,
  History,
  Info,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
  SpellCheck,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import type { InstalledApp, StoredCorrection } from "@/bindings";
import { ActionIconButton } from "../../ui/ActionIconButton";
import Badge from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { Input } from "../../ui/Input";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SwitchControl } from "../../ui/SwitchControl";
import { modal } from "@/motion/springs";
import { handleDialogKeyDown, useDialogFocusTrap } from "@/lib/ui/focusTrap";
import {
  humanizeBundleId,
  readCachedInstalledApps,
  refreshInstalledApps,
  subscribeInstalledApps,
} from "@/lib/installedApps";
import { AppMonogram } from "@/components/settings/write-rules/AppMonogram";

type CorrectionViewMode = "corrections" | "dictionary";

const DICTIONARY_IMPORT_EXTENSIONS = [
  "json",
  "csv",
  "tsv",
  "tab",
  "txt",
  "dic",
  "plist",
];

/**
 * A group of corrections that share the same corrected word.
 * Multiple originals -> one corrected target.
 */
interface CorrectionGroup {
  corrected: string;
  entries: StoredCorrection[];
  allActive: boolean;
  disabledBundleIds: string[];
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
    const allActive = entries.every((entry) => entry.is_active);
    const disabledBundleIds = normalizeBundleIds(
      entries.flatMap((entry) => entry.disabled_bundle_ids ?? []),
    );

    groups.push({
      corrected: entries[0].corrected,
      entries,
      allActive,
      disabledBundleIds,
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

const getEntrySourceLabel = (
  entry: StoredCorrection,
  t: ReturnType<typeof useTranslation>["t"],
): string => {
  switch (entry.source_kind) {
    case "manual":
      return t("settings.corrections.dictionary.source.manual", {
        defaultValue: "Manual",
      });
    case "observed_edit":
      return t("settings.corrections.dictionary.source.observedEdit", {
        defaultValue: "Observed edit",
      });
    case "imported":
      return t("settings.corrections.dictionary.source.imported", {
        defaultValue: "Imported",
      });
    case "auto_learned":
    default:
      return t("settings.corrections.dictionary.source.autoLearned", {
        defaultValue: "Learned",
      });
  }
};

const getEntrySourceTitle = (
  entry: StoredCorrection,
  t: ReturnType<typeof useTranslation>["t"],
): string => {
  const confidence = Math.round(
    (entry.auto_apply?.effective_confidence ?? entry.confidence) * 100,
  );
  return t("settings.corrections.dictionary.source.title", {
    source: getEntrySourceLabel(entry, t),
    frequency: entry.frequency,
    confidence,
    defaultValue:
      "{{source}} correction. Seen {{frequency}} time(s). Confidence {{confidence}}%.",
  });
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

function normalizeBundleIds(bundleIds: string[]): string[] {
  return bundleIds
    .map((bundleId) => bundleId.trim())
    .filter(Boolean)
    .reduce<string[]>((acc, bundleId) => {
      if (
        !acc.some(
          (existing) => existing.toLowerCase() === bundleId.toLowerCase(),
        )
      ) {
        acc.push(bundleId);
      }
      return acc;
    }, []);
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
  const [openOriginalsKey, setOpenOriginalsKey] = useState<string | null>(null);
  const [openDisableKey, setOpenDisableKey] = useState<string | null>(null);
  const [disableAppQuery, setDisableAppQuery] = useState("");
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>(
    () => readCachedInstalledApps() ?? [],
  );
  const [confirmingDeleteGroupKey, setConfirmingDeleteGroupKey] = useState<
    string | null
  >(null);
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualCorrectionDraft>(
    emptyManualCorrectionDraft,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<CorrectionViewMode>("dictionary");
  const [importError, setImportError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const disablePopoverRef = useRef<HTMLDivElement>(null);
  const originalsPopoverRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const manualOriginalRef = useRef<HTMLInputElement>(null);
  const manualDialogRef = useRef<HTMLDivElement>(null);

  useDialogFocusTrap({
    enabled: showManualEditor,
    containerRef: manualDialogRef,
    initialFocusSelector: '[data-manual-correction-original="true"]',
  });

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
    const unsubscribe = subscribeInstalledApps(setInstalledApps);
    void refreshInstalledApps().then(setInstalledApps);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (addingTo && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [addingTo]);

  useEffect(() => {
    if (!searchExpanded) return;
    searchInputRef.current?.focus();
  }, [searchExpanded]);

  useEffect(() => {
    if (!searchExpanded) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setSearchExpanded(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [searchExpanded]);

  useEffect(() => {
    if (!openOriginalsKey) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        originalsPopoverRef.current?.contains(event.target as Node) ||
        (event.target as HTMLElement).closest("[data-originals-trigger]")
      ) {
        return;
      }

      setOpenOriginalsKey(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openOriginalsKey]);

  useEffect(() => {
    if (!openDisableKey) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        disablePopoverRef.current?.contains(event.target as Node) ||
        (event.target as HTMLElement).closest("[data-disable-trigger]")
      ) {
        return;
      }

      setOpenDisableKey(null);
      setDisableAppQuery("");
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openDisableKey]);

  const handleDelete = async (id: number) => {
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
    try {
      for (const entry of group.entries) {
        await commands.deleteCorrection(entry.id);
      }
      const ids = new Set(group.entries.map((entry) => entry.id));
      setCorrections((prev) =>
        prev.filter((correction) => !ids.has(correction.id)),
      );
      setConfirmingDeleteGroupKey(null);
      setOpenOriginalsKey(null);
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

  const handleSetGroupDisabledApps = async (
    group: CorrectionGroup,
    bundleIds: string[],
  ) => {
    const nextBundleIds = normalizeBundleIds(bundleIds);
    try {
      for (const entry of group.entries) {
        const result = await commands.setCorrectionDisabledApps(
          entry.id,
          nextBundleIds,
        );
        if (result.status === "error") {
          throw new Error(result.error);
        }
      }

      const ids = new Set(group.entries.map((entry) => entry.id));
      setCorrections((prev) =>
        prev.map((correction) =>
          ids.has(correction.id)
            ? { ...correction, disabled_bundle_ids: nextBundleIds }
            : correction,
        ),
      );
    } catch (error) {
      console.error("Failed to update disabled apps:", error);
    }
  };

  const handleDisableForCurrentApp = async (group: CorrectionGroup) => {
    try {
      const result = await commands.getFrontmostAppForExclusion();
      if (result.status === "error") {
        throw new Error(result.error);
      }

      const bundleId = result.data.bundle_id.trim();
      if (!bundleId) return;

      setInstalledApps((current) => {
        if (
          current.some(
            (app) => app.bundle_id.toLowerCase() === bundleId.toLowerCase(),
          )
        ) {
          return current;
        }
        return [
          ...current,
          {
            bundle_id: bundleId,
            name: result.data.localized_name || humanizeBundleId(bundleId),
          },
        ];
      });

      await handleSetGroupDisabledApps(group, [
        ...group.disabledBundleIds,
        bundleId,
      ]);
    } catch (error) {
      console.error("Failed to add current app exclusion:", error);
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

  const handleToggleEntryActive = async (
    entry: StoredCorrection,
    active: boolean,
  ) => {
    try {
      const result = await commands.toggleCorrection(entry.id, active);
      if (result.status === "ok") {
        await loadCorrections();
      }
    } catch (error) {
      console.error("Failed to toggle correction:", error);
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
    const path = await open({
      multiple: false,
      filters: [
        {
          name: t("settings.corrections.dictionary.importFileTypes", {
            defaultValue: "Dictionary files",
          }),
          extensions: DICTIONARY_IMPORT_EXTENSIONS,
        },
      ],
    });
    if (!path || Array.isArray(path)) return;

    setImportError("");
    setImportMessage("");
    setImporting(true);
    try {
      const result = await commands.importDictionaryFile(path);
      if (result.status === "ok") {
        setViewMode("dictionary");
        setImportMessage(
          result.data.skipped > 0
            ? t("settings.corrections.dictionary.importPartialSuccess", {
                count: result.data.imported,
                skipped: result.data.skipped,
                defaultValue:
                  "Imported {{count}} dictionary entries. Skipped {{skipped}}.",
              })
            : t("settings.corrections.dictionary.importSuccess", {
                count: result.data.imported,
                defaultValue: "Imported {{count}} dictionary entries.",
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
    } finally {
      setImporting(false);
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
  const installedAppsByBundleId = useMemo(
    () =>
      new Map(installedApps.map((app) => [app.bundle_id.toLowerCase(), app])),
    [installedApps],
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
  const viewDescription =
    viewMode === "dictionary"
      ? t("settings.corrections.dictionary.views.dictionaryDescription", {
          defaultValue:
            "Add names, jargon, and preferred spellings so dictation uses the words that matter to you.",
        })
      : t("settings.corrections.dictionary.views.correctionsDescription", {
          defaultValue:
            "Vox Jot learns from edits after dictation so repeated spelling and phrase mistakes happen less often.",
        });

  const searchAriaLabel =
    viewMode === "dictionary"
      ? t("settings.corrections.dictionary.search.dictionaryAriaLabel", {
          defaultValue: "Search dictionary",
        })
      : t("settings.corrections.dictionary.search.ariaLabel", {
          defaultValue: "Search learned corrections",
        });
  const searchPlaceholder =
    viewMode === "dictionary"
      ? t("settings.corrections.dictionary.search.dictionaryPlaceholder", {
          defaultValue: "Search dictionary",
        })
      : t("settings.corrections.dictionary.search.placeholder", {
          defaultValue: "Search corrections",
        });

  const searchField = (
    <div ref={searchContainerRef} className="flex justify-end">
      {searchExpanded ? (
        <label
          className="relative flex h-9 w-[min(20rem,calc(100vw-3rem))] min-w-[12rem] items-center"
          aria-label={searchAriaLabel}
        >
          <Search
            className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 stroke-[2.75] text-[var(--accent-hover)]"
            aria-hidden
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                if (searchQuery) {
                  setSearchQuery("");
                } else {
                  setSearchExpanded(false);
                }
                event.preventDefault();
              }
            }}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-full border-[1.5px] border-[var(--accent-hover)] bg-transparent py-1 pl-8 pr-8 text-start text-xs font-bold text-[var(--accent-hover)] transition-all duration-150 placeholder:text-[var(--accent-hover)] hover:bg-[var(--accent-soft)] focus:border-[var(--accent-hover)] focus:bg-[var(--accent-soft)] focus:outline-none"
          />
          {searchQuery ? (
            <button
              type="button"
              className="absolute right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--accent-hover)] transition-colors hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&>svg]:stroke-[2.75]"
              onClick={() => setSearchQuery("")}
              aria-label={t("settings.corrections.dictionary.search.clear", {
                defaultValue: "Clear search",
              })}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
        </label>
      ) : (
        <button
          type="button"
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-[var(--accent-hover)] text-[var(--accent-hover)] transition-colors hover:border-[var(--accent-hover)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] [&>svg]:stroke-[2.75] ${
            searchQuery ? "bg-[var(--accent-soft)]" : "bg-transparent"
          }`}
          onClick={() => setSearchExpanded(true)}
          aria-label={searchAriaLabel}
          title={
            searchQuery
              ? t("settings.corrections.dictionary.search.activeTitle", {
                  query: searchQuery,
                  defaultValue: "Search active: {{query}}",
                })
              : searchAriaLabel
          }
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );

  const actionButtons = (
    <div className="correction-dictionary-actions flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={openManualEditor}
          aria-haspopup="dialog"
        >
          <span
            className="inline-flex h-4 w-4 items-center justify-center text-[1.15em] font-bold leading-none text-[var(--accent-hover)]"
            aria-hidden
          >
            +
          </span>
          {t("settings.postProcessing.dictionary.add", {
            defaultValue: "Add new",
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
      <div className="correction-dictionary-actions__trailing ms-auto flex items-center justify-end gap-2">
        {searchField}
        {viewMode === "dictionary" ? (
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-[var(--accent-hover)] bg-transparent text-[var(--accent-hover)] transition-colors hover:border-[var(--accent-hover)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-wait disabled:opacity-60 [&>svg]:stroke-[2.75]"
            onClick={() => void handleImport()}
            disabled={importing}
            aria-label={t("settings.corrections.dictionary.import", {
              defaultValue: "Import dictionary",
            })}
            title={t("settings.corrections.dictionary.import", {
              defaultValue: "Import dictionary",
            })}
          >
            <FileInput className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
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
            className="absolute inset-0 bg-[var(--scrim-bg)] backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            ref={manualDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-correction-title"
            className="relative w-full max-w-[420px] rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] p-5 shadow-[var(--modal-shadow)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) =>
              handleDialogKeyDown(
                event,
                manualDialogRef.current,
                resetManualEditor,
              )
            }
          >
            <div className="border-b border-[var(--border)] pb-3">
              <h2
                id="add-correction-title"
                className="min-w-0 truncate text-lg font-bold text-[var(--text)]"
              >
                {t("settings.postProcessing.dictionary.addTitle", {
                  defaultValue: "Add to dictionary",
                })}
              </h2>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t("settings.postProcessing.dictionary.addSpokenLabel", {
                    defaultValue: "Spoken form",
                  })}
                </span>
                <input
                  ref={manualOriginalRef}
                  data-manual-correction-original="true"
                  value={manualDraft.original}
                  placeholder={t(
                    "settings.postProcessing.dictionary.addSpokenPlaceholder",
                    {
                      defaultValue: "e.g. open ai",
                    },
                  )}
                  onChange={(event) =>
                    setManualDraft((current) => ({
                      ...current,
                      original: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-semibold text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted)] hover:border-[var(--accent)] focus:border-[var(--accent)] focus:bg-[var(--input)] focus:ring-2 focus:ring-[var(--accent-glow)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t("settings.postProcessing.dictionary.addWrittenLabel", {
                    defaultValue: "Written form",
                  })}
                </span>
                <input
                  value={manualDraft.corrected}
                  placeholder={t(
                    "settings.postProcessing.dictionary.addWrittenPlaceholder",
                    {
                      defaultValue: "e.g. OpenAI",
                    },
                  )}
                  onChange={(event) =>
                    setManualDraft((current) => ({
                      ...current,
                      corrected: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-semibold text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted)] hover:border-[var(--accent)] focus:border-[var(--accent)] focus:bg-[var(--input)] focus:ring-2 focus:ring-[var(--accent-glow)]"
                />
              </label>
              <div className="flex items-center gap-3">
                <SwitchControl
                  checked={manualDraft.exactOnly}
                  size="compact"
                  ariaLabel={t(
                    "settings.postProcessing.dictionary.addExactMatchOnly",
                    {
                      defaultValue: "Exact match only",
                    },
                  )}
                  onChange={(checked) =>
                    setManualDraft((current) => ({
                      ...current,
                      exactOnly: checked,
                    }))
                  }
                />
                <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[var(--text)]">
                  {t("settings.postProcessing.dictionary.addExactMatchOnly", {
                    defaultValue: "Exact match only",
                  })}
                  <span
                    className="inline-flex shrink-0 text-[var(--muted)]"
                    title={t(
                      "settings.postProcessing.dictionary.addExactMatchHelp",
                      {
                        defaultValue:
                          "Only replace this phrase when it appears exactly as written.",
                      },
                    )}
                    aria-label={t(
                      "settings.postProcessing.dictionary.addExactMatchHelp",
                      {
                        defaultValue:
                          "Only replace this phrase when it appears exactly as written.",
                      },
                    )}
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </span>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={resetManualEditor}
                className="border-transparent bg-transparent text-[var(--muted)] hover:border-transparent hover:bg-transparent hover:text-[var(--text)]"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="border-[color-mix(in_srgb,var(--text),transparent_8%)] bg-[color-mix(in_srgb,var(--text),black_10%)] text-[var(--bg)] hover:border-[var(--text)] hover:bg-[var(--text)]"
                onClick={() => void handleAddManualCorrection()}
                disabled={
                  !manualDraft.original.trim() || !manualDraft.corrected.trim()
                }
              >
                {t("settings.postProcessing.dictionary.addWord", {
                  defaultValue: "Add word",
                })}
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
              variant="outline"
              onClick={
                viewMode === "dictionary" ? handleImport : openManualEditor
              }
            >
              {viewMode === "dictionary" ? (
                <>
                  <FileInput className="h-3.5 w-3.5" aria-hidden />
                  {t("settings.corrections.dictionary.import")}
                </>
              ) : (
                <>
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center text-[1.15em] font-bold leading-none text-[var(--accent-hover)]"
                    aria-hidden
                  >
                    +
                  </span>
                  {t("settings.postProcessing.dictionary.add", {
                    defaultValue: "Add new",
                  })}
                </>
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
      <div className="space-y-4">
        {filteredGroups.map((group) => {
          const groupKey = getCorrectionGroupKey(group);
          const originalsOpen = openOriginalsKey === groupKey;
          const confirmingDelete = confirmingDeleteGroupKey === groupKey;
          const disableOpen = openDisableKey === groupKey;
          const hasAppDisables = group.disabledBundleIds.length > 0;
          const isDisabled = !group.allActive || hasAppDisables;
          const rowActionsVisible =
            originalsOpen || disableOpen || confirmingDelete;
          const actionClusterClassName = "inline-flex items-center gap-2";
          const revealedActionClassName = `transition-opacity duration-150 ${
            rowActionsVisible
              ? "opacity-100"
              : "opacity-0 group-hover/dictionary-row:opacity-100 group-focus-within/dictionary-row:opacity-100"
          }`;
          const disableActionClassName = `transition-opacity duration-150 ${
            isDisabled || rowActionsVisible
              ? "opacity-100"
              : "opacity-0 group-hover/dictionary-row:opacity-100 group-focus-within/dictionary-row:opacity-100"
          }`;
          const disableQuery = disableOpen
            ? disableAppQuery.trim().toLowerCase()
            : "";
          const disabledAppSuggestions = disableQuery
            ? installedApps
                .filter(
                  (app) =>
                    !group.disabledBundleIds.some(
                      (bundleId) =>
                        bundleId.localeCompare(app.bundle_id, undefined, {
                          sensitivity: "accent",
                        }) === 0,
                    ) &&
                    (app.name.toLowerCase().includes(disableQuery) ||
                      app.bundle_id.toLowerCase().includes(disableQuery)),
                )
                .slice(0, 6)
            : [];

          return (
            <div
              key={groupKey}
              className={`card-linear group/dictionary-row relative grid grid-cols-1 gap-3 overflow-visible px-4 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text)_4%,transparent)] md:grid-cols-[minmax(14rem,1fr)_auto] md:items-center md:gap-4 ${
                !group.allActive
                  ? "bg-[color-mix(in_srgb,var(--text)_3%,transparent)]"
                  : ""
              }`}
            >
              <div className="min-w-0 space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] md:hidden">
                  {t("settings.corrections.dictionary.columns.corrected")}
                </span>
                <Input
                  variant="compact"
                  aria-label={t(
                    "settings.corrections.dictionary.columns.corrected",
                  )}
                  className="min-h-9 w-full min-w-0 border-transparent bg-transparent px-0 text-base font-semibold text-[var(--text)] shadow-none hover:border-transparent hover:bg-transparent focus:border-transparent focus:bg-transparent focus:ring-0"
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

              <div className="relative flex items-center justify-start md:justify-end">
                {confirmingDelete ? (
                  <div className={actionClusterClassName}>
                    <ActionIconButton
                      tone="confirm"
                      onClick={() => void handleDeleteGroup(group)}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 aria-hidden />
                    </ActionIconButton>
                    <ActionIconButton
                      onClick={() => setConfirmingDeleteGroupKey(null)}
                      title={t("common.cancel")}
                      aria-label={t("common.cancel")}
                    >
                      <X aria-hidden />
                    </ActionIconButton>
                  </div>
                ) : (
                  <div className={actionClusterClassName}>
                    <ActionIconButton
                      data-originals-trigger
                      active={originalsOpen}
                      className={revealedActionClassName}
                      onClick={() => {
                        setOpenDisableKey(null);
                        setDisableAppQuery("");
                        setOpenOriginalsKey((current) =>
                          current === groupKey ? null : groupKey,
                        );
                      }}
                      aria-haspopup="dialog"
                      aria-expanded={originalsOpen}
                      aria-label={t(
                        "settings.corrections.dictionary.originals.openAria",
                        {
                          count: group.entries.length,
                          defaultValue: "Show {{count}} original phrases",
                        },
                      )}
                      title={t(
                        "settings.corrections.dictionary.originals.openTitle",
                        {
                          count: group.entries.length,
                          defaultValue: "Show original phrases",
                        },
                      )}
                    >
                      <History aria-hidden />
                    </ActionIconButton>
                    {originalsOpen ? (
                      <div
                        ref={originalsPopoverRef}
                        role="dialog"
                        aria-label={t(
                          "settings.corrections.dictionary.originals.dialogTitle",
                          {
                            defaultValue: "Original phrases",
                          },
                        )}
                        className="absolute right-0 top-full z-30 mt-2 w-[min(28rem,calc(100vw-3rem))] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 shadow-[var(--shadow-lg)]"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                            {t(
                              "settings.corrections.dictionary.columns.original",
                            )}
                          </p>
                          <ActionIconButton
                            type="button"
                            onClick={() => setOpenOriginalsKey(null)}
                            aria-label={t("common.close", {
                              defaultValue: "Close",
                            })}
                            title={t("common.close", { defaultValue: "Close" })}
                          >
                            <X aria-hidden />
                          </ActionIconButton>
                        </div>
                        <div className="flex max-h-64 min-w-0 flex-wrap gap-1.5 overflow-y-auto pr-1">
                          {group.entries.map((entry) => (
                            <OriginalChip
                              key={entry.id}
                              entry={entry}
                              onUpdate={handleUpdateOriginal}
                              onDelete={handleDelete}
                              onApprove={handleApprove}
                              onToggleActive={handleToggleEntryActive}
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
                                onChange={(event) =>
                                  setNewOriginal(event.target.value)
                                }
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
                              aria-label={t("common.add", {
                                defaultValue: "Add",
                              })}
                            >
                              <Plus className="h-3 w-3" aria-hidden />
                            </button>
                          )}
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      data-disable-trigger
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${disableActionClassName} ${
                        disableOpen
                          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "text-[var(--text)]"
                      }`}
                      onClick={() => {
                        setOpenOriginalsKey(null);
                        setOpenDisableKey((current) =>
                          current === groupKey ? null : groupKey,
                        );
                        setDisableAppQuery("");
                      }}
                      aria-haspopup="dialog"
                      aria-expanded={disableOpen}
                      aria-label={t(
                        "settings.corrections.dictionary.disableMenu.open",
                        {
                          defaultValue: "Correction disable options",
                        },
                      )}
                      title={t(
                        "settings.corrections.dictionary.disableMenu.open",
                        {
                          defaultValue: "Correction disable options",
                        },
                      )}
                    >
                      {isDisabled ? (
                        <Ban className="h-[18px] w-[18px]" aria-hidden />
                      ) : (
                        <SlidersHorizontal
                          className="h-[18px] w-[18px]"
                          aria-hidden
                        />
                      )}
                    </button>
                    {disableOpen ? (
                      <div
                        ref={disablePopoverRef}
                        role="dialog"
                        aria-label={t(
                          "settings.corrections.dictionary.disableMenu.title",
                          {
                            defaultValue: "Disable options",
                          },
                        )}
                        className="absolute right-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-3rem))] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-left shadow-[var(--shadow-lg)]"
                      >
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                            {t(
                              "settings.corrections.dictionary.disableMenu.title",
                              {
                                defaultValue: "Disable options",
                              },
                            )}
                          </p>
                          <ActionIconButton
                            type="button"
                            onClick={() => {
                              setOpenDisableKey(null);
                              setDisableAppQuery("");
                            }}
                            aria-label={t("common.close", {
                              defaultValue: "Close",
                            })}
                            title={t("common.close", { defaultValue: "Close" })}
                          >
                            <X aria-hidden />
                          </ActionIconButton>
                        </div>

                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                          onClick={() =>
                            void handleToggleGroup(group, !group.allActive)
                          }
                        >
                          <span>
                            {group.allActive
                              ? t(
                                  "settings.corrections.dictionary.disableMenu.disableEverywhere",
                                  {
                                    defaultValue: "Disable everywhere",
                                  },
                                )
                              : t(
                                  "settings.corrections.dictionary.disableMenu.enableEverywhere",
                                  {
                                    defaultValue: "Enable everywhere",
                                  },
                                )}
                          </span>
                          <Ban
                            className="h-4 w-4 text-[var(--muted)]"
                            aria-hidden
                          />
                        </button>

                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            className="w-full rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-left text-xs font-semibold text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            onClick={() =>
                              void handleDisableForCurrentApp(group)
                            }
                          >
                            {t(
                              "settings.corrections.dictionary.disableMenu.currentApp",
                              {
                                defaultValue: "Disable in current app",
                              },
                            )}
                          </button>

                          <input
                            type="search"
                            value={disableAppQuery}
                            onChange={(event) =>
                              setDisableAppQuery(event.target.value)
                            }
                            placeholder={t(
                              "settings.corrections.dictionary.disableMenu.searchApps",
                              {
                                defaultValue: "Search apps",
                              },
                            )}
                            className="h-9 w-full rounded-full border border-[var(--border-strong)] bg-[var(--input)] px-3 py-1 text-start text-xs font-semibold text-[var(--text)] transition-all duration-150 placeholder:text-[var(--muted)] hover:border-logo-primary hover:bg-logo-primary/10 focus:border-logo-primary focus:bg-logo-primary/20 focus:outline-none"
                          />

                          {disabledAppSuggestions.length > 0 ? (
                            <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] py-1">
                              {disabledAppSuggestions.map((app) => (
                                <button
                                  key={app.bundle_id}
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--input)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                  onClick={() => {
                                    void handleSetGroupDisabledApps(group, [
                                      ...group.disabledBundleIds,
                                      app.bundle_id,
                                    ]);
                                    setDisableAppQuery("");
                                  }}
                                >
                                  <AppMonogram
                                    bundleId={app.bundle_id}
                                    name={app.name}
                                    size="sm"
                                  />
                                  <span className="min-w-0 flex-1 truncate text-[var(--text)]">
                                    {app.name}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}

                          {group.disabledBundleIds.length > 0 ? (
                            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                              {group.disabledBundleIds.map((bundleId) => {
                                const app = installedAppsByBundleId.get(
                                  bundleId.toLowerCase(),
                                );
                                const name =
                                  app?.name ?? humanizeBundleId(bundleId);
                                return (
                                  <span
                                    key={bundleId}
                                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--input)] py-0.5 pl-1 pr-2 text-xs font-medium text-[var(--text)]"
                                    title={bundleId}
                                  >
                                    <AppMonogram
                                      bundleId={bundleId}
                                      name={name}
                                      size="xs"
                                    />
                                    <span className="max-w-36 truncate">
                                      {name}
                                    </span>
                                    <button
                                      type="button"
                                      className="text-[var(--muted)] hover:text-[var(--danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                      onClick={() =>
                                        void handleSetGroupDisabledApps(
                                          group,
                                          group.disabledBundleIds.filter(
                                            (id) =>
                                              id.toLowerCase() !==
                                              bundleId.toLowerCase(),
                                          ),
                                        )
                                      }
                                      aria-label={t("common.remove", {
                                        defaultValue: "Remove",
                                      })}
                                    >
                                      <X className="h-3 w-3" aria-hidden />
                                    </button>
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs leading-5 text-[var(--muted)]">
                              {t(
                                "settings.corrections.dictionary.disableMenu.noApps",
                                {
                                  defaultValue:
                                    "No app-specific disables for this correction.",
                                },
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : null}
                    <ActionIconButton
                      tone="danger"
                      className={revealedActionClassName}
                      onClick={() => setConfirmingDeleteGroupKey(groupKey)}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 aria-hidden />
                    </ActionIconButton>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="space-y-7">
      {addDialog}
      {showHeaderTitle ? (
        <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3 px-5">
          <div className="min-w-0 flex-1">
            <h2 className="min-w-0 truncate text-sm font-bold uppercase tracking-widest text-[var(--text)]">
              {sectionTitle}
            </h2>
            <p className="mt-1 max-w-4xl text-sm font-semibold leading-6 text-[var(--muted)]">
              {viewDescription}
            </p>
          </div>
          {actionButtons}
        </div>
      ) : (
        <>
          <SettingsGroup
            noCard
            title={sectionTitle}
            description={viewDescription}
            showTitle={false}
            descriptionOnlyGap="controls"
          >
            {null}
          </SettingsGroup>
          {/* Sticky toolbar: a direct child of the tall root so it holds at the
              top while the corrections list scrolls (SettingsGroup's short box
              would give `sticky` no room). */}
          <div className="sticky top-0 z-30 -mt-3 py-3">{actionButtons}</div>
        </>
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
      {renderContent()}
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
  onToggleActive: (entry: StoredCorrection, active: boolean) => Promise<void>;
}> = ({ entry, onUpdate, onDelete, onApprove, onToggleActive }) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
        className="min-w-[3rem] rounded-full border border-[color-mix(in_srgb,var(--accent)_60%,var(--border))] bg-[var(--input)] px-2 py-0.5 font-mono-token text-xs focus:border-[var(--accent)] focus:outline-none"
        style={{ width: `${Math.max(value.length, 3) + 2}ch` }}
      />
    );
  }

  return (
    <Badge
      variant="secondary"
      className="group min-w-0 gap-1 border border-[var(--border)] bg-[var(--input)] px-2 py-1 font-mono-token text-[var(--text)] hover:border-[var(--border-strong)]"
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
      <span
        className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]"
        title={getEntrySourceTitle(entry, t)}
      >
        {getEntrySourceLabel(entry, t)}
      </span>
      {!entry.user_approved ? (
        <button
          type="button"
          className="shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--success)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => void onApprove(entry)}
          aria-label={t(
            "settings.corrections.dictionary.approveCorrectionAria",
            {
              original: entry.original,
              corrected: entry.corrected,
            },
          )}
          title={t("settings.corrections.dictionary.approveAlways")}
        >
          <CheckCircle2 className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
      {entry.is_active ? (
        <button
          type="button"
          className="shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--warning)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => void onToggleActive(entry, false)}
          aria-label={t("settings.corrections.dictionary.undoCorrectionAria", {
            original: entry.original,
            corrected: entry.corrected,
            defaultValue: "Undo correction from {{original}} to {{corrected}}",
          })}
          title={t("settings.corrections.dictionary.undoCorrection", {
            defaultValue: "Undo / disable",
          })}
        >
          <Undo2 className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
      {confirmingDelete ? (
        <>
          <button
            type="button"
            className="shrink-0 rounded-full bg-[var(--danger-soft)] p-0.5 text-[var(--danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger-soft)_70%,var(--danger)_30%)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            onClick={async () => {
              await onDelete(entry.id);
              setConfirmingDelete(false);
            }}
            aria-label={t(
              "settings.corrections.dictionary.deleteOriginalPhrase",
            )}
            title={t("common.delete")}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
          <button
            type="button"
            className="-mr-0.5 shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            onClick={() => setConfirmingDelete(false)}
            aria-label={t("common.cancel")}
            title={t("common.cancel")}
          >
            <X className="h-2.5 w-2.5" aria-hidden />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="-mr-0.5 shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => setConfirmingDelete(true)}
          aria-label={t("settings.corrections.dictionary.deleteOriginalPhrase")}
          title={t("common.delete")}
        >
          <X className="h-2.5 w-2.5" aria-hidden />
        </button>
      )}
    </Badge>
  );
};
