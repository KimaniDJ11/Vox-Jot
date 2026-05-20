import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Trash2,
  X,
  Pencil,
  Check,
  WholeWord,
  Plus,
  Upload,
  FileJson,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Snippet } from "@/bindings";
import { commands } from "@/bindings";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { SwitchControl } from "../../ui/SwitchControl";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { subtleCardClassName } from "../../ui/subtleCard";
import { useSettings } from "../../../hooks/useSettings";
import { PhraseKeysEnabledToggle } from "../PhraseKeysEnabledToggle";
import { pickJsonFileText } from "@/lib/fileIo";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
import { modal } from "@/motion/springs";
import { handleDialogKeyDown, useDialogFocusTrap } from "@/lib/ui/focusTrap";

const TRIGGER_MAX = 60;
const EXPANSION_MAX = 4000;
const IMPORT_MAX_BYTES = 3 * 1024 * 1024;

type PhraseKeysView = "myKeys" | "importedKeys";

function generateId(): string {
  return `snippet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface SnippetSettingsProps {
  showEnabledToggle?: boolean;
}

export const SnippetSettings: React.FC<SnippetSettingsProps> = ({
  showEnabledToggle = true,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const snippets: Snippet[] = getSetting("snippets") ?? [];
  const snippetsUpdating = isUpdating("snippets");

  const [view, setView] = useState<PhraseKeysView>("myKeys");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTrigger, setEditTrigger] = useState("");
  const [editExpansion, setEditExpansion] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTrigger, setNewTrigger] = useState("");
  const [newExpansion, setNewExpansion] = useState("");
  const [isImportDragOver, setIsImportDragOver] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const triggerInputRef = useRef<HTMLInputElement>(null);
  const newTriggerRef = useRef<HTMLInputElement>(null);
  const addDialogRef = useRef<HTMLDivElement>(null);

  useDialogFocusTrap({
    enabled: adding,
    containerRef: addDialogRef,
    initialFocusSelector: '[data-add-phrase-key-trigger="true"]',
  });

  const duplicateNewTrigger = snippets.some(
    (s) =>
      newTrigger.trim().length > 0 &&
      s.trigger.trim().toLowerCase() === newTrigger.trim().toLowerCase(),
  );

  const openAddDialog = useCallback(() => {
    setAdding(true);
    setNewTrigger("");
    setNewExpansion("");
  }, []);

  const closeAddDialog = useCallback(() => {
    setAdding(false);
    setNewTrigger("");
    setNewExpansion("");
  }, []);

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
    if (!trigger || !expansion || duplicateNewTrigger) return;

    const snippet: Snippet = {
      id: generateId(),
      trigger,
      expansion,
      enabled: true,
    };

    await saveSnippets([...snippets, snippet]);
    closeAddDialog();
  };

  const handleDelete = async (snippet: Snippet) => {
    if (
      !confirmDestructiveAction(
        t("settings.snippets.list.deleteConfirm", {
          trigger: snippet.trigger,
          defaultValue: 'Delete phrase key "{{trigger}}"?',
        }),
      )
    ) {
      return;
    }

    await saveSnippets(snippets.filter((s) => s.id !== snippet.id));
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await saveSnippets(
      snippets.map((s) => (s.id === id ? { ...s, enabled } : s)),
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

  const importSnippetsText = useCallback(
    async (text: string) => {
      setImportError("");
      setImportMessage("");
      try {
        const result = await commands.importSnippets(text);
        if (result.status === "error") {
          setImportError(result.error);
          return;
        }

        const settingsResult = await commands.getAppSettings();
        if (settingsResult.status === "error") {
          setImportError(settingsResult.error);
          return;
        }

        await updateSetting("snippets", settingsResult.data.snippets);
        setImportMessage(
          t("settings.snippets.list.importSuccess", {
            defaultValue: "Phrase keys imported.",
          }),
        );
      } catch (error) {
        console.error("Failed to import snippets:", error);
        setImportError(
          error instanceof Error
            ? error.message
            : t("settings.snippets.list.importFailed", {
                defaultValue: "Failed to import phrase keys.",
              }),
        );
      }
    },
    [t, updateSetting],
  );

  const handleImport = useCallback(async () => {
    const text = await pickJsonFileText({ maxBytes: IMPORT_MAX_BYTES });
    if (text === null) return;
    await importSnippetsText(text);
  }, [importSnippetsText]);

  const handleDroppedImport = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setImportError("");
      setImportMessage("");
      if (!file.name.toLowerCase().endsWith(".json")) {
        setImportError(
          t("settings.snippets.list.importJsonOnly", {
            defaultValue: "Choose a JSON phrase keys file.",
          }),
        );
        return;
      }
      if (file.size > IMPORT_MAX_BYTES) {
        setImportError(
          t("settings.snippets.list.importTooLarge", {
            defaultValue: "That file is too large to import.",
          }),
        );
        return;
      }
      try {
        await importSnippetsText(await file.text());
      } catch (error) {
        console.error("Failed to read dropped snippet import:", error);
        setImportError(
          error instanceof Error
            ? error.message
            : t("settings.snippets.list.importFailed", {
                defaultValue: "Failed to import phrase keys.",
              }),
        );
      }
    },
    [importSnippetsText, t],
  );

  const phraseKeyViews = useMemo(
    () => [
      {
        value: "myKeys" as const,
        label: t("settings.snippets.list.myKeys", {
          defaultValue: "My keys",
        }),
      },
      {
        value: "importedKeys" as const,
        label: t("settings.snippets.list.importedKeys", {
          defaultValue: "Imported keys",
        }),
      },
    ],
    [t],
  );

  const actionButtons = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary-soft"
          onClick={openAddDialog}
          aria-haspopup="dialog"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t("settings.snippets.list.add")}
        </Button>
        <SegmentedControl
          items={phraseKeyViews}
          value={view}
          onChange={setView}
          ariaLabel={t("settings.snippets.list.viewLabel", {
            defaultValue: "Phrase keys view",
          })}
          layoutId="phrase-keys-view"
        />
      </div>
    ),
    [openAddDialog, phraseKeyViews, t, view],
  );

  const addDialog = createPortal(
    <AnimatePresence>
      {adding ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={closeAddDialog}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            ref={addDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-phrase-key-title"
            className="relative w-full max-w-[560px] rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) =>
              handleDialogKeyDown(event, addDialogRef.current, closeAddDialog)
            }
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2
                id="add-phrase-key-title"
                className="min-w-0 truncate text-base font-semibold text-[var(--text)]"
              >
                {t("settings.snippets.list.add")}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={closeAddDialog}
                aria-label={t("common.close", { defaultValue: "Close" })}
                title={t("common.close", { defaultValue: "Close" })}
              >
                <X />
              </Button>
            </div>
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t("settings.snippets.list.trigger")}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    ref={newTriggerRef}
                    data-add-phrase-key-trigger="true"
                    type="text"
                    value={newTrigger}
                    onChange={(e) =>
                      setNewTrigger(e.target.value.slice(0, TRIGGER_MAX))
                    }
                    placeholder={t("settings.snippets.list.triggerPlaceholder")}
                    className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {newTrigger.length}/{TRIGGER_MAX}
                  </span>
                </div>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t("settings.snippets.list.expansion")}
                </span>
                <div className="flex items-start gap-2">
                  <textarea
                    value={newExpansion}
                    onChange={(e) =>
                      setNewExpansion(e.target.value.slice(0, EXPANSION_MAX))
                    }
                    placeholder={t(
                      "settings.snippets.list.expansionPlaceholder",
                    )}
                    rows={5}
                    className="min-w-0 flex-1 resize-y rounded-2xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                  <span className="shrink-0 pt-2 text-xs text-[var(--muted)]">
                    {newExpansion.length}/{EXPANSION_MAX}
                  </span>
                </div>
              </label>
              {duplicateNewTrigger ? (
                <div className="text-xs text-[var(--danger)]" role="alert">
                  {t("settings.snippets.list.duplicateTrigger", {
                    defaultValue:
                      "A phrase key already uses that spoken trigger.",
                  })}
                </div>
              ) : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={closeAddDialog}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleAdd()}
                disabled={
                  snippetsUpdating ||
                  duplicateNewTrigger ||
                  !newTrigger.trim() ||
                  !newExpansion.trim()
                }
              >
                {t("settings.snippets.list.add")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );

  const renderMyKeys = () => (
    <div className="flat-card overflow-visible">
      {snippets.length === 0 ? (
        <EmptyState
          framed={false}
          icon={<WholeWord className="h-5 w-5" aria-hidden />}
          title={t("settings.snippets.list.empty")}
          description={t("settings.snippets.list.emptyDescription")}
          example={t("settings.snippets.list.emptyExample")}
          action={
            <Button
              type="button"
              size="sm"
              variant="primary-soft"
              onClick={openAddDialog}
            >
              {t("settings.snippets.list.add")}
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {snippets.map((snippet) => {
            const snippetEnabled = snippet.enabled ?? true;

            return (
              <div
                key={snippet.id}
                className={`space-y-1.5 px-5 py-3 transition-opacity ${
                  !snippetEnabled ? "opacity-50" : ""
                }`}
              >
                {editingId === snippet.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                        {t("settings.snippets.list.trigger")}
                      </span>
                      <input
                        ref={triggerInputRef}
                        type="text"
                        value={editTrigger}
                        onChange={(e) =>
                          setEditTrigger(e.target.value.slice(0, TRIGGER_MAX))
                        }
                        className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingId(null);
                          if (e.key === "Enter") void commitEdit();
                        }}
                      />
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-16 shrink-0 pt-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
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
                        className="min-w-0 flex-1 resize-y rounded-2xl border border-[var(--border)] bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
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
                        <Check className="mr-1 h-3.5 w-3.5" />
                        {t("common.save")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                        {t("settings.snippets.list.trigger")}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {snippet.trigger}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => startEdit(snippet)}
                          title={t("common.edit", {
                            defaultValue: "Edit",
                          })}
                          aria-label={t("common.edit", {
                            defaultValue: "Edit",
                          })}
                        >
                          <Pencil />
                        </Button>
                        <SwitchControl
                          checked={snippetEnabled}
                          onChange={(checked) =>
                            void handleToggle(snippet.id, checked)
                          }
                          size="compact"
                          frame="icon"
                          title={
                            snippetEnabled
                              ? t("common.disable", {
                                  defaultValue: "Disable",
                                })
                              : t("common.enable", {
                                  defaultValue: "Enable",
                                })
                          }
                          ariaLabel={
                            snippetEnabled
                              ? t("settings.snippets.list.disableAriaLabel", {
                                  trigger: snippet.trigger,
                                  defaultValue:
                                    "Disable phrase key: {{trigger}}",
                                })
                              : t("settings.snippets.list.enableAriaLabel", {
                                  trigger: snippet.trigger,
                                  defaultValue:
                                    "Enable phrase key: {{trigger}}",
                                })
                          }
                        />
                        <Button
                          type="button"
                          variant="danger-ghost"
                          size="icon-sm"
                          onClick={() => void handleDelete(snippet)}
                          title={t("common.delete")}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                        {t("settings.snippets.list.expansion")}
                      </span>
                      <span className="line-clamp-2 min-w-0 text-xs leading-relaxed text-[var(--muted)]">
                        {snippet.expansion}
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderImportedKeys = () => (
    <div
      className={[
        subtleCardClassName,
        "flex flex-col items-center justify-center gap-3 border-dashed text-center transition-[border-color,background-color,box-shadow] duration-150",
        isImportDragOver
          ? "border-[var(--accent)] bg-[var(--accent-soft,var(--panel-bg))] shadow-[var(--shadow-md,var(--shadow-sm))]"
          : "",
      ].join(" ")}
      style={{ minHeight: 220 }}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsImportDragOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsImportDragOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsImportDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsImportDragOver(false);
        void handleDroppedImport(event.dataTransfer.files?.[0]);
      }}
    >
      <div
        className="flex size-12 items-center justify-center rounded-full bg-[var(--input)] text-[var(--muted)]"
        aria-hidden="true"
      >
        {isImportDragOver ? <Upload size={22} /> : <FileJson size={22} />}
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-[var(--text)]">
          {t("settings.snippets.list.importDropHint", {
            defaultValue: "Drag & drop a phrase keys JSON file here",
          })}
        </div>
        <div className="text-xs text-[var(--muted)]">
          {t("dictate.fileTranscription.orLabel", { defaultValue: "or" })}
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={handleImport}
        disabled={snippetsUpdating}
      >
        {t("settings.snippets.list.pickImportFile", {
          defaultValue: "Pick JSON file",
        })}
      </Button>
      {importMessage ? (
        <div className="text-xs font-medium text-[var(--accent)]" role="status">
          {importMessage}
        </div>
      ) : null}
      {importError ? (
        <div
          className="max-w-[32rem] text-xs text-[var(--danger)]"
          role="alert"
        >
          {importError}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="w-full space-y-7">
      {addDialog}
      {showEnabledToggle && (
        <SettingsGroup title={t("settings.snippets.toggle.title")}>
          <PhraseKeysEnabledToggle descriptionMode="tooltip" grouped={true} />
        </SettingsGroup>
      )}

      {!showEnabledToggle ? (
        <SettingsGroup
          noCard
          title={t("settings.snippets.toggle.title")}
          description={t("settings.snippets.toggle.description")}
          showTitle={false}
          descriptionOnlyGap="controls"
        >
          {actionButtons}
        </SettingsGroup>
      ) : null}

      <section className="space-y-2">
        {showEnabledToggle ? (
          <div className="mb-3 flex min-w-0 items-center justify-between gap-3 px-5">
            <h2 className="min-w-0 truncate text-sm font-bold uppercase tracking-widest text-[var(--text)]">
              {t("settings.snippets.list.title")}
            </h2>
            <div className="flex shrink-0 gap-1">{actionButtons}</div>
          </div>
        ) : null}

        {view === "myKeys" ? renderMyKeys() : renderImportedKeys()}
      </section>
    </div>
  );
};
