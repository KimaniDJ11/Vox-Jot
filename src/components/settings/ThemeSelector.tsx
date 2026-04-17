import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";

interface ThemeSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const ThemeSelector: React.FC<ThemeSelectorProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const themeOptions = [
      { value: "light", label: t("settings.advanced.theme.options.light") },
      { value: "dark", label: t("settings.advanced.theme.options.dark") },
      { value: "sepia", label: t("settings.advanced.theme.options.sepia") },
      { value: "ocean", label: t("settings.advanced.theme.options.ocean") },
      { value: "forest", label: t("settings.advanced.theme.options.forest") },
      { value: "rose", label: t("settings.advanced.theme.options.rose") },
      { value: "slate", label: t("settings.advanced.theme.options.slate") },
      {
        value: "solarized",
        label: t("settings.advanced.theme.options.solarized"),
      },
      {
        value: "graphite",
        label: t("settings.advanced.theme.options.graphite"),
      },
      { value: "system", label: t("settings.advanced.theme.options.system") },
    ];

    const selectedTheme = (getSetting("app_theme") as string) || "system";

    return (
      <SettingContainer
        title={t("settings.advanced.theme.title")}
        description={t("settings.advanced.theme.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <Dropdown
          options={themeOptions}
          selectedValue={selectedTheme}
          onSelect={(value) => updateSetting("app_theme", value)}
          disabled={isUpdating("app_theme")}
        />
      </SettingContainer>
    );
  },
);
