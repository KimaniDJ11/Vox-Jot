import { listen } from "@tauri-apps/api/event";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import "./RecordingOverlay.css";
import {
  commands,
  type ContextCaptureStatus,
  type ResolvedWriteRule,
} from "@/bindings";
import i18n from "@/i18n";
import { getLanguageDirection } from "@/lib/utils/rtl";
import { bounce } from "@/motion/springs";

type OverlayState = "recording" | "transcribing" | "processing";
type OverlayStyle = "compact" | "detailed" | "minimal" | "notch";

interface ShowOverlayPayload {
  state: OverlayState;
  style: OverlayStyle;
}

interface CorrectionOverlayPayload {
  original: string;
  corrected: string;
  confidence: number;
  additionalCount?: number;
}

interface SettingsChangedPayload {
  setting?: string;
  value?: unknown;
}

interface ScreenContextCapturePayload {
  captured_at_ms: number;
}

const BAR_COUNT_DETAILED = 64;
const BAR_COUNT_COMPACT = 9;
const ATTACK = 0.35;
const RELEASE = 0.12;
const MIN_BAR_PX = 2;
const SCREEN_CONTEXT_PULSE_MS = 800;
const ruleBadgePrefix = "▸";

/** Organic center-weighted waveform with attack/release envelope + ring buffer. */
function useWaveform(
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
  barCount: number,
  state: OverlayState,
  recording: boolean,
  enabled: boolean,
) {
  /** Most recent raw level per bar (written in the mic-level event handler). */
  const targetsRef = useRef<Float32Array>(new Float32Array(barCount));
  /** Smoothed amplitudes shown on screen. */
  const displayRef = useRef<Float32Array>(new Float32Array(barCount));
  /** Ring buffer of the last `barCount` peak amplitudes for scrolling feel. */
  const bufferRef = useRef<Float32Array>(new Float32Array(barCount));
  const bufferCursorRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const stateRef = useRef<OverlayState>(state);
  const recordingRef = useRef<boolean>(recording);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });

  useEffect(() => {
    stateRef.current = state;
    recordingRef.current = recording;
  }, [state, recording]);

  // Resize the underlying arrays if bar count changes.
  useEffect(() => {
    targetsRef.current = new Float32Array(barCount);
    displayRef.current = new Float32Array(barCount);
    bufferRef.current = new Float32Array(barCount);
    bufferCursorRef.current = 0;
  }, [barCount]);

  const writeLevels = useCallback(
    (raw: number[]) => {
      const n = barCount;
      const targets = targetsRef.current;
      // Down/upsample the incoming raw array into n bins.
      if (raw.length === 0) {
        targets.fill(0);
        return;
      }
      const ratio = raw.length / n;
      let peak = 0;
      for (let i = 0; i < n; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
        let sum = 0;
        let count = 0;
        for (let j = start; j < end && j < raw.length; j++) {
          sum += raw[j] ?? 0;
          count++;
        }
        const avg = count > 0 ? sum / count : 0;
        targets[i] = avg;
        if (avg > peak) peak = avg;
      }
      // Push the frame's peak into the ring buffer so bars also scroll.
      const buf = bufferRef.current;
      buf[bufferCursorRef.current] = peak;
      bufferCursorRef.current = (bufferCursorRef.current + 1) % n;
    },
    [barCount],
  );

  useEffect(() => {
    if (!enabled) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    contextRef.current = ctx;

    const syncCanvasSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      sizeRef.current = { width, height, dpr };
    };

    syncCanvasSize();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncCanvasSize);
    resizeObserver?.observe(canvas);
    window.addEventListener("resize", syncCanvasSize);

    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const { width: w, height: h, dpr } = sizeRef.current;
        const ctx = contextRef.current;
        if (ctx && w > 0 && h > 0) {
          const n = barCount;
          const targets = targetsRef.current;
          const display = displayRef.current;
          const buffer = bufferRef.current;
          const cursor = bufferCursorRef.current;

          // Advance envelope (attack/release) per bar.
          for (let i = 0; i < n; i++) {
            // Blend a sample of the ring buffer into the target so bars
            // appear to scroll left-to-right instead of only pulsing.
            const ringIdx = (cursor + i) % n;
            const target = Math.max(targets[i], buffer[ringIdx] * 0.6);
            const d = display[i];
            const coef = target > d ? ATTACK : RELEASE;
            display[i] = d + (target - d) * coef;
          }

          // Clear.
          ctx.clearRect(0, 0, w, h);

          const barStep = w / n;
          const barWidth = Math.max(1, Math.floor(barStep * 0.55));
          const radius = Math.min(barWidth / 2, 3 * dpr);
          const minH = MIN_BAR_PX * dpr;

          // Color based on state.
          const active =
            stateRef.current === "recording" && recordingRef.current;
          ctx.fillStyle = active
            ? "rgba(255,255,255,0.92)"
            : "rgba(255,255,255,0.55)";

          for (let i = 0; i < n; i++) {
            // Center-weighted bell: taller in the middle.
            const bell = 0.6 + 0.4 * Math.sin((Math.PI * (i + 0.5)) / n);
            const amp = Math.max(0, Math.min(1, display[i])) * bell;
            const barH = Math.max(minH, Math.pow(amp, 0.7) * h);
            const x = Math.floor(i * barStep + (barStep - barWidth) / 2);
            const y = Math.floor((h - barH) / 2);
            roundedRect(ctx, x, y, barWidth, barH, radius);
            ctx.fill();
          }
        }
      }
      frameRef.current = requestAnimationFrame(draw);
    };
    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      contextRef.current = null;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncCanvasSize);
    };
  }, [barCount, canvasRef, enabled]);

  return { writeLevels };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

const RecordingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [state, setState] = useState<OverlayState>("recording");
  const [style, setStyle] = useState<OverlayStyle>("compact");
  const [correction, setCorrection] = useState<CorrectionOverlayPayload | null>(
    null,
  );
  const [partialText, setPartialText] = useState("");
  const [screenContextEnabled, setScreenContextEnabled] = useState(true);
  const [screenContextStatus, setScreenContextStatus] =
    useState<ContextCaptureStatus | null>(null);
  const [screenContextPulseVisible, setScreenContextPulseVisible] =
    useState(false);
  const [matchedRule, setMatchedRule] = useState<ResolvedWriteRule | null>(
    null,
  );
  const direction = getLanguageDirection(i18n.language);

  const isCompact = style === "compact";
  const isMinimal = style === "minimal";
  const isNotch = style === "notch";
  // Notch uses the compact bar count (small footprint, single waveform).
  // Minimal renders no waveform, only a status dot, so its bar count
  // is irrelevant — we still pick a value so the canvas isn't undefined.
  const barCount = useMemo(
    () =>
      isCompact || isNotch || isMinimal
        ? BAR_COUNT_COMPACT
        : BAR_COUNT_DETAILED,
    [isCompact, isNotch, isMinimal],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformEnabled =
    isVisible && !correction && !isMinimal && state === "recording";
  const { writeLevels } = useWaveform(
    canvasRef,
    barCount,
    state,
    state === "recording",
    waveformEnabled,
  );
  const writeLevelsRef = useRef(writeLevels);
  const screenContextEnabledRef = useRef(screenContextEnabled);
  const screenContextStatusRef = useRef(screenContextStatus);
  const screenContextPulseTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    writeLevelsRef.current = writeLevels;
  }, [writeLevels]);

  useEffect(() => {
    screenContextEnabledRef.current = screenContextEnabled;
  }, [screenContextEnabled]);

  useEffect(() => {
    screenContextStatusRef.current = screenContextStatus;
  }, [screenContextStatus]);

  const clearScreenContextPulse = useCallback(() => {
    if (screenContextPulseTimeoutRef.current !== null) {
      window.clearTimeout(screenContextPulseTimeoutRef.current);
      screenContextPulseTimeoutRef.current = null;
    }
    setScreenContextPulseVisible(false);
  }, []);

  const pulseScreenContextCapture = useCallback(() => {
    clearScreenContextPulse();
    setScreenContextPulseVisible(true);
    screenContextPulseTimeoutRef.current = window.setTimeout(() => {
      setScreenContextPulseVisible(false);
      screenContextPulseTimeoutRef.current = null;
    }, SCREEN_CONTEXT_PULSE_MS);
  }, [clearScreenContextPulse]);

  useEffect(() => {
    const setup = async () => {
      const settingsResult = await commands.getAppSettings();
      if (settingsResult.status === "ok") {
        const nextEnabled = settingsResult.data.screen_context_enabled ?? true;
        screenContextEnabledRef.current = nextEnabled;
        setScreenContextEnabled(nextEnabled);
      }

      const diagnosticsResult = await commands.getScreenContextDiagnostics();
      if (diagnosticsResult.status === "ok") {
        screenContextStatusRef.current = diagnosticsResult.data.status;
        setScreenContextStatus(diagnosticsResult.data.status);
      }

      const unShow = await listen<ShowOverlayPayload>(
        "show-overlay",
        (event) => {
          const payload = event.payload;
          setState(payload.state);
          setStyle(payload.style);
          setCorrection(null);
          setIsVisible(true);
        },
      );

      const unCorrection = await listen<CorrectionOverlayPayload>(
        "show-correction-overlay",
        (event) => {
          setCorrection(event.payload);
          setStyle("detailed");
          setIsVisible(true);
        },
      );

      const unHide = await listen("hide-overlay", () => {
        setIsVisible(false);
        setCorrection(null);
        setPartialText("");
        setMatchedRule(null);
        clearScreenContextPulse();
      });

      const unLevel = await listen<number[]>("mic-level", (event) => {
        writeLevelsRef.current(event.payload);
      });

      const unPartial = await listen<string>(
        "partial-transcription",
        (event) => {
          setPartialText((event.payload as string) || "");
        },
      );

      const unRuleMatched = await listen<ResolvedWriteRule>(
        "write-rule-matched",
        (event) => {
          setMatchedRule(event.payload);
        },
      );

      const unRuleCleared = await listen("write-rule-cleared", () => {
        setMatchedRule(null);
      });

      const unSettingsChanged = await listen<SettingsChangedPayload>(
        "settings-changed",
        (event) => {
          if (event.payload.setting !== "screen_context_enabled") {
            return;
          }
          const nextEnabled = event.payload.value !== false;
          screenContextEnabledRef.current = nextEnabled;
          setScreenContextEnabled(nextEnabled);
          if (!nextEnabled) {
            screenContextStatusRef.current = "disabled";
            setScreenContextStatus("disabled");
            clearScreenContextPulse();
          }
        },
      );

      const unScreenContextStatus = await listen<ContextCaptureStatus>(
        "screen-context-status",
        (event) => {
          const nextStatus = event.payload;
          screenContextStatusRef.current = nextStatus;
          setScreenContextStatus(nextStatus);
          if (nextStatus === "disabled" || nextStatus === "excluded_app") {
            clearScreenContextPulse();
          }
        },
      );

      const unScreenContextCapture = await listen<ScreenContextCapturePayload>(
        "screen-context-capture",
        () => {
          const currentStatus = screenContextStatusRef.current;
          if (
            !screenContextEnabledRef.current ||
            currentStatus === "disabled" ||
            currentStatus === "excluded_app"
          ) {
            return;
          }
          pulseScreenContextCapture();
        },
      );

      return () => {
        unShow();
        unCorrection();
        unHide();
        unLevel();
        unPartial();
        unRuleMatched();
        unRuleCleared();
        unSettingsChanged();
        unScreenContextStatus();
        unScreenContextCapture();
      };
    };

    const teardownPromise = setup();
    return () => {
      void teardownPromise.then((teardown) => teardown());
      clearScreenContextPulse();
    };
  }, [clearScreenContextPulse, pulseScreenContextCapture]);

  const showScreenContextPulse =
    screenContextEnabled &&
    screenContextPulseVisible &&
    screenContextStatus !== "disabled" &&
    screenContextStatus !== "excluded_app";
  const statusLabel = correction
    ? t("overlay.correctionPreview", { defaultValue: "Correction preview" })
    : state === "recording"
      ? t("overlay.recording")
      : state === "transcribing"
        ? t("overlay.transcribing")
        : t("overlay.processing");

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          dir={direction}
          className={[
            "recording-overlay",
            isCompact ? "recording-overlay--compact" : "",
            isMinimal ? "recording-overlay--minimal" : "",
            isNotch ? "recording-overlay--notch" : "",
            correction ? "recording-overlay--correction" : "",
            !isCompact && !isMinimal && !isNotch && state === "recording"
              ? "is-interactive"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={bounce}
        >
          <span className="sr-only" role="status" aria-live="polite">
            {statusLabel}
          </span>
          {correction ? (
            <CorrectionBody payload={correction} />
          ) : isMinimal ? (
            // Minimal: just a single dot — pulsing while recording,
            // amber while transcribing, slow while post-processing.
            <span
              className={`overlay-dot overlay-dot--${state}`}
              aria-label={
                state === "recording"
                  ? t("overlay.recording")
                  : state === "transcribing"
                    ? t("overlay.transcribing")
                    : t("overlay.processing")
              }
            />
          ) : isCompact || isNotch ? (
            <CompactBody state={state} canvasRef={canvasRef} />
          ) : (
            <>
              <div
                className={`overlay-left ${state === "recording" ? "is-recording" : ""}`}
              >
                {state === "recording" ? <MicIcon /> : <WaveIcon />}
              </div>
              <div className="overlay-middle">
                {state === "recording" ? (
                  <div className="recording-content">
                    <canvas
                      ref={canvasRef}
                      className="waveform-canvas"
                      aria-hidden
                    />
                    <div className="overlay-meta-row">
                      <div className="min-w-0 flex-1">
                        {partialText.trim().length > 0 ? (
                          <div className="partial-text" title={partialText}>
                            {partialText}
                          </div>
                        ) : matchedRule ? (
                          <button
                            type="button"
                            className="rule-badge"
                            onClick={() =>
                              void commands.showDetailView("write-profiles")
                            }
                            title={t("refine.writeRules.overlayBadgeOpen")}
                          >
                            {ruleBadgePrefix} {matchedRule.rule_name}
                          </button>
                        ) : (
                          <div className="overlay-meta-spacer" />
                        )}
                      </div>
                      <ScreenContextPulse visible={showScreenContextPulse} />
                    </div>
                  </div>
                ) : (
                  <div className="overlay-meta-row">
                    <div className="status-text">
                      <span className="status-dot" />
                      {state === "transcribing"
                        ? t("overlay.transcribing")
                        : t("overlay.processing")}
                    </div>
                    <ScreenContextPulse visible={showScreenContextPulse} />
                  </div>
                )}
              </div>
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
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const CompactBody: React.FC<{
  state: OverlayState;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
}> = ({ state, canvasRef }) => {
  if (state === "recording") {
    return <canvas ref={canvasRef} className="waveform-canvas" aria-hidden />;
  }
  return <span className="status-dot" />;
};

const ScreenContextPulse: React.FC<{ visible: boolean }> = ({ visible }) => {
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  return (
    <span
      className="screen-context-pulse"
      role="status"
      title={t("overlay.screenContextActive", {
        defaultValue: "Screen Context OCR active",
      })}
    >
      <span className="sr-only">
        {t("overlay.screenContextActive", {
          defaultValue: "Screen Context OCR active",
        })}
      </span>
    </span>
  );
};

const CorrectionBody: React.FC<{ payload: CorrectionOverlayPayload }> = ({
  payload,
}) => {
  const { t } = useTranslation();
  const confidence = Math.round(
    Math.max(0, Math.min(1, payload.confidence)) * 100,
  );
  const additionalCount = payload.additionalCount ?? 0;

  return (
    <div className="correction-overlay-body">
      <div className="correction-overlay-icon" aria-hidden>
        <CheckIcon />
      </div>
      <div className="correction-overlay-copy">
        <div className="correction-overlay-title">
          {t("overlay.correctionAdded", {
            defaultValue: "Added correction",
          })}
        </div>
        <div className="correction-overlay-pair">
          <span className="correction-overlay-token">{payload.original}</span>
          <span className="correction-overlay-arrow" aria-hidden>
            -&gt;
          </span>
          <span className="correction-overlay-token">{payload.corrected}</span>
        </div>
        <div className="correction-overlay-meta">
          {t("overlay.correctionConfidence", {
            confidence,
            defaultValue: "Confidence {{confidence}}%",
          })}
          {additionalCount > 0 ? `, +${additionalCount} more` : ""}
        </div>
      </div>
    </div>
  );
};

/* ── Inline SVG icons (no external deps in the overlay bundle) ── */

const CheckIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path
      d="M4 9.2l3.1 3.1L14 5.4"
      stroke="var(--ov-accent)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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
