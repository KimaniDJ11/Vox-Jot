import React from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Mic, MicOff } from "lucide-react";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import {
  SelectionDot,
  visualizationStateClass,
} from "@/components/settings/VisualizationCard";

interface PushToTalkProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const PushToTalk: React.FC<PushToTalkProps> = (props) => (
  <PushToTalkPreview {...props} />
);

const PushToTalkPreview: React.FC<PushToTalkProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const selectedPushToTalk = getSetting("push_to_talk") ?? false;
  const disabled = isUpdating("push_to_talk");

  return (
    <SettingContainer
      title={t("settings.general.pushToTalk.label")}
      description={t("settings.general.pushToTalk.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <ModeCard
          title="Toggle"
          description="Press once to start, press again to stop."
          selected={!selectedPushToTalk}
          disabled={disabled}
          onSelect={() => void updateSetting("push_to_talk", false)}
          firstState="Key press"
          secondState="Next press"
          secondActive={false}
        />
        <ModeCard
          title="Push-to-talk"
          description="Hold the shortcut while speaking."
          selected={selectedPushToTalk}
          disabled={disabled}
          onSelect={() => void updateSetting("push_to_talk", true)}
          firstState="Hold key"
          secondState="Release"
          secondActive={false}
        />
      </div>
    </SettingContainer>
  );
};

const ModeCard: React.FC<{
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  firstState: string;
  secondState: string;
  secondActive: boolean;
}> = ({
  title,
  description,
  selected,
  disabled,
  onSelect,
  firstState,
  secondState,
  secondActive,
}) => (
  <button
    type="button"
    className={visualizationStateClass(selected, disabled)}
    disabled={disabled}
    aria-pressed={selected}
    onClick={onSelect}
  >
    <div className="mb-3 grid gap-2">
      <StateRow label={firstState} active />
      <StateRow label={secondState} active={secondActive} />
    </div>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
        <p className="mt-0.5 text-xs leading-4 text-[var(--muted)]">
          {description}
        </p>
      </div>
      <SelectionDot selected={selected} />
    </div>
  </button>
);

const StateRow: React.FC<{ label: string; active: boolean }> = ({
  label,
  active,
}) => (
  <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-2">
    <span
      className={`flex h-8 w-10 items-center justify-center rounded-md border text-[var(--text)] ${
        active
          ? "translate-y-0.5 border-[var(--accent)] bg-[var(--accent-soft)] shadow-[inset_0_2px_3px_rgba(0,0,0,0.16)]"
          : "border-[var(--border)] bg-[var(--panel-bg)]"
      }`}
    >
      <Keyboard className="h-4 w-4" aria-hidden />
    </span>
    <span className="min-w-0 flex-1 text-xs font-medium text-[var(--text)]">
      {label}
    </span>
    {active ? (
      <Mic className="h-4 w-4 text-[var(--success)]" aria-label="Mic on" />
    ) : (
      <MicOff className="h-4 w-4 text-[var(--muted)]" aria-label="Mic off" />
    )}
  </div>
);
