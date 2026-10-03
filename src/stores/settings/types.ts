import type {
  AppSettings,
  AudioDevice,
  PostProcessResult,
  SettingUpdate,
  SettingsSnapshot,
} from "@/bindings";
import type { StoreApi } from "zustand";
import type { LanguageSyncTrigger } from "@/lib/languageSync";
import type { SettingsUpdateQueue } from "./SettingsEdits";

/** A preference that can be changed through `updateSetting`. */
export type SettingKey = SettingUpdate["key"];

/** The value type `updateSetting` accepts for `K`. */
export type SettingValue<K extends SettingKey> = Extract<
  SettingUpdate,
  { key: K }
>["value"];

export interface SettingsStore {
  settings: AppSettings | null;
  defaultSettings: AppSettings | null;
  isLoading: boolean;
  initializePromise: Promise<void> | null;
  isUpdating: Record<string, boolean>;
  audioDevices: AudioDevice[];
  outputDevices: AudioDevice[];
  customSounds: { start: boolean; stop: boolean };
  postProcessModelOptions: Record<string, string[]>;

  initialize: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  acceptSettingsSnapshot: (snapshot: SettingsSnapshot) => void;
  /**
   * Optimistically apply and persist one preference. A rejected change is
   * rolled back and reported to the user; the promise resolves to whether the
   * change was saved.
   */
  updateSetting: <K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
  ) => Promise<boolean>;
  resetSetting: (key: SettingKey) => Promise<boolean>;
  getSetting: <K extends keyof AppSettings>(
    key: K,
  ) => AppSettings[K] | undefined;
  isUpdatingKey: (key: string) => boolean;

  refreshAudioDevices: () => Promise<void>;
  refreshOutputDevices: () => Promise<void>;
  playTestSound: (soundType: "start" | "stop") => Promise<void>;
  checkCustomSounds: () => Promise<void>;

  updateBinding: (id: string, binding: string) => Promise<void>;
  resetBinding: (id: string) => Promise<void>;

  setPostProcessProvider: (providerId: string) => Promise<boolean>;
  updatePostProcessBaseUrl: (
    providerId: string,
    baseUrl: string,
  ) => Promise<boolean>;
  updatePostProcessApiKey: (
    providerId: string,
    apiKey: string,
  ) => Promise<boolean>;
  updatePostProcessModel: (
    providerId: string,
    model: string,
  ) => Promise<boolean>;
  updateTranslationModel: (
    providerId: string,
    model: string,
  ) => Promise<boolean>;
  fetchPostProcessModels: (providerId: string) => Promise<string[]>;
  setPostProcessModelOptions: (providerId: string, models: string[]) => void;
  previewPostProcessText: (
    text: string,
    appBundleIdOverride?: string | null,
  ) => Promise<PostProcessResult>;

  /** Resolves to whether the app language itself was saved. */
  setAppLanguageWithSync: (appLanguage: string) => Promise<boolean>;
  /** Resolves to whether speech input and output now follow `appLanguage`. */
  applyGlobalLanguageSync: (
    appLanguage: string,
    trigger: LanguageSyncTrigger,
  ) => Promise<boolean>;
}

export type SettingsActionContext = Pick<
  StoreApi<SettingsStore>,
  "setState" | "getState"
> & { updates: SettingsUpdateQueue };
