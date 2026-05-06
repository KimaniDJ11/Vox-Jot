import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import type {
  VoiceArchitectDraftState,
  VoiceArchitectUiDraftState,
  VoiceCloningDraftState,
} from "./types";
import { DEFAULT_TTS_PREVIEW_TEXT, defaultVoiceTuning } from "./utils";

let cachedVoiceArchitectDraft: VoiceArchitectDraftState | null = null;

const voiceArchitectUiDraftStorageKey = "vox-jot-create-voice-draft-v1";
const voiceCloningDraftStorageKey = "vox-jot-voice-cloning-draft-v1";

const defaultVoiceArchitectUiDraft: VoiceArchitectUiDraftState = {
  saveProfileNameDraft: "",
  previewTextDraft: DEFAULT_TTS_PREVIEW_TEXT,
  modelSearchQuery: "",
  createVoiceTool: "models",
};

const defaultVoiceCloningDraft: VoiceCloningDraftState = {
  selectedCloneModelValue: "__none__",
  selectedProfileId: "__none__",
  voiceCloneTool: "models",
  modelSearchQuery: "",
  referenceAudioPathDraft: "",
  referenceTranscriptDraft: "",
};

export function buildVoiceArchitectDraftFromPreset(
  preset: TtsVoicePreset | null | undefined,
): VoiceArchitectDraftState {
  return {
    presetId: preset?.id ?? null,
    providerId: preset?.provider_id ?? "",
    modelId: preset?.model_id ?? "",
    voiceId: preset?.voice_id ?? "__auto__",
    voiceProfileId: preset?.voice_profile_id ?? "__none__",
    tuning: { ...(preset?.tuning ?? defaultVoiceTuning()) },
  };
}

export function getCachedVoiceArchitectDraft(): VoiceArchitectDraftState | null {
  return cachedVoiceArchitectDraft;
}

export function saveVoiceArchitectDraft(draft: VoiceArchitectDraftState) {
  cachedVoiceArchitectDraft = {
    ...draft,
    tuning: { ...draft.tuning },
  };
}

export function readVoiceArchitectUiDraft(): VoiceArchitectUiDraftState {
  if (typeof window === "undefined") {
    return defaultVoiceArchitectUiDraft;
  }

  try {
    const rawDraft = window.localStorage.getItem(
      voiceArchitectUiDraftStorageKey,
    );
    if (!rawDraft) {
      return defaultVoiceArchitectUiDraft;
    }
    return normalizeVoiceArchitectUiDraft(
      JSON.parse(rawDraft) as Partial<VoiceArchitectUiDraftState>,
    );
  } catch (error) {
    console.warn("Failed to read Create Voices draft:", error);
    return defaultVoiceArchitectUiDraft;
  }
}

export function writeVoiceArchitectUiDraft(draft: VoiceArchitectUiDraftState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      voiceArchitectUiDraftStorageKey,
      JSON.stringify(normalizeVoiceArchitectUiDraft(draft)),
    );
  } catch (error) {
    console.warn("Failed to store Create Voices draft:", error);
  }
}

function normalizeVoiceArchitectUiDraft(
  draft: Partial<VoiceArchitectUiDraftState>,
): VoiceArchitectUiDraftState {
  return {
    saveProfileNameDraft:
      typeof draft.saveProfileNameDraft === "string"
        ? draft.saveProfileNameDraft
        : defaultVoiceArchitectUiDraft.saveProfileNameDraft,
    previewTextDraft:
      typeof draft.previewTextDraft === "string"
        ? draft.previewTextDraft
        : defaultVoiceArchitectUiDraft.previewTextDraft,
    modelSearchQuery:
      typeof draft.modelSearchQuery === "string"
        ? draft.modelSearchQuery
        : defaultVoiceArchitectUiDraft.modelSearchQuery,
    createVoiceTool:
      draft.createVoiceTool === "tuning"
        ? "tuning"
        : defaultVoiceArchitectUiDraft.createVoiceTool,
  };
}

export function readVoiceCloningDraft(): VoiceCloningDraftState {
  if (typeof window === "undefined") {
    return defaultVoiceCloningDraft;
  }

  try {
    const rawDraft = window.localStorage.getItem(voiceCloningDraftStorageKey);
    if (!rawDraft) {
      return defaultVoiceCloningDraft;
    }
    return normalizeVoiceCloningDraft(
      JSON.parse(rawDraft) as Partial<VoiceCloningDraftState>,
    );
  } catch (error) {
    console.warn("Failed to read Voice Cloning draft:", error);
    return defaultVoiceCloningDraft;
  }
}

export function writeVoiceCloningDraft(draft: VoiceCloningDraftState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      voiceCloningDraftStorageKey,
      JSON.stringify(normalizeVoiceCloningDraft(draft)),
    );
  } catch (error) {
    console.warn("Failed to store Voice Cloning draft:", error);
  }
}

function normalizeVoiceCloningDraft(
  draft: Partial<VoiceCloningDraftState>,
): VoiceCloningDraftState {
  return {
    selectedCloneModelValue:
      typeof draft.selectedCloneModelValue === "string"
        ? draft.selectedCloneModelValue
        : defaultVoiceCloningDraft.selectedCloneModelValue,
    selectedProfileId:
      typeof draft.selectedProfileId === "string"
        ? draft.selectedProfileId
        : defaultVoiceCloningDraft.selectedProfileId,
    voiceCloneTool:
      draft.voiceCloneTool === "profiles"
        ? "profiles"
        : defaultVoiceCloningDraft.voiceCloneTool,
    modelSearchQuery:
      typeof draft.modelSearchQuery === "string"
        ? draft.modelSearchQuery
        : defaultVoiceCloningDraft.modelSearchQuery,
    referenceAudioPathDraft:
      typeof draft.referenceAudioPathDraft === "string"
        ? draft.referenceAudioPathDraft
        : defaultVoiceCloningDraft.referenceAudioPathDraft,
    referenceTranscriptDraft:
      typeof draft.referenceTranscriptDraft === "string"
        ? draft.referenceTranscriptDraft
        : defaultVoiceCloningDraft.referenceTranscriptDraft,
  };
}
