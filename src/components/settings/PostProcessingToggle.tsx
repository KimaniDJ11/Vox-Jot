import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface PostProcessingToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const PostProcessingToggle: React.FC<PostProcessingToggleProps> = (
  props,
) => (
  <BooleanSetting
    settingKey="post_process_enabled"
    labelKey="settings.debug.postProcessingToggle.label"
    descriptionKey="settings.debug.postProcessingToggle.description"
    {...props}
  />
);
