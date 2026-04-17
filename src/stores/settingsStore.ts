import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  AppSettings as Settings,
  AppToneMapping,
  AudioDevice,
  DictionaryEntry,
  LogLevel,
  PostProcessResult,
  Snippet,
  TtsVoicePreset,
  TtsVoicePresetInput,
  ToneDefinition,
  VoiceInfo,
} from "@/bindings";
import { commands } from "@/bindings";
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
  type LanguageSyncTrigger,
} from "@/lib/languageSync";

type CommandResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

export interface LanguageSyncResult {
  message: string;
}

interface SettingsStore {
  settings: Settings | null;
  defaultSettings: Settings | null;
  isLoading: boolean;
  isUpdating: Record<string, boolean>;
  audioDevices: AudioDevice[];
  outputDevices: AudioDevice[];
  customSounds: { start: boolean; stop: boolean };
  postProcessModelOptions: Record<string, string[]>;

  // Actions
  initialize: () => Promise<void>;
  loadDefaultSettings: () => Promise<void>;
  updateSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  resetSetting: <K extends keyof Settings>(key: K) => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshAudioDevices: () => Promise<void>;
  refreshOutputDevices: () => Promise<void>;
  updateBinding: (id: string, binding: string) => Promise<void>;
  resetBinding: (id: string) => Promise<void>;
  getSetting: <K extends keyof Settings>(key: K) => Settings[K] | undefined;
  isUpdatingKey: (key: string) => boolean;
  playTestSound: (soundType: "start" | "stop") => Promise<void>;
  checkCustomSounds: () => Promise<void>;
  setPostProcessProvider: (providerId: string) => Promise<void>;
  updatePostProcessSetting: (
    settingType: "base_url" | "api_key" | "model",
    providerId: string,
    value: string,
  ) => Promise<void>;
  updatePostProcessBaseUrl: (
    providerId: string,
    baseUrl: string,
  ) => Promise<void>;
  updatePostProcessApiKey: (
    providerId: string,
    apiKey: string,
  ) => Promise<void>;
  updatePostProcessModel: (providerId: string, model: string) => Promise<void>;
  fetchPostProcessModels: (providerId: string) => Promise<string[]>;
  previewPostProcessText: (
    text: string,
    appBundleIdOverride?: string | null,
  ) => Promise<PostProcessResult>;
  setAppLanguageWithSync: (appLanguage: string) => Promise<LanguageSyncResult>;
  applyGlobalLanguageSync: (
    appLanguage: string,
    trigger: LanguageSyncTrigger,
  ) => Promise<LanguageSyncResult>;
  setTtsVoiceSelection: (
    voiceId: string | null,
    voice?: VoiceInfo | null,
  ) => Promise<void>;
  setPostProcessModelOptions: (providerId: string, models: string[]) => void;

  // Internal state setters
  setSettings: (settings: Settings | null) => void;
  setDefaultSettings: (defaultSettings: Settings | null) => void;
  setLoading: (loading: boolean) => void;
  setUpdating: (key: string, updating: boolean) => void;
  setAudioDevices: (devices: AudioDevice[]) => void;
  setOutputDevices: (devices: AudioDevice[]) => void;
  setCustomSounds: (sounds: { start: boolean; stop: boolean }) => void;
}

// Note: Default settings are now fetched from Rust via commands.getDefaultSettings()
// This ensures platform-specific defaults (like overlay_position, shortcuts, paste_method) work correctly

const DEFAULT_AUDIO_DEVICE: AudioDevice = {
  index: "default",
  name: "Default",
  is_default: true,
};

async function unwrapCommandResult<T>(promise: Promise<CommandResult<T>>) {
  const result = await promise;
  if (result.status === "error") {
    throw new Error(result.error);
  }
  return result.data;
}

function buildTtsPresetInput(
  preset: TtsVoicePreset,
  overrides: Partial<TtsVoicePresetInput> = {},
): TtsVoicePresetInput {
  const { tuning, ...restOverrides } = overrides;
  return {
    label: preset.label,
    provider_id: preset.provider_id,
    model_id: preset.model_id,
    voice_id: preset.voice_id ?? null,
    voice_profile_id: preset.voice_profile_id ?? null,
    voice_label_snapshot: preset.voice_label_snapshot ?? null,
    locale_snapshot: preset.locale_snapshot ?? null,
    ...restOverrides,
    tuning: {
      ...preset.tuning,
      ...(tuning ?? {}),
    },
  };
}

const settingUpdaters: {
  [K in keyof Settings]?: (value: Settings[K]) => Promise<unknown>;
} = {
  always_on_microphone: (value) =>
    commands.updateMicrophoneMode(value as boolean),
  audio_feedback: (value) =>
    commands.changeAudioFeedbackSetting(value as boolean),
  audio_feedback_volume: (value) =>
    commands.changeAudioFeedbackVolumeSetting(value as number),
  sound_theme: (value) => commands.changeSoundThemeSetting(value as string),
  app_theme: (value) => commands.changeAppThemeSetting(value as string),
  start_hidden: (value) => commands.changeStartHiddenSetting(value as boolean),
  autostart_enabled: (value) =>
    commands.changeAutostartSetting(value as boolean),
  update_checks_enabled: (value) =>
    commands.changeUpdateChecksSetting(value as boolean),
  push_to_talk: (value) => commands.changePttSetting(value as boolean),
  selected_microphone: (value) =>
    commands.setSelectedMicrophone(
      (value as string) === "Default" || value === null
        ? "default"
        : (value as string),
    ),
  clamshell_microphone: (value) =>
    commands.setClamshellMicrophone(
      (value as string) === "Default" ? "default" : (value as string),
    ),
  selected_output_device: (value) =>
    commands.setSelectedOutputDevice(
      (value as string) === "Default" || value === null
        ? "default"
        : (value as string),
    ),
  recording_retention_period: (value) =>
    commands.updateRecordingRetentionPeriod(value as string),
  translate_to_english: (value) =>
    commands.changeTranslateToEnglishSetting(value as boolean),
  selected_language: (value) =>
    commands.changeSelectedLanguageSetting(value as string),
  translation_output_mode: (value) =>
    commands.changeTranslationOutputModeSetting(value as string),
  translation_target_language: (value) =>
    commands.changeTranslationTargetLanguageSetting(value as string),
  translation_route_preference: (value) =>
    commands.changeTranslationRoutePreferenceSetting(value as string),
  translation_provider_id: (value) =>
    commands.setTranslationProvider(value as string),
  translation_bilingual_layout: (value) =>
    commands.changeTranslationBilingualLayoutSetting(value as string),
  translation_translate_snippets: (value) =>
    commands.changeTranslationTranslateSnippetsSetting(value as boolean),
  translation_destination_mode: (value) =>
    commands.changeTranslationDestinationModeSetting(value as string),
  selection_translation_destination_mode: (value) =>
    commands.changeSelectionTranslationDestinationModeSetting(value as string),
  tts_enabled: (value) => commands.changeTtsEnabledSetting(value as boolean),
  tts_engine_preference: (value) =>
    commands.changeTtsEnginePreferenceSetting(value as string),
  tts_auto_readback_mode: (value) =>
    commands.changeTtsAutoReadbackModeSetting(value as string),
  tts_auto_readback_scope: (value) =>
    commands.changeTtsAutoReadbackScopeSetting(value as string),
  tts_readback_text_mode: (value) =>
    commands.changeTtsReadbackTextModeSetting(value as string),
  tts_default_voice_id: (value) =>
    commands.changeTtsDefaultVoiceIdSetting((value as string | null) ?? null),
  tts_rate: (value) => commands.changeTtsRateSetting(value as number),
  tts_volume: (value) => commands.changeTtsVolumeSetting(value as number),
  tts_stop_on_record: (value) =>
    commands.changeTtsStopOnRecordSetting(value as boolean),
  audio_enhancement_enabled: (value) =>
    commands.changeAudioEnhancementEnabledSetting(value as boolean),
  audio_enhancement_model: (value) =>
    commands.changeAudioEnhancementModelSetting(value as string),
  speech_runtime_path: (value) =>
    commands.changeSpeechRuntimePathSetting((value as string | null) ?? null),
  tts_model_store_path: (value) =>
    commands.changeTtsModelStorePathSetting((value as string | null) ?? null),
  overlay_position: (value) =>
    commands.changeOverlayPositionSetting(value as string),
  recording_overlay_style: (value) =>
    commands.changeRecordingOverlayStyleSetting(value as string),
  debug_mode: (value) => commands.changeDebugModeSetting(value as boolean),
  custom_words: (value) => commands.updateCustomWords(value as string[]),
  word_correction_threshold: (value) =>
    commands.changeWordCorrectionThresholdSetting(value as number),
  paste_method: (value) => commands.changePasteMethodSetting(value as string),
  typing_tool: (value) => commands.changeTypingToolSetting(value as string),
  external_script_path: (value) =>
    commands.changeExternalScriptPathSetting(value as string | null),
  clipboard_handling: (value) =>
    commands.changeClipboardHandlingSetting(value as string),
  auto_submit: (value) => commands.changeAutoSubmitSetting(value as boolean),
  auto_submit_key: (value) =>
    commands.changeAutoSubmitKeySetting(value as string),
  history_limit: (value) => commands.updateHistoryLimit(value as number),
  post_process_enabled: (value) =>
    commands.changePostProcessEnabledSetting(value as boolean),
  local_privacy_mode: (value) =>
    commands.changeLocalPrivacyModeSetting(value as boolean),
  context_capture_mode: (value) =>
    commands.changeContextCaptureModeSetting(value as string),
  screen_context_ocr_quality: (value) =>
    commands.changeScreenContextOcrQualitySetting(value as string),
  screen_context_ocr_timeout_ms: (value) =>
    commands.changeScreenContextOcrTimeoutMsSetting(value as number),
  screen_context_token_budget: (value) =>
    commands.changeScreenContextTokenBudgetSetting(value as number),
  screen_context_stale_threshold_ms: (value) =>
    commands.changeScreenContextStaleThresholdMsSetting(value as number),
  post_process_mode: (value) =>
    commands.changePostProcessModeSetting(value as string),
  post_process_selected_prompt_id: (value) =>
    commands.setPostProcessSelectedPrompt(value as string),
  personal_dictionary: (value) =>
    commands.updatePersonalDictionary(value as DictionaryEntry[]),
  max_rewrite_strength: (value) =>
    commands.changeMaxRewriteStrengthSetting(value as number),
  show_preview_before_paste: (value) =>
    commands.changeShowPreviewBeforePasteSetting(value as boolean),
  fallback_to_raw_on_failure: (value) =>
    commands.changeFallbackToRawOnFailureSetting(value as boolean),
  app_aware_tone_enabled: (value) =>
    commands.changeAppAwareToneEnabledSetting(value as boolean),
  tone_definitions: (value) =>
    commands.updateToneDefinitions(value as ToneDefinition[]),
  app_tone_mappings: (value) =>
    commands.updateAppToneMappings(value as AppToneMapping[]),
  mute_while_recording: (value) =>
    commands.changeMuteWhileRecordingSetting(value as boolean),
  append_trailing_space: (value) =>
    commands.changeAppendTrailingSpaceSetting(value as boolean),
  log_level: (value) => commands.setLogLevel((value ?? "info") as LogLevel),
  app_language: (value) => commands.changeAppLanguageSetting(value as string),
  global_language_sync_enabled: (value) =>
    commands.changeGlobalLanguageSyncEnabledSetting(value as boolean),
  experimental_enabled: (value) =>
    commands.changeExperimentalEnabledSetting(value as boolean),
  show_tray_icon: (value) =>
    commands.changeShowTrayIconSetting(value as boolean),
  correction_tracking_enabled: (value) =>
    commands.changeCorrectionTrackingEnabledSetting(value as boolean),
  snippets_enabled: (value) =>
    commands.changeSnippetsEnabledSetting(value as boolean),
  snippets: (value) => commands.updateSnippets(value as Snippet[]),
};

export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => ({
    settings: null,
    defaultSettings: null,
    isLoading: true,
    isUpdating: {},
    audioDevices: [],
    outputDevices: [],
    customSounds: { start: false, stop: false },
    postProcessModelOptions: {},

    // Internal setters
    setSettings: (settings) => set({ settings }),
    setDefaultSettings: (defaultSettings) => set({ defaultSettings }),
    setLoading: (isLoading) => set({ isLoading }),
    setUpdating: (key, updating) =>
      set((state) => ({
        isUpdating: { ...state.isUpdating, [key]: updating },
      })),
    setAudioDevices: (audioDevices) => set({ audioDevices }),
    setOutputDevices: (outputDevices) => set({ outputDevices }),
    setCustomSounds: (customSounds) => set({ customSounds }),

    // Getters
    getSetting: (key) => get().settings?.[key],
    isUpdatingKey: (key) => get().isUpdating[key] || false,

    // Load settings from store
    refreshSettings: async () => {
      try {
        const result = await commands.getAppSettings();
        if (result.status === "ok") {
          const settings = result.data;
          const normalizedSettings: Settings = {
            ...settings,
            always_on_microphone: settings.always_on_microphone ?? false,
            selected_microphone: settings.selected_microphone ?? "Default",
            clamshell_microphone: settings.clamshell_microphone ?? "Default",
            selected_output_device:
              settings.selected_output_device ?? "Default",
          };
          set({ settings: normalizedSettings, isLoading: false });
        } else {
          console.error("Failed to load settings:", result.error);
          set({ isLoading: false });
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
        set({ isLoading: false });
      }
    },

    // Load audio devices
    refreshAudioDevices: async () => {
      try {
        const result = await commands.getAvailableMicrophones();
        if (result.status === "ok") {
          const devicesWithDefault = [
            DEFAULT_AUDIO_DEVICE,
            ...result.data.filter(
              (d) => d.name !== "Default" && d.name !== "default",
            ),
          ];
          set({ audioDevices: devicesWithDefault });
        } else {
          set({ audioDevices: [DEFAULT_AUDIO_DEVICE] });
        }
      } catch (error) {
        console.error("Failed to load audio devices:", error);
        set({ audioDevices: [DEFAULT_AUDIO_DEVICE] });
      }
    },

    // Load output devices
    refreshOutputDevices: async () => {
      try {
        const result = await commands.getAvailableOutputDevices();
        if (result.status === "ok") {
          const devicesWithDefault = [
            DEFAULT_AUDIO_DEVICE,
            ...result.data.filter(
              (d) => d.name !== "Default" && d.name !== "default",
            ),
          ];
          set({ outputDevices: devicesWithDefault });
        } else {
          set({ outputDevices: [DEFAULT_AUDIO_DEVICE] });
        }
      } catch (error) {
        console.error("Failed to load output devices:", error);
        set({ outputDevices: [DEFAULT_AUDIO_DEVICE] });
      }
    },

    // Play a test sound
    playTestSound: async (soundType: "start" | "stop") => {
      try {
        await commands.playTestSound(soundType);
      } catch (error) {
        console.error(`Failed to play test sound (${soundType}):`, error);
      }
    },

    checkCustomSounds: async () => {
      try {
        const sounds = await commands.checkCustomSounds();
        get().setCustomSounds(sounds);
      } catch (error) {
        console.error("Failed to check custom sounds:", error);
      }
    },

    // Update a specific setting
    updateSetting: async <K extends keyof Settings>(
      key: K,
      value: Settings[K],
    ) => {
      const { settings, setUpdating } = get();
      const updateKey = String(key);
      const originalValue = settings?.[key];

      setUpdating(updateKey, true);

      try {
        set((state) => ({
          settings: state.settings ? { ...state.settings, [key]: value } : null,
        }));

        const updater = settingUpdaters[key];
        if (updater) {
          await updater(value);
        } else if (key !== "bindings" && key !== "selected_model") {
          console.warn(`No handler for setting: ${String(key)}`);
        }
      } catch (error) {
        console.error(`Failed to update setting ${String(key)}:`, error);
        if (settings) {
          set({ settings: { ...settings, [key]: originalValue } });
        }
      } finally {
        setUpdating(updateKey, false);
      }
    },

    setTtsVoiceSelection: async (voiceId, voice = null) => {
      const { settings, setUpdating, refreshSettings } = get();
      const updateKey = "tts_default_voice_id";
      const originalSettings = settings;
      const normalizedVoiceId = voiceId?.trim() ? voiceId.trim() : null;
      const activePreset = getActiveTtsPreset(settings);
      const nextVoiceLabel = normalizedVoiceId
        ? (voice?.label ?? normalizedVoiceId)
        : "Automatic voice";
      const nextLocale = normalizedVoiceId ? (voice?.locale ?? null) : null;

      setUpdating(updateKey, true);

      try {
        set((state) => ({
          settings: state.settings
            ? {
                ...state.settings,
                tts_default_voice_id: normalizedVoiceId,
                selected_tts_voice_id: normalizedVoiceId,
                tts_voice_presets: (state.settings.tts_voice_presets ?? []).map(
                  (preset) =>
                    activePreset && preset.id === activePreset.id
                      ? {
                          ...preset,
                          voice_id: normalizedVoiceId,
                          voice_label_snapshot: nextVoiceLabel,
                          locale_snapshot: nextLocale,
                        }
                      : preset,
                ),
              }
            : null,
        }));

        if (activePreset) {
          await unwrapCommandResult(
            commands.updateTtsVoicePreset(
              activePreset.id,
              buildTtsPresetInput(activePreset, {
                voice_id: normalizedVoiceId,
                voice_label_snapshot: nextVoiceLabel,
                locale_snapshot: nextLocale,
              }),
            ),
          );
        } else {
          await unwrapCommandResult(
            commands.changeTtsDefaultVoiceIdSetting(normalizedVoiceId),
          );
        }

        await refreshSettings();
      } catch (error) {
        console.error("Failed to update TTS voice selection:", error);
        if (originalSettings) {
          set({ settings: originalSettings });
        }
        throw error;
      } finally {
        setUpdating(updateKey, false);
      }
    },

    applyGlobalLanguageSync: async (appLanguage, trigger) => {
      const { settings, refreshSettings, setUpdating } = get();
      if (!settings) {
        return {
          message:
            "Settings are still loading, so language sync could not run yet.",
        };
      }

      const updateKey = "global_language_sync";
      setUpdating(updateKey, true);

      const targetSttLanguage = appLanguageToSttLanguage(appLanguage);
      const targetTtsLanguage = appLanguageToTtsTarget(appLanguage);
      let sttMessage = "Speech recognition stayed as-is.";
      let ttsMessage = "Speech output stayed as-is.";

      try {
        const overview = await getModelPlatformOverview();
        const selectedSttModel =
          overview.stt.models.find(
            (model) => model.id === overview.selection.selected_stt_model_id,
          ) ?? null;
        const nextSttLanguage =
          selectedSttModel &&
          modelSupportsLanguage(selectedSttModel, targetSttLanguage)
            ? targetSttLanguage
            : "auto";

        if ((settings.selected_language ?? "auto") !== nextSttLanguage) {
          const previousSttLanguage = settings.selected_language ?? "auto";
          set((state) => ({
            settings: state.settings
              ? { ...state.settings, selected_language: nextSttLanguage }
              : null,
          }));

          try {
            await unwrapCommandResult(
              commands.changeSelectedLanguageSetting(nextSttLanguage),
            );
            sttMessage =
              nextSttLanguage === "auto"
                ? "Speech recognition switched to Auto."
                : `Speech recognition switched to ${nextSttLanguage}.`;
          } catch (error) {
            set((state) => ({
              settings: state.settings
                ? { ...state.settings, selected_language: previousSttLanguage }
                : null,
            }));
            sttMessage =
              error instanceof Error
                ? `Speech recognition could not sync: ${error.message}`
                : "Speech recognition could not sync.";
          }
        } else {
          sttMessage =
            nextSttLanguage === "auto"
              ? "Speech recognition stayed on Auto."
              : `Speech recognition stayed on ${nextSttLanguage}.`;
        }

        if (!settings.tts_enabled) {
          ttsMessage =
            "Speech output stayed as-is because Speak Output is turned off.";
          return { message: `${sttMessage} ${ttsMessage}` };
        }

        const selectedModel = pickTtsModelForLanguage(
          overview,
          settings,
          targetTtsLanguage,
          trigger,
        );
        if (!selectedModel) {
          return {
            message: `${sttMessage} No compatible speech output model is ready for ${targetTtsLanguage}, so the current voice was kept.`,
          };
        }

        const currentProviderId = overview.selection.selected_tts_provider_id;
        const currentModelId = overview.selection.selected_tts_model_id;
        const keepCurrentModel =
          trigger === "auto" &&
          currentProviderId === selectedModel.provider_id &&
          currentModelId === selectedModel.id;

        try {
          if (!keepCurrentModel) {
            await setTtsPlatformSelection(
              selectedModel.provider_id,
              selectedModel.id,
            );
            await refreshSettings();
          }

          const voiceInventory = await commands.getAvailableTtsVoices();
          const availableVoices =
            voiceInventory.status === "ok" ? voiceInventory.data : [];
          const refreshedSettings = get().settings ?? settings;
          const recommendedVoice = pickTtsVoiceForLanguage({
            voices: availableVoices,
            providerId: selectedModel.provider_id,
            targetLanguage: targetTtsLanguage,
            currentVoiceId: getCurrentTtsVoiceId(refreshedSettings),
            preserveCurrentVoice: keepCurrentModel,
          });

          if (recommendedVoice || !keepCurrentModel) {
            await get().setTtsVoiceSelection(
              recommendedVoice?.id ?? null,
              recommendedVoice,
            );
          }

          ttsMessage = recommendedVoice
            ? `Speech output is using ${selectedModel.label} with ${recommendedVoice.label}.`
            : keepCurrentModel
              ? `Speech output kept ${selectedModel.label}.`
              : `Speech output switched to ${selectedModel.label}.`;
        } catch (error) {
          ttsMessage =
            error instanceof Error
              ? `Speech output could not fully sync: ${error.message}`
              : "Speech output could not fully sync.";
        }

        return { message: `${sttMessage} ${ttsMessage}` };
      } finally {
        setUpdating(updateKey, false);
      }
    },

    setAppLanguageWithSync: async (appLanguage) => {
      const { settings, setUpdating } = get();
      const updateKey = "app_language";
      const previousLanguage = settings?.app_language ?? null;
      const syncEnabled = settings?.global_language_sync_enabled ?? true;

      setUpdating(updateKey, true);

      try {
        set((state) => ({
          settings: state.settings
            ? { ...state.settings, app_language: appLanguage }
            : null,
        }));
        await unwrapCommandResult(
          commands.changeAppLanguageSetting(appLanguage),
        );

        if (!syncEnabled) {
          return {
            message:
              "App language updated. Global Language Sync is off, so speech settings were left alone.",
          };
        }

        return await get().applyGlobalLanguageSync(appLanguage, "auto");
      } catch (error) {
        console.error("Failed to update app language:", error);
        if (previousLanguage && settings) {
          set({
            settings: {
              ...settings,
              app_language: previousLanguage,
            },
          });
        }
        throw error;
      } finally {
        setUpdating(updateKey, false);
      }
    },

    // Reset a setting to its default value
    resetSetting: async <K extends keyof Settings>(key: K) => {
      const { defaultSettings } = get();
      if (defaultSettings) {
        const defaultValue = defaultSettings[key];
        if (defaultValue !== undefined) {
          await get().updateSetting(key, defaultValue);
        }
      }
    },

    // Update a specific binding
    updateBinding: async (id, binding) => {
      const { settings, setUpdating } = get();
      const updateKey = `binding_${id}`;
      const originalBinding = settings?.bindings?.[id]?.current_binding;

      setUpdating(updateKey, true);

      try {
        // Optimistic update
        set((state) => ({
          settings: state.settings
            ? {
                ...state.settings,
                bindings: {
                  ...state.settings.bindings,
                  [id]: {
                    ...state.settings.bindings[id]!,
                    current_binding: binding,
                  },
                },
              }
            : null,
        }));

        const result = await commands.changeBinding(id, binding);

        // Check if the command executed successfully
        if (result.status === "error") {
          throw new Error(result.error);
        }

        // Check if the binding change was successful
        if (!result.data.success) {
          throw new Error(result.data.error || "Failed to update binding");
        }
      } catch (error) {
        console.error(`Failed to update binding ${id}:`, error);

        // Rollback on error
        if (originalBinding && get().settings) {
          set((state) => ({
            settings: state.settings
              ? {
                  ...state.settings,
                  bindings: {
                    ...state.settings.bindings,
                    [id]: {
                      ...state.settings.bindings[id]!,
                      current_binding: originalBinding,
                    },
                  },
                }
              : null,
          }));
        }

        // Re-throw to let the caller know it failed
        throw error;
      } finally {
        setUpdating(updateKey, false);
      }
    },

    // Reset a specific binding
    resetBinding: async (id) => {
      const { setUpdating, refreshSettings } = get();
      const updateKey = `binding_${id}`;

      setUpdating(updateKey, true);

      try {
        await commands.resetBinding(id);
        await refreshSettings();
      } catch (error) {
        console.error(`Failed to reset binding ${id}:`, error);
      } finally {
        setUpdating(updateKey, false);
      }
    },

    setPostProcessProvider: async (providerId) => {
      const {
        settings,
        setUpdating,
        refreshSettings,
        setPostProcessModelOptions,
      } = get();
      const updateKey = "post_process_provider_id";
      const previousId = settings?.post_process_provider_id ?? null;

      setUpdating(updateKey, true);

      if (settings) {
        set((state) => ({
          settings: state.settings
            ? { ...state.settings, post_process_provider_id: providerId }
            : null,
        }));
      }

      // Clear cached model options for the new provider so the dropdown
      // doesn't show stale models from a previous fetch or base_url.
      setPostProcessModelOptions(providerId, []);

      try {
        await commands.setPostProcessProvider(providerId);
        await refreshSettings();
      } catch (error) {
        console.error("Failed to set post-process provider:", error);
        if (previousId !== null) {
          set((state) => ({
            settings: state.settings
              ? { ...state.settings, post_process_provider_id: previousId }
              : null,
          }));
        }
      } finally {
        setUpdating(updateKey, false);
      }
    },

    // Generic updater for post-processing provider settings
    updatePostProcessSetting: async (
      settingType: "base_url" | "api_key" | "model",
      providerId: string,
      value: string,
    ) => {
      const { setUpdating, refreshSettings } = get();
      const updateKey = `post_process_${settingType}:${providerId}`;

      setUpdating(updateKey, true);

      try {
        if (settingType === "base_url") {
          await commands.changePostProcessBaseUrlSetting(providerId, value);
        } else if (settingType === "api_key") {
          await commands.changePostProcessApiKeySetting(providerId, value);
        } else if (settingType === "model") {
          await commands.changePostProcessModelSetting(providerId, value);
        }
        await refreshSettings();
      } catch (error) {
        console.error(
          `Failed to update post-process ${settingType.replace("_", " ")}:`,
          error,
        );
      } finally {
        setUpdating(updateKey, false);
      }
    },

    updatePostProcessBaseUrl: async (providerId, baseUrl) => {
      const { setUpdating, refreshSettings } = get();
      const updateKey = `post_process_base_url:${providerId}`;

      setUpdating(updateKey, true);

      try {
        // Persist the new base URL first.
        const urlResult = await commands.changePostProcessBaseUrlSetting(
          providerId,
          baseUrl,
        );
        if (urlResult.status === "error") {
          console.error("Failed to persist base URL:", urlResult.error);
          return;
        }

        // Reset the stored model since the previous value is almost certainly
        // invalid for the new endpoint (e.g. switching Custom from Groq to
        // Cerebras). Only proceed if the reset succeeds.
        const modelResult = await commands.changePostProcessModelSetting(
          providerId,
          "",
        );
        if (modelResult.status === "error") {
          console.error("Failed to reset model setting:", modelResult.error);
          return;
        }

        // Clear cached model options only after both backend writes succeed.
        set((state) => ({
          postProcessModelOptions: {
            ...state.postProcessModelOptions,
            [providerId]: [],
          },
        }));

        // Single refresh after both backend writes.
        await refreshSettings();
      } catch (error) {
        console.error("Failed to update post-process base URL:", error);
      } finally {
        setUpdating(updateKey, false);
      }
    },

    updatePostProcessApiKey: async (providerId, apiKey) => {
      // Clear cached models when API key changes - user should click refresh after
      set((state) => ({
        postProcessModelOptions: {
          ...state.postProcessModelOptions,
          [providerId]: [],
        },
      }));
      return get().updatePostProcessSetting("api_key", providerId, apiKey);
    },

    updatePostProcessModel: async (providerId, model) => {
      return get().updatePostProcessSetting("model", providerId, model);
    },

    fetchPostProcessModels: async (providerId) => {
      const updateKey = `post_process_models_fetch:${providerId}`;
      const { setUpdating, setPostProcessModelOptions } = get();

      setUpdating(updateKey, true);

      try {
        // Call Tauri backend command instead of fetch
        const result = await commands.fetchPostProcessModels(providerId);
        if (result.status === "ok") {
          setPostProcessModelOptions(providerId, result.data);
          return result.data;
        } else {
          console.error("Failed to fetch models:", result.error);
          return [];
        }
      } catch (error) {
        console.error("Failed to fetch models:", error);
        // Don't cache empty array on error - let user retry
        return [];
      } finally {
        setUpdating(updateKey, false);
      }
    },

    setPostProcessModelOptions: (providerId, models) =>
      set((state) => ({
        postProcessModelOptions: {
          ...state.postProcessModelOptions,
          [providerId]: models,
        },
      })),

    previewPostProcessText: async (text, appBundleIdOverride = null) => {
      const result = await commands.previewPostProcessText(
        text,
        appBundleIdOverride,
      );
      if (result.status === "ok") {
        return result.data;
      }
      throw new Error(result.error);
    },

    // Load default settings from Rust
    loadDefaultSettings: async () => {
      try {
        const result = await commands.getDefaultSettings();
        if (result.status === "ok") {
          set({ defaultSettings: result.data });
        } else {
          console.error("Failed to load default settings:", result.error);
        }
      } catch (error) {
        console.error("Failed to load default settings:", error);
      }
    },

    // Initialize everything
    initialize: async () => {
      const { refreshSettings, checkCustomSounds, loadDefaultSettings } = get();

      // Note: Audio devices are NOT refreshed here. The frontend (App.tsx)
      // is responsible for calling refreshAudioDevices/refreshOutputDevices
      // after onboarding completes. This avoids triggering permission dialogs
      // on macOS before the user is ready.
      await Promise.all([
        loadDefaultSettings(),
        refreshSettings(),
        checkCustomSounds(),
      ]);
    },
  })),
);
