import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Play, Trash2 } from "lucide-react";
import { commands } from "@/bindings";
import { Button } from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { ActiveBadgeIcon } from "@/components/ui/CompactOverflow";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { voiceAvatarGradient } from "../createVoiceVoiceHub";
import type { ListenSpeechState } from "../useListenSpeechState";
import { ttsPreviewSampleForLocale } from "../utils";

const PREVIEW_RUNNING_DELAY_MS = 1500;

export const SavedVoiceProfilesSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const [previewRunning, setPreviewRunning] = useState(false);

  useEffect(() => {
    setPreviewRunning(false);
    if (!speech.previewingPresetId) return;

    const timeoutId = window.setTimeout(() => {
      setPreviewRunning(true);
    }, PREVIEW_RUNNING_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [speech.previewingPresetId]);

  if (!speech.settings || !speech.activePreset) return null;

  const previewLabel = t("listen.myVoices.preview");
  const stopLabel = t("listen.myVoices.stop");
  const activeLabel = t("listen.myVoices.active");
  const cloneLabel = t("listen.myVoices.clone");
  const preparingPreviewLabel = t("listen.createVoices.preparingPreview", {
    defaultValue: "Preparing preview",
  });
  const runningPreviewLabel = t("listen.createVoices.previewRunning", {
    defaultValue: "Preview running",
  });
  const automaticVoiceLabel = t("listen.createVoices.automaticVoice", {
    defaultValue: "Automatic voice",
  });
  const deleteLabel = t("common.delete", { defaultValue: "Delete" });

  const content = (
    <div
      className={`space-y-3 ${showTitle ? "px-4 py-3" : ""} ${
        !speech.ttsEnabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      {speech.statusMessage ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
          {speech.statusMessage}
        </div>
      ) : null}

      <div className="grid gap-2 lg:grid-cols-2">
        {speech.presets.map((preset) => {
          const isActive = preset.id === speech.activePreset?.id;
          const presetVoiceLabel =
            preset.voice_label_snapshot ??
            preset.voice_id ??
            automaticVoiceLabel;
          const isClone = Boolean(preset.voice_profile_id);
          const isPreviewing = speech.previewingPresetId === preset.id;
          const previewStatusLabel = isPreviewing
            ? previewRunning
              ? runningPreviewLabel
              : preparingPreviewLabel
            : null;
          const avatarGradient = voiceAvatarGradient(
            [
              preset.provider_id,
              preset.model_id,
              preset.voice_id ?? preset.voice_profile_id ?? preset.id,
            ].join("::"),
          );
          const canActivate = !isActive && speech.ttsEnabled;
          const activate = () => void speech.setActivePreset(preset.id);
          const togglePreview = async () => {
            if (isPreviewing) {
              const result = await commands.ttsStop();
              if (result.status === "error") {
                speech.setStatusMessage(result.error);
              }
              setPreviewRunning(false);
              return;
            }
            setPreviewRunning(false);
            await speech.previewPreset(
              preset.id,
              ttsPreviewSampleForLocale(preset.locale_snapshot),
            );
          };
          const description = [
            preset.model_id,
            presetVoiceLabel,
            isClone ? cloneLabel : null,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <div
              key={preset.id}
              className={[
                "group/profile-card flex w-full min-w-0 items-center gap-3 rounded-2xl border px-3 py-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-transparent bg-[var(--card)] hover:border-[var(--border)] hover:bg-[var(--panel-bg)]",
              ].join(" ")}
            >
              <span className="relative h-12 w-12 shrink-0">
                <span
                  className="block h-12 w-12 rounded-full shadow-inner"
                  style={{ background: avatarGradient }}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void togglePreview();
                  }}
                  aria-label={`${isPreviewing ? stopLabel : previewLabel} ${preset.label}`}
                  title={isPreviewing ? stopLabel : previewLabel}
                  className={[
                    "absolute inset-0 inline-flex items-center justify-center rounded-full bg-[rgba(22,43,32,0.78)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5),0_6px_16px_rgba(0,0,0,0.22)] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
                    isPreviewing
                      ? "opacity-100"
                      : "opacity-0 group-hover/profile-card:opacity-100 group-focus-within/profile-card:opacity-100",
                  ].join(" ")}
                >
                  {isPreviewing ? (
                    <Loader2
                      className="h-5 w-5 animate-[spin_1s_linear_infinite]"
                      aria-hidden
                    />
                  ) : (
                    <Play className="h-5 w-5 fill-current" aria-hidden />
                  )}
                </button>
              </span>

              <button
                type="button"
                onClick={activate}
                disabled={!canActivate}
                className="min-w-0 flex-1 rounded-xl px-1 py-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-default"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold text-[var(--text)]">
                    {preset.label}
                  </span>
                  {isActive ? (
                    <Badge
                      variant="primary"
                      className="gap-1 text-[var(--inverse-text)] shadow-[var(--shadow-sm)]"
                    >
                      <ActiveBadgeIcon />
                      {activeLabel}
                    </Badge>
                  ) : null}
                  {previewStatusLabel ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)] shadow-[var(--shadow-sm)]"
                      aria-live="polite"
                      role="status"
                    >
                      <Loader2
                        className="h-3.5 w-3.5 animate-[spin_1s_linear_infinite]"
                        aria-hidden
                      />
                      <span>{previewStatusLabel}</span>
                    </span>
                  ) : null}
                </div>
                <span className="mt-1 block truncate text-sm leading-5 text-[var(--muted)]">
                  {description}
                </span>
              </button>

              <div
                className="flex shrink-0 items-center gap-0.5"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="icon-sm"
                  onClick={() => void speech.removePreset(preset.id)}
                  disabled={!speech.ttsEnabled || speech.presets.length <= 1}
                  title={`${deleteLabel} ${preset.label}`}
                  aria-label={`${deleteLabel} ${preset.label}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return (
    <SettingsGroup title={t("appSections.sections.myVoicesTitle")}>
      {content}
    </SettingsGroup>
  );
};
