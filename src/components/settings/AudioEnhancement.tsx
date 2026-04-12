import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface AudioEnhancementProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AudioEnhancement: React.FC<AudioEnhancementProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const enhancementEnabled = getSetting("audio_enhancement_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={enhancementEnabled}
        onChange={(enabled) => {
          void updateSetting("audio_enhancement_enabled", enabled);
          if (enabled) {
            void updateSetting("audio_enhancement_model", "rnnoise");
          }
        }}
        isUpdating={isUpdating("audio_enhancement_enabled")}
        label={t("settings.sound.audioEnhancement.label", {
          defaultValue: "Noise Reduction (RNNoise)",
        })}
        description={t("settings.sound.audioEnhancement.description", {
          defaultValue:
            "Denoise microphone audio before speech detection and transcription. Best for fans, HVAC, and room noise.",
        })}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
