import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface PhraseKeysEnabledToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const PhraseKeysEnabledToggle: React.FC<PhraseKeysEnabledToggleProps> = (
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
