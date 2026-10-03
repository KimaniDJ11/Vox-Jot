import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
  ({ onClick, disabled = false, className = "", ariaLabel, children }) => {
    const { t } = useTranslation();
    const [confirming, setConfirming] = useState(false);
    const resetButton = useRef<HTMLButtonElement>(null);
    const cancel = () => {
      setConfirming(false);
      resetButton.current?.focus();
    };
    const label =
      ariaLabel ?? t("ui.resetButton.label", { defaultValue: "Reset" });
    return (
      <span
        className="inline-flex items-center gap-1"
        onKeyDown={(event) => {
          if (event.key === "Escape" && confirming) {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setConfirming(false);
        }}
      >
        <button
          ref={resetButton}
          type="button"
          aria-label={label}
          className={`inline-flex items-center justify-center rounded-full border border-[var(--border)] p-0 transition-all duration-150 ${interactiveFocusRingClass} ${minTapTargetSquareClass} ${
            disabled
              ? "cursor-not-allowed opacity-50 text-[var(--muted)]"
              : "cursor-pointer text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] active:translate-y-px active:bg-[color-mix(in_srgb,var(--accent),transparent_78%)]"
          } ${className}`}
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            setConfirming(false);
            onClick();
          }}
          disabled={disabled}
        >
          {confirming ? (
            <span className="px-2 text-xs font-semibold">{label}</span>
          ) : (
            (children ?? <ResetIcon />)
          )}
        </button>
        {confirming && (
          <button
            type="button"
            className={`inline-flex items-center justify-center rounded-full border border-[var(--border)] px-2 text-xs font-semibold text-[var(--text)] ${interactiveFocusRingClass} ${minTapTargetSquareClass}`}
            onClick={cancel}
          >
            {t("common.cancel")}
          </button>
        )}
      </span>
    );
  },
);
