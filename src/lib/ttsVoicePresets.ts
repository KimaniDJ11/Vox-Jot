import { invoke } from "@tauri-apps/api/core";

export type TtsStyleControlValue =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string };

export interface TtsVoiceStyleSettings {
  expressiveness: number;
  rate: number;
  advanced_overrides: Record<string, TtsStyleControlValue>;
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
  style: TtsVoiceStyleSettings;
}

export interface TtsVoicePresetInput {
  label?: string | null;
  provider_id: string;
  model_id: string;
  voice_id?: string | null;
  voice_profile_id?: string | null;
  voice_label_snapshot?: string | null;
  locale_snapshot?: string | null;
  style: TtsVoiceStyleSettings;
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

export async function previewTtsVoicePreset(presetId: string): Promise<void> {
  return invoke("preview_tts_voice_preset", { presetId });
}

export async function prepareSidecarEngine(
  providerId: string,
): Promise<void> {
  return invoke("prepare_sidecar_engine", { providerId });
}
