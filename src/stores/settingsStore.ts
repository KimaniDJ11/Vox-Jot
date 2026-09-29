import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { commands } from "@/bindings";
import type { SettingUpdate } from "@/bindings";
import { unwrapCommandResult } from "@/lib/commandResult";
import { subscribeSettingsSnapshots } from "@/lib/settingsEvents";
import { SettingsEdits, SettingsUpdateQueue } from "./settings/SettingsEdits";
import type { SettingKey, SettingValue, SettingsStore } from "./settings/types";
import { createDeviceActions } from "./settings/deviceActions";
import { createBindingActions } from "./settings/bindingActions";
import { createProviderActions } from "./settings/providerActions";
import { createLanguageActions } from "./settings/languageActions";
import { reportSettingError } from "./settings/reportSettingError";
export type { SettingKey, SettingValue } from "./settings/types";

/** Owns the settings snapshot; domain actions share this single store. */
export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => {
    const markUpdating = (key: string, updating: boolean) =>
      set((state) => ({
        isUpdating: { ...state.isUpdating, [key]: updating },
      }));
    const edits = new SettingsEdits();
    const updates = new SettingsUpdateQueue(markUpdating);
    const publish = () => set({ settings: edits.project(), isLoading: false });

    return {
      settings: null,
      defaultSettings: null,
      isLoading: true,
      initializePromise: null,
      isUpdating: {},
      audioDevices: [],
      outputDevices: [],
      customSounds: { start: false, stop: false },
      postProcessModelOptions: {},
      getSetting: (key) => get().settings?.[key],
      isUpdatingKey: (key) => get().isUpdating[key] || false,
      acceptSettingsSnapshot: (snapshot) => {
        edits.accept(snapshot);
        publish();
      },
      refreshSettings: async () => {
        try {
          get().acceptSettingsSnapshot(await commands.getSettingsSnapshot());
        } catch (error) {
          console.error("Failed to load settings:", error);
          set({ isLoading: false });
        }
      },
      updateSetting: async <K extends SettingKey>(
        key: K,
        value: SettingValue<K>,
      ) => {
        const edit = edits.begin(key, value, get().settings);
        publish();
        return updates.run(key, async () => {
          try {
            // TypeScript cannot correlate a generic key with its value type.
            const update = { key, value } as SettingUpdate;
            edits.accept(
              await unwrapCommandResult(commands.updateSetting(update)),
            );
            return true;
          } catch (error) {
            // A runtime effect can fail after persistence. Reconcile with the
            // backend rather than presenting a rollback that did not happen.
            await get().refreshSettings();
            reportSettingError(error);
            return false;
          } finally {
            edits.finish(edit);
            publish();
          }
        });
      },
      resetSetting: async (key) => {
        const defaults = get().defaultSettings;
        if (!defaults || !(key in defaults)) return false;
        return get().updateSetting(
          key,
          defaults[key] as SettingValue<typeof key>,
        );
      },
      initialize: async () => {
        const existingPromise = get().initializePromise;
        if (existingPromise) return existingPromise;
        if (get().settings && get().defaultSettings && !get().isLoading) return;

        // Audio devices are not enumerated here: App.tsx refreshes them once
        // onboarding completes so macOS permission prompts stay user-initiated.
        const initializePromise = (async () => {
          const loadDefaults = async () => {
            try {
              set({
                defaultSettings: await unwrapCommandResult(
                  commands.getDefaultSettings(),
                ),
              });
            } catch (error) {
              console.error("Failed to load default settings:", error);
            }
          };
          await Promise.all([
            loadDefaults(),
            get().refreshSettings(),
            get().checkCustomSounds(),
          ]);
        })();

        set({ initializePromise });
        try {
          await initializePromise;
        } finally {
          if (get().initializePromise === initializePromise) {
            set({ initializePromise: null });
          }
        }
      },
      ...createDeviceActions({ setState: set, getState: get, updates }),
      ...createBindingActions({ setState: set, getState: get, updates }),
      ...createProviderActions({ setState: set, getState: get, updates }),
      ...createLanguageActions({ setState: set, getState: get, updates }),
    };
  }),
);

const stopSettingsSync = subscribeSettingsSnapshots((snapshot) =>
  useSettingsStore.getState().acceptSettingsSnapshot(snapshot),
);

if (import.meta.hot) import.meta.hot.dispose(stopSettingsSync);
