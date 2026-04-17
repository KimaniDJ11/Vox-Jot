import React from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "../ui/Slider";
import { useSetting, useUpdateSetting } from "../../hooks/useSettings";

export const VolumeSlider: React.FC<{ disabled?: boolean }> = ({
  disabled = false,
}) => {
  const { t } = useTranslation();
  const updateSetting = useUpdateSetting();
  const audioFeedbackVolume = useSetting("audio_feedback_volume") ?? 0.5;

  return (
    <Slider
      value={audioFeedbackVolume}
      onChange={(value: number) =>
        updateSetting("audio_feedback_volume", value)
      }
      min={0}
      max={1}
      step={0.1}
      label={t("settings.sound.volume.title")}
      description={t("settings.sound.volume.description")}
      descriptionMode="tooltip"
      grouped
      formatValue={(value) => `${Math.round(value * 100)}%`}
      disabled={disabled}
    />
  );
};
