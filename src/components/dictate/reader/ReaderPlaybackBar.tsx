import React from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";

import { ActionIconButton } from "@/components/ui";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import type { CreateVoiceHubVoiceRow } from "@/components/settings/general/listen/createVoiceVoiceHub";

import type { ReaderPlaybackStatus } from "./useReaderPlayback";
import { ReaderVoicePicker } from "./ReaderVoicePicker";

export type ReaderPlaybackBarProps = {
  status: ReaderPlaybackStatus;
  index: number;
  total: number;
  playbackRate: number;
  pageLabel: string | null;
  currentText: string;
  onToggle: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (index: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  presets: TtsVoicePreset[];
  presetVoices: CreateVoiceHubVoiceRow[];
  selectedPresetId: string | null;
  onSelectPreset: (presetId: string | null) => void;
  onCreatePresetFromVoice: (voice: CreateVoiceHubVoiceRow) => Promise<string>;
};

const readerPlaybackRateOptions = [0.75, 1, 1.25, 1.5, 1.75, 2];

export const ReaderPlaybackBar: React.FC<ReaderPlaybackBarProps> = ({
  status,
  index,
  total,
  playbackRate,
  pageLabel,
  currentText,
  onToggle,
  onStop,
  onPrev,
  onNext,
  onSeek,
  onPlaybackRateChange,
  presets,
  presetVoices,
  selectedPresetId,
  onSelectPreset,
  onCreatePresetFromVoice,
}) => {
  const { t } = useTranslation();
  const hasUnits = total > 0;
  const isPlaying = status === "playing";
  const maxIndex = Math.max(total - 1, 0);
  const clampedIndex = Math.min(Math.max(index, 0), maxIndex);
  // Fill must track the native thumb position (value / max), so the accent fill
  // ends exactly under the thumb. Uses the same card-pill track styling as the
  // app's shared Slider via the global `--slider-bg` CSS variable.
  const fillPercent = maxIndex > 0 ? (clampedIndex / maxIndex) * 100 : 0;
  const trackStyle = {
    "--slider-bg": hasUnits
      ? `linear-gradient(to right, color-mix(in srgb, var(--accent), var(--card) 52%) ${fillPercent}%, var(--card) ${fillPercent}%)`
      : "var(--card)",
  } as React.CSSProperties;

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
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--on-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
            max={maxIndex}
            value={clampedIndex}
            onChange={(event) => onSeek(Number(event.target.value))}
            disabled={!hasUnits}
            aria-label={t("dictate.reader.player.scrub", {
              defaultValue: "Reading position",
            })}
            className="block h-11 w-full cursor-pointer appearance-none bg-transparent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            style={trackStyle}
          />
          <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] text-[var(--muted)]">
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
        <div className="w-[210px]">
          <ReaderVoicePicker
            value={selectedPresetId}
            presets={presets}
            presetVoices={presetVoices}
            onSelectPreset={(presetId) => onSelectPreset(presetId)}
            onSelectDefault={() => onSelectPreset(null)}
            onCreatePresetFromVoice={onCreatePresetFromVoice}
          />
        </div>

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
