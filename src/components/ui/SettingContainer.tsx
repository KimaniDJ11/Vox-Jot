import React, { useEffect, useRef, useState } from "react";

import {
  interactiveFocusRingClass,
  minTapTargetSquareClass,
} from "@/lib/interactiveFocus";

import { Tooltip } from "./Tooltip";

interface SettingContainerProps {
  /** When omitted, no heading row is shown (tooltip still shown if description is set). */
  title?: string;
  description: string;
  children: React.ReactNode;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  layout?: "horizontal" | "stacked" | "compact";
  disabled?: boolean;
  tooltipPosition?: "top" | "bottom";
}

export const SettingContainer: React.FC<SettingContainerProps> = ({
  title,
  description,
  children,
  descriptionMode = "tooltip",
  grouped = false,
  layout = "horizontal",
  disabled = false,
  tooltipPosition = "top",
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLButtonElement>(null);

  // Handle click outside to close tooltip
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node)
      ) {
        setShowTooltip(false);
      }
    };

    if (showTooltip) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showTooltip]);

  const toggleTooltip = () => {
    setShowTooltip(!showTooltip);
  };

  const tooltipTrigger = description ? (
    <button
      ref={tooltipRef}
      type="button"
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text),transparent_92%)] text-[var(--muted)] transition-colors duration-200 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] ${interactiveFocusRingClass} ${minTapTargetSquareClass}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={toggleTooltip}
      aria-label="More information"
      aria-expanded={showTooltip}
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
          strokeWidth={2.5}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {showTooltip && (
        <Tooltip targetRef={tooltipRef} position={tooltipPosition}>
          <p className="text-sm text-center leading-relaxed">{description}</p>
        </Tooltip>
      )}
    </button>
  ) : null;

  const containerClasses = grouped
    ? "px-4 py-3.5"
    : "rounded-2xl border border-[var(--border)] px-4 py-3.5";

  if (layout === "stacked" || layout === "compact") {
    if (descriptionMode === "tooltip") {
      return (
        <div className={containerClasses}>
          {(title || description) && (
            <div className="mb-2 flex items-center gap-2">
              {title ? (
                <h3
                  className={`text-[16px] font-semibold leading-6 tracking-tight ${disabled ? "opacity-50" : ""}`}
                >
                  {title}
                </h3>
              ) : null}
              {tooltipTrigger}
            </div>
          )}
          <div className="w-full">{children}</div>
        </div>
      );
    }

    return (
      <div className={containerClasses}>
        <div className="mb-2">
          {title ? (
            <h3
              className={`text-[16px] font-semibold leading-6 tracking-tight ${disabled ? "opacity-50" : ""}`}
            >
              {title}
            </h3>
          ) : null}
          <p
            className={`text-[14px] leading-6 text-[var(--muted)] ${disabled ? "opacity-50" : ""}`}
          >
            {description}
          </p>
        </div>
        <div className="w-full">{children}</div>
      </div>
    );
  }

  // Horizontal layout (default)
  const horizontalContainerClasses = grouped
    ? "flex items-center justify-between gap-6 px-5 py-4"
    : "flex items-center justify-between gap-6 rounded-xl border border-[var(--border)] px-6 py-4";

  if (descriptionMode === "tooltip") {
    return (
      <div className={horizontalContainerClasses}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {title ? (
              <h3
                className={`text-[16px] font-semibold leading-6 tracking-tight truncate ${disabled ? "opacity-50" : ""}`}
              >
                {title}
              </h3>
            ) : null}
            {tooltipTrigger}
          </div>
        </div>
        <div className="relative shrink-0 self-center">{children}</div>
      </div>
    );
  }

  return (
    <div className={horizontalContainerClasses}>
      <div className="flex-1 pr-6 min-w-0">
        {title ? (
          <h3
            className={`text-[16px] font-semibold leading-6 tracking-tight truncate ${disabled ? "opacity-50" : ""}`}
          >
            {title}
          </h3>
        ) : null}
        <p
          className={`mt-1 text-[14px] leading-6 text-[var(--muted)] line-clamp-2 ${disabled ? "opacity-50" : ""}`}
        >
          {description}
        </p>
      </div>
      <div className="relative shrink-0 self-center whitespace-nowrap">
        {children}
      </div>
    </div>
  );
};
