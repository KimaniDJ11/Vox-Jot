import type {
  TtsVoicePresetInput,
  TtsVoiceTuningSettings,
} from "@/lib/ttsVoicePresets";

export type TtsVoicePresetPatch = Omit<
  Partial<TtsVoicePresetInput>,
  "tuning"
> & {
  tuning?: Partial<TtsVoicePresetInput["tuning"]>;
};

export type VoiceArchitectDraftState = {
  presetId: string | null;
  providerId: string;
  modelId: string;
  voiceId: string;
  voiceProfileId: string;
  tuning: TtsVoiceTuningSettings;
};

export type VoiceArchitectUiDraftState = {
  saveProfileNameDraft: string;
  previewTextDraft: string;
  modelSearchQuery: string;
  createVoiceTool: "models" | "tuning";
};

export type VoiceCloningDraftState = {
  selectedCloneModelValue: string;
  selectedProfileId: string;
  voiceCloneTool: "models" | "profiles";
  modelSearchQuery: string;
  referenceAudioPathDraft: string;
  referenceTranscriptDraft: string;
};
