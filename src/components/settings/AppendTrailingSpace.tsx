import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface AppendTrailingSpaceProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AppendTrailingSpace: React.FC<AppendTrailingSpaceProps> = (
  props,
) => (
  <BooleanSetting
    settingKey="append_trailing_space"
    labelKey="settings.debug.appendTrailingSpace.label"
    descriptionKey="settings.debug.appendTrailingSpace.description"
    {...props}
  />
);
