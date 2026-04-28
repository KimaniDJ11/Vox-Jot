import { invoke } from "@tauri-apps/api/core";

export interface TtsVoiceProfileDescriptor {
  id: string;
  label: string;
  description?: string | null;
  transcript?: string | null;
  compatible_provider_ids: string[];
  compatible_model_ids: string[];
  has_reference_audio: boolean;
  reference_audio_path?: string | null;
  sample_rate_hz?: number | null;
  ready: boolean;
  continuous_improvement_enabled: boolean;
  collected_audio_duration_secs: number;
  satisfactory_threshold_secs: number;
  fully_optimized: boolean;
}

export async function listTtsVoiceProfiles(): Promise<
  TtsVoiceProfileDescriptor[]
> {
  return invoke("list_tts_voice_profiles");
}

export async function createTtsVoiceProfile(
  label: string,
  description?: string | null,
  transcript?: string | null,
): Promise<TtsVoiceProfileDescriptor> {
  return invoke("create_tts_voice_profile", {
    label,
    description: description ?? null,
    transcript: transcript ?? null,
  });
}

export async function importTtsVoiceProfileSample(
  profileId: string,
  sourcePath: string,
  transcript?: string | null,
): Promise<TtsVoiceProfileDescriptor> {
  return invoke("import_tts_voice_profile_sample", {
    profileId,
    sourcePath,
    transcript: transcript ?? null,
  });
}

export async function deleteTtsVoiceProfile(profileId: string): Promise<void> {
  return invoke("delete_tts_voice_profile", { profileId });
}

export async function setActiveImprovementProfile(
  profileId: string,
  enabled: boolean,
): Promise<TtsVoiceProfileDescriptor> {
  return invoke("set_active_improvement_profile", { profileId, enabled });
}

export async function clearProfileCollectedData(
  profileId: string,
): Promise<TtsVoiceProfileDescriptor> {
  return invoke("clear_profile_collected_data", { profileId });
}
