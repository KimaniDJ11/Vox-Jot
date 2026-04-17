import type { AppSettings as Settings, VoiceInfo } from "@/bindings";
import type {
  CatalogModelDescriptor,
  ModelPlatformOverview,
} from "@/lib/modelPlatform";

export type LanguageSyncTrigger = "auto" | "manual";

const AUTO_TTS_PROVIDER_PREFERENCE: Record<string, number> = {
  openvoice: 5,
  kokoro: 4,
  xtts: 3,
  sherpa_pack: 2,
  system_builtin: 1,
};

const EXCLUDED_AUTO_TTS_PROVIDER_IDS = new Set([
  "qwen3_native",
  "local_sidecar_api",
  "tada_local",
  "hf_s2s_local",
  "fish_speech_local",
]);

export function appLanguageToSttLanguage(
  appLanguage: string | null | undefined,
) {
  const normalized = (appLanguage ?? "").trim();
  if (!normalized) {
    return "auto";
  }
  if (normalized === "zh") {
    return "zh-Hans";
  }
  if (normalized === "zh-TW") {
    return "zh-Hant";
  }
  return normalized.toLowerCase().split("-")[0] || "auto";
}

export function appLanguageToTtsTarget(appLanguage: string | null | undefined) {
  const normalized = (appLanguage ?? "").trim();
  if (!normalized) {
    return "en";
  }
  if (normalized === "zh" || normalized === "zh-TW") {
    return "zh";
  }
  return normalized.toLowerCase().split("-")[0] || "en";
}

export function getActiveTtsPreset(settings: Settings | null | undefined) {
  if (!settings?.tts_voice_presets?.length) {
    return null;
  }
  if (settings.tts_active_preset_id) {
    return (
      settings.tts_voice_presets.find(
        (preset) => preset.id === settings.tts_active_preset_id,
      ) ?? settings.tts_voice_presets[0]
    );
  }
  return settings.tts_voice_presets[0];
}

export function getCurrentTtsVoiceId(settings: Settings | null | undefined) {
  return (
    getActiveTtsPreset(settings)?.voice_id ??
    settings?.selected_tts_voice_id ??
    settings?.tts_default_voice_id ??
    null
  );
}

function normalizeLanguageTag(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/_/g, "-");
}

function baseLanguageTag(value: string | null | undefined) {
  const normalized = normalizeLanguageTag(value);
  if (!normalized) {
    return "";
  }
  if (normalized === "zh-hans" || normalized === "zh-hant") {
    return normalized;
  }
  return normalized.split("-")[0] || normalized;
}

function languageCompatibilityScore(
  targetLanguage: string,
  candidateLanguage: string,
) {
  const target = normalizeLanguageTag(targetLanguage);
  const candidate = normalizeLanguageTag(candidateLanguage);
  if (!target || !candidate) {
    return 0;
  }
  if (target === candidate) {
    return 3;
  }
  if (
    (target === "zh" && (candidate === "zh" || candidate === "zh-cn")) ||
    (candidate === "zh" && (target === "zh" || target === "zh-cn"))
  ) {
    return 3;
  }
  const targetBase = baseLanguageTag(target);
  const candidateBase = baseLanguageTag(candidate);
  if (targetBase && targetBase === candidateBase) {
    return 2;
  }
  return 0;
}

function modelLanguageCandidates(model: CatalogModelDescriptor) {
  if (model.supported_languages.length > 0) {
    return model.supported_languages;
  }
  if (model.locale) {
    return [model.locale];
  }
  return [];
}

export function modelSupportsLanguage(
  model: CatalogModelDescriptor | null | undefined,
  targetLanguage: string,
) {
  if (!model) {
    return false;
  }
  return (
    Math.max(
      0,
      ...modelLanguageCandidates(model).map((language) =>
        languageCompatibilityScore(targetLanguage, language),
      ),
    ) > 0
  );
}

function modelLanguageScore(
  model: CatalogModelDescriptor,
  targetLanguage: string,
) {
  return Math.max(
    0,
    ...modelLanguageCandidates(model).map((language) =>
      languageCompatibilityScore(targetLanguage, language),
    ),
  );
}

function providerPreference(providerId: string) {
  return AUTO_TTS_PROVIDER_PREFERENCE[providerId] ?? 0;
}

export function pickTtsModelForLanguage(
  overview: ModelPlatformOverview,
  settings: Settings | null | undefined,
  targetLanguage: string,
  trigger: LanguageSyncTrigger,
) {
  const currentProviderId = overview.selection.selected_tts_provider_id;
  const currentModelId = overview.selection.selected_tts_model_id;
  const currentModel =
    overview.tts.models.find(
      (model) =>
        model.provider_id === currentProviderId && model.id === currentModelId,
    ) ?? null;

  if (
    trigger === "auto" &&
    currentModel &&
    !currentModel.capabilities.coming_soon &&
    currentModel.runnable &&
    modelSupportsLanguage(currentModel, targetLanguage)
  ) {
    return currentModel;
  }

  const candidates = overview.tts.models
    .filter(
      (model) =>
        model.runnable &&
        !model.capabilities.coming_soon &&
        !EXCLUDED_AUTO_TTS_PROVIDER_IDS.has(model.provider_id) &&
        providerPreference(model.provider_id) > 0,
    )
    .map((model) => ({
      model,
      languageScore: modelLanguageScore(model, targetLanguage),
      providerScore: providerPreference(model.provider_id),
    }))
    .filter((entry) => entry.languageScore > 0)
    .sort((left, right) => {
      if (right.languageScore !== left.languageScore) {
        return right.languageScore - left.languageScore;
      }
      if (right.providerScore !== left.providerScore) {
        return right.providerScore - left.providerScore;
      }
      if (left.model.provider_id !== right.model.provider_id) {
        return left.model.provider_id.localeCompare(right.model.provider_id);
      }
      return left.model.id.localeCompare(right.model.id);
    });

  return candidates[0]?.model ?? null;
}

function providerDefaultVoiceId(providerId: string, targetLanguage: string) {
  const base = baseLanguageTag(targetLanguage);
  if (providerId === "kokoro") {
    return "af_heart";
  }
  if (providerId === "openvoice") {
    return base === "en" ? "en-default" : null;
  }
  if (providerId === "xtts") {
    return base === "zh" ? "sample:zh-cn" : `sample:${base}`;
  }
  return null;
}

function voiceLanguageScore(voice: VoiceInfo, targetLanguage: string) {
  return languageCompatibilityScore(targetLanguage, voice.locale ?? "");
}

export function voiceMatchesLanguage(
  voice: VoiceInfo | null | undefined,
  targetLanguage: string,
) {
  return !!voice && voiceLanguageScore(voice, targetLanguage) > 0;
}

export function pickTtsVoiceForLanguage(options: {
  voices: VoiceInfo[];
  providerId: string;
  targetLanguage: string;
  currentVoiceId?: string | null;
  preserveCurrentVoice?: boolean;
}) {
  const {
    voices,
    providerId,
    targetLanguage,
    currentVoiceId = null,
    preserveCurrentVoice = false,
  } = options;

  const currentVoice =
    (currentVoiceId
      ? voices.find((voice) => voice.id === currentVoiceId)
      : null) ?? null;
  if (
    preserveCurrentVoice &&
    currentVoice &&
    voiceMatchesLanguage(currentVoice, targetLanguage)
  ) {
    return currentVoice;
  }

  const defaultVoiceId = providerDefaultVoiceId(providerId, targetLanguage);
  const ranked = voices
    .map((voice) => ({
      voice,
      languageScore: voiceLanguageScore(voice, targetLanguage),
      defaultScore: voice.id === defaultVoiceId ? 1 : 0,
    }))
    .sort((left, right) => {
      if (right.languageScore !== left.languageScore) {
        return right.languageScore - left.languageScore;
      }
      if (right.defaultScore !== left.defaultScore) {
        return right.defaultScore - left.defaultScore;
      }
      return left.voice.id.localeCompare(right.voice.id);
    });

  if (ranked[0]?.languageScore > 0) {
    return ranked[0].voice;
  }

  if (defaultVoiceId) {
    return voices.find((voice) => voice.id === defaultVoiceId) ?? null;
  }

  return null;
}
