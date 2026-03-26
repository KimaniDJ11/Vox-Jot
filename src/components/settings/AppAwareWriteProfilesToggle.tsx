import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface AppAwareWriteProfilesToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AppAwareWriteProfilesToggle: React.FC<AppAwareWriteProfilesToggleProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const enabled = getSetting("app_aware_tone_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enabled}
        onChange={(value) =>
          void updateSetting("app_aware_tone_enabled", value)
        }
        isUpdating={isUpdating("app_aware_tone_enabled")}
        label={t("settings.styles.toggle.label")}
        description={t("settings.styles.toggle.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  });
