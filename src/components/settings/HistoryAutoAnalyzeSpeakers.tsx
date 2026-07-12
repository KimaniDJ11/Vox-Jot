import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { ToggleSwitch } from "../ui/ToggleSwitch";

interface HistoryAutoAnalyzeSpeakersProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const HistoryAutoAnalyzeSpeakers: React.FC<
  HistoryAutoAnalyzeSpeakersProps
> = ({ descriptionMode = "inline", grouped = false }) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const enabled =
    getSetting("history_auto_analyze_speakers_long_recordings_enabled") ??
    false;

  return (
    <ToggleSwitch
      checked={Boolean(enabled)}
      onChange={(checked) =>
        updateSetting(
          "history_auto_analyze_speakers_long_recordings_enabled",
          checked,
        )
      }
      isUpdating={isUpdating(
        "history_auto_analyze_speakers_long_recordings_enabled",
      )}
      label={t("settings.history.autoAnalyze.label", {
        defaultValue: "Auto-analyze speakers for long recordings",
      })}
      description={t("settings.history.autoAnalyze.description", {
        defaultValue:
          "For recordings 2 minutes or longer, detect speakers in the background after save. Short dictations stay unchanged. You can always run Analyze speakers from History detail.",
      })}
      descriptionMode={descriptionMode}
      grouped={grouped}
    />
  );
};
