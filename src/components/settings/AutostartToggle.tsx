import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";
import { isMacAppStoreBuild } from "@/lib/distribution";

interface AutostartToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AutostartToggle: React.FC<AutostartToggleProps> = (props) =>
  isMacAppStoreBuild ? null : (
    <BooleanSetting
      settingKey="autostart_enabled"
      labelKey="settings.advanced.autostart.label"
      descriptionKey="settings.advanced.autostart.description"
      {...props}
    />
  );
