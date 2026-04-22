import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  getNotes: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("@/bindings", () => ({
  commands: commandMocks,
}));

import { useNotesStore } from "@/scratchpad/notesStore";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
    },
  });
}

function resetStoreState() {
  useNotesStore.setState({
    notes: [],
    activeNoteId: null,
    isLoading: true,
  });
}

describe("notes store", () => {
  beforeEach(() => {
    resetStoreState();
    vi.clearAllMocks();
    installLocalStorageMock();
    localStorage.clear();
  });

  it("ignores invalid persisted active note ids", async () => {
    localStorage.setItem("scratchpad_active_note_id", "Infinity");

    vi.resetModules();
    const { useNotesStore: freshStore } = await import("@/scratchpad/notesStore");

    expect(freshStore.getState().activeNoteId).toBeNull();
    expect(localStorage.getItem("scratchpad_active_note_id")).toBeNull();
  });

  it("restores the previous note and refetches when updateNote fails", async () => {
    useNotesStore.setState({
      notes: [
        {
          id: 1,
          title: "Original title",
          content: "Original content",
          created_at: 0,
          updated_at: 0,
          is_pinned: false,
        } as never,
      ],
      activeNoteId: 1,
      isLoading: false,
    });

    commandMocks.updateNote.mockResolvedValue({
      status: "error",
      error: "backend rejected update",
    });
    commandMocks.getNotes.mockResolvedValue({
      status: "ok",
      data: [
        {
          id: 1,
          title: "Original title",
          content: "Original content",
          created_at: 0,
          updated_at: 0,
          is_pinned: false,
        },
      ],
    });

    await useNotesStore.getState().updateNote(1, "Draft title", "Draft body");

    expect(commandMocks.updateNote).toHaveBeenCalledWith(
      1,
      "Draft title",
      "Draft body",
    );
    expect(commandMocks.getNotes).toHaveBeenCalledTimes(1);

    const note = useNotesStore.getState().notes.find((item) => item.id === 1);
    expect(note?.title).toBe("Original title");
    expect(note?.content).toBe("Original content");
  });
});
