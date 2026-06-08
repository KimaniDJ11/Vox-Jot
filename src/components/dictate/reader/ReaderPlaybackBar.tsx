import React from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";

import { ActionIconButton } from "@/components/ui";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";

import type { ReaderPlaybackStatus } from "./useReaderPlayback";

function voicePresetOptionLabel(preset: TtsVoicePreset): string {
  const label = preset.label.trim() || preset.voice_label_snapshot?.trim();
  const model = preset.model_id.trim();
  if (!model || label?.toLowerCase().includes(model.toLowerCase())) {
    return label || model || preset.id;
  }
  return `${label || preset.id} - ${model}`;
}

export type ReaderPlaybackBarProps = {
  status: ReaderPlaybackStatus;
  index: number;
  total: number;
  playbackRate: number;
  pageLabel: string | null;
  currentText: string;
  voiceLabel: string | null;
  onToggle: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (index: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  presets: TtsVoicePreset[];
  selectedPresetId: string | null;
  onSelectPreset: (presetId: string | null) => void;
};

const readerPlaybackRateOptions = [0.75, 1, 1.25, 1.5, 1.75, 2];

export const ReaderPlaybackBar: React.FC<ReaderPlaybackBarProps> = ({
  status,
  index,
  total,
  playbackRate,
  pageLabel,
  currentText,
  voiceLabel,
  onToggle,
  onStop,
  onPrev,
  onNext,
  onSeek,
  onPlaybackRateChange,
  presets,
  selectedPresetId,
  onSelectPreset,
}) => {
  const { t } = useTranslation();
  const hasUnits = total > 0;
  const isPlaying = status === "playing";
  const progressPercent = hasUnits ? ((index + 1) / total) * 100 : 0;

  const playLabel = isPlaying
    ? t("dictate.reader.player.pause", { defaultValue: "Pause" })
    : status === "paused"
      ? t("dictate.reader.player.resume", { defaultValue: "Resume" })
      : t("dictate.reader.player.play", { defaultValue: "Play" });

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted,var(--bg))] p-3">
      <div className="flex items-center gap-2">
        <ActionIconButton
          type="button"
          onClick={onPrev}
          disabled={!hasUnits}
          title={t("dictate.reader.player.previous", {
            defaultValue: "Previous",
          })}
          aria-label={t("dictate.reader.player.previous", {
            defaultValue: "Previous",
          })}
        >
          <SkipBack size={15} aria-hidden="true" />
        </ActionIconButton>

        <button
          type="button"
          onClick={onToggle}
          disabled={!hasUnits}
          aria-label={playLabel}
          title={playLabel}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--on-accent,#fff)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPlaying ? (
            <Pause size={18} aria-hidden="true" />
          ) : (
            <Play size={18} aria-hidden="true" className="translate-x-[1px]" />
          )}
        </button>

        <ActionIconButton
          type="button"
          onClick={onNext}
          disabled={!hasUnits}
          title={t("dictate.reader.player.next", { defaultValue: "Next" })}
          aria-label={t("dictate.reader.player.next", { defaultValue: "Next" })}
        >
          <SkipForward size={15} aria-hidden="true" />
        </ActionIconButton>

        <ActionIconButton
          type="button"
          onClick={onStop}
          disabled={status === "idle"}
          title={t("dictate.reader.player.stop", { defaultValue: "Stop" })}
          aria-label={t("dictate.reader.player.stop", { defaultValue: "Stop" })}
        >
          <Square size={14} aria-hidden="true" />
        </ActionIconButton>

        <div className="min-w-0 flex-1 space-y-1">
          <input
            type="range"
            min={0}
            max={Math.max(total - 1, 0)}
            value={Math.min(index, Math.max(total - 1, 0))}
            onChange={(event) => onSeek(Number(event.target.value))}
            disabled={!hasUnits}
            aria-label={t("dictate.reader.player.scrub", {
              defaultValue: "Reading position",
            })}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--border)] accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: hasUnits
                ? `linear-gradient(to right, var(--accent) ${progressPercent}%, var(--border) ${progressPercent}%)`
                : undefined,
            }}
          />
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
            <span className="truncate">
              {hasUnits
                ? t("dictate.reader.player.position", {
                    defaultValue: "Part {{current}} of {{total}}",
                    current: index + 1,
                    total,
                  })
                : t("dictate.reader.player.nothingToRead", {
                    defaultValue: "Nothing to read",
                  })}
            </span>
            {pageLabel ? (
              <span className="shrink-0 truncate">{pageLabel}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-[var(--muted)]">
          {t("dictate.reader.player.defaultVoice", {
            defaultValue: "Default voice",
          })}
        </span>
        <label className="sr-only" htmlFor="reader-playback-voice">
          {t("dictate.reader.voice", { defaultValue: "Voice" })}
        </label>
        <select
          id="reader-playback-voice"
          value={selectedPresetId ?? ""}
          onChange={(event) => onSelectPreset(event.target.value || null)}
          title={
            voiceLabel ??
            t("dictate.reader.currentVoice", {
              defaultValue: "Current voice",
            })
          }
          className="h-8 max-w-[200px] rounded-full border border-[var(--border)] bg-[var(--input)] px-3 text-xs font-medium text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--accent-glow)]"
        >
          {presets.length === 0 ? (
            <option value="">
              {t("dictate.reader.currentVoice", {
                defaultValue: "Current voice",
              })}
            </option>
          ) : null}
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {voicePresetOptionLabel(preset)}
            </option>
          ))}
        </select>

        <span className="text-[11px] font-medium text-[var(--muted)]">
          {t("dictate.reader.player.speed", { defaultValue: "Speed" })}
        </span>
        <label className="sr-only" htmlFor="reader-playback-speed">
          {t("dictate.reader.player.speed", { defaultValue: "Speed" })}
        </label>
        <select
          id="reader-playback-speed"
          value={String(playbackRate)}
          onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          className="h-8 rounded-full border border-[var(--border)] bg-[var(--input)] px-3 text-xs font-medium text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--accent-glow)]"
        >
          {readerPlaybackRateOptions.map((rate) => (
            <option key={rate} value={rate}>
              {t("dictate.reader.player.speedOption", {
                defaultValue: "{{rate}}x",
                rate,
              })}
            </option>
          ))}
        </select>
      </div>

      {currentText ? (
        <p className="line-clamp-2 border-t border-[var(--border)] pt-2 text-xs leading-5 text-[var(--muted)]">
          {currentText}
        </p>
      ) : null}
    </div>
  );
};
