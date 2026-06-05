import { platform } from "@tauri-apps/plugin-os";

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
