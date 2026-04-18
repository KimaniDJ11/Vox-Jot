import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface AudioFeedbackProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AudioFeedback: React.FC<AudioFeedbackProps> = (props) => (
  <div className="flex flex-col">
    <BooleanSetting
      settingKey="audio_feedback"
      labelKey="settings.sound.audioFeedback.label"
      descriptionKey="settings.sound.audioFeedback.description"
      {...props}
    />
  </div>
);
