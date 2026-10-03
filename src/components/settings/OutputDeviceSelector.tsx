import React from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { DeviceSelectorSetting } from "./DeviceSelectorSetting";

interface OutputDeviceSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  disabled?: boolean;
}

export const OutputDeviceSelector: React.FC<OutputDeviceSelectorProps> = (
  props,
) => {
  const { t } = useTranslation();
  const devices = useSettingsStore((s) => s.outputDevices);
  const refresh = useSettingsStore((s) => s.refreshOutputDevices);

  return (
    <DeviceSelectorSetting
      settingKey="selected_output_device"
      devices={devices}
      onRefresh={refresh}
      title={t("settings.sound.outputDevice.title")}
      description={t("settings.sound.outputDevice.description")}
      placeholder={t("settings.sound.outputDevice.placeholder")}
      loadingPlaceholder={t("settings.sound.outputDevice.loading")}
      {...props}
    />
  );
};
