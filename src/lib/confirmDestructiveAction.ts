import { ask } from "@tauri-apps/plugin-dialog";

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
      title: options.title ?? "Confirm action",
      kind: "warning",
      okLabel: options.okLabel ?? "Delete",
      cancelLabel: options.cancelLabel ?? "Cancel",
    });
  } catch (error) {
    console.error("Failed to show destructive action confirmation:", error);
    return false;
  }
}
