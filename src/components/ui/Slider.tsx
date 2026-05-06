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
  defaultValue?: number;
  rangeHint?: { left: string; right: string };
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
  defaultValue,
  rangeHint,
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
  const defaultPercent =
    defaultValue !== undefined && max !== min
      ? Math.min(100, Math.max(0, ((defaultValue - min) / (max - min)) * 100))
      : null;
  const handleResetToDefault = () => {
    if (defaultValue === undefined || disabled) return;
    if (defaultValue !== value) onChange(defaultValue);
  };

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
        defaultPercent={defaultPercent}
        defaultValue={defaultValue}
        onResetToDefault={handleResetToDefault}
        rangeHint={rangeHint}
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
  defaultPercent: number | null;
  defaultValue?: number;
  onResetToDefault: () => void;
  rangeHint?: { left: string; right: string };
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
  defaultPercent,
  defaultValue,
  onResetToDefault,
  rangeHint,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLButtonElement>(null);
  const canReset = defaultValue !== undefined && !disabled;
  const isAtDefault = defaultValue !== undefined && value === defaultValue;
  const valueResetTitle = canReset
    ? "Double-click to reset to default"
    : undefined;

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
            className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-transparent text-[var(--muted)] transition-colors duration-200 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] ${interactiveFocusRingClass} ${minTapTargetSquareClass}`}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={() => setShowTooltip(!showTooltip)}
            aria-label="More information"
          >
            <svg
              className="h-3.5 w-3.5 select-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.25}
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
          <button
            type="button"
            onClick={canReset ? onResetToDefault : undefined}
            disabled={!canReset}
            title={valueResetTitle}
            aria-label={
              canReset
                ? `${label} ${formatValue(value)} — click to reset`
                : `${label} ${formatValue(value)}`
            }
            className={`ml-auto rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums transition-colors ${
              isAtDefault
                ? "text-[var(--muted)]"
                : "text-[var(--accent)] hover:bg-[var(--accent-soft)]"
            } disabled:cursor-default disabled:hover:bg-transparent`}
          >
            {formatValue(value)}
          </button>
        )}
      </div>
      <div className="relative">
        {defaultPercent !== null ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 z-10 h-3 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--text),transparent_55%)]"
            style={{ left: `${defaultPercent}%` }}
          />
        ) : null}
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
          onDoubleClick={canReset ? onResetToDefault : undefined}
          disabled={disabled}
          className="relative z-0 h-2 w-full appearance-none rounded-full bg-transparent cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          style={trackStyle}
        />
      </div>
      {rangeHint ? (
        <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.06em] text-[color-mix(in_srgb,var(--muted),transparent_25%)]">
          <span>{rangeHint.left}</span>
          <span>{rangeHint.right}</span>
        </div>
      ) : null}
    </div>
  );
};
