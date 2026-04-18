import React from "react";
import { useTranslation } from "react-i18next";
import { SelectorSetting } from "../ui/SelectorSetting";

interface ThemeSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const THEME_VALUES = [
  "light",
  "dark",
  "sepia",
  "ocean",
  "forest",
  "rose",
  "slate",
  "solarized",
  "graphite",
  "system",
] as const;

export const ThemeSelector: React.FC<ThemeSelectorProps> = (props) => {
  const { t } = useTranslation();
  const themeOptions = THEME_VALUES.map((value) => ({
    value,
    label: t(`settings.advanced.theme.options.${value}`),
  }));

  return (
    <SelectorSetting
      settingKey="app_theme"
      title={t("settings.advanced.theme.title")}
      description={t("settings.advanced.theme.description")}
      options={themeOptions}
      defaultValue="system"
      {...props}
    />
  );
};
