import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface TranslateToEnglishProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const TranslateToEnglish: React.FC<TranslateToEnglishProps> = (
  props,
) => (
  <BooleanSetting
    settingKey="translate_to_english"
    labelKey="settings.advanced.translateToEnglish.label"
    descriptionKey="settings.advanced.translateToEnglish.description"
    {...props}
  />
);
