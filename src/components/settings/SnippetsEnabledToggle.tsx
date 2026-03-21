import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface SnippetsEnabledToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const SnippetsEnabledToggle: React.FC<SnippetsEnabledToggleProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const snippetsEnabled = getSetting("snippets_enabled") ?? true;

    return (
      <ToggleSwitch
        checked={snippetsEnabled}
        onChange={(enabled) => void updateSetting("snippets_enabled", enabled)}
        isUpdating={isUpdating("snippets_enabled")}
        label={t("settings.snippets.toggle.label")}
        description={t("settings.snippets.toggle.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  });
