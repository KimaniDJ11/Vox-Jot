import { describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
import {
  readReaderDocument,
  removeStoredReaderDocument,
  renderReaderPage,
  synthesizeReaderUnit,
  exportReaderAudiobook,
  speakReaderTextWithPreset,
} from "./readerCommands";

describe("Reader native contracts", () => {
  it("uses the existing command names, argument keys and default narration settings", async () => {
    native.invoke.mockResolvedValue(null);
    await readReaderDocument("/docs/book.pdf");
    await removeStoredReaderDocument("book");
    const unit = { id: "unit", text: "Hello", preset_id: "voice" };
    await synthesizeReaderUnit("book", unit, 1.25, "en");
    await speakReaderTextWithPreset("  Hello  ", "voice");
    expect(native.invoke.mock.calls).toEqual([
      ["read_reader_document", { sourcePath: "/docs/book.pdf" }],
      ["remove_reader_document", { id: "book" }],
      [
        "synthesize_reader_audio_unit",
        { documentId: "book", unit, playbackRate: 1.25, language: "en" },
      ],
      [
        "tts_speak_reader",
        {
          text: "Hello",
          locale: null,
          presetId: "voice",
          playbackRate: 1,
          trigger: "reader_document",
          rememberLastOutput: false,
        },
      ],
    ]);
  });

  it("exports ordered chapters with the selected voice, format and document metadata", async () => {
    native.invoke.mockResolvedValue({ output_path: "/export/book.m4b" });
    const request = {
      documentId: "book",
      chapters: [
        {
          title: "Chapter one",
          units: [{ id: "u", text: "Hello", preset_id: "voice" }],
        },
      ],
      outputPath: "/export/book.m4b",
      format: "m4b" as const,
      playbackRate: 1,
      language: null,
      title: "Book",
      author: null,
      coverDataUrl: null,
    };
    await expect(exportReaderAudiobook(request)).resolves.toEqual({
      output_path: "/export/book.m4b",
    });
    expect(native.invoke).toHaveBeenCalledWith(
      "export_reader_audiobook",
      request,
    );
  });

  it("converts native page geometry to the renderer contract", async () => {
    native.invoke.mockResolvedValue({
      index: 0,
      width: 600,
      height: 800,
      scale: 2,
      image_data_url: "data:image/png;base64,example",
      words: [{ text: "Hello", x0: 1, y0: 2, x1: 3, y1: 4 }],
    });
    const page = await renderReaderPage("book", 0);
    expect(page.imageDataUrl).toBe("data:image/png;base64,example");
    expect(page.words[0]).toEqual({
      text: "Hello",
      x0: 1,
      y0: 2,
      x1: 3,
      y1: 4,
    });
    expect(native.invoke).toHaveBeenCalledWith("render_reader_page", {
      documentId: "book",
      pageIndex: 0,
      scale: 2,
    });
  });

  it("surfaces native failures and invalid page geometry", async () => {
    native.invoke.mockRejectedValue("Document missing");
    await expect(readReaderDocument("missing.pdf")).rejects.toThrow(
      "Document missing",
    );
    native.invoke.mockResolvedValue({
      index: 0,
      width: null,
      height: 800,
      scale: 2,
      words: [],
    });
    await expect(renderReaderPage("book", 0)).rejects.toThrow(
      "invalid geometry",
    );
  });
});
