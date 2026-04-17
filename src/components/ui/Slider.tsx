import React, { useEffect, useRef, useState } from "react";

import {
  interactiveFocusRingClass,
  minTapTargetSquareClass,
} from "@/lib/interactiveFocus";

import { SettingContainer } from "./SettingContainer";
import { Tooltip } from "./Tooltip";

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  label: string;
  description: string;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  layout?: "horizontal" | "stacked" | "compact";
  showValue?: boolean;
  formatValue?: (value: number) => string;
}

// Commits to `onChange` only on pointer/key release so dragging doesn't
// trigger a backend write for every intermediate value.
function useDeferredSliderValue(
  value: number,
  onChange: (value: number) => void,
) {
  const [localValue, setLocalValue] = useState(value);
  const pendingRef = useRef(value);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!activeRef.current) {
      setLocalValue(value);
      pendingRef.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    pendingRef.current = parsed;
    activeRef.current = true;
    setLocalValue(parsed);
  };

  const commit = () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (pendingRef.current !== value) {
      onChange(pendingRef.current);
    }
  };

  return { localValue, handleChange, commit };
}

export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  disabled = false,
  label,
  description,
  descriptionMode = "tooltip",
  grouped = false,
  layout = "horizontal",
  showValue = true,
  formatValue = (v) => v.toFixed(2),
}) => {
  const { localValue, handleChange, commit } = useDeferredSliderValue(
    value,
    onChange,
  );
  const fillPercent =
    max === min
      ? 0
      : Math.min(100, Math.max(0, ((localValue - min) / (max - min)) * 100));
  const trackStyle = {
    "--slider-bg": `linear-gradient(to right, var(--accent) 0%, var(--accent) ${fillPercent}%, color-mix(in srgb, var(--accent), white 78%) ${fillPercent}%, color-mix(in srgb, var(--text), transparent 82%) 100%)`,
  } as React.CSSProperties;

  if (layout === "compact") {
    return (
      <CompactSlider
        label={label}
        description={description}
        descriptionMode={descriptionMode}
        disabled={disabled}
        showValue={showValue}
        formatValue={formatValue}
        value={localValue}
        min={min}
        max={max}
        step={step}
        trackStyle={trackStyle}
        handleChange={handleChange}
        commit={commit}
      />
    );
  }

  return (
    <SettingContainer
      title={label}
      description={description}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout={layout}
      disabled={disabled}
    >
      <div className="w-full">
        <div className="flex items-center gap-2 h-6">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={localValue}
            onChange={handleChange}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
            disabled={disabled}
            className="h-2 w-full appearance-none rounded-full bg-transparent cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            style={trackStyle}
          />
          {showValue && (
            <span className="text-sm font-semibold text-[var(--text)] min-w-10 text-end tabular-nums">
              {formatValue(localValue)}
            </span>
          )}
        </div>
      </div>
    </SettingContainer>
  );
};

/** Minimal label-above-track slider for dense grids. */
const CompactSlider: React.FC<{
  label: string;
  description: string;
  descriptionMode?: "inline" | "tooltip";
  disabled: boolean;
  showValue: boolean;
  formatValue: (v: number) => string;
  value: number;
  min: number;
  max: number;
  step: number;
  trackStyle: React.CSSProperties;
  handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  commit: () => void;
}> = ({
  label,
  description,
  descriptionMode,
  disabled,
  showValue,
  formatValue,
  value,
  min,
  max,
  step,
  trackStyle,
  handleChange,
  commit,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="py-2 px-1">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span
          className={`text-[13px] font-semibold leading-5 ${disabled ? "opacity-50" : ""}`}
        >
          {label}
        </span>
        {descriptionMode === "tooltip" && description ? (
          <button
            ref={tooltipRef}
            type="button"
            className={`relative inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text),transparent_92%)] text-[var(--muted)] transition-colors duration-200 hover:border-[var(--accent)] hover:text-[var(--accent)] ${interactiveFocusRingClass} ${minTapTargetSquareClass}`}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={() => setShowTooltip(!showTooltip)}
            aria-label="More information"
          >
            <svg
              className="h-2.5 w-2.5 select-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {showTooltip && (
              <Tooltip targetRef={tooltipRef} position="top">
                <p className="text-sm text-center leading-relaxed">
                  {description}
                </p>
              </Tooltip>
            )}
          </button>
        ) : null}
        {showValue && (
          <span className="ml-auto text-xs font-semibold text-[var(--muted)] tabular-nums">
            {formatValue(value)}
          </span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        disabled={disabled}
        className="h-2 w-full appearance-none rounded-full bg-transparent cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        style={trackStyle}
      />
    </div>
  );
};
