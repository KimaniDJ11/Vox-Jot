import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface ExperimentalToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const ExperimentalToggle: React.FC<ExperimentalToggleProps> = (
  props,
) => (
  <BooleanSetting
    settingKey="experimental_enabled"
    labelKey="settings.advanced.experimentalToggle.label"
    descriptionKey="settings.advanced.experimentalToggle.description"
    {...props}
  />
);
