import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import { commands } from "@/bindings";
import i18n, { syncLanguageFromSettings } from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";

type OverlayState = "recording" | "transcribing" | "processing";
type OverlayStyle = "compact" | "detailed";

interface ShowOverlayPayload {
  state: OverlayState;
  style: OverlayStyle;
}

const BAR_COUNT_DETAILED = 12;
const BAR_COUNT_COMPACT = 5;
const SMOOTHING = 0.65;

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  const [style, setStyle] = useState<OverlayStyle>("compact");
  const [levels, setLevels] = useState<number[]>(
    Array(BAR_COUNT_DETAILED).fill(0),
  );
  const [partialText, setPartialText] = useState("");
  const smoothedRef = useRef<number[]>(Array(BAR_COUNT_DETAILED).fill(0));
  const direction = getLanguageDirection(i18n.language);

  const barCount =
    style === "compact" ? BAR_COUNT_COMPACT : BAR_COUNT_DETAILED;

  useEffect(() => {
    const setup = async () => {
      const unShow = await listen<ShowOverlayPayload>(
        "show-overlay",
        async (event) => {
          await syncLanguageFromSettings();
          const payload = event.payload;
          setState(payload.state);
          setStyle(payload.style);
          setIsVisible(true);
        },
      );

      const unHide = await listen("hide-overlay", () => {
        setIsVisible(false);
        setPartialText("");
      });

      const unLevel = await listen<number[]>("mic-level", (event) => {
        const raw = event.payload;
        const smoothed = smoothedRef.current.map((prev, i) => {
          const target = raw[i] ?? 0;
          return prev * SMOOTHING + target * (1 - SMOOTHING);
        });
        smoothedRef.current = smoothed;
        setLevels(smoothed);
      });

      const unPartial = await listen<string>(
        "partial-transcription",
        (event) => {
          setPartialText((event.payload as string) || "");
        },
      );

      return () => {
        unShow();
        unHide();
        unLevel();
        unPartial();
      };
    };

    setup();
  }, []);

  const isCompact = style === "compact";
  const overlayClass = [
    "recording-overlay",
    isCompact ? "recording-overlay--compact" : "",
    isVisible ? "fade-in" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const visibleLevels = levels.slice(0, barCount);

  if (isCompact) {
    return (
      <div dir={direction} className={overlayClass}>
        {/* Compact: bars only while recording, pulsing dot while processing */}
        {state === "recording" ? (
          <div className="bars-container">
            {visibleLevels.map((v, i) => (
              <div
                key={i}
                className="bar"
                style={{
                  height: `${Math.min(16, 3 + Math.pow(v, 0.65) * 13)}px`,
                  opacity: Math.max(0.3, Math.min(1, v * 2)),
                  transition: "height 70ms ease-out, opacity 100ms ease-out",
                }}
              />
            ))}
          </div>
        ) : (
          <span className="status-dot" />
        )}
      </div>
    );
  }

  return (
    <div dir={direction} className={overlayClass}>
      {/* Left: state icon */}
      <div
        className={`overlay-left ${state === "recording" ? "is-recording" : ""}`}
      >
        {state === "recording" ? <MicIcon /> : <WaveIcon />}
      </div>

      {/* Middle: content */}
      <div className="overlay-middle">
        {state === "recording" ? (
          <div className="recording-content">
            <div className="bars-container">
              {visibleLevels.map((v, i) => (
                <div
                  key={i}
                  className="bar"
                  style={{
                    height: `${Math.min(18, 3 + Math.pow(v, 0.65) * 15)}px`,
                    opacity: Math.max(0.25, Math.min(1, v * 2)),
                    transition: "height 70ms ease-out, opacity 100ms ease-out",
                  }}
                />
              ))}
            </div>
            {partialText.trim().length > 0 && (
              <div className="partial-text" title={partialText}>
                {partialText}
              </div>
            )}
          </div>
        ) : (
          <div className="status-text">
            <span className="status-dot" />
            {state === "transcribing"
              ? t("overlay.transcribing")
              : t("overlay.processing")}
          </div>
        )}
      </div>

      {/* Right: cancel */}
      <div className="overlay-right">
        {state === "recording" && (
          <button
            className="cancel-button"
            onClick={() => commands.cancelOperation()}
            aria-label={t("common.cancel")}
          >
            <XIcon />
          </button>
        )}
      </div>
    </div>
  );
};

/* ── Inline SVG icons (no external deps in the overlay bundle) ── */

const MicIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="7" y="2" width="6" height="10" rx="3" fill="var(--ov-accent)" />
    <path
      d="M4.5 9.5a5.5 5.5 0 0 0 11 0"
      stroke="var(--ov-accent)"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
    <line
      x1="10"
      y1="15"
      x2="10"
      y2="18"
      stroke="var(--ov-accent)"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const WaveIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path
      d="M3 10h2l1.5-3 2 6 2-8 2 10 1.5-5H16"
      stroke="var(--ov-accent)"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

const XIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path
      d="M3.5 3.5l7 7M10.5 3.5l-7 7"
      stroke="var(--ov-cancel)"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

export default RecordingOverlay;
