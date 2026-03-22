import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import {
  Download,
  Plus,
  Trash2,
  Upload,
  X,
  Pencil,
  Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Snippet } from "@/bindings";
import { commands } from "@/bindings";
import { Button } from "../../ui/Button";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { useSettings } from "../../../hooks/useSettings";
import { SnippetsEnabledToggle } from "../SnippetsEnabledToggle";

const TRIGGER_MAX = 60;
const EXPANSION_MAX = 4000;

function generateId(): string {
  return `snippet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface SnippetSettingsProps {
  showEnabledToggle?: boolean;
  titleActionTargetId?: string;
}

export const SnippetSettings: React.FC<SnippetSettingsProps> = ({
  showEnabledToggle = true,
  titleActionTargetId,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const snippets: Snippet[] = getSetting("snippets") ?? [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTrigger, setEditTrigger] = useState("");
  const [editExpansion, setEditExpansion] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTrigger, setNewTrigger] = useState("");
  const [newExpansion, setNewExpansion] = useState("");
  const triggerInputRef = useRef<HTMLInputElement>(null);
  const newTriggerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && newTriggerRef.current) {
      newTriggerRef.current.focus();
    }
  }, [adding]);

  useEffect(() => {
    if (editingId && triggerInputRef.current) {
      triggerInputRef.current.focus();
    }
  }, [editingId]);

  const saveSnippets = useCallback(
    async (updated: Snippet[]) => {
      await updateSetting("snippets", updated);
    },
    [updateSetting],
  );

  const handleAdd = async () => {
    const trigger = newTrigger.trim();
    const expansion = newExpansion.trim();
    if (!trigger || !expansion) return;

    const duplicate = snippets.some(
      (s) => s.trigger.toLowerCase() === trigger.toLowerCase(),
    );
    if (duplicate) return;

    const snippet: Snippet = {
      id: generateId(),
      trigger,
      expansion,
      enabled: true,
    };

    await saveSnippets([...snippets, snippet]);
    setNewTrigger("");
    setNewExpansion("");
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    await saveSnippets(snippets.filter((s) => s.id !== id));
  };

  const handleToggle = async (id: string) => {
    await saveSnippets(
      snippets.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s,
      ),
    );
  };

  const startEdit = (snippet: Snippet) => {
    setEditingId(snippet.id);
    setEditTrigger(snippet.trigger);
    setEditExpansion(snippet.expansion);
  };

  const commitEdit = async () => {
    if (!editingId) return;
    const trigger = editTrigger.trim();
    const expansion = editExpansion.trim();
    if (!trigger || !expansion) {
      setEditingId(null);
      return;
    }

    await saveSnippets(
      snippets.map((s) =>
        s.id === editingId ? { ...s, trigger, expansion } : s,
      ),
    );
    setEditingId(null);
  };

  const handleClearAll = async () => {
    await saveSnippets([]);
  };

  const handleExport = async () => {
    try {
      const result = await commands.exportSnippets();
      if (result.status === "ok") {
        const blob = new Blob([result.data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "vox-jot-snippets.json";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Failed to export snippets:", error);
    }
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) {
        console.error("Import file too large (max 3MB)");
        return;
      }
      const text = await file.text();
      try {
        const result = await commands.importSnippets(text);
        if (result.status === "ok") {
          // Refresh settings to pick up imported snippets
          const settingsResult = await commands.getAppSettings();
          if (settingsResult.status === "ok") {
            await updateSetting("snippets", settingsResult.data.snippets);
          }
        }
      } catch (error) {
        console.error("Failed to import snippets:", error);
      }
    };
    input.click();
  };

  const bulkDisabled = snippets.length === 0;
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!titleActionTargetId) {
      setPortalTarget(null);
      return;
    }

    setPortalTarget(document.getElementById(titleActionTargetId));
  }, [titleActionTargetId]);

  const actionButtons = useMemo(
    () => (
      <>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-10 w-10 p-0"
          onClick={() => {
            setAdding(true);
            setNewTrigger("");
            setNewExpansion("");
          }}
          title={t("settings.snippets.list.add")}
          aria-label={t("settings.snippets.list.add")}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-10 w-10 p-0"
          onClick={handleImport}
          title={t("settings.snippets.list.import")}
          aria-label={t("settings.snippets.list.import")}
        >
          <Upload className="h-4 w-4 shrink-0" aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-10 w-10 p-0"
          onClick={handleExport}
          disabled={bulkDisabled}
          title={t("settings.snippets.list.export")}
          aria-label={t("settings.snippets.list.export")}
        >
          <Download className="h-4 w-4 shrink-0" aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="danger-ghost"
          className="h-10 w-10 p-0"
          onClick={handleClearAll}
          disabled={bulkDisabled}
          title={t("settings.snippets.list.clearAll")}
          aria-label={t("settings.snippets.list.clearAll")}
        >
          <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
        </Button>
      </>
    ),
    [bulkDisabled, t],
  );

  const shouldPortalActions = !showEnabledToggle && !!portalTarget;

  return (
    <div className="w-full space-y-6">
      {showEnabledToggle && (
        <SettingsGroup title={t("settings.snippets.toggle.title")}>
          <SnippetsEnabledToggle descriptionMode="tooltip" grouped={true} />
        </SettingsGroup>
      )}

      <section className="space-y-2">
        {shouldPortalActions ? createPortal(actionButtons, portalTarget) : null}

        {!showEnabledToggle && !shouldPortalActions ? (
          <div className="mb-3 flex justify-end px-5">{actionButtons}</div>
        ) : null}

        {showEnabledToggle ? (
          <div className="px-5 mb-3 flex items-center justify-between gap-3 min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text)] min-w-0 truncate">
              {t("settings.snippets.list.title")}
            </h2>
            <div className="flex gap-1 shrink-0">{actionButtons}</div>
          </div>
        ) : null}

        <div className="flat-card overflow-visible">
          {/* Add new snippet form */}
          {adding && (
            <div className="px-5 py-3 border-b border-[var(--border)] space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] shrink-0 w-16">
                  {t("settings.snippets.list.trigger")}
                </span>
                <input
                  ref={newTriggerRef}
                  type="text"
                  value={newTrigger}
                  onChange={(e) =>
                    setNewTrigger(e.target.value.slice(0, TRIGGER_MAX))
                  }
                  placeholder={t("settings.snippets.list.triggerPlaceholder")}
                  className="flex-1 px-2 py-1 text-sm bg-transparent border border-[var(--border)] rounded-full focus:outline-none focus:border-[var(--accent)] min-w-0"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setAdding(false);
                    }
                  }}
                />
                <span className="text-xs text-[var(--muted)] shrink-0">
                  {newTrigger.length}/{TRIGGER_MAX}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] shrink-0 w-16 pt-1.5">
                  {t("settings.snippets.list.expansion")}
                </span>
                <textarea
                  value={newExpansion}
                  onChange={(e) =>
                    setNewExpansion(e.target.value.slice(0, EXPANSION_MAX))
                  }
                  placeholder={t(
                    "settings.snippets.list.expansionPlaceholder",
                  )}
                  rows={2}
                  className="flex-1 px-2 py-1 text-sm bg-transparent border border-[var(--border)] rounded-2xl focus:outline-none focus:border-[var(--accent)] min-w-0 resize-y"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setAdding(false);
                    }
                  }}
                />
                <span className="text-xs text-[var(--muted)] shrink-0 pt-1.5">
                  {newExpansion.length}/{EXPANSION_MAX}
                </span>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdding(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleAdd()}
                  disabled={!newTrigger.trim() || !newExpansion.trim()}
                >
                  {t("settings.snippets.list.add")}
                </Button>
              </div>
            </div>
          )}

          {/* Snippet list */}
          {snippets.length === 0 && !adding ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">
              {t("settings.snippets.list.empty")}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {snippets.map((snippet) => (
                <div
                  key={snippet.id}
                  className={`px-5 py-3 space-y-1.5 transition-opacity ${
                    !snippet.enabled ? "opacity-50" : ""
                  }`}
                >
                  {editingId === snippet.id ? (
                    /* Edit mode */
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] shrink-0 w-16">
                          {t("settings.snippets.list.trigger")}
                        </span>
                        <input
                          ref={triggerInputRef}
                          type="text"
                          value={editTrigger}
                          onChange={(e) =>
                            setEditTrigger(
                              e.target.value.slice(0, TRIGGER_MAX),
                            )
                          }
                          className="flex-1 px-2 py-1 text-sm bg-transparent border border-[var(--border)] rounded-full focus:outline-none focus:border-[var(--accent)] min-w-0"
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingId(null);
                            if (e.key === "Enter") void commitEdit();
                          }}
                        />
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] shrink-0 w-16 pt-1.5">
                          {t("settings.snippets.list.expansion")}
                        </span>
                        <textarea
                          value={editExpansion}
                          onChange={(e) =>
                            setEditExpansion(
                              e.target.value.slice(0, EXPANSION_MAX),
                            )
                          }
                          rows={2}
                          className="flex-1 px-2 py-1 text-sm bg-transparent border border-[var(--border)] rounded-2xl focus:outline-none focus:border-[var(--accent)] min-w-0 resize-y"
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void commitEdit()}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          {t("common.save")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] shrink-0">
                          {t("settings.snippets.list.trigger")}
                        </span>
                        <span className="text-sm font-semibold truncate flex-1 min-w-0">
                          {snippet.trigger}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            className="rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text),transparent_94%)] p-1 text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] transition-colors"
                            onClick={() => startEdit(snippet)}
                            title={t("common.edit", {
                              defaultValue: "Edit",
                            })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={`inline-block w-7 h-3.5 rounded-full transition-colors ${
                              snippet.enabled
                                ? "bg-[var(--accent)]"
                                : "bg-[color-mix(in_srgb,var(--text),transparent_65%)] border border-[color-mix(in_srgb,var(--text),transparent_50%)]"
                            }`}
                            onClick={() => void handleToggle(snippet.id)}
                            title={
                              snippet.enabled
                                ? t("common.disable", {
                                    defaultValue: "Disable",
                                  })
                                : t("common.enable", {
                                    defaultValue: "Enable",
                                  })
                            }
                          >
                            <span
                              className={`block w-2.5 h-2.5 rounded-full bg-[var(--card)] shadow transition-transform ${
                                snippet.enabled
                                  ? "translate-x-3.5"
                                  : "translate-x-0.5"
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text),transparent_94%)] p-1 text-[var(--text)] hover:border-[var(--danger)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors"
                            onClick={() => void handleDelete(snippet.id)}
                            title={t("common.delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] shrink-0">
                          {t("settings.snippets.list.expansion")}
                        </span>
                        <span className="text-xs text-[var(--muted)] leading-relaxed line-clamp-2 min-w-0">
                          {snippet.expansion}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
