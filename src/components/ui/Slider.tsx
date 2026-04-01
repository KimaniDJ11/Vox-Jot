import React, { useRef, useState } from "react";
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
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const fillPercent = ((value - min) / (max - min)) * 100;
  const trackStyle = {
    "--slider-bg": `linear-gradient(to right, var(--color-background-ui) ${fillPercent}%, rgba(128, 128, 128, 0.35) ${fillPercent}%)`,
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
        value={value}
        min={min}
        max={max}
        step={step}
        trackStyle={trackStyle}
        handleChange={handleChange}
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
        <div className="flex items-center space-x-1 h-6">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            disabled={disabled}
            className="flex-grow h-2 rounded-full appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-logo-primary disabled:opacity-50 disabled:cursor-not-allowed"
            style={trackStyle}
          />
          {showValue && (
            <span className="text-sm font-semibold text-[var(--text)] min-w-10 text-end">
              {formatValue(value)}
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
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className={`text-[13px] font-semibold leading-5 tracking-tight ${disabled ? "opacity-50" : ""}`}
        >
          {label}
        </span>
        {descriptionMode === "tooltip" && description ? (
          <button
            ref={tooltipRef}
            type="button"
            className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text),transparent_92%)] text-[var(--muted)] transition-colors duration-200 hover:border-[var(--accent)] hover:text-[var(--accent)]"
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
        disabled={disabled}
        className="h-2 w-full rounded-full appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-logo-primary disabled:opacity-50 disabled:cursor-not-allowed"
        style={trackStyle}
      />
    </div>
  );
};
