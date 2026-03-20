import { create } from "zustand";
import type { Note } from "@/bindings";
import { commands } from "@/bindings";

const ACTIVE_NOTE_KEY = "scratchpad_active_note_id";

function loadPersistedActiveNote(): number | null {
  try {
    const stored = localStorage.getItem(ACTIVE_NOTE_KEY);
    return stored ? Number(stored) : null;
  } catch {
    return null;
  }
}

function persistActiveNote(id: number | null) {
  try {
    if (id !== null) {
      localStorage.setItem(ACTIVE_NOTE_KEY, String(id));
    } else {
      localStorage.removeItem(ACTIVE_NOTE_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
}

interface NotesStore {
  notes: Note[];
  activeNoteId: number | null;
  isLoading: boolean;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  createNote: () => Promise<Note | null>;
  updateNote: (id: number, title: string, content: string) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  togglePin: (id: number, pinned: boolean) => Promise<void>;
  setActiveNote: (id: number | null) => void;
  getActiveNote: () => Note | null;
}

export const useNotesStore = create<NotesStore>()((set, get) => ({
  notes: [],
  activeNoteId: loadPersistedActiveNote(),
  isLoading: true,

  initialize: async () => {
    await get().refresh();
  },

  refresh: async () => {
    try {
      const result = await commands.getNotes();
      if (result.status === "ok") {
        const notes = result.data;
        set({ notes, isLoading: false });

        // Auto-select first note if none selected or selected was deleted
        const { activeNoteId } = get();
        if (
          activeNoteId === null ||
          !notes.some((n) => n.id === activeNoteId)
        ) {
          const newId = notes.length > 0 ? notes[0].id : null;
          set({ activeNoteId: newId });
          persistActiveNote(newId);
        }
      } else {
        console.error("Failed to load notes:", result.error);
        set({ isLoading: false });
      }
    } catch (error) {
      console.error("Failed to load notes:", error);
      set({ isLoading: false });
    }
  },

  createNote: async () => {
    try {
      const result = await commands.createNote("", "");
      if (result.status === "ok") {
        const note = result.data;
        await get().refresh();
        set({ activeNoteId: note.id });
        persistActiveNote(note.id);
        return note;
      }
      return null;
    } catch (error) {
      console.error("Failed to create note:", error);
      return null;
    }
  },

  updateNote: async (id, title, content) => {
    try {
      // Optimistic update
      set((state) => ({
        notes: state.notes.map((n) =>
          n.id === id ? { ...n, title, content } : n,
        ),
      }));
      await commands.updateNote(id, title, content);
    } catch (error) {
      console.error("Failed to update note:", error);
    }
  },

  deleteNote: async (id) => {
    try {
      const result = await commands.deleteNote(id);
      if (result.status === "ok") {
        const { activeNoteId, notes } = get();
        const remaining = notes.filter((n) => n.id !== id);
        const newActive =
          activeNoteId === id
            ? remaining.length > 0
              ? remaining[0].id
              : null
            : activeNoteId;
        set({ notes: remaining, activeNoteId: newActive });
        persistActiveNote(newActive);
      }
    } catch (error) {
      console.error("Failed to delete note:", error);
    }
  },

  togglePin: async (id, pinned) => {
    try {
      set((state) => ({
        notes: state.notes.map((n) =>
          n.id === id ? { ...n, is_pinned: pinned } : n,
        ),
      }));
      await commands.toggleNotePin(id, pinned);
      await get().refresh();
    } catch (error) {
      console.error("Failed to toggle pin:", error);
    }
  },

  setActiveNote: (id) => {
    set({ activeNoteId: id });
    persistActiveNote(id);
  },

  getActiveNote: () => {
    const { notes, activeNoteId } = get();
    return notes.find((n) => n.id === activeNoteId) ?? null;
  },
}));
