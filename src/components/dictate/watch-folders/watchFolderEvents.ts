import { type WatchFolderConfig, commands } from "@/bindings";
import { open } from "@tauri-apps/plugin-dialog";

let latestAddedWatchFolderId: string | null = null;

let pendingScanWatchFolder: WatchFolderConfig | null = null;

export function getLatestAddedWatchFolderId(): string | null {
  return latestAddedWatchFolderId;
}

/** The toolbar can add a folder before the folder panel mounts. Consume that handoff once. */
export function takePendingWatchFolderScan(): WatchFolderConfig | null {
  const folder = pendingScanWatchFolder;
  pendingScanWatchFolder = null;
  return folder;
}

export const addWatchFolder = async (): Promise<WatchFolderConfig | null> => {
  const picked = await open({ directory: true, multiple: false });
  if (!picked || Array.isArray(picked)) return null;

  const result = await commands.addWatchFolder(picked, "text", false);
  if (result.status === "ok") {
    latestAddedWatchFolderId = result.data.id;
    pendingScanWatchFolder = result.data;
    window.dispatchEvent(
      new CustomEvent<WatchFolderConfig>("watch-folders-changed", {
        detail: result.data,
      }),
    );
    return result.data;
  }
  console.error("addWatchFolder failed:", result.error);
  return null;
};
