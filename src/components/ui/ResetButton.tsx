import React from "react";

import {
  interactiveFocusRingClass,
  minTapTargetSquareClass,
} from "@/lib/interactiveFocus";

import ResetIcon from "../icons/ResetIcon";

interface ResetButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
}

export const ResetButton: React.FC<ResetButtonProps> = React.memo(
  ({ onClick, disabled = false, className = "", ariaLabel, children }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`rounded-full border border-[var(--border)] p-1 transition-all duration-150 ${interactiveFocusRingClass} ${minTapTargetSquareClass} ${
        disabled
          ? "cursor-not-allowed opacity-50 text-[var(--muted)]"
          : "cursor-pointer text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] active:translate-y-px active:bg-[color-mix(in_srgb,var(--accent),transparent_78%)]"
      } ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children ?? <ResetIcon />}
    </button>
  ),
);
