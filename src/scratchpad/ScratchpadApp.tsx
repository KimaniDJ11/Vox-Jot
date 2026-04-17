import React, { useEffect, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast, Toaster } from "sonner";
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
import { commands } from "@/bindings";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";
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
      <div className="flex items-center justify-center h-screen bg-[var(--bg)] text-[var(--muted)]">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="app-titlebar-safe-top flex h-screen flex-col bg-[var(--bg)] font-body text-[var(--text)]">
      <Toaster />
      {/* Title bar — same pattern as main app */}
      <header className="app-macos-titlebar-overlay" dir="ltr">
        <div className="app-macos-titlebar-overlay__traffic-shim" aria-hidden />
        <div className="app-macos-titlebar-overlay__leading app-no-drag flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="border-transparent p-1 text-[var(--muted)] hover:text-[var(--accent)]"
            onClick={() => void handleCreateNote()}
            aria-label={t("jotPad.newNote")}
            title={t("jotPad.newNote")}
          >
            <Plus className="shrink-0" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="border-transparent p-1 text-[var(--muted)] hover:text-[var(--accent)]"
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
            size="sm"
            className="border-transparent p-1 text-[var(--muted)] hover:text-[var(--accent)]"
            onClick={() => void handleStopSpeaking()}
            aria-label="Stop speaking"
            title="Stop speaking"
          >
            <Square className="shrink-0" aria-hidden />
          </Button>
        </div>
        <div
          className="app-macos-titlebar-overlay__drag"
          data-tauri-drag-region
          aria-hidden
        />
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Note list sidebar */}
        <div className="flex min-h-0 w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar-bg)]">
          {/* Notes list */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {notes.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">
                {t("jotPad.empty")}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 p-1.5">
                {notes.map((note) => {
                  const isActive = note.id === activeNoteId;
                  const displayTitle =
                    note.title ||
                    note.content.slice(0, 30) ||
                    t("jotPad.untitled");

                  return (
                    <div key={note.id} className="group relative">
                      <button
                        type="button"
                        className={`${interactiveFocusRingClass} ${minTapTargetHeightClass} flex w-full items-center gap-2 rounded-full px-2.5 py-2 pr-16 text-left text-sm transition-all ${
                          isActive
                            ? "bg-[var(--accent)] text-[var(--inverse-text)]"
                            : "text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text),transparent_93%)]"
                        }`}
                        onClick={() => {
                          saveNow();
                          void setEditorArmed(false);
                          setActiveNote(note.id);
                        }}
                      >
                        <FileText
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isActive
                              ? "text-[var(--inverse-text)]/70"
                              : "text-[var(--muted)]"
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate leading-tight">
                          {displayTitle}
                        </span>
                        {note.is_pinned && (
                          <Pin
                            className={`h-3 w-3 shrink-0 ${
                              isActive
                                ? "text-[var(--inverse-text)]/60"
                                : "text-[var(--muted)]"
                            }`}
                          />
                        )}
                      </button>

                      <div
                        className={`pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5 rounded opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
                          isActive ? "" : "bg-[var(--sidebar-bg)]"
                        }`}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className={`pointer-events-auto rounded-full border-transparent p-0.5 ${
                            isActive
                              ? "text-[var(--inverse-text)]/60 hover:text-[var(--inverse-text)]"
                              : "text-[var(--muted)] hover:text-[var(--text)]"
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void togglePin(note.id, !note.is_pinned);
                          }}
                          aria-label={
                            note.is_pinned ? t("jotPad.unpin") : t("jotPad.pin")
                          }
                          title={
                            note.is_pinned ? t("jotPad.unpin") : t("jotPad.pin")
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
                          className={`pointer-events-auto rounded-full border-transparent p-0.5 ${
                            isActive
                              ? "text-[var(--inverse-text)]/60 hover:text-[var(--danger)]"
                              : "text-[var(--muted)] hover:text-[var(--danger)]"
                          }`}
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
                })}
              </div>
            )}
          </div>
        </div>

        {/* Editor area */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeNote ? (
            <div className="flex-1 flex flex-col px-5 pb-4 min-h-0">
              {/* Title input */}
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                onFocus={() => void setEditorArmed(true)}
                placeholder={t("jotPad.titlePlaceholder")}
                className="w-full text-xl font-display font-bold bg-transparent border-none outline-none placeholder:text-[var(--muted)]/40 mb-2"
              />

              {/* Content textarea */}
              <textarea
                ref={contentRef}
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                onFocus={() => void setEditorArmed(true)}
                placeholder={t("jotPad.contentPlaceholder")}
                className="flex-1 w-full bg-transparent border-none outline-none resize-none text-sm leading-relaxed font-body placeholder:text-[var(--muted)]/40"
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-[var(--muted)]">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
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
