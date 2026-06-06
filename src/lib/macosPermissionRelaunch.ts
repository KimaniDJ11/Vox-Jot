import { platform } from "@tauri-apps/plugin-os";
import { exit } from "@tauri-apps/plugin-process";

import { commands } from "@/bindings";

export const prepareMacosPermissionRelaunch = async (
  reason: string,
): Promise<void> => {
  if (platform() !== "macos") {
    return;
  }

  const result = await commands.prepareMacosPermissionRelaunch(reason);
  if (result.status !== "ok") {
    throw new Error(result.error);
  }
};

/**
 * Exit the current process so the relaunch watcher prepared by
 * {@link prepareMacosPermissionRelaunch} can reopen the installed app with the
 * newly granted macOS permissions active. macOS only applies Accessibility /
 * Input Monitoring / Screen Recording grants to a fresh process, so a restart
 * is required for them to take effect.
 *
 * We exit (rather than calling Tauri's `relaunch()`) so the single, canonical
 * watcher that reopens the `.app` bundle handles the relaunch — avoiding a
 * double-launch race between Tauri's restart and the watcher's `open`.
 */
export const relaunchForMacosPermissions = async (
  reason: string,
): Promise<void> => {
  if (platform() !== "macos") {
    return;
  }

  // Ensure a watcher is in place before we exit, in case the user reaches the
  // relaunch button without having triggered a permission request first.
  await prepareMacosPermissionRelaunch(reason);
  await exit(0);
};
