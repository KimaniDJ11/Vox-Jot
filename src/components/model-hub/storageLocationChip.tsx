import { HardDrive } from "lucide-react";
import type { TFunction } from "i18next";

import type { ModelStorageLocation } from "@/bindings";
import type { CompactBadgeItem } from "@/components/ui/CompactOverflow";

export function storageLocationChip(
  t: TFunction,
  installed: boolean | undefined,
  location?: ModelStorageLocation | null,
): CompactBadgeItem | null {
  if (!installed || !location) {
    return null;
  }

  const external = location === "external";
  return {
    id: "capability-origin",
    label: external
      ? t("modelHub.storageLocation.external")
      : t("modelHub.storageLocation.local"),
    variant: "secondary",
    icon: <HardDrive className="h-3 w-3" aria-hidden />,
    detail: external
      ? t("modelHub.storageLocation.externalDetail")
      : t("modelHub.storageLocation.localDetail"),
  };
}
