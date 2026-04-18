import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface CorrectionTrackingToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const CorrectionTrackingToggle: React.FC<
  CorrectionTrackingToggleProps
> = (props) => (
  <BooleanSetting
    settingKey="correction_tracking_enabled"
    labelKey="settings.corrections.tracking.label"
    descriptionKey="settings.corrections.tracking.description"
    {...props}
  />
);
