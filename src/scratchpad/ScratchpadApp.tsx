import React, { useEffect, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast, Toaster } from "sonner";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  Plus,
  Trash2,
  Pin,
  PinOff,
  FileText,
  Play,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { HighlightTrack } from "@/motion/HighlightTrack";
import { Kbd } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/Skeleton";
import { crisp } from "@/motion/springs";
import { useMacosWindowFullscreen } from "@/hooks/useMacosWindowFullscreen";
import { commands } from "@/bindings";
import {
  interactiveFocusRingClass,
  titleBarOverlayButtonFocusClass,
} from "@/lib/interactiveFocus";
import { formatTime } from "@/utils/dateFormat";
import { useNotesStore } from "./notesStore";

const AUTO_SAVE_DELAY = 2000;
const SCRATCHPAD_INSERT_EVENT = "scratchpad-insert-text";
const SCRATCHPAD_SELECT_NOTE_EVENT = "scratchpad-select-note";

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
  const [hoveredNoteId, setHoveredNoteId] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const isMountedRef = useRef(false);
  const activeNoteIdRef = useRef<number | null>(null);
  const titleValueRef = useRef("");
  const contentValueRef = useRef("");

  const setEditorArmed = useCallback(async (armed: boolean) => {
    const result = await commands.setScratchpadEditorArmed(armed);
    if (result.status !== "ok") {
      console.error(
        "Failed to update Jot Pad editor target state:",
        result.error,
      );
    }
  }, []);

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
    const clearArmedState = () => {
      void setEditorArmed(false);
    };

    window.addEventListener("blur", clearArmedState);
    document.addEventListener("visibilitychange", clearArmedState);

    return () => {
      window.removeEventListener("blur", clearArmedState);
      document.removeEventListener("visibilitychange", clearArmedState);
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

  // Auto-save with debounce
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

  // Immediate save (Cmd+S)
  const saveNow = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (activeNoteId !== null) {
      updateNote(activeNoteId, title, content);
    }
  }, [activeNoteId, title, content, updateNote]);

  // Keyboard shortcut: Cmd+S / Ctrl+S
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

  // Flush pending save on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Flush pending save when window is hidden (e.g. tray toggle, close button)
  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();
    const unlisten = appWindow.onCloseRequested(() => {
      saveNow();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [saveNow]);

  // Also flush on browser visibility change (covers minimize/hide on all platforms)
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
      if (!editor) {
        return;
      }

      editor.focus();
      editor.setSelectionRange(caretPosition, caretPosition);
    }, 0);
  }, []);

  const focusTitleAt = useCallback((caretPosition: number) => {
    setTimeout(() => {
      const input = titleInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      input.setSelectionRange(caretPosition, caretPosition);
    }, 0);
  }, []);

  const handleScratchpadInsert = useCallback(
    async (insertedText: string) => {
      if (!insertedText) {
        return;
      }

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
      if (!Number.isFinite(noteId)) {
        return;
      }

      saveNow();
      void setEditorArmed(false);
      setActiveNote(noteId);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [saveNow, setActiveNote, setEditorArmed]);

  const macosWindowFullscreen = useMacosWindowFullscreen();

  const handleCreateNote = async () => {
    // Flush any pending save before creating
    saveNow();
    void setEditorArmed(false);
    await createNote();
    // Focus the content area after creation
    setTimeout(() => contentRef.current?.focus(), 100);
  };

  const handleDeleteNote = async (id: number) => {
    await deleteNote(id);
  };

  const handleSpeakNote = async () => {
    if (!content.trim()) {
      return;
    }

    const result = await commands.ttsSpeak(
      content,
      null,
      null,
      "scratchpad_note",
      false,
    );
    if (result.status !== "ok") {
      toast.error(result.error);
    }
  };

  const handleStopSpeaking = async () => {
    const result = await commands.ttsStop();
    if (result.status !== "ok") {
      toast.error(result.error);
    }
  };

  const activeNote = getActiveNote();

  if (isLoading) {
    return (
      <div className="app-titlebar-safe-top flex h-screen flex-col bg-transparent text-[var(--muted)]">
        <div className="flex flex-1 gap-4 px-4 pb-4">
          <div className="card-linear w-56 p-3">
            <div className="space-y-2">
              <Skeleton className="h-9 w-full rounded-2xl" />
              <Skeleton className="h-9 w-full rounded-2xl" />
              <Skeleton className="h-9 w-4/5 rounded-2xl" />
            </div>
          </div>
          <div className="card-linear flex-1 p-5">
            <div className="space-y-4">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-titlebar-safe-top flex h-screen flex-col bg-transparent font-body text-[var(--text)]">
      <Toaster />
      <header
        className={`app-macos-titlebar-overlay${macosWindowFullscreen ? " app-macos-titlebar-overlay--fullscreen" : ""}`}
        dir="ltr"
      >
        <div className="app-macos-titlebar-overlay__traffic-shim" aria-hidden />
        <div className="app-macos-titlebar-overlay__leading app-no-drag flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={`border-transparent text-[var(--muted)] hover:text-[var(--accent)] ${titleBarOverlayButtonFocusClass}`}
            onClick={() => void handleCreateNote()}
            aria-label={t("jotPad.newNote")}
            title={t("jotPad.newNote")}
          >
            <Plus className="shrink-0" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={`border-transparent text-[var(--muted)] hover:text-[var(--accent)] ${titleBarOverlayButtonFocusClass}`}
            onClick={() => void handleSpeakNote()}
            aria-label="Play note"
            title="Play note"
            disabled={!content.trim()}
          >
            <Play className="shrink-0" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={`border-transparent text-[var(--muted)] hover:text-[var(--accent)] ${titleBarOverlayButtonFocusClass}`}
            onClick={() => void handleStopSpeaking()}
            aria-label="Stop speaking"
            title="Stop speaking"
          >
            <Square className="shrink-0" aria-hidden />
          </Button>
        </div>
        <div className="app-macos-titlebar-overlay__center">
          <div className="card-linear--elevated app-no-drag flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium text-[var(--text)]">
            <span>{t("jotPad.title")}</span>
            <span className="text-[var(--muted)]">{t("common.save")}</span>
            <Kbd>{navigator.platform.includes("Mac") ? "⌘" : "ctrl"}</Kbd>
            <Kbd>S</Kbd>
          </div>
        </div>
        <div
          className="app-macos-titlebar-overlay__drag"
          data-tauri-drag-region
          aria-hidden
        />
      </header>

      <div className="flex flex-1 min-h-0 gap-3 px-3 pb-3">
        <div className="card-linear flex min-h-0 w-[260px] shrink-0 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--sidebar-bg)_72%,transparent)]">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {notes.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">
                {t("jotPad.empty")}
              </div>
            ) : (
              <LayoutGroup id="scratchpad-notes">
                <div className="flex flex-col gap-1 p-2">
                  {notes.map((note) => {
                    const isActive = note.id === activeNoteId;
                    const displayTitle =
                      note.title ||
                      note.content.slice(0, 42) ||
                      t("jotPad.untitled");
                    const displayPreview =
                      note.content.trim() || t("jotPad.contentPlaceholder");
                    const noteTime = formatTime(
                      String(note.updated_at),
                      navigator.language,
                    );

                    return (
                      <div key={note.id} className="group relative">
                        <button
                          type="button"
                          onPointerEnter={() => setHoveredNoteId(note.id)}
                          onFocus={() => setHoveredNoteId(note.id)}
                          className={`${interactiveFocusRingClass} relative flex min-h-[56px] w-full items-start gap-3 rounded-2xl px-3 py-3 pr-20 text-left text-sm text-[var(--text)]`}
                          onClick={() => {
                            saveNow();
                            void setEditorArmed(false);
                            setActiveNote(note.id);
                          }}
                        >
                          {isActive ? (
                            <motion.span
                              layoutId="scratchpad-note-active"
                              transition={crisp}
                              className="absolute inset-0 rounded-2xl bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] ring-1 ring-[var(--ring-hairline)]"
                            />
                          ) : (
                            <HighlightTrack
                              active={hoveredNoteId === note.id}
                              layoutId="scratchpad-note-hover"
                              variant="surface"
                              insetClass="inset-0"
                              radiusClass="rounded-2xl"
                            />
                          )}
                          {isActive && (
                            <motion.span
                              layoutId="scratchpad-note-rail"
                              transition={crisp}
                              className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-[var(--accent)]"
                            />
                          )}
                          <FileText className="relative z-10 mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />
                          <div className="relative z-10 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-semibold leading-5">
                                {displayTitle}
                              </span>
                              {note.is_pinned && (
                                <Pin className="h-3 w-3 shrink-0 text-[var(--muted)]" />
                              )}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-[var(--muted)]">
                              {displayPreview}
                            </p>
                          </div>
                          <span className="relative z-10 shrink-0 text-[11px] text-[var(--text-subtle)] tabular">
                            {noteTime}
                          </span>
                        </button>

                        <motion.div
                          initial={false}
                          animate={{
                            opacity:
                              hoveredNoteId === note.id || isActive ? 1 : 0,
                            x: hoveredNoteId === note.id || isActive ? 0 : 6,
                          }}
                          transition={crisp}
                          className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1"
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="pointer-events-auto rounded-full border-transparent bg-[color-mix(in_srgb,var(--bg)_88%,transparent)]"
                            onClick={(e) => {
                              e.stopPropagation();
                              void togglePin(note.id, !note.is_pinned);
                            }}
                            aria-label={
                              note.is_pinned
                                ? t("jotPad.unpin")
                                : t("jotPad.pin")
                            }
                            title={
                              note.is_pinned
                                ? t("jotPad.unpin")
                                : t("jotPad.pin")
                            }
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
                            className="pointer-events-auto rounded-full border-transparent bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] hover:text-[var(--danger)]"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteNote(note.id);
                            }}
                            aria-label={t("common.delete")}
                            title={t("common.delete")}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </motion.div>
                      </div>
                    );
                  })}
                </div>
              </LayoutGroup>
            )}
          </div>
        </div>

        <div className="card-linear flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--panel-bg)_84%,transparent)]">
          {activeNote ? (
            <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-subtle)]">
                  <span>
                    {t("jotPad.lastEdited", { defaultValue: "Last edited" })}
                  </span>
                  <Kbd>
                    {formatTime(
                      String(activeNote.updated_at),
                      navigator.language,
                    )}
                  </Kbd>
                </div>
                <div className="text-[12px] text-[var(--muted)]">
                  {t("jotPad.charCount", {
                    count: content.trim().length,
                    defaultValue: "{{count}} chars",
                  })}
                </div>
              </div>
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                onFocus={() => void setEditorArmed(true)}
                placeholder={t("jotPad.titlePlaceholder")}
                className="mb-3 w-full border-none bg-transparent text-[24px] font-display font-semibold tracking-[-0.01em] outline-none placeholder:text-[var(--muted)]/65"
              />

              <textarea
                ref={contentRef}
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                onFocus={() => void setEditorArmed(true)}
                placeholder={t("jotPad.contentPlaceholder")}
                className="flex-1 w-full resize-none border-none bg-transparent text-[14px] leading-7 outline-none placeholder:text-[var(--muted)]/65"
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-[var(--text)]">
                <FileText className="text-[var(--muted)] mx-auto mb-3 h-10 w-10 opacity-[0.82]" />
                <p className="text-sm">{t("jotPad.noNoteSelected")}</p>
                <Button
                  type="button"
                  onClick={() => void handleCreateNote()}
                  variant="primary-soft"
                  size="sm"
                  className="mt-3"
                >
                  {t("jotPad.createFirst")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScratchpadApp;
