import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";

import {
  checkForCustomUpdate,
  type CustomUpdateResult,
} from "@/lib/utils/customUpdateChecker";

interface UpdateStore {
  updateInfo: CustomUpdateResult | null;
  isChecking: boolean;
  lastCheckedAt: number | null;
  error: string | null;
  checkForUpdates: () => Promise<CustomUpdateResult>;
  clearUpdate: () => void;
}

let inFlightCheck: Promise<CustomUpdateResult> | null = null;

export const useUpdateStore = create<UpdateStore>((set) => ({
  updateInfo: null,
  isChecking: false,
  lastCheckedAt: null,
  error: null,

  checkForUpdates: async () => {
    if (inFlightCheck) return inFlightCheck;

    inFlightCheck = (async () => {
      set({ isChecking: true, error: null });

      try {
        const currentVersion = await getVersion();
        const result = await checkForCustomUpdate(currentVersion);

        set({
          updateInfo: result.available ? result : null,
          lastCheckedAt: Date.now(),
          error: null,
        });

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({
          error: message,
          lastCheckedAt: Date.now(),
        });
        throw error;
      } finally {
        inFlightCheck = null;
        set({ isChecking: false });
      }
    })();

    return inFlightCheck;
  },

  clearUpdate: () => {
    set({
      updateInfo: null,
      isChecking: false,
      error: null,
    });
  },
}));
