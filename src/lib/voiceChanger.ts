import { invoke } from "@tauri-apps/api/core";

export interface VoiceChangerResult {
  source_path: string;
  output_path: string;
  target_profile_label: string;
  provider_id: string;
  model_id: string;
}

export async function convertVoiceSample(
  sourcePath: string,
  profileId: string,
  tau: number,
): Promise<VoiceChangerResult> {
  return invoke("convert_voice_sample", {
    sourcePath,
    profileId,
    tau,
  });
}

export async function convertVoiceRecording(
  wavBytes: number[],
  profileId: string,
  tau: number,
): Promise<VoiceChangerResult> {
  return invoke("convert_voice_recording", {
    wavBytes,
    profileId,
    tau,
  });
}
