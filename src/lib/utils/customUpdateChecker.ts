import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";

const FALLBACK_RELEASES_URL =
  "https://huggingface.co/IrieDinamik/vox-jot-releases";

export type CustomUpdateResult = {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  downloadUrl?: string;
  update?: Update;
};

let pendingUpdate: Update | null = null;

export const checkForCustomUpdate = async (
  currentVersion: string,
): Promise<CustomUpdateResult> => {
  let update: Update | null;
  try {
    update = await check();
  } catch (error) {
    pendingUpdate = null;
    console.warn("Update manifest unavailable; treating as no update.", error);
    return { available: false, currentVersion };
  }

  if (!update) {
    pendingUpdate = null;
    return { available: false, currentVersion };
  }

  pendingUpdate = update;
  return {
    available: true,
    currentVersion,
    latestVersion: update.version,
    notes: update.body ?? undefined,
    downloadUrl: FALLBACK_RELEASES_URL,
    update,
  };
};

export const installUpdate = async (
  update: Update,
  onEvent?: (event: DownloadEvent) => void,
): Promise<void> => {
  await update.downloadAndInstall(onEvent);
  await relaunch();
};

export const installPendingUpdate = async (
  onEvent?: (event: DownloadEvent) => void,
): Promise<void> => {
  if (!pendingUpdate) {
    throw new Error("No pending update to install");
  }
  await installUpdate(pendingUpdate, onEvent);
};

export const openUpdateDownloadUrl = async (url?: string): Promise<void> => {
  if (pendingUpdate) {
    try {
      await installPendingUpdate();
      return;
    } catch (error) {
      console.error("In-app install failed, falling back to browser:", error);
    }
  }
  await openUrl(url || FALLBACK_RELEASES_URL);
};
