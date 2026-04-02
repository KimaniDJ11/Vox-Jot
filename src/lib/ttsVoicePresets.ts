import { invoke } from "@tauri-apps/api/core";

export type TtsStyleControlValue =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string };

export interface TtsVoiceTuningSettings {
  tempo_rate: number;
  expressiveness: number;
  exaggeration: number;
  randomness: number;
  guidance: number;
  stability: number;
  repetition_penalty: number;
  style_instructions?: string | null;
}

export interface TtsVoicePreset {
  id: string;
  label: string;
  provider_id: string;
  model_id: string;
  voice_id?: string | null;
  voice_profile_id?: string | null;
  voice_label_snapshot?: string | null;
  locale_snapshot?: string | null;
  tuning: TtsVoiceTuningSettings;
}

export interface TtsVoicePresetInput {
  label?: string | null;
  provider_id: string;
  model_id: string;
  voice_id?: string | null;
  voice_profile_id?: string | null;
  voice_label_snapshot?: string | null;
  locale_snapshot?: string | null;
  tuning: TtsVoiceTuningSettings;
}

function normalizeInvokeError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" && error.trim()) {
    return new Error(error);
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return new Error((error as { message: string }).message);
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(fallback);
  }
}

async function invokeTts<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeInvokeError(error, `TTS command '${command}' failed.`);
  }
}

export async function listTtsVoicePresets(): Promise<TtsVoicePreset[]> {
  return invokeTts("list_tts_voice_presets");
}

export async function createTtsVoicePreset(
  input: TtsVoicePresetInput,
): Promise<TtsVoicePreset> {
  return invokeTts("create_tts_voice_preset", { input });
}

export async function updateTtsVoicePreset(
  presetId: string,
  input: TtsVoicePresetInput,
): Promise<TtsVoicePreset> {
  return invokeTts("update_tts_voice_preset", { presetId, input });
}

export async function deleteTtsVoicePreset(presetId: string): Promise<void> {
  return invokeTts("delete_tts_voice_preset", { presetId });
}

export async function setActiveTtsVoicePreset(
  presetId: string,
): Promise<TtsVoicePreset> {
  return invokeTts("set_active_tts_voice_preset", { presetId });
}

export async function previewTtsVoicePreset(
  presetId: string,
  previewText?: string | null,
): Promise<void> {
  return invokeTts("preview_tts_voice_preset", { presetId, previewText });
}

export async function previewTtsVoicePresetDraft(
  input: TtsVoicePresetInput,
  previewText?: string | null,
): Promise<void> {
  return invokeTts("preview_tts_voice_preset_draft", { input, previewText });
}

export async function prepareSidecarEngine(providerId: string): Promise<void> {
  return invokeTts("prepare_sidecar_engine", { providerId });
}
