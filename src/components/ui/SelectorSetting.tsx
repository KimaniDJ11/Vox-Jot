import React from "react";
import type { AppSettings } from "@/bindings";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { SettingContainer } from "./SettingContainer";
import { ResetButton } from "./ResetButton";
import { useSetting } from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";

type StringSettingKey = {
  [K in keyof AppSettings]-?: NonNullable<AppSettings[K]> extends string
    ? K
    : never;
}[keyof AppSettings];

interface SelectorSettingProps {
  settingKey: StringSettingKey;
  title: string;
  description: string;
  options: DropdownOption[];
  /** Shown when no value has been chosen yet. */
  placeholder?: string;
  /** Shown instead of `placeholder` while options are loading / unavailable. */
  loadingPlaceholder?: string;
  /** Marks the dropdown as loading / unavailable (e.g. device enumeration in-flight). */
  loading?: boolean;
  /** Optional outside reason to disable the entire row (e.g. TTS off). */
  disabled?: boolean;
  /** If provided, shows a reset affordance that calls resetSetting(key). */
  showResetButton?: boolean;
  /** If provided, the dropdown shows a refresh icon wired to this callback. */
  onRefresh?: () => void;
  /** Default value to render when the setting is unset. */
  defaultValue?: string;
  /** Map the raw persisted value into the value passed to the Dropdown. */
  valueTransform?: (raw: string | undefined) => string;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/**
 * Dropdown-backed setting row. Handles: label/description layout, value
 * binding to `AppSettings`, isUpdating disabled state, optional refresh and
 * reset affordances. For specialised dropdowns (searchable language picker,
 * etc.) implement them directly rather than extending this abstraction.
 */
export const SelectorSetting: React.FC<SelectorSettingProps> = React.memo(
  ({
    settingKey,
    title,
    description,
    options,
    placeholder,
    loadingPlaceholder,
    loading = false,
    disabled = false,
    showResetButton = false,
    onRefresh,
    defaultValue,
    valueTransform,
    descriptionMode = "tooltip",
    grouped = false,
  }) => {
    const updateSetting = useSettingsStore((s) => s.updateSetting);
    const resetSetting = useSettingsStore((s) => s.resetSetting);
    const isUpdating = useSettingsStore((s) => s.isUpdatingKey(settingKey));
    const raw = useSetting(settingKey) as string | undefined;
    const selectedValue = valueTransform
      ? valueTransform(raw)
      : (raw ?? defaultValue ?? "");
    const optionsEmpty = options.length === 0;
    const dropdownDisabled = disabled || isUpdating || loading || optionsEmpty;
    const resolvedPlaceholder =
      loading || optionsEmpty
        ? (loadingPlaceholder ?? placeholder)
        : placeholder;

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
            options={options}
            selectedValue={selectedValue}
            onSelect={(value) => {
              void updateSetting(
                settingKey,
                value as AppSettings[typeof settingKey],
              );
            }}
            placeholder={resolvedPlaceholder}
            disabled={dropdownDisabled}
            onRefresh={onRefresh}
          />
          {showResetButton ? (
            <ResetButton
              onClick={() => void resetSetting(settingKey)}
              disabled={disabled || isUpdating || loading}
            />
          ) : null}
        </div>
      </SettingContainer>
    );
  },
);
