import React from "react";
import { useTranslation } from "react-i18next";

import { Slider } from "@/components/ui/Slider";
import { useSetting, useUpdateSetting } from "@/hooks/useSettings";

export const AppFontScale: React.FC = () => {
  const { t } = useTranslation();
  const updateSetting = useUpdateSetting();
  const fontScale = useSetting("app_font_scale") ?? 1;

  return (
    <Slider
      value={fontScale}
      onChange={(value) => void updateSetting("app_font_scale", value)}
      min={0.9}
      max={1.3}
      step={0.05}
      label={t("settings.advanced.fontScale.title")}
      description={t("settings.advanced.fontScale.description")}
      descriptionMode="tooltip"
      grouped
      formatValue={(value) => `${Math.round(value * 100)}%`}
    />
  );
};
