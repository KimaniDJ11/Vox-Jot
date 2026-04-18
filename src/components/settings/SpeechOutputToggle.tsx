import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface SpeechOutputToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const SpeechOutputToggle: React.FC<SpeechOutputToggleProps> = (
  props,
) => (
  <BooleanSetting
    settingKey="tts_enabled"
    label="Enable Speech Output"
    description="Read back final Vox Jot output after dictation, translation, or selection flows."
    {...props}
  />
);
