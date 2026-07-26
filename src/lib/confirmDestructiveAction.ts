import { ask } from "@tauri-apps/plugin-dialog";

import i18n from "@/i18n";

type ConfirmDestructiveActionOptions = {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
};

export async function confirmDestructiveAction(
  message: string,
  options: ConfirmDestructiveActionOptions = {},
): Promise<boolean> {
  try {
    return await ask(message, {
      title: options.title ?? i18n.t("common.confirmAction"),
      kind: "warning",
      okLabel: options.okLabel ?? i18n.t("common.delete"),
      cancelLabel: options.cancelLabel ?? i18n.t("common.cancel"),
    });
  } catch (error) {
    console.error("Failed to show destructive action confirmation:", error);
    return false;
  }
}
