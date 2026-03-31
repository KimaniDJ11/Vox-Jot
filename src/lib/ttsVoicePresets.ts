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

export async function listTtsVoicePresets(): Promise<TtsVoicePreset[]> {
  return invoke("list_tts_voice_presets");
}

export async function createTtsVoicePreset(
  input: TtsVoicePresetInput,
): Promise<TtsVoicePreset> {
  return invoke("create_tts_voice_preset", { input });
}

export async function updateTtsVoicePreset(
  presetId: string,
  input: TtsVoicePresetInput,
): Promise<TtsVoicePreset> {
  return invoke("update_tts_voice_preset", { presetId, input });
}

export async function deleteTtsVoicePreset(presetId: string): Promise<void> {
  return invoke("delete_tts_voice_preset", { presetId });
}

export async function setActiveTtsVoicePreset(
  presetId: string,
): Promise<TtsVoicePreset> {
  return invoke("set_active_tts_voice_preset", { presetId });
}

export async function previewTtsVoicePreset(
  presetId: string,
  previewText?: string | null,
): Promise<void> {
  return invoke("preview_tts_voice_preset", { presetId, previewText });
}

export async function prepareSidecarEngine(providerId: string): Promise<void> {
  return invoke("prepare_sidecar_engine", { providerId });
}
