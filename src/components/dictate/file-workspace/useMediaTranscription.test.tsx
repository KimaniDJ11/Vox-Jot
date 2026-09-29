import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  cleanAudioFile: vi.fn(),
  transcribeFile: vi.fn(),
  exportSubtitlesSrt: vi.fn(),
  exportSubtitlesVtt: vi.fn(),
}));
const dialogs = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: native }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogs);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options: { defaultValue: string }) =>
      options.defaultValue,
  }),
}));
import { useMediaTranscription } from "./useMediaTranscription";

describe("media transcription workflow", () => {
  let root: Root;
  let host: HTMLDivElement;
  let workflow: ReturnType<typeof useMediaTranscription>;
  const result = {
    text: "Hello",
    segments: [{ text: "Hello", start: 0, end: 1 }],
    emotion: null,
  };
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    root = createRoot(host);
    function Harness() {
      workflow = useMediaTranscription();
      return null;
    }
    native.transcribeFile.mockResolvedValue({ status: "ok", data: result });
    await act(async () => root.render(<Harness />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("cleans before transcription and ignores a second request while busy", async () => {
    let finish!: (value: unknown) => void;
    native.cleanAudioFile.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => workflow.setProcessingMode("clean_transcribe"));
    let running!: Promise<void>;
    await act(async () => {
      running = workflow.runMediaAction("/audio/input.wav");
      await workflow.runMediaAction("/audio/duplicate.wav");
    });
    expect(workflow.isRunning).toBe(true);
    expect(native.cleanAudioFile).toHaveBeenCalledTimes(1);
    expect(native.transcribeFile).not.toHaveBeenCalled();
    await act(async () => {
      finish({ status: "ok", data: { output_path: "/audio/cleaned.wav" } });
      await running;
    });
    expect(native.transcribeFile).toHaveBeenCalledWith("/audio/cleaned.wav");
    expect(workflow).toMatchObject({
      selectedPath: "/audio/input.wav",
      cleanedPath: "/audio/cleaned.wav",
      transcription: "Hello",
      isRunning: false,
    });
  });

  it("shows cleaning errors, releases busy state and permits retry", async () => {
    native.cleanAudioFile.mockResolvedValue({
      status: "error",
      error: "Cannot clean this file",
    });
    await act(async () => workflow.setProcessingMode("clean_transcribe"));
    await act(async () => workflow.runMediaAction("bad.wav"));
    expect(workflow.error).toBe("Cannot clean this file");
    expect(workflow.isRunning).toBe(false);
    expect(native.transcribeFile).not.toHaveBeenCalled();
    await act(async () => workflow.setProcessingMode("transcribe"));
    await act(async () => workflow.runMediaAction("good.wav"));
    expect(workflow.error).toBe("");
    expect(workflow.transcription).toBe("Hello");
  });

  it("keeps file-picker cancellation inert and exports the timed transcript", async () => {
    dialogs.open.mockResolvedValue(null);
    await act(async () => workflow.pickFile());
    expect(native.transcribeFile).not.toHaveBeenCalled();
    await act(async () => workflow.runMediaAction("/audio/talk.wav"));
    dialogs.save.mockResolvedValue("/exports/talk.vtt");
    native.exportSubtitlesVtt.mockResolvedValue({ status: "ok", data: null });
    await act(async () => workflow.exportSubtitles("vtt"));
    expect(dialogs.save).toHaveBeenCalledWith({
      defaultPath: "talk.vtt",
      filters: [{ name: "VTT", extensions: ["vtt"] }],
    });
    expect(native.exportSubtitlesVtt).toHaveBeenCalledWith(
      result.segments,
      "/exports/talk.vtt",
    );
  });
});
