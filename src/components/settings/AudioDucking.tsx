import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface AudioDuckingToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AudioDucking: React.FC<AudioDuckingToggleProps> = (props) => (
  <BooleanSetting
    settingKey="audio_ducking_enabled"
    labelKey="settings.debug.audioDucking.label"
    descriptionKey="settings.debug.audioDucking.description"
    {...props}
  />
);
