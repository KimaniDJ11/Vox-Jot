import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";
import { isMacAppStoreBuild } from "@/lib/distribution";

interface UpdateChecksToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const UpdateChecksToggle: React.FC<UpdateChecksToggleProps> = (props) =>
  isMacAppStoreBuild ? null : (
    <BooleanSetting
      settingKey="update_checks_enabled"
      labelKey="settings.debug.updateChecks.label"
      descriptionKey="settings.debug.updateChecks.description"
      defaultValue={true}
      {...props}
    />
  );
