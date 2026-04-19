import React from "react";
import { useTranslation } from "react-i18next";
import { SelectorSetting } from "../ui/SelectorSetting";
import { useSettings } from "../../hooks/useSettings";

interface MicrophoneSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const MicrophoneSelector: React.FC<MicrophoneSelectorProps> = (
  props,
) => {
  const { t } = useTranslation();
  const { audioDevices, refreshAudioDevices, isLoading } = useSettings();
  const microphoneOptions = audioDevices.map((device) => ({
    value: device.name,
    label: device.name,
  }));

  return (
    <SelectorSetting
      settingKey="selected_microphone"
      title={t("settings.sound.microphone.title")}
      description={t("settings.sound.microphone.description")}
      options={microphoneOptions}
      placeholder={t("settings.sound.microphone.placeholder")}
      loadingPlaceholder={t("settings.sound.microphone.loading")}
      loading={isLoading || audioDevices.length === 0}
      onRefresh={refreshAudioDevices}
      showResetButton
      valueTransform={(raw) =>
        raw === "default" ? "Default" : raw || "Default"
      }
      {...props}
    />
  );
};
