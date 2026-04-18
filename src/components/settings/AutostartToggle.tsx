import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface AutostartToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AutostartToggle: React.FC<AutostartToggleProps> = (props) => (
  <BooleanSetting
    settingKey="autostart_enabled"
    labelKey="settings.advanced.autostart.label"
    descriptionKey="settings.advanced.autostart.description"
    {...props}
  />
);
