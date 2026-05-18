import React from "react";
import { useTranslation } from "react-i18next";
import { BooleanSetting } from "../ui/BooleanSetting";
import { useSettingsStore } from "../../stores/settingsStore";

interface AudioEnhancementProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AudioEnhancement: React.FC<AudioEnhancementProps> = (props) => {
  const { t } = useTranslation();
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  return (
    <BooleanSetting
      settingKey="audio_enhancement_enabled"
      label={t("settings.sound.audioEnhancement.label", {
        defaultValue: "Noise Reduction",
      })}
      defaultValue={true}
      description={t("settings.sound.audioEnhancement.description", {
        defaultValue:
          "Denoise microphone audio before speech detection and transcription. Best for fans, HVAC, and room noise.",
      })}
      onChange={(enabled) => {
        if (enabled) {
          void updateSetting("audio_enhancement_model", "rnnoise");
        }
      }}
      {...props}
    />
  );
};
