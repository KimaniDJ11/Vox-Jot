import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const { localValue, handleChange, commit } = useDeferredSliderValue(
    value,
    onChange,
  );
  const fillPercent =
    max === min
      ? 0
      : Math.min(100, Math.max(0, ((localValue - min) / (max - min)) * 100));
  const trackStyle = {
    "--slider-bg": `linear-gradient(to right, color-mix(in srgb, var(--accent), var(--card) 52%) ${fillPercent}%, var(--card) ${fillPercent}%)`,
  } as React.CSSProperties;
  const defaultPercent =
    defaultValue !== undefined && max !== min
      ? Math.min(100, Math.max(0, ((defaultValue - min) / (max - min)) * 100))
      : null;
  const handleResetToDefault = () => {
    if (defaultValue === undefined || disabled) return;
    if (defaultValue !== value) onChange(defaultValue);
  };
  const canReset = defaultValue !== undefined && !disabled;
  const isAtDefault = defaultValue !== undefined && localValue === defaultValue;
  const valueResetTitle = canReset
    ? t("ui.slider.resetToDefault", {
        defaultValue: "Click to reset to default",
      })
    : undefined;

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
        <div className="relative">
          {defaultPercent !== null ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 z-10 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-[color-mix(in_srgb,var(--text),transparent_70%)]"
              style={{ left: `${defaultPercent}%` }}
            />
          ) : null}
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
            className="relative z-0 block h-11 w-full appearance-none bg-transparent cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            style={trackStyle}
          />
          {showValue && (
            <>
              {canReset ? (
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  title={valueResetTitle}
                  aria-label={t("ui.slider.resetValue", {
                    label,
                    value: formatValue(localValue),
                    defaultValue: "{{label}} {{value}} - click to reset",
                  })}
                  className={`absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-sm font-semibold tabular-nums transition-colors ${interactiveFocusRingClass} ${
                    isAtDefault
                      ? "text-[var(--muted)]"
                      : "text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text),transparent_92%)]"
                  }`}
                >
                  {formatValue(localValue)}
                </button>
              ) : (
                <span className="pointer-events-none absolute right-3 top-1/2 z-20 -translate-y-1/2 text-sm font-semibold tabular-nums text-[var(--text)]">
                  {formatValue(localValue)}
                </span>
              )}
            </>
          )}
        </div>
        {rangeHint ? (
          <div
            className={`mt-2 flex items-center gap-3 px-0.5 ${disabled ? "opacity-50" : ""}`}
          >
            <span className="text-xs font-medium text-[var(--muted)]">
              {rangeHint.left}
            </span>
            <div
              className="flex flex-1 items-center justify-between"
              aria-hidden="true"
            >
              {Array.from({ length: 13 }).map((_, i) => (
                <div
                  key={i}
                  className="h-2 w-px bg-[var(--muted)] opacity-35"
                />
              ))}
            </div>
            <span className="text-xs font-medium text-[var(--muted)]">
              {rangeHint.right}
            </span>
          </div>
        ) : null}
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
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLButtonElement>(null);
  const canReset = defaultValue !== undefined && !disabled;
  const isAtDefault = defaultValue !== undefined && value === defaultValue;
  const valueResetTitle = canReset
    ? t("ui.slider.resetToDefault", {
        defaultValue: "Click to reset to default",
      })
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
            aria-label={t("common.moreInformation")}
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
      </div>
      <div className="relative">
        {defaultPercent !== null ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 z-10 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-[color-mix(in_srgb,var(--text),transparent_70%)]"
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
          className="relative z-0 block h-11 w-full appearance-none bg-transparent cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          style={trackStyle}
        />
        {showValue && (
          <>
            {canReset ? (
              <button
                type="button"
                onClick={onResetToDefault}
                title={valueResetTitle}
                aria-label={t("ui.slider.resetValue", {
                  label,
                  value: formatValue(value),
                  defaultValue: "{{label}} {{value}} - click to reset",
                })}
                className={`absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-sm font-semibold tabular-nums transition-colors ${interactiveFocusRingClass} ${
                  isAtDefault
                    ? "text-[var(--muted)]"
                    : "text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text),transparent_92%)]"
                }`}
              >
                {formatValue(value)}
              </button>
            ) : (
              <span className="pointer-events-none absolute right-3 top-1/2 z-20 -translate-y-1/2 text-sm font-semibold tabular-nums text-[var(--text)]">
                {formatValue(value)}
              </span>
            )}
          </>
        )}
      </div>
      {rangeHint ? (
        <div
          className={`mt-2 flex items-center gap-3 px-0.5 ${disabled ? "opacity-50" : ""}`}
        >
          <span className="text-xs font-medium text-[var(--muted)]">
            {rangeHint.left}
          </span>
          <div
            className="flex flex-1 items-center justify-between"
            aria-hidden="true"
          >
            {Array.from({ length: 13 }).map((_, i) => (
              <div key={i} className="h-2 w-px bg-[var(--muted)] opacity-35" />
            ))}
          </div>
          <span className="text-xs font-medium text-[var(--muted)]">
            {rangeHint.right}
          </span>
        </div>
      ) : null}
    </div>
  );
};
