import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface StartHiddenProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const StartHidden: React.FC<StartHiddenProps> = (props) => (
  <BooleanSetting
    settingKey="start_hidden"
    labelKey="settings.advanced.startHidden.label"
    descriptionKey="settings.advanced.startHidden.description"
    tooltipPosition="bottom"
    {...props}
  />
);
