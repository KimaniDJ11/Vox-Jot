import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface CorrectionTrackingToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const CorrectionTrackingToggle: React.FC<CorrectionTrackingToggleProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const trackingEnabled = getSetting("correction_tracking_enabled") || false;

    return (
      <ToggleSwitch
        checked={trackingEnabled}
        onChange={(enabled) =>
          void updateSetting("correction_tracking_enabled", enabled)
        }
        isUpdating={isUpdating("correction_tracking_enabled")}
        label={t("settings.corrections.tracking.label")}
        description={t("settings.corrections.tracking.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  });
