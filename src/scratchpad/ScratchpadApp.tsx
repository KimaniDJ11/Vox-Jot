import React, {
  useEffect,
  useCallback,
  useRef,
  useState,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast, Toaster } from "sonner";
import { motion } from "framer-motion";
import { Plus, Trash2, Pin, PinOff, FileText, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useApplyAppearanceSettings } from "@/hooks/useApplyAppearanceSettings";
import { useMacosWindowFullscreen } from "@/hooks/useMacosWindowFullscreen";
import { useSettingsSlice } from "@/hooks/useSettings";
import { commands } from "@/bindings";
import { titleBarOverlayButtonFocusClass } from "@/lib/interactiveFocus";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
import { formatTime } from "@/utils/dateFormat";
import { useNotesStore } from "./notesStore";

const AUTO_SAVE_DELAY = 2000;
const SCRATCHPAD_INSERT_EVENT = "scratchpad-insert-text";
const SCRATCHPAD_SELECT_NOTE_EVENT = "scratchpad-select-note";

const NO_DRAG_SELECTOR = [
  ".app-no-drag",
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[contenteditable='true']",
].join(",");

function setPanelBackgroundDrag(enabled: boolean) {
  void commands
    .setScratchpadTitlebarDragEnabled(enabled)
    .then((result) => {
      if (result.status !== "ok") {
        console.warn(
          "Failed to update Jot Pad titlebar drag state:",
          result.error,
        );
      }
    })
    .catch((error) => {
      console.warn("Failed to update Jot Pad titlebar drag state:", error);
    });
}

function insertAtSelection(
  currentValue: string,
  insertedText: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
) {
  const start = selectionStart ?? currentValue.length;
  const end = selectionEnd ?? currentValue.length;
  const nextValue =
    currentValue.slice(0, start) + insertedText + currentValue.slice(end);

  return {
    nextValue,
    caretPosition: start + insertedText.length,
  };
}

function shouldStartPointerDrag(
  event: React.PointerEvent<HTMLElement>,
): boolean {
  if (event.button !== 0 || event.buttons !== 1) {
    return false;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }
  return !target.closest(NO_DRAG_SELECTOR);
}

const ScratchpadApp: React.FC = () => {
  const { t } = useTranslation();
  const {
    notes,
    activeNoteId,
    isLoading,
    initialize,
    createNote,
    updateNote,
    deleteNote,
    togglePin,
    setActiveNote,
    getActiveNote,
    refresh,
  } = useNotesStore();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const isMountedRef = useRef(false);
  const activeNoteIdRef = useRef<number | null>(null);
  const titleValueRef = useRef("");
  const contentValueRef = useRef("");
  const { app_theme: appTheme, app_font_scale: appFontScale } =
    useSettingsSlice(["app_theme", "app_font_scale"] as const);

  useApplyAppearanceSettings(appTheme, appFontScale);
  const macosWindowFullscreen = useMacosWindowFullscreen();

  const setEditorArmed = useCallback(async (armed: boolean) => {
    const result = await commands.setScratchpadEditorArmed(armed);
    if (result.status !== "ok") {
      console.error(
        "Failed to update Jot Pad editor target state:",
        result.error,
      );
    }
  }, []);

  const armJotPadTarget = useCallback(() => {
    void setEditorArmed(true);
  }, [setEditorArmed]);

  // Initialize on mount
  useEffect(() => {
    void (async () => {
      await initialize();
      const result = await commands.consumeScratchpadTargetNote();
      if (result.status === "ok" && result.data !== null) {
        setActiveNote(result.data);
      }
    })();
  }, [initialize]);

  // Listen for backend notes-updated events
  useEffect(() => {
    const unlisten = listen("notes-updated", () => {
      refresh();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen<string>("tts-error", (event) => {
      toast.error(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      void setEditorArmed(true);
    };
    const handleBlur = () => {
      void setEditorArmed(false);
    };
    const handleVisibility = () => {
      if (document.hidden) {
        void setEditorArmed(false);
      }
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);

    if (document.hasFocus() && !document.hidden) {
      void setEditorArmed(true);
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
      void setEditorArmed(false);
    };
  }, [setEditorArmed]);

  // Sync editor state when active note changes
  useEffect(() => {
    const note = getActiveNote();
    if (note) {
      setTitle(note.title);
      setContent(note.content);
    } else {
      setTitle("");
      setContent("");
    }
  }, [activeNoteId, notes, getActiveNote]);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);

  useEffect(() => {
    titleValueRef.current = title;
  }, [title]);

  useEffect(() => {
    contentValueRef.current = content;
  }, [content]);

  const scheduleSave = useCallback(
    (noteId: number, newTitle: string, newContent: string) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        updateNote(noteId, newTitle, newContent);
      }, AUTO_SAVE_DELAY);
    },
    [updateNote],
  );

  const saveNow = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (activeNoteId !== null) {
      updateNote(activeNoteId, title, content);
    }
  }, [activeNoteId, title, content, updateNote]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveNow]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();
    const unlisten = appWindow.onCloseRequested(() => {
      saveNow();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [saveNow]);

  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        saveNow();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [saveNow]);

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (activeNoteId !== null) {
      scheduleSave(activeNoteId, newTitle, content);
    }
  };

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    if (activeNoteId !== null) {
      scheduleSave(activeNoteId, title, newContent);
    }
  };

  const focusContentAt = useCallback((caretPosition: number) => {
    setTimeout(() => {
      const editor = contentRef.current;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(caretPosition, caretPosition);
    }, 0);
  }, []);

  const focusTitleAt = useCallback((caretPosition: number) => {
    setTimeout(() => {
      const input = titleInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(caretPosition, caretPosition);
    }, 0);
  }, []);

  const handleScratchpadInsert = useCallback(
    async (insertedText: string) => {
      if (!insertedText) return;

      const existingNoteId = activeNoteIdRef.current;
      if (existingNoteId === null) {
        const createdNote = await createNote("", insertedText);
        if (!createdNote) {
          toast.error("Failed to create a Jot Pad note for dictation.");
          return;
        }
        setTitle("");
        setContent(insertedText);
        titleValueRef.current = "";
        contentValueRef.current = insertedText;
        focusContentAt(insertedText.length);
        return;
      }

      const activeElement = document.activeElement;
      const titleInput = titleInputRef.current;
      const contentInput = contentRef.current;

      if (activeElement === titleInput && titleInput) {
        const { nextValue, caretPosition } = insertAtSelection(
          titleValueRef.current,
          insertedText,
          titleInput.selectionStart,
          titleInput.selectionEnd,
        );
        setTitle(nextValue);
        titleValueRef.current = nextValue;
        scheduleSave(existingNoteId, nextValue, contentValueRef.current);
        focusTitleAt(caretPosition);
        return;
      }

      const { nextValue, caretPosition } = insertAtSelection(
        contentValueRef.current,
        insertedText,
        contentInput?.selectionStart,
        contentInput?.selectionEnd,
      );
      setContent(nextValue);
      contentValueRef.current = nextValue;
      scheduleSave(existingNoteId, titleValueRef.current, nextValue);
      focusContentAt(caretPosition);
    },
    [createNote, focusContentAt, focusTitleAt, scheduleSave],
  );

  useEffect(() => {
    const unlisten = listen<string>(SCRATCHPAD_INSERT_EVENT, (event) => {
      void handleScratchpadInsert(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleScratchpadInsert]);

  useEffect(() => {
    const unlisten = listen<number>(SCRATCHPAD_SELECT_NOTE_EVENT, (event) => {
      const noteId = Number(event.payload);
      if (!Number.isFinite(noteId)) return;
      saveNow();
      void setEditorArmed(true);
      setActiveNote(noteId);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [saveNow, setActiveNote, setEditorArmed]);

  const handleCreateNote = async () => {
    saveNow();
    void setEditorArmed(false);
    await createNote();
    setTimeout(() => titleInputRef.current?.focus(), 100);
  };

  const handleDeleteNote = async (id: number) => {
    const note = notes.find((candidate) => candidate.id === id);
    const noteTitle = note?.title.trim() || t("jotPad.untitledNote");
    if (!confirmDestructiveAction(t("jotPad.deleteConfirm", { noteTitle }))) {
      return;
    }
    await deleteNote(id);
  };

  const focusContentEndSoon = useCallback(() => {
    setTimeout(() => {
      const editor = contentRef.current;
      if (!editor) return;
      editor.focus();
      const caretPosition = editor.value.length;
      editor.setSelectionRange(caretPosition, caretPosition);
      void setEditorArmed(true);
    }, 50);
  }, [setEditorArmed]);

  const handleTitlebarPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!shouldStartPointerDrag(event)) return;
      event.preventDefault();
      void getCurrentWindow()
        .startDragging()
        .catch((error) => {
          console.warn("Failed to start window drag:", error);
        });
    },
    [],
  );

  const activeNote = getActiveNote();

  const { pinnedNotes, otherNotes } = useMemo(() => {
    const pinned = notes.filter((n) => n.is_pinned);
    const others = notes.filter((n) => !n.is_pinned);
    return { pinnedNotes: pinned, otherNotes: others };
  }, [notes]);

  const headerTitle =
    activeNote && (title.trim() || content.trim().slice(0, 36))
      ? title.trim() || content.trim().slice(0, 36)
      : t("jotPad.title");

  if (isLoading) {
    return (
      <div className="jotpad-shell">
        <Toaster />
        <header
          className={`jotpad-titlebar${macosWindowFullscreen ? " jotpad-titlebar--fullscreen" : ""}`}
        >
          <div className="jotpad-titlebar__traffic-shim" aria-hidden />
          <div className="jotpad-titlebar__center">
            <span className="jotpad-titlebar__title">{t("jotPad.title")}</span>
          </div>
        </header>
        <div className="jotpad-body">
          <aside className="jotpad-sidebar">
            <div className="jotpad-sidebar__scroll space-y-2">
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-14 w-4/5 rounded-xl" />
            </div>
          </aside>
          <section className="jotpad-editor">
            <div className="jotpad-editor__inner">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </section>
        </div>
      </div>
    );
  }

  const renderNoteCard = (note: (typeof notes)[number]) => {
    const isActive = note.id === activeNoteId;
    const displayTitle =
      note.title.trim() ||
      note.content.trim().slice(0, 42) ||
      t("jotPad.untitled");
    const displayPreview =
      note.content.trim() || t("jotPad.contentPlaceholder");
    const noteTime = formatTime(String(note.updated_at), navigator.language);

    return (
      <div
        key={note.id}
        className={`jotpad-note-card-shell ${isActive ? "is-active" : ""}`}
      >
        <button
          type="button"
          className={`jotpad-note-card ${isActive ? "is-active" : ""} ${titleBarOverlayButtonFocusClass}`}
          onClick={() => {
            saveNow();
            setActiveNote(note.id);
            focusContentEndSoon();
          }}
        >
          <div className="jotpad-note-card__title-row">
            <span className="jotpad-note-card__title">{displayTitle}</span>
            {note.is_pinned && (
              <Pin
                className="jotpad-note-card__pin h-3 w-3 shrink-0"
                aria-hidden
              />
            )}
            <span className="jotpad-note-card__time">{noteTime}</span>
          </div>
          <p className="jotpad-note-card__preview">{displayPreview}</p>
        </button>

        <div className="jotpad-note-card__actions">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="border-transparent bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] backdrop-blur"
            onClick={(e) => {
              e.stopPropagation();
              void togglePin(note.id, !note.is_pinned);
            }}
            aria-label={note.is_pinned ? t("jotPad.unpin") : t("jotPad.pin")}
            title={note.is_pinned ? t("jotPad.unpin") : t("jotPad.pin")}
          >
            {note.is_pinned ? (
              <PinOff className="h-3 w-3" />
            ) : (
              <Pin className="h-3 w-3" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="border-transparent bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] backdrop-blur hover:text-[var(--danger)]"
            onClick={(e) => {
              e.stopPropagation();
              void handleDeleteNote(note.id);
            }}
            aria-label={t("common.delete")}
            title={t("common.delete")}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div
      className="jotpad-shell font-body"
      onPointerDownCapture={armJotPadTarget}
      onFocusCapture={armJotPadTarget}
    >
      <Toaster />

      <header
        className={`jotpad-titlebar${macosWindowFullscreen ? " jotpad-titlebar--fullscreen" : ""}`}
        data-tauri-drag-region
        onPointerDown={handleTitlebarPointerDown}
        onPointerEnter={() => setPanelBackgroundDrag(true)}
        onPointerLeave={() => setPanelBackgroundDrag(false)}
        dir="ltr"
      >
        <div
          className="jotpad-titlebar__drag-layer"
          data-tauri-drag-region
          aria-hidden
        />
        <div
          className="jotpad-titlebar__traffic-shim"
          data-tauri-drag-region
          aria-hidden
        />

        <div className="jotpad-titlebar__actions">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={`app-no-drag border-transparent text-[var(--muted)] hover:text-[var(--accent)] ${titleBarOverlayButtonFocusClass}`}
            onPointerEnter={() => setPanelBackgroundDrag(false)}
            onPointerLeave={() => setPanelBackgroundDrag(true)}
            onClick={() => void handleCreateNote()}
            aria-label={t("jotPad.newNote")}
            title={t("jotPad.newNote")}
          >
            <Plus className="shrink-0" aria-hidden />
          </Button>
        </div>

        <div className="jotpad-titlebar__center" data-tauri-drag-region>
          <motion.span
            key={headerTitle}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="jotpad-titlebar__title"
          >
            {headerTitle}
          </motion.span>
        </div>

        <div className="jotpad-titlebar__spacer" data-tauri-drag-region />
      </header>

      <div className="jotpad-body">
        <aside className="jotpad-sidebar">
          <div className="jotpad-sidebar__scroll">
            {notes.length === 0 ? (
              <EmptyState
                framed={false}
                icon={<Pencil className="h-4 w-4" aria-hidden />}
                title={t("jotPad.empty")}
                description={t("jotPad.emptyDescription")}
                example={t("jotPad.emptyExample")}
                action={
                  <Button
                    type="button"
                    onClick={() => void handleCreateNote()}
                    variant="primary-soft"
                    size="sm"
                  >
                    {t("jotPad.createFirst")}
                  </Button>
                }
                className="px-2 py-6"
              />
            ) : (
              <div className="flex flex-col gap-1">
                {pinnedNotes.length > 0 && (
                  <>
                    <div className="jotpad-sidebar__group-label">
                      {t("jotPad.pinned")}
                    </div>
                    {pinnedNotes.map(renderNoteCard)}
                    {otherNotes.length > 0 && (
                      <div className="jotpad-sidebar__group-label">
                        {t("jotPad.notes")}
                      </div>
                    )}
                  </>
                )}
                {otherNotes.map(renderNoteCard)}
              </div>
            )}
          </div>
        </aside>

        <section className="jotpad-editor">
          {activeNote ? (
            <>
              <div className="jotpad-editor__meta">
                <div className="flex items-center gap-2">
                  <span className="uppercase tracking-[0.08em] text-[10px]">
                    {t("jotPad.lastEdited")}
                  </span>
                  <span className="jotpad-editor__meta-time">
                    {formatTime(
                      String(activeNote.updated_at),
                      navigator.language,
                    )}
                  </span>
                </div>
                <div>
                  {t("jotPad.charCount", { count: content.trim().length })}
                </div>
              </div>

              <div className="jotpad-editor__scroll">
                <div className="jotpad-editor__inner">
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    onFocus={() => void setEditorArmed(true)}
                    placeholder={t("jotPad.titlePlaceholder")}
                    className="jotpad-editor__title-input"
                  />
                  <textarea
                    ref={contentRef}
                    value={content}
                    onChange={(e) => handleContentChange(e.target.value)}
                    onFocus={() => void setEditorArmed(true)}
                    placeholder={t("jotPad.contentPlaceholder")}
                    className="jotpad-editor__content-input"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="jotpad-editor__empty">
              <EmptyState
                framed={false}
                icon={<FileText className="h-5 w-5" aria-hidden />}
                title={t("jotPad.noNoteSelected")}
                description={t("jotPad.emptyDescription")}
                example={t("jotPad.emptyExample")}
                action={
                  <Button
                    type="button"
                    onClick={() => void handleCreateNote()}
                    variant="primary-soft"
                    size="sm"
                  >
                    {t("jotPad.createFirst")}
                  </Button>
                }
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ScratchpadApp;
