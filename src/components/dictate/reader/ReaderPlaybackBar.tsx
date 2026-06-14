import React from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronsUpDown,
  ClipboardCopy,
  Download,
  Languages,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
} from "lucide-react";

import { ActionIconButton } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import {
  SelectControl,
  type ModelListControlOption,
} from "@/components/model-hub/ModelListControls";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import type { CreateVoiceHubVoiceRow } from "@/components/settings/general/listen/createVoiceVoiceHub";
import {
  DOCKED_AUDIO_HUD_TICK_COUNT,
  DOCKED_AUDIO_HUD_TICK_HEIGHTS,
} from "@/components/ui/DockedAudioHud";

import type { ReaderPlaybackStatus } from "./useReaderPlayback";
import { ReaderVoicePicker } from "./ReaderVoicePicker";

export type ReaderPlaybackBarProps = {
  status: ReaderPlaybackStatus;
  index: number;
  total: number;
  playbackRate: number;
  audiobookFormat: "m4b" | "mp3" | "wav";
  pageLabel: string | null;
  onToggle: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (index: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onAudiobookFormatChange: (format: "m4b" | "mp3" | "wav") => void;
  presets: TtsVoicePreset[];
  presetVoices: CreateVoiceHubVoiceRow[];
  ttsModels?: CatalogModelDescriptor[];
  selectedPresetId: string | null;
  onSelectPreset: (presetId: string | null) => void;
  onCreatePresetFromVoice: (voice: CreateVoiceHubVoiceRow) => Promise<string>;
  audioCacheStatus: {
    total_count: number;
    ready_count: number;
    missing_count: number;
  } | null;
  isPreparingAudio: boolean;
  onPrepareAudio: () => void;
  onExportAudio: () => void;
  isExportingAudio: boolean;
  exportDisabled: boolean;
  onCopySection: () => void;
  copyFeedback: boolean;
  documentLanguage: string;
  readerLanguageOptions: ModelListControlOption[];
  onDocumentLanguageChange: (value: string) => void;
  selectedReaderLanguageLabel: string;
};

const readerPlaybackRateOptions = [0.75, 1, 1.25, 1.5, 1.75, 2];
const readerAudiobookFormatOptions = ["m4b", "mp3", "wav"] as const;

/**
 * Floating, docked Reader player — the same bottom-pinned HUD the Story Studio
 * and History views use (`story-audio-waveform-hud` + the fixed-position dock
 * class), driven by the unit-sequential `useReaderPlayback` engine. The
 * scrubber represents the whole document (one step per reading part), so
 * dragging it seeks to any section. It renders a flat track when idle/paused
 * and an animated waveform while playing — both seek by part.
 */
export const ReaderPlaybackBar: React.FC<ReaderPlaybackBarProps> = ({
  status,
  index,
  total,
  playbackRate,
  audiobookFormat,
  pageLabel,
  onToggle,
  onStop,
  onPrev,
  onNext,
  onSeek,
  onPlaybackRateChange,
  onAudiobookFormatChange,
  presets,
  presetVoices,
  ttsModels,
  selectedPresetId,
  onSelectPreset,
  onCreatePresetFromVoice,
  audioCacheStatus,
  isPreparingAudio,
  onPrepareAudio,
  onExportAudio,
  isExportingAudio,
  exportDisabled,
  onCopySection,
  copyFeedback,
  documentLanguage,
  readerLanguageOptions,
  onDocumentLanguageChange,
  selectedReaderLanguageLabel,
}) => {
  const { t } = useTranslation();
  const hasUnits = total > 0;
  const isPlaying = status === "playing";
  const maxIndex = Math.max(total - 1, 0);
  const clampedIndex = Math.min(Math.max(index, 0), maxIndex);
  // The fill tracks the native thumb position (value / max). The flat track
  // reuses the app's shared slider pill via the global `--slider-bg` variable.
  const progressPercent = maxIndex > 0 ? (clampedIndex / maxIndex) * 100 : 0;
  const trackStyle = {
    "--slider-bg": hasUnits
      ? `linear-gradient(to right, color-mix(in srgb, var(--accent), var(--card) 52%) ${progressPercent}%, var(--card) ${progressPercent}%)`
      : "var(--card)",
  } as React.CSSProperties;

  const scrubLabel = t("dictate.reader.player.scrub", {
    defaultValue: "Reading position",
  });
  const speedLabel = t("dictate.reader.player.speed", {
    defaultValue: "Speed",
  });
  const formatLabel = t("dictate.reader.player.exportFormat", {
    defaultValue: "Export format",
  });
  const exportFormatLabel = audiobookFormat.toUpperCase();
  const exportAudioLabel = isExportingAudio
    ? t("dictate.reader.exportingAudio", { defaultValue: "Exporting" })
    : t("dictate.reader.exportAudio", {
        defaultValue: "Export {{format}}",
        format: exportFormatLabel,
      });
  const copySectionLabel = copyFeedback
    ? t("dictate.reader.copied", { defaultValue: "Copied" })
    : t("dictate.reader.copySection", { defaultValue: "Copy section" });
  const playLabel = isPlaying
    ? t("dictate.reader.player.pause", { defaultValue: "Pause" })
    : status === "paused"
      ? t("dictate.reader.player.resume", { defaultValue: "Resume" })
      : t("dictate.reader.player.play", { defaultValue: "Play" });
  const audioReady =
    hasUnits &&
    audioCacheStatus !== null &&
    audioCacheStatus.total_count > 0 &&
    audioCacheStatus.missing_count === 0;
  const prepareAudioButtonClassName = [
    "gap-1.5 text-[11px]",
    audioReady ? "disabled:opacity-100" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const positionLabel = hasUnits
    ? t("dictate.reader.player.position", {
        defaultValue: "Part {{current}} of {{total}}",
        current: index + 1,
        total,
      })
    : t("dictate.reader.player.nothingToRead", {
        defaultValue: "Nothing to read",
      });

  return (
    <div className="story-audio-waveform-hud reader-docked-player z-20 overflow-visible rounded-[1.75rem]">
      <div className="story-audio-waveform-hud__floating-title">
        <ReaderVoicePicker
          value={selectedPresetId}
          presets={presets}
          presetVoices={presetVoices}
          ttsModels={ttsModels}
          onSelectPreset={(presetId) => onSelectPreset(presetId)}
          onSelectDefault={() => onSelectPreset(null)}
          onCreatePresetFromVoice={onCreatePresetFromVoice}
          allowDefault={false}
        />
      </div>

      <div className="story-audio-waveform-hud__floating-controls">
        <label className="sr-only" htmlFor="reader-playback-speed">
          {speedLabel}
        </label>
        <div className="relative inline-flex">
          <select
            id="reader-playback-speed"
            value={String(playbackRate)}
            onChange={(event) =>
              onPlaybackRateChange(Number(event.target.value))
            }
            className="h-9 appearance-none rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--accent),transparent_72%)] bg-[var(--panel-bg)] py-1 pl-3 pr-7 text-xs font-medium text-[var(--text)] shadow-[var(--segmented-control-shadow)] outline-none transition-colors hover:border-[color-mix(in_srgb,var(--accent),transparent_50%)] focus:ring-2 focus:ring-[var(--accent-glow)]"
            aria-label={speedLabel}
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
          <ChevronsUpDown
            className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]"
            aria-hidden="true"
          />
        </div>

        <label className="sr-only" htmlFor="reader-audiobook-format">
          {formatLabel}
        </label>
        <div className="relative inline-flex">
          <select
            id="reader-audiobook-format"
            value={audiobookFormat}
            onChange={(event) =>
              onAudiobookFormatChange(
                event.target.value as "m4b" | "mp3" | "wav",
              )
            }
            className="h-9 appearance-none rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--accent),transparent_72%)] bg-[var(--panel-bg)] py-1 pl-3 pr-7 text-xs font-medium text-[var(--text)] shadow-[var(--segmented-control-shadow)] outline-none transition-colors hover:border-[color-mix(in_srgb,var(--accent),transparent_50%)] focus:ring-2 focus:ring-[var(--accent-glow)]"
            aria-label={formatLabel}
            title={`${formatLabel}: ${exportFormatLabel}`}
          >
            {readerAudiobookFormatOptions.map((format) => (
              <option key={format} value={format}>
                {format.toUpperCase()}
              </option>
            ))}
          </select>
          <ChevronsUpDown
            className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]"
            aria-hidden="true"
          />
        </div>

        <Button
          type="button"
          size="sm"
          variant={audioReady ? "control" : "secondary"}
          disabled={!hasUnits || isPreparingAudio || audioReady}
          onClick={onPrepareAudio}
          className={prepareAudioButtonClassName}
        >
          {isPreparingAudio ? (
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          ) : audioReady ? (
            <Check size={13} aria-hidden="true" />
          ) : null}
          {isPreparingAudio
            ? t("dictate.reader.player.preparingAudio", {
                defaultValue: "Preparing",
              })
            : audioReady
              ? t("dictate.reader.player.readyAudio", {
                  defaultValue: "Ready",
                })
              : t("dictate.reader.player.prepareAudio", {
                  defaultValue: "Prepare audio",
                })}
        </Button>

        <SelectControl
          value={documentLanguage}
          options={readerLanguageOptions}
          onChange={onDocumentLanguageChange}
          ariaLabel={t("dictate.reader.language.ariaLabel", {
            defaultValue: "Reader language",
          })}
          title={t("dictate.reader.language.title", {
            defaultValue: "Language: {{language}}",
            language: selectedReaderLanguageLabel,
          })}
          selectedLabel={selectedReaderLanguageLabel}
          active={documentLanguage !== "auto"}
        >
          <Languages className="h-4 w-4" />
        </SelectControl>

        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          onClick={onExportAudio}
          disabled={isExportingAudio || exportDisabled}
          title={exportAudioLabel}
          aria-label={exportAudioLabel}
        >
          {isExportingAudio ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          onClick={onCopySection}
          title={copySectionLabel}
          aria-label={copySectionLabel}
        >
          {copyFeedback ? (
            <Check aria-hidden="true" />
          ) : (
            <ClipboardCopy aria-hidden="true" />
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2 px-3 py-3 sm:gap-2.5 sm:px-4">
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
          className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--on-accent)] shadow-[0_8px_22px_-10px_color-mix(in_srgb,var(--accent),transparent_45%)] transition-all duration-200 ease-out hover:scale-[1.03] hover:bg-[var(--accent-hover)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
        >
          {isPlaying ? (
            <Pause size={20} aria-hidden="true" fill="currentColor" />
          ) : (
            <Play
              size={20}
              aria-hidden="true"
              fill="currentColor"
              className="translate-x-[1px]"
            />
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

        <div className="min-w-0 flex-1">
          {isPlaying ? (
            <div className="group/scrub relative flex h-11 cursor-pointer items-center">
              <div
                aria-hidden
                className="absolute inset-0 flex items-center gap-[2px]"
              >
                {DOCKED_AUDIO_HUD_TICK_HEIGHTS.map(
                  (heightPercent, tickIndex) => {
                    const tickProgress =
                      ((tickIndex + 0.5) / DOCKED_AUDIO_HUD_TICK_COUNT) * 100;
                    const isFilled =
                      hasUnits && tickProgress <= progressPercent;
                    return (
                      <span
                        key={tickIndex}
                        className="flex-1 rounded-full transition-colors duration-100"
                        style={{
                          height: `${heightPercent}%`,
                          background: isFilled
                            ? "var(--accent)"
                            : "color-mix(in srgb, var(--muted), transparent 55%)",
                        }}
                      />
                    );
                  },
                )}
              </div>
              <input
                type="range"
                min={0}
                max={maxIndex}
                step={1}
                value={clampedIndex}
                onChange={(event) => onSeek(Number(event.target.value))}
                disabled={!hasUnits}
                aria-label={scrubLabel}
                className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
              />
            </div>
          ) : (
            <input
              type="range"
              min={0}
              max={maxIndex}
              value={clampedIndex}
              onChange={(event) => onSeek(Number(event.target.value))}
              disabled={!hasUnits}
              aria-label={scrubLabel}
              className="block h-11 w-full cursor-pointer appearance-none bg-transparent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              style={trackStyle}
            />
          )}
        </div>

        <span className="shrink-0 text-right text-[11px] font-medium leading-4 text-[var(--muted)]">
          <span className="block text-[var(--text)]">{positionLabel}</span>
          {pageLabel ? <span className="block">{pageLabel}</span> : null}
        </span>
      </div>
    </div>
  );
};
