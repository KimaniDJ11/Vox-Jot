import React from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { DeviceSelectorSetting } from "./DeviceSelectorSetting";

interface MicrophoneSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const MicrophoneSelector: React.FC<MicrophoneSelectorProps> = (
  props,
) => {
  const { t } = useTranslation();
  const devices = useSettingsStore((s) => s.audioDevices);
  const refresh = useSettingsStore((s) => s.refreshAudioDevices);

  return (
    <DeviceSelectorSetting
      settingKey="selected_microphone"
      devices={devices}
      onRefresh={refresh}
      title={t("settings.sound.microphone.title")}
      description={t("settings.sound.microphone.description")}
      placeholder={t("settings.sound.microphone.placeholder")}
      loadingPlaceholder={t("settings.sound.microphone.loading")}
      {...props}
    />
  );
};
