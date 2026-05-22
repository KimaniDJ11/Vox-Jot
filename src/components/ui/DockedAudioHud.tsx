import React, { useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";

export const DOCKED_AUDIO_HUD_TICK_COUNT = 64;

export const DOCKED_AUDIO_HUD_TICK_HEIGHTS = Array.from(
  { length: DOCKED_AUDIO_HUD_TICK_COUNT },
  (_, i) => {
    const phase = i / (DOCKED_AUDIO_HUD_TICK_COUNT - 1);
    const wave =
      0.4 +
      0.6 *
        Math.abs(
          Math.sin(i * 0.5 + 0.4) *
            Math.cos(i * 0.27 + 1.3) *
            (1 - 0.2 * Math.abs(phase - 0.5)),
        );
    return Math.max(20, Math.min(100, Math.round(wave * 100)));
  },
);

interface DockedAudioHudProps {
  audioRef: React.RefObject<HTMLAudioElement>;
  audioSrc: string | null;
  isPlaying: boolean;
  isLoadingAudio: boolean;
  hasAudio: boolean;
  currentTime: number;
  duration: number;
  progressPercent: number;
  currentTimeLabel: string;
  durationLabel: string;
  playLabel: string;
  pauseLabel: string;
  timelineLabel: string;
  floatingTitle?: React.ReactNode;
  floatingControls?: React.ReactNode;
  details?: React.ReactNode;
  className?: string;
  onTogglePlay: () => void;
  onScrub: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAudioLoadedMetadata: (
    event: React.SyntheticEvent<HTMLAudioElement>,
  ) => void;
  onAudioPlay: () => void;
  onAudioPause: () => void;
  onAudioEnded: () => void;
}

export const DockedAudioHud: React.FC<DockedAudioHudProps> = ({
  audioRef,
  audioSrc,
  isPlaying,
  isLoadingAudio,
  hasAudio,
  currentTime,
  duration,
  progressPercent,
  currentTimeLabel,
  durationLabel,
  playLabel,
  pauseLabel,
  timelineLabel,
  floatingTitle,
  floatingControls,
  details,
  className = "",
  onTogglePlay,
  onScrub,
  onAudioLoadedMetadata,
  onAudioPlay,
  onAudioPause,
  onAudioEnded,
}) => {
  const [isHudInteracting, setIsHudInteracting] = useState(false);

  return (
    <div
      className={`story-audio-waveform-hud z-20 overflow-visible rounded-[1.75rem] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[0_22px_60px_-18px_rgba(0,0,0,0.32)] ${className}`}
      data-expanded={isHudInteracting ? "true" : "false"}
      onMouseEnter={() => setIsHudInteracting(true)}
      onMouseLeave={() => setIsHudInteracting(false)}
      onFocusCapture={() => setIsHudInteracting(true)}
      onBlurCapture={(event) => {
        const nextFocusedElement =
          event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (
          !nextFocusedElement ||
          !event.currentTarget.contains(nextFocusedElement)
        ) {
          setIsHudInteracting(false);
        }
      }}
    >
      <audio
        ref={audioRef}
        src={audioSrc ?? undefined}
        preload="metadata"
        onLoadedMetadata={onAudioLoadedMetadata}
        onPlay={onAudioPlay}
        onPause={onAudioPause}
        onEnded={onAudioEnded}
      />

      {floatingTitle ? (
        <div className="story-audio-waveform-hud__floating-title">
          {floatingTitle}
        </div>
      ) : null}

      {floatingControls ? (
        <div className="story-audio-waveform-hud__floating-controls">
          {floatingControls}
        </div>
      ) : null}

      <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={isLoadingAudio}
          aria-label={isPlaying ? pauseLabel : playLabel}
          title={isPlaying ? pauseLabel : playLabel}
          className={`relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--inverse-text)] transition-all duration-200 ease-out hover:scale-[1.03] hover:bg-[var(--accent-hover)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:opacity-50 disabled:hover:scale-100 sm:h-14 sm:w-14 ${
            isPlaying
              ? "shadow-[0_14px_36px_-12px_color-mix(in_srgb,var(--accent),transparent_25%)]"
              : "shadow-[0_8px_22px_-10px_color-mix(in_srgb,var(--accent),transparent_45%)]"
          }`}
        >
          {isLoadingAudio ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-6 w-6" fill="currentColor" />
          ) : (
            <Play className="h-6 w-6 translate-x-[1px]" fill="currentColor" />
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="group/scrub relative flex h-7 cursor-pointer items-center">
            <div
              aria-hidden
              className="absolute inset-0 flex items-center gap-[2px]"
            >
              {DOCKED_AUDIO_HUD_TICK_HEIGHTS.map((heightPercent, index) => {
                const tickProgress =
                  ((index + 0.5) / DOCKED_AUDIO_HUD_TICK_COUNT) * 100;
                const isFilled = hasAudio && tickProgress <= progressPercent;
                return (
                  <span
                    key={index}
                    className="flex-1 rounded-full transition-colors duration-100"
                    style={{
                      height: `${heightPercent}%`,
                      background: isFilled
                        ? "var(--accent)"
                        : audioSrc
                          ? "color-mix(in srgb, var(--muted), transparent 55%)"
                          : "color-mix(in srgb, var(--muted), transparent 75%)",
                    }}
                  />
                );
              })}
            </div>
            {hasAudio ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 h-7 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-0 shadow-[0_2px_8px_color-mix(in_srgb,var(--accent),transparent_55%)] transition-opacity duration-150 group-hover/scrub:opacity-100"
                style={{ left: `${progressPercent}%` }}
              />
            ) : null}
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={currentTime}
              onChange={onScrub}
              disabled={!hasAudio}
              className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
              aria-label={timelineLabel}
            />
          </div>
        </div>

        <span className="shrink-0 text-[13px] font-semibold tabular-nums leading-5 text-[var(--muted)]">
          <span className="text-[var(--text)]">{currentTimeLabel}</span>
          <span aria-hidden className="px-1 text-[var(--muted)]">
            /
          </span>
          {durationLabel}
        </span>
      </div>

      {details ? (
        <div className="story-audio-waveform-hud__details">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-4">
            {details}
          </div>
        </div>
      ) : null}
    </div>
  );
};
