import { toast } from "sonner";
import i18n from "@/i18n";

type SettingErrorMessage =
  "settings.errors.saveFailed" | "settings.errors.modelListFailed";

/** Tell the user that a preference operation failed. */
export function reportSettingError(
  error: unknown,
  messageKey: SettingErrorMessage = "settings.errors.saveFailed",
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${messageKey}:`, message);
  toast.error(i18n.t(messageKey, { error: message }));
}
