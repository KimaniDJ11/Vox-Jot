import React from "react";
import { BooleanSetting } from "../ui/BooleanSetting";

interface ShowTrayIconProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const ShowTrayIcon: React.FC<ShowTrayIconProps> = (props) => (
  <BooleanSetting
    settingKey="show_tray_icon"
    labelKey="settings.advanced.showTrayIcon.label"
    descriptionKey="settings.advanced.showTrayIcon.description"
    defaultValue={true}
    tooltipPosition="bottom"
    {...props}
  />
);
