import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface UpdateChecksToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const UpdateChecksToggle: React.FC<UpdateChecksToggleProps> = (
  props,
) => (
  <BooleanSetting
    settingKey="update_checks_enabled"
    labelKey="settings.debug.updateChecks.label"
    descriptionKey="settings.debug.updateChecks.description"
    defaultValue={true}
    {...props}
  />
);
