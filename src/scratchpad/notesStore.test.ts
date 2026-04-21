import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  getNotes: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("@/bindings", () => ({
  commands: commandMocks,
}));

import { useNotesStore } from "@/scratchpad/notesStore";

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
