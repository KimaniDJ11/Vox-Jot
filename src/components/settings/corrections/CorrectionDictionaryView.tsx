import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { Plus, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import type { StoredCorrection } from "@/bindings";
import Badge from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { SwitchControl } from "../../ui/SwitchControl";
import { ListActionButtons } from "../../ui/ListActionButtons";
import { usePortalTarget } from "../../../hooks/usePortalTarget";
import { downloadJsonFile, pickJsonFileText } from "@/lib/fileIo";

/**
 * A group of corrections that share the same corrected word.
 * Multiple originals → one corrected target.
 */
interface CorrectionGroup {
  corrected: string;
  entries: StoredCorrection[];
  totalFrequency: number;
  avgConfidence: number;
  allActive: boolean;
}

const getCorrectionGroupKey = (group: CorrectionGroup): string => {
  return group.entries
    .map((entry) => entry.id)
    .sort((left, right) => left - right)
    .join("-");
};

function groupCorrections(corrections: StoredCorrection[]): CorrectionGroup[] {
  const map = new Map<string, StoredCorrection[]>();

  for (const c of corrections) {
    const key = c.corrected.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.push(c);
    } else {
      map.set(key, [c]);
    }
  }

  const groups: CorrectionGroup[] = [];
  for (const entries of map.values()) {
    const totalFrequency = entries.reduce((sum, e) => sum + e.frequency, 0);
    const avgConfidence =
      entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length;
    const allActive = entries.every((e) => e.is_active);

    groups.push({
      corrected: entries[0].corrected,
      entries,
      totalFrequency,
      avgConfidence,
      allActive,
    });
  }

  // Sort by most recent activity
  groups.sort((a, b) => {
    const aMax = Math.max(...a.entries.map((e) => e.last_seen));
    const bMax = Math.max(...b.entries.map((e) => e.last_seen));
    return bMax - aMax;
  });

  return groups;
}

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
  /** Shown in the row above the card, with import/export/clear icons trailing right. */
  sectionTitle: string;
  showHeaderTitle?: boolean;
  titleActionTargetId?: string;
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
> = ({ sectionTitle, showHeaderTitle = true, titleActionTargetId }) => {
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
  const portalTarget = usePortalTarget(titleActionTargetId);
  const addInputRef = useRef<HTMLInputElement>(null);

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

  const handleDelete = async (id: number) => {
    try {
      const result = await commands.deleteCorrection(id);
      if (result.status === "ok") {
        setCorrections((prev) => prev.filter((c) => c.id !== id));
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
      const ids = new Set(group.entries.map((e) => e.id));
      setCorrections((prev) => prev.filter((c) => !ids.has(c.id)));
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
      const ids = new Set(group.entries.map((e) => e.id));
      setCorrections((prev) =>
        prev.map((c) => (ids.has(c.id) ? { ...c, is_active: newActive } : c)),
      );
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
      const ids = new Set(group.entries.map((e) => e.id));
      setCorrections((prev) =>
        prev.map((c) => (ids.has(c.id) ? { ...c, corrected: trimmed } : c)),
      );
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
        setCorrections((prev) =>
          prev.map((c) =>
            c.id === entry.id ? { ...c, original: trimmed } : c,
          ),
        );
      }
    } catch (error) {
      console.error("Failed to update original:", error);
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
        await loadCorrections();
      }
    } catch (error) {
      console.error("Failed to add correction:", error);
    }
  };

  const resetManualEditor = () => {
    setShowManualEditor(false);
    setManualDraft(emptyManualCorrectionDraft());
  };

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
        await loadCorrections();
      }
    } catch (error) {
      console.error("Failed to add manual correction:", error);
    }
  };

  const handleClearAll = async () => {
    try {
      const result = await commands.clearAllCorrections();
      if (result.status === "ok") {
        setCorrections([]);
      }
    } catch (error) {
      console.error("Failed to clear corrections:", error);
    }
  };

  const handleExport = async () => {
    try {
      const result = await commands.exportCorrections();
      if (result.status === "ok") {
        downloadJsonFile("vox-jot-corrections.json", result.data);
      }
    } catch (error) {
      console.error("Failed to export corrections:", error);
    }
  };

  const handleImport = async () => {
    const text = await pickJsonFileText();
    if (text === null) return;
    try {
      const result = await commands.importCorrections(text);
      if (result.status === "ok") {
        loadCorrections();
      }
    } catch (error) {
      console.error("Failed to import corrections:", error);
    }
  };

  const groups = useMemo(
    () => (loading ? [] : groupCorrections(corrections)),
    [corrections, loading],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredGroups = useMemo(
    () =>
      groups.filter((group) => groupMatchesSearch(group, normalizedSearchQuery)),
    [groups, normalizedSearchQuery],
  );
  const bulkActionsDisabled = loading || corrections.length === 0;

  const searchField = (
    <label
      className="relative flex h-8 w-full min-w-[11rem] max-w-60 items-center"
      aria-label={t("settings.corrections.dictionary.search.ariaLabel", {
        defaultValue: "Search learned corrections",
      })}
    >
      <Search
        className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--muted)]"
        aria-hidden
      />
      <Input
        autoFocus
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && searchQuery) {
            setSearchQuery("");
            event.preventDefault();
          }
        }}
        placeholder={t("settings.corrections.dictionary.search.placeholder", {
          defaultValue: "Search corrections",
        })}
        className="h-8 w-full pl-8 pr-8 text-xs text-[var(--text)] placeholder:text-[var(--muted)]"
      />
      {searchQuery ? (
        <button
          type="button"
          className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]"
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

  const actionButtons = useMemo(
    () => (
      <ListActionButtons
        labels={{
          add: t("settings.postProcessing.dictionary.add", {
            defaultValue: "Add entry",
          }),
          import: t("settings.corrections.dictionary.import"),
          export: t("settings.corrections.dictionary.export"),
          clearAll: t("settings.corrections.dictionary.clearAll"),
        }}
        onAdd={() => {
          setShowManualEditor(true);
          setManualDraft(emptyManualCorrectionDraft());
        }}
        onImport={handleImport}
        onExport={handleExport}
        onClear={handleClearAll}
        bulkDisabled={bulkActionsDisabled}
      />
    ),
    [bulkActionsDisabled, t],
  );
  const headerControls = (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
      {searchField}
      <div className="flex shrink-0 gap-1">{actionButtons}</div>
    </div>
  );
  const shouldPortalActions = !showHeaderTitle && !!portalTarget;

  return (
    <section className="space-y-2">
      {shouldPortalActions ? createPortal(headerControls, portalTarget) : null}
      <div className="px-5 mb-3 flex flex-wrap items-center justify-between gap-3 min-w-0">
        {showHeaderTitle || !shouldPortalActions ? (
          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text)] min-w-0 truncate">
            {sectionTitle}
          </h2>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {!shouldPortalActions ? headerControls : null}
      </div>

      <div className="flat-card overflow-visible">
        {showManualEditor && (
          <div className="space-y-3 border-b border-[var(--border)] px-5 py-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)]">
                  {t("settings.postProcessing.dictionary.columns.spoken")}
                </label>
                <Input
                  value={manualDraft.original}
                  onChange={(event) =>
                    setManualDraft((current) => ({
                      ...current,
                      original: event.target.value,
                    }))
                  }
                  placeholder={t(
                    "settings.postProcessing.dictionary.placeholders.spoken",
                  )}
                  className="w-full"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--muted)]">
                  {t("settings.postProcessing.dictionary.columns.written")}
                </label>
                <Input
                  value={manualDraft.corrected}
                  onChange={(event) =>
                    setManualDraft((current) => ({
                      ...current,
                      corrected: event.target.value,
                    }))
                  }
                  placeholder={t(
                    "settings.postProcessing.dictionary.placeholders.written",
                  )}
                  className="w-full"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-sm">
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

            <div className="flex justify-end gap-2">
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
          </div>
        )}

        {loading ? (
          <div className="px-5 py-4 text-sm text-[var(--muted)]">
            {t("common.loading")}
          </div>
        ) : groups.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">
            {t("settings.corrections.dictionary.empty")}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">
            {t("settings.corrections.dictionary.search.empty", {
              query: searchQuery.trim(),
              defaultValue: "No corrections match your search for '{{query}}'.",
            })}
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filteredGroups.map((group) => (
              <div
                key={getCorrectionGroupKey(group)}
                className={`px-5 py-3 space-y-2.5 transition-opacity ${
                  !group.allActive ? "opacity-50" : ""
                }`}
              >
                {/* Top row: corrected word + controls */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] shrink-0">
                    {t("settings.corrections.dictionary.columns.corrected")}
                  </span>
                  <Input
                    variant="compact"
                    className="flex-1 font-semibold min-w-0"
                    defaultValue={group.corrected}
                    onBlur={(e) => handleUpdateCorrected(group, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
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
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mr-1">
                    {t("settings.corrections.dictionary.columns.original")}
                  </span>
                  {group.entries.map((entry) => (
                    <OriginalChip
                      key={entry.id}
                      entry={entry}
                      onUpdate={handleUpdateOriginal}
                      onDelete={handleDelete}
                    />
                  ))}
                  {addingTo === group.corrected ? (
                    <form
                      className="inline-flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleAddOriginal(group.corrected);
                      }}
                    >
                      <input
                        ref={addInputRef}
                        type="text"
                        value={newOriginal}
                        onChange={(e) => setNewOriginal(e.target.value)}
                        onBlur={() => {
                          if (!newOriginal.trim()) {
                            setAddingTo(null);
                            setNewOriginal("");
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setAddingTo(null);
                            setNewOriginal("");
                          }
                        }}
                        className="px-2 py-0.5 text-xs bg-mid-gray/10 border border-mid-gray/60 rounded-full w-24 focus:outline-none focus:border-[var(--accent)] focus:bg-[var(--accent)]/10"
                        placeholder={t("common.add", {
                          defaultValue: "Add...",
                        })}
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs text-[var(--text)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded-full transition-colors border border-dashed border-mid-gray/50 hover:border-[var(--accent)]/40"
                      onClick={() => {
                        setAddingTo(group.corrected);
                        setNewOriginal("");
                      }}
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>

                <div className="flex gap-3 text-xs font-medium text-[var(--text)]">
                  <span>
                    {t("settings.corrections.dictionary.columns.frequency")}:{" "}
                    {group.totalFrequency}
                  </span>
                  <span>
                    {t("settings.corrections.dictionary.columns.confidence")}:{" "}
                    {(group.avgConfidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
}> = ({ entry, onUpdate, onDelete }) => {
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
        onChange={(e) => setValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitEdit();
          if (e.key === "Escape") {
            setValue(entry.original);
            setEditing(false);
          }
        }}
        className="px-2 py-0.5 text-xs font-mono bg-mid-gray/10 border border-[var(--accent)]/60 rounded-full focus:outline-none focus:border-[var(--accent)] min-w-[3rem]"
        style={{ width: `${Math.max(value.length, 3) + 2}ch` }}
      />
    );
  }

  return (
    <Badge
      variant="secondary"
      className="group gap-0.5 border border-mid-gray/30 bg-mid-gray/10 px-2 py-0.5 font-mono text-[var(--text)] hover:border-mid-gray/50"
    >
      <button
        type="button"
        className="cursor-text"
        onClick={() => setEditing(true)}
        title={entry.source_app || undefined}
      >
        {entry.original}
      </button>
      <button
        type="button"
        className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--danger)] transition-all -mr-0.5"
        onClick={() => void onDelete(entry.id)}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </Badge>
  );
};
