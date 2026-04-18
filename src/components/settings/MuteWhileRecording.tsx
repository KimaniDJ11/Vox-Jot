import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface MuteWhileRecordingToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const MuteWhileRecording: React.FC<MuteWhileRecordingToggleProps> = (
  props,
) => (
  <BooleanSetting
    settingKey="mute_while_recording"
    labelKey="settings.debug.muteWhileRecording.label"
    descriptionKey="settings.debug.muteWhileRecording.description"
    {...props}
  />
);
