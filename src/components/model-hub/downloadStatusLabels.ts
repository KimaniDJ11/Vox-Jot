import type { TFunction } from "i18next";

export function downloadingModelFilesLabel(t: TFunction): string {
  return t("modelHub.downloadStatus.downloadingModelFiles", {
    defaultValue: "Downloading model files...",
  });
}
