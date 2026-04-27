import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface AppAwareWriteProfilesToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  dense?: boolean;
}

export const AppAwareWriteProfilesToggle: React.FC<
  AppAwareWriteProfilesToggleProps
> = (props) => (
  <BooleanSetting
    settingKey="app_aware_tone_enabled"
    labelKey="settings.styles.toggle.label"
    descriptionKey="settings.styles.toggle.description"
    {...props}
  />
);
