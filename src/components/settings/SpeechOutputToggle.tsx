import React from "react";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

interface SpeechOutputToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const SpeechOutputToggle: React.FC<SpeechOutputToggleProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const speechOutputEnabled = getSetting("tts_enabled") ?? false;

    return (
      <ToggleSwitch
        checked={speechOutputEnabled}
        onChange={(enabled) => void updateSetting("tts_enabled", enabled)}
        isUpdating={isUpdating("tts_enabled")}
        label="Enable Speech Output"
        description="Read back final Vox Jot output after dictation, translation, or selection flows."
        descriptionMode={descriptionMode}
        grouped={grouped}
      />
    );
  },
);
