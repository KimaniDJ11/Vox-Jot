import React from "react";

import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";

type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

interface ModelStatusButtonProps {
  status: ModelStatus;
  displayText: string;
  isDropdownOpen: boolean;
  onClick: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  leading?: React.ReactNode;
  className?: string;
  id?: string;
  ariaControls?: string;
  ariaLabel?: string;
  /** Overrides default `font-semibold` on the label (e.g. title bar `font-bold`). */
  labelClassName?: string;
  /** Larger hit targets and glyphs for the window title bar. */
  density?: "default" | "titleBar";
}

const ModelStatusButton = React.forwardRef<
  HTMLButtonElement,
  ModelStatusButtonProps
>(
  (
    {
      status,
      displayText,
      isDropdownOpen,
      onClick,
      onKeyDown,
      leading,
      className = "",
      id,
      ariaControls,
      ariaLabel,
      labelClassName,
      density = "default",
    },
    ref,
  ) => {
    const getStatusColor = (status: ModelStatus): string => {
      switch (status) {
        case "ready":
          return "bg-[var(--success)]";
        case "loading":
          return "bg-[var(--warning)] animate-pulse";
        case "downloading":
          return "bg-[var(--accent)] animate-pulse";
        case "extracting":
          return "bg-[var(--voice)] animate-pulse";
        case "error":
          return "bg-[var(--danger)]";
        case "unloaded":
          return "bg-[var(--muted)]/60";
        case "none":
          return "bg-[var(--danger)]";
        default:
          return "bg-[var(--muted)]/60";
      }
    };

    const isTitleBar = density === "titleBar";

    return (
      <button
        id={id}
        ref={ref}
        type="button"
        onClick={onClick}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isDropdownOpen}
        aria-controls={isDropdownOpen ? ariaControls : undefined}
        aria-label={ariaLabel}
        className={`inline-flex min-w-0 items-center rounded-lg px-2.5 transition-colors hover:text-[var(--text)] ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${
          isTitleBar ? "gap-2.5" : "gap-2"
        } ${className}`}
        title={`Model status: ${displayText}`}
      >
        <div
          className={`status-dot-glow rounded-full shrink-0 ${getStatusColor(status)} ${
            isTitleBar ? "h-2 w-2" : "h-[7px] w-[7px]"
          } ${status === "downloading" || status === "loading" || status === "extracting" ? "is-live" : ""} ${status === "ready" ? "is-ready" : ""} ${status === "error" || status === "none" ? "is-error" : ""}`}
          aria-hidden
        />
        {leading}
        <span
          className={`truncate ${isTitleBar ? "max-w-[11rem]" : "max-w-28"} ${
            labelClassName ?? "font-semibold"
          }`}
        >
          {displayText}
        </span>
        <svg
          className={`shrink-0 transition-transform ${isTitleBar ? "h-4 w-4" : "h-3 w-3"} ${isDropdownOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={isTitleBar ? 2.25 : 2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
    );
  },
);

ModelStatusButton.displayName = "ModelStatusButton";

export default ModelStatusButton;
