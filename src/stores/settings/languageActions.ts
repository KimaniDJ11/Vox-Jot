import i18n from "@/i18n";
import { commands } from "@/bindings";
import type {
  TtsVoicePreset,
  TtsVoicePresetInput,
  VoiceInfo,
} from "@/bindings";
import {
  getModelPlatformOverview,
  setTtsPlatformSelection,
} from "@/lib/modelPlatform";
import {
  appLanguageToSttLanguage,
  appLanguageToTtsTarget,
  getActiveTtsPreset,
  getCurrentTtsVoiceId,
  modelSupportsLanguage,
  pickTtsModelForLanguage,
  pickTtsVoiceForLanguage,
} from "@/lib/languageSync";
import { unwrapCommandResult } from "@/lib/commandResult";
import { reportSettingError } from "./reportSettingError";
import type { SettingsActionContext, SettingsStore } from "./types";

function presetInputWithVoice(
  preset: TtsVoicePreset,
  voice: Pick<
    TtsVoicePresetInput,
    "voice_id" | "voice_label_snapshot" | "locale_snapshot"
  >,
): TtsVoicePresetInput {
  return {
    label: preset.label,
    provider_id: preset.provider_id,
    model_id: preset.model_id,
    voice_id: preset.voice_id ?? null,
    voice_profile_id: preset.voice_profile_id ?? null,
    voice_label_snapshot: preset.voice_label_snapshot ?? null,
    locale_snapshot: preset.locale_snapshot ?? null,
    ...voice,
    tuning: preset.tuning,
  };
}

export function createLanguageActions({
  getState: get,
  updates,
}: SettingsActionContext): Pick<
  SettingsStore,
  "applyGlobalLanguageSync" | "setAppLanguageWithSync"
> {
  /** Use `voice` for the active preset, or as the default voice without one. */
  const selectTtsVoice = async (voice: VoiceInfo | null) => {
    const activePreset = getActiveTtsPreset(get().settings);
    if (!activePreset) {
      return get().updateSetting("tts_default_voice_id", voice?.id ?? null);
    }
    await unwrapCommandResult(
      commands.updateTtsVoicePreset(
        activePreset.id,
        presetInputWithVoice(activePreset, {
          voice_id: voice?.id ?? null,
          voice_label_snapshot:
            voice?.label ?? i18n.t("listen.createVoices.automaticVoice"),
          locale_snapshot: voice?.locale ?? null,
        }),
      ),
    );
    return true;
  };

  /** Match speech recognition and speech output to the app language. */
  const syncSpeechLanguage: SettingsStore["applyGlobalLanguageSync"] = async (
    appLanguage,
    trigger,
  ) => {
    const settings = get().settings;
    if (!settings) return false;

    const overview = await getModelPlatformOverview();
    if (
      trigger === "auto" &&
      (get().settings?.app_language !== appLanguage ||
        get().settings?.global_language_sync_enabled === false)
    )
      return false;
    const targetSttLanguage = appLanguageToSttLanguage(appLanguage);
    const selectedSttModel = overview.stt.models.find(
      (model) => model.id === overview.selection.selected_stt_model_id,
    );
    const nextSttLanguage =
      selectedSttModel &&
      modelSupportsLanguage(selectedSttModel, targetSttLanguage)
        ? targetSttLanguage
        : "auto";
    const sttSynced =
      (settings.selected_language ?? "auto") === nextSttLanguage ||
      (await get().updateSetting("selected_language", nextSttLanguage));
    if (!settings.tts_enabled) return sttSynced;

    const targetTtsLanguage = appLanguageToTtsTarget(appLanguage);
    const model = pickTtsModelForLanguage(overview, targetTtsLanguage, trigger);
    if (!model) return sttSynced;

    const keepCurrentModel =
      trigger === "auto" &&
      overview.selection.selected_tts_provider_id === model.provider_id &&
      overview.selection.selected_tts_model_id === model.id;
    if (!keepCurrentModel) {
      await setTtsPlatformSelection(model.provider_id, model.id);
    }
    const voices = await unwrapCommandResult(commands.getAvailableTtsVoices());
    const recommendedVoice = pickTtsVoiceForLanguage({
      voices,
      providerId: model.provider_id,
      targetLanguage: targetTtsLanguage,
      currentVoiceId: getCurrentTtsVoiceId(get().settings ?? settings),
      preserveCurrentVoice: keepCurrentModel,
    });
    const ttsSynced =
      recommendedVoice || !keepCurrentModel
        ? await selectTtsVoice(recommendedVoice ?? null)
        : true;
    return sttSynced && ttsSynced;
  };

  return {
    applyGlobalLanguageSync: (appLanguage, trigger) =>
      updates.run("language_sync", async () => {
        try {
          return await syncSpeechLanguage(appLanguage, trigger);
        } catch (error) {
          reportSettingError(error);
          return false;
        }
      }),
    setAppLanguageWithSync: async (appLanguage) => {
      if (!(await get().updateSetting("app_language", appLanguage))) {
        return false;
      }
      if (!(get().settings?.global_language_sync_enabled ?? true)) return true;
      await get().applyGlobalLanguageSync(appLanguage, "auto");
      return true;
    },
  };
}
