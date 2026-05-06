import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import type { ListenSpeechState } from "../useListenSpeechState";
import { DEFAULT_TTS_PREVIEW_TEXT } from "../utils";

export const SavedVoiceProfilesSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();

  if (!speech.settings || !speech.activePreset) return null;

  const content = (
    <div
      className={`space-y-3 px-4 py-3 ${
        !speech.ttsEnabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      {speech.statusMessage ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
          {speech.statusMessage}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-semibold text-[var(--text)]">
          {t("listen.myVoices.savedProfiles")}
        </p>

        <div className="grid max-h-[520px] gap-2 overflow-y-auto pe-1 lg:grid-cols-2">
          {speech.presets.map((preset) => {
            const isActive = preset.id === speech.activePreset?.id;
            const presetVoiceLabel =
              preset.voice_label_snapshot ?? preset.voice_id ?? "Automatic";

            return (
              <div
                key={preset.id}
                className={
                  isActive
                    ? "rounded-xl border border-[var(--accent)] bg-[var(--card)] px-3 py-2.5 shadow-[var(--shadow-md)]"
                    : "rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-md"
                }
              >
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold leading-none text-[var(--text)]">
                        {preset.label}
                      </p>
                      {isActive ? (
                        <Badge
                          variant="primary"
                          className="gap-1 text-[var(--inverse-text)] shadow-[var(--shadow-sm)]"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t("listen.myVoices.active")}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                      <Badge variant="secondary">{preset.model_id}</Badge>
                      <Badge variant="secondary">{presetVoiceLabel}</Badge>
                      {preset.voice_profile_id ? (
                        <Badge variant="secondary">
                          {t("listen.myVoices.clone")}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    {!isActive ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void speech.setActivePreset(preset.id)}
                        disabled={!speech.ttsEnabled}
                      >
                        {t("listen.myVoices.useThisVoice")}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void speech.previewPreset(
                          preset.id,
                          DEFAULT_TTS_PREVIEW_TEXT,
                        )
                      }
                      disabled={speech.previewingPresetId === preset.id}
                      className="inline-flex items-center gap-1.5"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {t("listen.myVoices.preview")}
                    </Button>
                    <Button
                      type="button"
                      variant="danger-ghost"
                      size="icon-sm"
                      onClick={() => void speech.removePreset(preset.id)}
                      disabled={
                        !speech.ttsEnabled || speech.presets.length <= 1
                      }
                      title={`Delete ${preset.label}`}
                      aria-label={`Delete ${preset.label}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return <SettingsGroup title="My Voices">{content}</SettingsGroup>;
};
