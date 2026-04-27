import React from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "./ToggleSwitch";
import { useSetting } from "../../hooks/useSettings";
import { useSettingsStore } from "../../stores/settingsStore";
import type { AppSettings } from "@/bindings";

type BooleanSettingKey = {
  [K in keyof AppSettings]-?: NonNullable<AppSettings[K]> extends boolean
    ? K
    : never;
}[keyof AppSettings];

interface BooleanSettingProps {
  settingKey: BooleanSettingKey;
  labelKey?: string;
  descriptionKey?: string;
  label?: string;
  description?: string;
  defaultValue?: boolean;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  dense?: boolean;
  tooltipPosition?: "top" | "bottom";
  onChange?: (enabled: boolean) => void;
}

export const BooleanSetting: React.FC<BooleanSettingProps> = React.memo(
  ({
    settingKey,
    labelKey,
    descriptionKey,
    label,
    description,
    defaultValue = false,
    descriptionMode = "tooltip",
    grouped = false,
    dense,
    tooltipPosition = "top",
    onChange,
  }) => {
    const { t } = useTranslation();
    const updateSetting = useSettingsStore((s) => s.updateSetting);
    const isUpdating = useSettingsStore((s) => s.isUpdatingKey(settingKey));
    const rawValue = useSetting(settingKey) as boolean | undefined;
    const checked = rawValue ?? defaultValue;

    const resolvedLabel = label ?? (labelKey ? t(labelKey) : "");
    const resolvedDescription =
      description ?? (descriptionKey ? t(descriptionKey) : "");

    return (
      <ToggleSwitch
        checked={checked}
        onChange={(enabled) => {
          void updateSetting(
            settingKey,
            enabled as AppSettings[typeof settingKey],
          );
          onChange?.(enabled);
        }}
        isUpdating={isUpdating}
        label={resolvedLabel}
        description={resolvedDescription}
        descriptionMode={descriptionMode}
        grouped={grouped}
        dense={dense}
        tooltipPosition={tooltipPosition}
      />
    );
  },
);
