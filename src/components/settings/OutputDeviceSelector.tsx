import React from "react";
import { useTranslation } from "react-i18next";
import type { AudioDevice } from "@/bindings";
import { SelectorSetting } from "../ui/SelectorSetting";
import { useSettings } from "../../hooks/useSettings";

interface OutputDeviceSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  disabled?: boolean;
}

export const OutputDeviceSelector: React.FC<OutputDeviceSelectorProps> = (
  props,
) => {
  const { t } = useTranslation();
  const { outputDevices, refreshOutputDevices, isLoading } = useSettings();
  const outputDeviceOptions = outputDevices.map((device: AudioDevice) => ({
    value: device.name,
    label: device.name,
  }));

  return (
    <SelectorSetting
      settingKey="selected_output_device"
      title={t("settings.sound.outputDevice.title")}
      description={t("settings.sound.outputDevice.description")}
      options={outputDeviceOptions}
      placeholder={t("settings.sound.outputDevice.placeholder")}
      loadingPlaceholder={t("settings.sound.outputDevice.loading")}
      loading={isLoading || outputDevices.length === 0}
      onRefresh={refreshOutputDevices}
      showResetButton
      valueTransform={(raw) =>
        raw === "default" ? "Default" : raw || "Default"
      }
      {...props}
    />
  );
};
