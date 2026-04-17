import { useEffect, useMemo } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useShallow } from "zustand/react/shallow";
import type {
  AppSettings as Settings,
  AudioDevice,
  PostProcessResult,
  VoiceInfo,
} from "@/bindings";
import type { LanguageSyncResult } from "@/stores/settingsStore";
import type { LanguageSyncTrigger } from "@/lib/languageSync";

interface UseSettingsReturn {
  // State
  settings: Settings | null;
  isLoading: boolean;
  isUpdating: (key: string) => boolean;
  audioDevices: AudioDevice[];
  outputDevices: AudioDevice[];
  audioFeedbackEnabled: boolean;
  postProcessModelOptions: Record<string, string[]>;

  // Actions
  updateSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  resetSetting: (key: keyof Settings) => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshAudioDevices: () => Promise<void>;
  refreshOutputDevices: () => Promise<void>;

  // Binding-specific actions
  updateBinding: (id: string, binding: string) => Promise<void>;
  resetBinding: (id: string) => Promise<void>;

  // Convenience getters
  getSetting: <K extends keyof Settings>(key: K) => Settings[K] | undefined;

  // Post-processing helpers
  setPostProcessProvider: (providerId: string) => Promise<void>;
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
}

export const useSettings = (): UseSettingsReturn => {
  const store = useSettingsStore();

  // Initialize on first mount
  useEffect(() => {
    if (store.isLoading) {
      store.initialize();
    }
  }, [store.initialize, store.isLoading]);

  return useMemo(
    () => ({
      settings: store.settings,
      isLoading: store.isLoading,
      isUpdating: store.isUpdatingKey,
      audioDevices: store.audioDevices,
      outputDevices: store.outputDevices,
      audioFeedbackEnabled: store.settings?.audio_feedback || false,
      postProcessModelOptions: store.postProcessModelOptions,
      updateSetting: store.updateSetting,
      resetSetting: store.resetSetting,
      refreshSettings: store.refreshSettings,
      refreshAudioDevices: store.refreshAudioDevices,
      refreshOutputDevices: store.refreshOutputDevices,
      updateBinding: store.updateBinding,
      resetBinding: store.resetBinding,
      getSetting: store.getSetting,
      setPostProcessProvider: store.setPostProcessProvider,
      updatePostProcessBaseUrl: store.updatePostProcessBaseUrl,
      updatePostProcessApiKey: store.updatePostProcessApiKey,
      updatePostProcessModel: store.updatePostProcessModel,
      fetchPostProcessModels: store.fetchPostProcessModels,
      previewPostProcessText: store.previewPostProcessText,
      setAppLanguageWithSync: store.setAppLanguageWithSync,
      applyGlobalLanguageSync: store.applyGlobalLanguageSync,
      setTtsVoiceSelection: store.setTtsVoiceSelection,
    }),
    [
      store.settings,
      store.isLoading,
      store.isUpdatingKey,
      store.audioDevices,
      store.outputDevices,
      store.postProcessModelOptions,
      store.updateSetting,
      store.resetSetting,
      store.refreshSettings,
      store.refreshAudioDevices,
      store.refreshOutputDevices,
      store.updateBinding,
      store.resetBinding,
      store.getSetting,
      store.setPostProcessProvider,
      store.updatePostProcessBaseUrl,
      store.updatePostProcessApiKey,
      store.updatePostProcessModel,
      store.fetchPostProcessModels,
      store.previewPostProcessText,
      store.setAppLanguageWithSync,
      store.applyGlobalLanguageSync,
      store.setTtsVoiceSelection,
    ],
  );
};

/**
 * Subscribe to a single settings key. Re-renders only when that key changes,
 * so hot components (sliders, toggles, overlays) don't repaint on unrelated
 * settings writes like `useSettings()` would.
 */
export function useSetting<K extends keyof Settings>(
  key: K,
): Settings[K] | undefined {
  return useSettingsStore((s) => s.settings?.[key]);
}

/**
 * Subscribe to multiple settings keys at once with a shallow-equality check.
 * Prefer this over `useSettings()` when a component reads more than one key
 * but far fewer than all of them.
 */
export function useSettingsSlice<K extends keyof Settings>(
  keys: readonly K[],
): { [P in K]: Settings[P] | undefined } {
  return useSettingsStore(
    useShallow((s) => {
      const slice = {} as { [P in K]: Settings[P] | undefined };
      for (const k of keys) slice[k] = s.settings?.[k];
      return slice;
    }),
  );
}

/** Stable accessor for `updateSetting` that doesn't subscribe to settings state. */
export function useUpdateSetting() {
  return useSettingsStore((s) => s.updateSetting);
}

/** Stable accessor for `refreshSettings` without subscribing to settings state. */
export function useRefreshSettings() {
  return useSettingsStore((s) => s.refreshSettings);
}
