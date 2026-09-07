import React from "react";
import { useTranslation } from "react-i18next";
import { SelectorSetting } from "../ui/SelectorSetting";

interface AcousticProfileSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AcousticProfileSelector: React.FC<
  AcousticProfileSelectorProps
> = ({ descriptionMode = "inline", grouped = false }) => {
  const { t } = useTranslation();

  const options = [
    {
      value: "normal",
      label: t("settings.audio.acousticProfile.normal", {
        defaultValue: "Standard (Conversational)",
      }),
    },
    {
      value: "quiet",
      label: t("settings.audio.acousticProfile.quiet", {
        defaultValue: "Quiet / Whisper (Experimental)",
      }),
    },
  ];

  return (
    <SelectorSetting
      settingKey="acoustic_profile"
      title={t("settings.audio.acousticProfile.title", {
        defaultValue: "Acoustic Profile",
      })}
      description={t("settings.audio.acousticProfile.description", {
        defaultValue:
          "Quiet/Whisper raises input level and voice detection sensitivity for low-volume speech. Results vary by microphone; Standard remains the calibrated default.",
      })}
      options={options}
      defaultValue="normal"
      descriptionMode={descriptionMode}
      grouped={grouped}
    />
  );
};
