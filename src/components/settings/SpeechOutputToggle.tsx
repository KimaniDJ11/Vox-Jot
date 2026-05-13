import React from "react";
import { useTranslation } from "react-i18next";
import { BooleanSetting } from "../ui/BooleanSetting";

interface SpeechOutputToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const SpeechOutputToggle: React.FC<SpeechOutputToggleProps> = (
  props,
) => {
  const { t } = useTranslation();
  return (
    <BooleanSetting
      settingKey="tts_enabled"
      label={t("listen.speechOutput.title")}
      description={t("listen.speechOutput.description")}
      {...props}
    />
  );
};
