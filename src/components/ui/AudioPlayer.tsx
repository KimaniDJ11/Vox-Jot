import React, { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, Pause, Play } from "lucide-react";

import { interactiveFocusRingClass } from "@/lib/interactiveFocus";

interface AudioPlayerProps {
  /** Audio source URL. If not provided, onLoadRequest must be provided. */
  src?: string;
  /** Called when play is clicked and no src is loaded yet. Should return the audio URL. */
  onLoadRequest?: () => Promise<string | null>;
  className?: string;
  autoPlay?: boolean;
  /** Optional title shown above the scrubber. */
  title?: React.ReactNode;
  /**
   * Optional inline meta line shown below the scrubber.
   * Pre-formatted string or ReactNode. Truncates with ellipsis.
   */
  meta?: React.ReactNode;
  /**
   * Optional action strip rendered to the right of the title.
   * Hidden by default; revealed on hover/focus inside the cassette.
   */
  actions?: React.ReactNode;
  /** When true, a small accent star pin is always shown beside the title. */
  starred?: boolean;
  /** When true, the cassette tile gets a stronger accent ring (selected state). */
  selected?: boolean;
  /** Optional artwork shown in the play tile, with controls revealed above it. */
  artwork?: React.ReactNode;
  /** Optional initial duration to show before the audio is loaded */
  initialDuration?: number;
}

const STARRED_GLYPH = "★";
const TICK_COUNT = 36;
// Deterministic pseudo-waveform — same shape across renders so the row never
// shifts. Sine + cosine combination gives a music-like "envelope".
const TICK_HEIGHTS: number[] = Array.from({ length: TICK_COUNT }, (_, i) => {
  const phase = i / (TICK_COUNT - 1);
  const wave =
    0.45 +
    0.55 *
      Math.abs(
        Math.sin(i * 0.7 + 0.3) *
          Math.cos(i * 0.32 + 1.1) *
          (1 - 0.25 * Math.abs(phase - 0.5)),
      );
  return Math.max(22, Math.min(100, Math.round(wave * 100)));
});

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src: initialSrc,
  onLoadRequest,
  className = "",
  autoPlay = false,
  title,
  meta,
  actions,
  starred = false,
  selected = false,
  artwork,
  initialDuration,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(initialSrc ?? null);
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number>();
  const dragTimeRef = useRef<number>(0);

  const isPlayingRef = useRef(false);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  const tick = useCallback(() => {
    if (audioRef.current && !isDraggingRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
    if (isPlayingRef.current) {
      animationRef.current = requestAnimationFrame(tick);
    }
  }, []);

  useEffect(() => {
    if (isPlaying && !isDragging) {
      if (!animationRef.current) {
        animationRef.current = requestAnimationFrame(tick);
      }
    } else if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = undefined;
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [isPlaying, isDragging, tick]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      setCurrentTime(0);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, []);

  const prevLoadedSrc = useRef<string | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (loadedSrc && !prevLoadedSrc.current && onLoadRequest) {
      audio.play().catch((error) => {
        console.error("Auto-play failed:", error);
      });
    } else if (autoPlay && initialSrc && !prevLoadedSrc.current) {
      audio.play().catch((error) => {
        console.error("Auto-play failed:", error);
      });
    }
    prevLoadedSrc.current = loadedSrc;
  }, [loadedSrc, autoPlay, initialSrc, onLoadRequest]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (audioRef.current) {
        audioRef.current.currentTime = dragTimeRef.current;
        setCurrentTime(dragTimeRef.current);
      }
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("touchend", handleMouseUp);
      return () => {
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchend", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseUp]);

  useEffect(() => {
    return () => {
      if (loadedSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(loadedSrc);
      }
    };
  }, [loadedSrc]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || isLoading) return;
    try {
      if (isPlaying) {
        audio.pause();
        return;
      }
      if (!loadedSrc && onLoadRequest) {
        setIsLoading(true);
        const newSrc = await onLoadRequest();
        setIsLoading(false);
        if (newSrc) {
          setLoadedSrc(newSrc);
          // playback will fire from the loadedSrc effect
        }
      } else if (loadedSrc) {
        await audio.play();
      }
    } catch (error) {
      console.error("Playback failed:", error);
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(event.target.value);
    dragTimeRef.current = newTime;
    setCurrentTime(newTime);
    if (!isDragging && audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleSliderMouseDown = () => setIsDragging(true);
  const handleSliderTouchStart = () => setIsDragging(true);

  const formatTime = (time: number): string => {
    if (!isFinite(time) || time < 0) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const progressPercent =
    duration > 0
      ? duration - currentTime < 0.1
        ? 100
        : Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;

  const hasAudio = duration > 0;
  const isReady = Boolean(loadedSrc) || Boolean(initialSrc);
  const tileLabel = isLoading ? "Loading audio" : isPlaying ? "Pause" : "Play";
  const controlIcon = isLoading ? (
    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
  ) : isPlaying ? (
    <Pause className="h-5 w-5" fill="currentColor" aria-hidden />
  ) : (
    <Play
      className="h-5 w-5 translate-x-[1px]"
      fill="currentColor"
      aria-hidden
    />
  );

  return (
    <div
      className={`group/audio relative flex items-stretch gap-3 ${className}`}
    >
      <audio ref={audioRef} src={loadedSrc ?? undefined} preload="metadata" />

      <button
        type="button"
        onClick={togglePlay}
        disabled={isLoading}
        aria-label={tileLabel}
        title={tileLabel}
        className={[
          "group/play-tile relative inline-flex h-12 w-12 shrink-0 items-center justify-center self-center overflow-hidden",
          artwork
            ? "rounded-xl bg-transparent text-[var(--accent)]"
            : "rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]",
          "transition-all duration-200 ease-out",
          artwork
            ? "hover:scale-[1.04]"
            : "hover:scale-[1.04] hover:bg-[color-mix(in_srgb,var(--accent-soft),var(--accent)_10%)]",
          "active:scale-[0.97]",
          interactiveFocusRingClass,
          "disabled:opacity-60 disabled:hover:scale-100",
          isPlaying
            ? "shadow-[0_10px_28px_-12px_color-mix(in_srgb,var(--accent),transparent_25%)] ring-1 ring-[color-mix(in_srgb,var(--accent),transparent_60%)]"
            : "",
          selected
            ? "ring-2 ring-[color-mix(in_srgb,var(--accent),transparent_55%)]"
            : "",
        ].join(" ")}
      >
        {artwork ? (
          <>
            <span
              className={`relative z-0 flex items-center justify-center transition-transform duration-150 ${
                isLoading || isPlaying
                  ? "scale-95 opacity-45"
                  : "group-hover/audio:scale-105"
              }`}
              aria-hidden
            >
              {artwork}
            </span>
            <span
              className={`absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg),transparent_45%)] transition-opacity duration-150 ${
                isLoading || isPlaying
                  ? "opacity-100"
                  : "opacity-0 group-hover/audio:opacity-100 group-focus-within/audio:opacity-100"
              }`}
              aria-hidden
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--card)_88%,transparent)] text-[var(--accent)] shadow-[0_6px_16px_color-mix(in_srgb,var(--text),transparent_82%)] backdrop-blur-sm">
                {controlIcon}
              </span>
            </span>
          </>
        ) : (
          controlIcon
        )}
        {isPlaying ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-px rounded-2xl ring-1 ring-[color-mix(in_srgb,var(--accent),transparent_70%)]"
          />
        ) : null}
      </button>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        {title || actions || starred ? (
          <div className="flex min-w-0 items-center gap-2">
            {title ? (
              <p className="m-0 min-w-0 truncate text-sm font-semibold leading-5 text-[var(--text)]">
                {title}
              </p>
            ) : null}
            {starred ? (
              <span
                aria-label="Starred"
                title="Starred"
                className="inline-flex h-4 shrink-0 items-center rounded-full bg-[var(--accent-soft)] px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--accent)]"
              >
                {STARRED_GLYPH}
              </span>
            ) : null}
            {actions ? (
              <div
                onClick={(event) => event.stopPropagation()}
                className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/audio:opacity-100 focus-within:opacity-100"
              >
                {actions}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-3 flex-1 items-center">
            {/* Static waveform tick marks */}
            <div
              aria-hidden
              className="absolute inset-0 flex items-center gap-[2px]"
            >
              {TICK_HEIGHTS.map((heightPercent, index) => {
                const tickProgress = ((index + 0.5) / TICK_COUNT) * 100;
                const isFilled = hasAudio && tickProgress <= progressPercent;
                return (
                  <span
                    key={index}
                    className="flex-1 rounded-full transition-colors duration-100"
                    style={{
                      height: `${heightPercent}%`,
                      background: isFilled
                        ? "var(--accent)"
                        : isReady
                          ? "color-mix(in srgb, var(--muted), transparent 55%)"
                          : "color-mix(in srgb, var(--muted), transparent 75%)",
                    }}
                  />
                );
              })}
            </div>
            {/* Hover thumb at playhead position */}
            {hasAudio ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-0 shadow-[0_2px_6px_color-mix(in_srgb,var(--accent),transparent_60%)] transition-opacity duration-150 group-hover/audio:opacity-100"
                style={{ left: `${progressPercent}%` }}
              />
            ) : null}
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={currentTime}
              onChange={handleSeek}
              onMouseDown={handleSliderMouseDown}
              onTouchStart={handleSliderTouchStart}
              disabled={!hasAudio}
              aria-label="Audio timeline"
              className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
            />
          </div>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--muted)]">
            {hasAudio
              ? `${formatTime(currentTime)} / ${formatTime(duration)}`
              : "—:—"}
          </span>
        </div>

        {meta ? (
          <div className="flex min-w-0 items-center gap-1.5 truncate text-[11px] leading-4 text-[var(--muted)]">
            {meta}
          </div>
        ) : null}
      </div>
    </div>
  );
};
