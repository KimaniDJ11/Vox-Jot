import React from "react";
import { useTranslation } from "react-i18next";
import { usePinState } from "@/hooks/usePinState";
import { useSetting } from "@/hooks/useSettings";
import { BooleanSetting } from "@/components/ui/BooleanSetting";
import { SettingsGroup } from "@/components/ui";
import { ShortcutInput } from "./ShortcutInput";

export const PinnedPasteSettings: React.FC = () => {
  const { t } = useTranslation();
  const pin = usePinState();
  const enabled = useSetting("pinned_paste_enabled");
  if (!pin?.available) return null;
  return (
    <SettingsGroup title={t("pinnedTarget.settingsTitle")}>
      <BooleanSetting
        settingKey="pinned_paste_enabled"
        label={t("pinnedTarget.label")}
        description={t("pinnedTarget.description")}
        descriptionMode="inline"
        grouped
      />
      <ShortcutInput
        shortcutId="pin_field"
        disabled={!enabled}
        descriptionMode="inline"
        grouped
      />
      <ShortcutInput
        shortcutId="clear_pin"
        disabled={!enabled}
        descriptionMode="inline"
        grouped
      />
    </SettingsGroup>
  );
};
