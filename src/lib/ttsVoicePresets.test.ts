import { describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  createTtsVoicePreset,
  deleteTtsVoicePreset,
  listTtsVoicePresets,
  prepareSidecarEngine,
  previewTtsVoicePreset,
} from "@/lib/ttsVoicePresets";

const presetInput = {
  label: "Warm narrator",
  provider_id: "kokoro",
  model_id: "kokoro-v1",
  voice_id: "af_heart",
  tuning: {
    tempo_rate: 1,
    expressiveness: 0.5,
    exaggeration: 0.1,
    randomness: 0.2,
    guidance: 0.3,
    stability: 0.7,
    repetition_penalty: 1,
  },
};

describe("ttsVoicePresets", () => {
  it("invokes TTS preset commands with the expected payloads", async () => {
    invokeMock.mockResolvedValueOnce([{ id: "preset-1" }]);
    invokeMock.mockResolvedValueOnce({ id: "preset-2" });

    await expect(listTtsVoicePresets()).resolves.toEqual([{ id: "preset-1" }]);
    await expect(createTtsVoicePreset(presetInput)).resolves.toEqual({
      id: "preset-2",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_tts_voice_presets", {});
    expect(invokeMock).toHaveBeenNthCalledWith(2, "create_tts_voice_preset", {
      input: presetInput,
    });
  });

  it("normalizes string and message-style invoke errors", async () => {
    invokeMock.mockRejectedValueOnce("preset preview failed");
    invokeMock.mockRejectedValueOnce({ message: "engine bootstrap failed" });

    await expect(previewTtsVoicePreset("preset-1")).rejects.toThrow(
      "preset preview failed",
    );
    await expect(prepareSidecarEngine("kokoro")).rejects.toThrow(
      "engine bootstrap failed",
    );
  });

  it("falls back to serializing unknown invoke errors", async () => {
    invokeMock.mockRejectedValueOnce({ code: "E_DELETE", retryable: false });

    await expect(deleteTtsVoicePreset("preset-1")).rejects.toThrow(
      JSON.stringify({ code: "E_DELETE", retryable: false }),
    );
  });
});
