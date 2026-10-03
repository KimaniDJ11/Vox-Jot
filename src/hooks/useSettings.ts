import { useMemo } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useShallow } from "zustand/react/shallow";
import type { AppSettings } from "@/bindings";
import type { SettingsStore } from "@/stores/settings/types";

type UseSettingsReturn = Pick<
  SettingsStore,
  | "settings"
  | "isLoading"
  | "audioDevices"
  | "outputDevices"
  | "postProcessModelOptions"
  | "updateSetting"
  | "resetSetting"
  | "refreshSettings"
  | "refreshAudioDevices"
  | "refreshOutputDevices"
  | "updateBinding"
  | "resetBinding"
  | "getSetting"
  | "setPostProcessProvider"
  | "updatePostProcessBaseUrl"
  | "updatePostProcessApiKey"
  | "updatePostProcessModel"
  | "updateTranslationModel"
  | "fetchPostProcessModels"
  | "previewPostProcessText"
  | "setAppLanguageWithSync"
  | "applyGlobalLanguageSync"
> & {
  isUpdating: SettingsStore["isUpdatingKey"];
  audioFeedbackEnabled: boolean;
};

export const useSettings = (): UseSettingsReturn => {
  const storeProps = useSettingsStore(
    useShallow((store) => ({
      settings: store.settings,
      isLoading: store.isLoading,
      /** Drives re-renders when any key’s updating flag toggles; `isUpdatingKey` is a stable function ref. */
      isUpdating: store.isUpdating,
      isUpdatingKey: store.isUpdatingKey,
      audioDevices: store.audioDevices,
      outputDevices: store.outputDevices,
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
      updateTranslationModel: store.updateTranslationModel,
      fetchPostProcessModels: store.fetchPostProcessModels,
      previewPostProcessText: store.previewPostProcessText,
      setAppLanguageWithSync: store.setAppLanguageWithSync,
      applyGlobalLanguageSync: store.applyGlobalLanguageSync,
    })),
  );

  return useMemo(() => {
    const { isUpdating: _updatingByKey, isUpdatingKey, ...rest } = storeProps;
    return {
      ...rest,
      isUpdating: isUpdatingKey,
      audioFeedbackEnabled: storeProps.settings?.audio_feedback || false,
    };
  }, [storeProps]);
};

/**
 * Subscribe to a single settings key. Re-renders only when that key changes,
 * so hot components (sliders, toggles, overlays) don't repaint on unrelated
 * settings writes like `useSettings()` would.
 */
export function useSetting<K extends keyof AppSettings>(
  key: K,
): AppSettings[K] | undefined {
  return useSettingsStore((s) => s.settings?.[key]);
}

/**
 * Subscribe to multiple settings keys at once with a shallow-equality check.
 * Prefer this over `useSettings()` when a component reads more than one key
 * but far fewer than all of them.
 */
export function useSettingsSlice<K extends keyof AppSettings>(
  keys: readonly K[],
): { [P in K]: AppSettings[P] | undefined } {
  return useSettingsStore(
    useShallow((s) => {
      const slice = {} as { [P in K]: AppSettings[P] | undefined };
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
