import React, { useEffect, useId, useRef, useState } from "react";

import { HighlightTrack } from "@/motion/HighlightTrack";
import {
  interactiveFocusRingClass,
  minTapTargetSquareClass,
} from "@/lib/interactiveFocus";

import { Tooltip } from "./Tooltip";
import { useSettingsGroupContext } from "./SettingsGroup";

interface SettingContainerProps {
  /** When omitted, no heading row is shown (tooltip still shown if description is set). */
  title?: string;
  description: string;
  children: React.ReactNode;
  descriptionMode?: "inline" | "tooltip";
  /**
   * @deprecated Grouping is now inferred automatically from a parent `<SettingsGroup>`.
   * Kept for backwards source compatibility — the prop is ignored.
   */
  grouped?: boolean;
  layout?: "horizontal" | "stacked" | "compact";
  /** Reduces row min-height from 56px to 44px for tighter cards. */
  dense?: boolean;
  disabled?: boolean;
  tooltipPosition?: "top" | "bottom";
}

export const SettingContainer: React.FC<SettingContainerProps> = ({
  title,
  description,
  children,
  descriptionMode = "tooltip",
  layout = "horizontal",
  dense = false,
  disabled = false,
  tooltipPosition = "top",
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tooltipRef = useRef<HTMLButtonElement>(null);
  const rowId = useId();
  const groupContext = useSettingsGroupContext();
  const grouped = Boolean(groupContext);
  const hoverLayoutId = groupContext
    ? `settings-hover-${groupContext.groupId}`
    : `settings-hover-solo-${rowId}`;

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
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-transparent text-[var(--muted)] transition-colors duration-200 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] ${interactiveFocusRingClass} ${minTapTargetSquareClass}`}
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
          strokeWidth={2}
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

  const rowWrapperClasses = grouped
    ? "relative group/row"
    : "relative group/row card-linear overflow-visible";

  const hoverHandlers = {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => {
      setHovered(false);
      setShowTooltip(false);
    },
    onFocus: () => setHovered(true),
    onBlur: () => setHovered(false),
  };

  const hoverTrack = (
    <HighlightTrack
      active={hovered}
      layoutId={hoverLayoutId}
      variant="surface"
      insetClass="inset-0"
      radiusClass={grouped ? "rounded-none" : "rounded-[inherit]"}
    />
  );

  const titleClass = `text-[14px] font-medium leading-5 tracking-[-0.005em] truncate ${
    disabled ? "opacity-50" : ""
  }`;
  const descriptionClass = `text-[12px] leading-5 text-[var(--muted)] line-clamp-2 ${
    disabled ? "opacity-50" : ""
  }`;
  const stackedTitleClass = `text-[14px] font-medium leading-5 tracking-[-0.005em] ${
    disabled ? "opacity-50" : ""
  }`;
  const stackedDescriptionClass = `text-[12px] leading-5 text-[var(--muted)] ${
    disabled ? "opacity-50" : ""
  }`;

  if (layout === "stacked" || layout === "compact") {
    const stackedPadding = grouped ? "px-4 py-3" : "px-4 py-3.5";
    return (
      <div className={rowWrapperClasses} {...hoverHandlers}>
        {hoverTrack}
        <div className={`relative ${stackedPadding}`}>
          {(title || description) && (
            <div className="mb-2 flex items-center gap-2">
              {title ? <h3 className={stackedTitleClass}>{title}</h3> : null}
              {descriptionMode === "tooltip" ? tooltipTrigger : null}
            </div>
          )}
          {descriptionMode === "inline" && description ? (
            <p className={`mb-2 ${stackedDescriptionClass}`}>{description}</p>
          ) : null}
          <div className="w-full">{children}</div>
        </div>
      </div>
    );
  }

  // Horizontal layout (default) — 56px minimum row height (44px when dense)
  const horizontalPadding = grouped
    ? dense
      ? "px-4 py-2"
      : "px-4 py-3"
    : "px-5 py-3";
  const minRowHeight = dense ? "min-h-[44px]" : "min-h-[56px]";

  return (
    <div className={rowWrapperClasses} {...hoverHandlers}>
      {hoverTrack}
      <div
        className={`relative flex ${minRowHeight} items-center justify-between gap-6 ${horizontalPadding}`}
      >
        <div className="flex-1 min-w-0">
          {descriptionMode === "tooltip" ? (
            <div className="flex items-center gap-2">
              {title ? <h3 className={titleClass}>{title}</h3> : null}
              {tooltipTrigger}
            </div>
          ) : (
            <>
              {title ? <h3 className={titleClass}>{title}</h3> : null}
              <p className={`mt-0.5 ${descriptionClass}`}>{description}</p>
            </>
          )}
        </div>
        <div className="relative shrink-0 self-center whitespace-nowrap">
          {children}
        </div>
      </div>
    </div>
  );
};
