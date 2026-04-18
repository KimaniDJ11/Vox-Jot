import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface AlwaysOnMicrophoneProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AlwaysOnMicrophone: React.FC<AlwaysOnMicrophoneProps> = (
  props,
) => (
  <BooleanSetting
    settingKey="always_on_microphone"
    labelKey="settings.debug.alwaysOnMicrophone.label"
    descriptionKey="settings.debug.alwaysOnMicrophone.description"
    {...props}
  />
);
