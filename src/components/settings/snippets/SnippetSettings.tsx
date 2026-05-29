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
  ArrowRight,
  Ban,
  Trash2,
  Pencil,
  Check,
  WholeWord,
  Upload,
  FileJson,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Snippet } from "@/bindings";
import { commands } from "@/bindings";
import { ActionIconButton } from "../../ui/ActionIconButton";
import { Button } from "../../ui/Button";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { subtleCardClassName } from "../../ui/subtleCard";
import { useSettings } from "../../../hooks/useSettings";
import { PhraseKeysEnabledToggle } from "../PhraseKeysEnabledToggle";
import { pickJsonFileText } from "@/lib/fileIo";
import { modal } from "@/motion/springs";
import { handleDialogKeyDown, useDialogFocusTrap } from "@/lib/ui/focusTrap";

const TRIGGER_MAX = 60;
const EXPANSION_MAX = 4000;
const IMPORT_MAX_BYTES = 3 * 1024 * 1024;
const phraseKeysEmptySurfaceClassName =
  "flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg)] px-5 py-8 text-center";

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
  const [openDisableId, setOpenDisableId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const triggerInputRef = useRef<HTMLInputElement>(null);
  const newTriggerRef = useRef<HTMLInputElement>(null);
  const addDialogRef = useRef<HTMLDivElement>(null);
  const disablePopoverRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!openDisableId) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        disablePopoverRef.current?.contains(event.target as Node) ||
        (event.target as HTMLElement).closest(
          "[data-phrase-key-disable-trigger]",
        )
      ) {
        return;
      }

      setOpenDisableId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openDisableId]);

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
    await saveSnippets(snippets.filter((s) => s.id !== snippet.id));
    setConfirmingDeleteId((current) =>
      current === snippet.id ? null : current,
    );
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await saveSnippets(
      snippets.map((s) => (s.id === id ? { ...s, enabled } : s)),
    );
    setOpenDisableId((current) => (current === id ? null : current));
  };

  const startEdit = (snippet: Snippet) => {
    setOpenDisableId(null);
    setConfirmingDeleteId(null);
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
          result.data > 0
            ? t("settings.snippets.list.importSuccess", {
                count: result.data,
                defaultValue:
                  result.data === 1
                    ? "Imported 1 phrase key."
                    : "Imported {{count}} phrase keys.",
              })
            : t("settings.snippets.list.importNoNewKeys", {
                defaultValue: "No new phrase keys to import.",
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
            aria-label={t("settings.snippets.list.add")}
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
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t("settings.snippets.list.trigger")}
                </span>
                <input
                  ref={newTriggerRef}
                  data-add-phrase-key-trigger="true"
                  type="text"
                  value={newTrigger}
                  onChange={(e) =>
                    setNewTrigger(e.target.value.slice(0, TRIGGER_MAX))
                  }
                  placeholder={t("settings.snippets.list.triggerPlaceholder")}
                  className="w-full rounded-full border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t("settings.snippets.list.expansion")}
                </span>
                <textarea
                  value={newExpansion}
                  onChange={(e) =>
                    setNewExpansion(e.target.value.slice(0, EXPANSION_MAX))
                  }
                  placeholder={t("settings.snippets.list.expansionPlaceholder")}
                  rows={5}
                  className="w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
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
    <div className={[subtleCardClassName, "overflow-visible"].join(" ")}>
      {snippets.length === 0 ? (
        <div className={phraseKeysEmptySurfaceClassName}>
          <div
            className="flex size-11 items-center justify-center rounded-full bg-[var(--input)] text-[var(--muted)]"
            aria-hidden="true"
          >
            <WholeWord size={20} />
          </div>
          <div className="mt-6 text-sm font-semibold text-[var(--text)]">
            {t("settings.snippets.list.empty")}
          </div>
          <p className="mt-3 max-w-md text-xs leading-5 text-[var(--muted)]">
            {t("settings.snippets.list.emptyExample")}
          </p>
          <div className="mt-5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={openAddDialog}
            >
              {t("settings.snippets.list.add")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="-mx-5 -my-4 divide-y divide-[var(--border)]">
          {snippets.map((snippet) => {
            const snippetEnabled = snippet.enabled ?? true;
            const disableOpen = openDisableId === snippet.id;
            const confirmingDelete = confirmingDeleteId === snippet.id;
            const actionClusterClassName = "flex shrink-0 items-center gap-1.5";
            const revealedActionClassName = `transition-opacity duration-150 ${
              disableOpen || confirmingDelete
                ? "opacity-100"
                : "opacity-0 group-hover/phrase-key-row:opacity-100 group-focus-within/phrase-key-row:opacity-100"
            }`;
            const disableActionClassName = `transition-opacity duration-150 ${
              !snippetEnabled || disableOpen
                ? "opacity-100"
                : "opacity-0 group-hover/phrase-key-row:opacity-100 group-focus-within/phrase-key-row:opacity-100"
            }`;

            return (
              <div
                key={snippet.id}
                className={`group/phrase-key-row relative space-y-1.5 overflow-visible px-5 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text)_4%,transparent)] ${
                  !snippetEnabled
                    ? "bg-[color-mix(in_srgb,var(--text)_3%,transparent)]"
                    : ""
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
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {t("settings.snippets.list.trigger")}
                    </span>
                    <span className="min-w-[4rem] max-w-[35%] truncate text-sm font-semibold text-[var(--text)]">
                      {snippet.trigger}
                    </span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-[var(--muted)]"
                      aria-hidden
                    />
                    <span className="sr-only">
                      {t("settings.snippets.list.expansion")}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]"
                      title={snippet.expansion}
                    >
                      {snippet.expansion}
                    </span>
                    <div className={actionClusterClassName}>
                      {confirmingDelete ? (
                        <>
                          <ActionIconButton
                            tone="confirm"
                            onClick={() => void handleDelete(snippet)}
                            title={t("common.delete")}
                            aria-label={t(
                              "settings.snippets.list.deleteConfirm",
                              {
                                trigger: snippet.trigger,
                                defaultValue:
                                  'Delete phrase key "{{trigger}}"?',
                              },
                            )}
                          >
                            <Trash2 aria-hidden />
                          </ActionIconButton>
                          <ActionIconButton
                            onClick={() => setConfirmingDeleteId(null)}
                            title={t("common.cancel")}
                            aria-label={t("common.cancel")}
                          >
                            <X aria-hidden />
                          </ActionIconButton>
                        </>
                      ) : (
                        <>
                          <ActionIconButton
                            className={revealedActionClassName}
                            onClick={() => startEdit(snippet)}
                            title={t("common.edit", {
                              defaultValue: "Edit",
                            })}
                            aria-label={t("common.edit", {
                              defaultValue: "Edit",
                            })}
                          >
                            <Pencil aria-hidden />
                          </ActionIconButton>
                          <div className="relative">
                            <button
                              type="button"
                              data-phrase-key-disable-trigger
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${disableActionClassName} ${
                                disableOpen
                                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                                  : "text-[var(--text)]"
                              }`}
                              onClick={() =>
                                setOpenDisableId((current) =>
                                  current === snippet.id ? null : snippet.id,
                                )
                              }
                              aria-haspopup="dialog"
                              aria-expanded={disableOpen}
                              aria-label={t(
                                "settings.snippets.list.disableMenu.open",
                                {
                                  trigger: snippet.trigger,
                                  defaultValue: "Phrase key disable options",
                                },
                              )}
                              title={t(
                                "settings.snippets.list.disableMenu.open",
                                {
                                  trigger: snippet.trigger,
                                  defaultValue: "Phrase key disable options",
                                },
                              )}
                            >
                              {snippetEnabled ? (
                                <SlidersHorizontal
                                  className="h-[18px] w-[18px]"
                                  aria-hidden
                                />
                              ) : (
                                <Ban
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
                                  "settings.snippets.list.disableMenu.title",
                                  {
                                    defaultValue: "Disable options",
                                  },
                                )}
                                className="absolute right-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-3rem))] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-left shadow-[var(--shadow-lg)]"
                              >
                                <div className="mb-3 flex items-center justify-between gap-2">
                                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                                    {t(
                                      "settings.snippets.list.disableMenu.title",
                                      {
                                        defaultValue: "Disable options",
                                      },
                                    )}
                                  </p>
                                  <ActionIconButton
                                    type="button"
                                    onClick={() => setOpenDisableId(null)}
                                    aria-label={t("common.close", {
                                      defaultValue: "Close",
                                    })}
                                    title={t("common.close", {
                                      defaultValue: "Close",
                                    })}
                                  >
                                    <X aria-hidden />
                                  </ActionIconButton>
                                </div>

                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                  onClick={() =>
                                    void handleToggle(
                                      snippet.id,
                                      !snippetEnabled,
                                    )
                                  }
                                >
                                  <span>
                                    {snippetEnabled
                                      ? t(
                                          "settings.snippets.list.disableMenu.disable",
                                          {
                                            defaultValue: "Disable phrase key",
                                          },
                                        )
                                      : t(
                                          "settings.snippets.list.disableMenu.enable",
                                          {
                                            defaultValue: "Enable phrase key",
                                          },
                                        )}
                                  </span>
                                  <Ban
                                    className="h-4 w-4 text-[var(--muted)]"
                                    aria-hidden
                                  />
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <ActionIconButton
                            tone="danger"
                            className={revealedActionClassName}
                            onClick={() => {
                              setOpenDisableId(null);
                              setConfirmingDeleteId(snippet.id);
                            }}
                            title={t("common.delete")}
                            aria-label={t(
                              "settings.snippets.list.deleteConfirm",
                              {
                                trigger: snippet.trigger,
                                defaultValue:
                                  'Delete phrase key "{{trigger}}"?',
                              },
                            )}
                          >
                            <Trash2 aria-hidden />
                          </ActionIconButton>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderImportedKeys = () => (
    <div className={[subtleCardClassName, "space-y-3"].join(" ")}>
      <div
        className={[
          phraseKeysEmptySurfaceClassName,
          "gap-3 transition-[border-color,background-color,box-shadow] duration-150",
          isImportDragOver
            ? "border-[var(--accent)] bg-[var(--accent-soft,var(--panel-bg))] shadow-[var(--shadow-md,var(--shadow-sm))]"
            : "",
        ].join(" ")}
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
          className="flex size-11 items-center justify-center rounded-full bg-[var(--input)] text-[var(--muted)]"
          aria-hidden="true"
        >
          {isImportDragOver ? <Upload size={20} /> : <FileJson size={20} />}
        </div>
        <div className="space-y-1">
          <div className="text-sm font-semibold text-[var(--text)]">
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
          size="sm"
          variant="secondary"
          onClick={handleImport}
          disabled={snippetsUpdating}
        >
          {t("settings.snippets.list.pickImportFile", {
            defaultValue: "Pick JSON file",
          })}
        </Button>
      </div>
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
