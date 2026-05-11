import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../../ui/SettingContainer";
import { Dropdown } from "../../ui/Dropdown";
import { useSettings } from "../../../hooks/useSettings";
import { commands } from "@/bindings";
import { toast } from "sonner";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";

const KEYBOARD_IMPLEMENTATIONS = ["tauri", "handy_keys"] as const;

interface KeyboardImplementationSelectorProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const KeyboardImplementationSelector: React.FC<
  KeyboardImplementationSelectorProps
> = ({ descriptionMode = "tooltip", grouped = false }) => {
  const { t } = useTranslation();
  const { getSetting, isUpdating, refreshSettings } = useSettings();
  const currentImplementation =
    getSetting("keyboard_implementation") ?? "tauri";

  const options = useMemo(
    () =>
      KEYBOARD_IMPLEMENTATIONS.map((value) => ({
        value,
        label: t(`settings.debug.keyboardImplementation.options.${value}`),
      })),
    [t],
  );

  const handleSelect = async (value: string) => {
    if (value === currentImplementation) return;

    const confirmed = confirmDestructiveAction(
      t("settings.debug.keyboardImplementation.changeConfirm", {
        defaultValue:
          "Change keyboard backend? Shortcuts that are incompatible with the new backend may be reset to defaults.",
      }),
    );
    if (!confirmed) return;

    try {
      const result = await commands.changeKeyboardImplementationSetting(value);

      if (result.status === "error") {
        console.error(
          "Failed to update keyboard implementation:",
          result.error,
        );
        toast.error(String(result.error));
        return;
      }

      // If any bindings were reset due to incompatibility, notify the user
      if (result.data.reset_bindings.length > 0) {
        toast.warning(t("settings.debug.keyboardImplementation.bindingsReset"));
      }

      await refreshSettings();
    } catch (error) {
      console.error("Failed to update keyboard implementation:", error);
      toast.error(String(error));
    }
  };

  return (
    <SettingContainer
      title={t("settings.debug.keyboardImplementation.title")}
      description={t("settings.debug.keyboardImplementation.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="horizontal"
    >
      <Dropdown
        options={options}
        selectedValue={currentImplementation}
        onSelect={handleSelect}
        disabled={isUpdating("keyboard_implementation")}
      />
    </SettingContainer>
  );
};
