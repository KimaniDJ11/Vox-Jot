import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface PushToTalkProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const PushToTalk: React.FC<PushToTalkProps> = (props) => (
  <BooleanSetting
    settingKey="push_to_talk"
    labelKey="settings.general.pushToTalk.label"
    descriptionKey="settings.general.pushToTalk.description"
    {...props}
  />
);
