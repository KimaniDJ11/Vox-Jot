import React from "react";
import type { AudioDevice } from "@/bindings";
import { useSetting } from "@/hooks/useSettings";
import { deviceNameForSetting, deviceSettingForName } from "@/lib/audioDevices";
import { useSettingsStore } from "@/stores/settingsStore";
import { Dropdown } from "../ui/Dropdown";
import { ResetButton } from "../ui/ResetButton";
import { SettingContainer } from "../ui/SettingContainer";

interface DeviceSelectorSettingProps {
  settingKey:
    "selected_microphone" | "selected_output_device" | "clamshell_microphone";
  devices: AudioDevice[];
  onRefresh: () => void;
  title: string;
  description: string;
  placeholder: string;
  loadingPlaceholder: string;
  disabled?: boolean;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/** Audio device picker whose system-default entry stores no device name. */
export const DeviceSelectorSetting: React.FC<DeviceSelectorSettingProps> =
  React.memo(
    ({
      settingKey,
      devices,
      onRefresh,
      title,
      description,
      placeholder,
      loadingPlaceholder,
      disabled = false,
      descriptionMode = "tooltip",
      grouped = false,
    }) => {
      const updateSetting = useSettingsStore((s) => s.updateSetting);
      const resetSetting = useSettingsStore((s) => s.resetSetting);
      const isUpdating = useSettingsStore((s) => s.isUpdatingKey(settingKey));
      const isLoading = useSettingsStore((s) => s.isLoading);
      const setting = useSetting(settingKey);
      const unavailable = isLoading || devices.length === 0;

      return (
        <SettingContainer
          title={title}
          description={description}
          descriptionMode={descriptionMode}
          grouped={grouped}
          disabled={disabled}
        >
          <div className="flex items-center space-x-1">
            <Dropdown
              options={devices.map((device) => ({
                value: device.name,
                label: device.name,
              }))}
              selectedValue={deviceNameForSetting(devices, setting)}
              onSelect={(name) => {
                void updateSetting(
                  settingKey,
                  deviceSettingForName(devices, name),
                );
              }}
              placeholder={unavailable ? loadingPlaceholder : placeholder}
              disabled={disabled || isUpdating || unavailable}
              onRefresh={onRefresh}
            />
            <ResetButton
              onClick={() => void resetSetting(settingKey)}
              disabled={disabled || isUpdating || isLoading}
            />
          </div>
        </SettingContainer>
      );
    },
  );

DeviceSelectorSetting.displayName = "DeviceSelectorSetting";
