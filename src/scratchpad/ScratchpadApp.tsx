import React, { useEffect, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Plus, Trash2, Pin, PinOff, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useNotesStore } from "./notesStore";

const AUTO_SAVE_DELAY = 2000;

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
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const isMountedRef = useRef(false);

  // Initialize on mount
  useEffect(() => {
    initialize();
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

  const handleCreateNote = async () => {
    // Flush any pending save before creating
    saveNow();
    await createNote();
    // Focus the content area after creation
    setTimeout(() => contentRef.current?.focus(), 100);
  };

  const handleDeleteNote = async (id: number) => {
    await deleteNote(id);
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
    <div className="flex flex-col h-screen bg-[var(--bg)] text-[var(--text)] font-body" style={{ paddingTop: "max(36px, env(titlebar-area-height, 36px))" }}>
      {/* Title bar — same pattern as main app */}
      <header className="app-macos-titlebar-overlay" dir="ltr">
        <div
          className="app-macos-titlebar-overlay__traffic-shim"
          aria-hidden
        />
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
        </div>
        <div
          className="app-macos-titlebar-overlay__drag"
          data-tauri-drag-region
          aria-hidden
        />
      </header>

      <div className="flex flex-1 min-h-0">
      {/* Note list sidebar */}
      <div className="w-52 shrink-0 border-r border-[var(--border)] bg-[var(--sidebar-bg)] flex flex-col">
        {/* Notes list */}
        <div className="flex-1 overflow-y-auto">
          {notes.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--muted)]">
              {t("jotPad.empty")}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 p-1.5">
              {notes.map((note) => {
                const isActive = note.id === activeNoteId;
                const displayTitle =
                  note.title || note.content.slice(0, 30) || t("jotPad.untitled");

                return (
                  <button
                    key={note.id}
                    type="button"
                    className={`group relative flex items-center gap-2 w-full rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                      isActive
                        ? "bg-[var(--accent)] text-white"
                        : "text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text),transparent_93%)]"
                    }`}
                    onClick={() => {
                      // Flush save before switching
                      saveNow();
                      setActiveNote(note.id);
                    }}
                  >
                    <FileText
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isActive ? "text-white/70" : "text-[var(--muted)]"
                      }`}
                    />
                    <span className="truncate flex-1 min-w-0 leading-tight">
                      {displayTitle}
                    </span>
                    {note.is_pinned && (
                      <Pin
                        className={`h-3 w-3 shrink-0 ${
                          isActive ? "text-white/60" : "text-[var(--muted)]"
                        }`}
                      />
                    )}

                    {/* Hover actions */}
                    <div
                      className={`absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                        isActive ? "" : "bg-[var(--sidebar-bg)]"
                      } rounded`}
                    >
                      <button
                        type="button"
                        className={`p-0.5 rounded transition-colors ${
                          isActive
                            ? "text-white/60 hover:text-white"
                            : "text-[var(--muted)] hover:text-[var(--text)]"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void togglePin(note.id, !note.is_pinned);
                        }}
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
                      </button>
                      <button
                        type="button"
                        className={`p-0.5 rounded transition-colors ${
                          isActive
                            ? "text-white/60 hover:text-red-300"
                            : "text-[var(--muted)] hover:text-red-500"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteNote(note.id);
                        }}
                        title={t("common.delete")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeNote ? (
          <div className="flex-1 flex flex-col px-5 pb-4 min-h-0">
            {/* Title input */}
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder={t("jotPad.titlePlaceholder")}
              className="w-full text-xl font-display font-bold bg-transparent border-none outline-none placeholder:text-[var(--muted)]/40 mb-2"
            />

            {/* Content textarea */}
            <textarea
              ref={contentRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={t("jotPad.contentPlaceholder")}
              className="flex-1 w-full bg-transparent border-none outline-none resize-none text-sm leading-relaxed font-body placeholder:text-[var(--muted)]/40"
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-[var(--muted)]">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t("jotPad.noNoteSelected")}</p>
              <button
                type="button"
                onClick={() => void handleCreateNote()}
                className="mt-3 text-sm text-[var(--accent)] hover:underline"
              >
                {t("jotPad.createFirst")}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

export default ScratchpadApp;
