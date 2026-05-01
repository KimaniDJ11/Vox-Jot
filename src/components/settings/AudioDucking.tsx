import React from "react";
import { useTranslation } from "react-i18next";
import { Mic, Volume2 } from "lucide-react";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import { SwitchControl } from "../ui/SwitchControl";

interface AudioDuckingToggleProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AudioDucking: React.FC<AudioDuckingToggleProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const enabled = getSetting("audio_ducking_enabled") ?? false;

  return (
    <SettingContainer
      title={t("settings.debug.audioDucking.label")}
      description={t("settings.debug.audioDucking.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
        <div className="space-y-3">
          <DuckingMeter
            icon={<Volume2 className="h-4 w-4" aria-hidden />}
            label="System"
            values={
              enabled
                ? [84, 72, 42, 30, 34, 56, 74]
                : [84, 78, 82, 80, 76, 82, 84]
            }
            muted={enabled}
          />
          <DuckingMeter
            icon={<Mic className="h-4 w-4" aria-hidden />}
            label="Input"
            values={[18, 24, 52, 76, 82, 58, 28]}
          />
        </div>
        <div className="mt-3 flex min-h-[44px] items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
          <p className="text-sm font-semibold text-[var(--text)]">
            {enabled
              ? "Background audio dips while recording"
              : "Background audio stays unchanged"}
          </p>
          <SwitchControl
            checked={enabled}
            onChange={(value) =>
              void updateSetting("audio_ducking_enabled", value)
            }
            disabled={isUpdating("audio_ducking_enabled")}
            ariaLabel={t("settings.debug.audioDucking.label")}
          />
        </div>
      </div>
    </SettingContainer>
  );
};

const DuckingMeter: React.FC<{
  icon: React.ReactNode;
  label: string;
  values: number[];
  muted?: boolean;
}> = ({ icon, label, values, muted = false }) => (
  <div className="grid grid-cols-[72px_1fr] items-center gap-3">
    <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
      <span className="text-[var(--muted)]">{icon}</span>
      <span>{label}</span>
    </div>
    <div className="flex h-9 items-end gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5">
      {values.map((value, index) => (
        <span
          key={`${label}-${index}`}
          className={`flex-1 rounded-sm ${
            muted ? "bg-[var(--warning)]" : "bg-[var(--accent)]"
          }`}
          style={{ height: `${value}%` }}
          aria-hidden
        />
      ))}
    </div>
  </div>
);
