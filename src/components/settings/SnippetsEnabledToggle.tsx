import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface SnippetsEnabledToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const SnippetsEnabledToggle: React.FC<SnippetsEnabledToggleProps> = (
  props,
) => (
  <BooleanSetting
    settingKey="snippets_enabled"
    labelKey="settings.snippets.toggle.label"
    descriptionKey="settings.snippets.toggle.description"
    defaultValue={true}
    {...props}
  />
);
