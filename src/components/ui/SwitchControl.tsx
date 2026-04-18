import React from "react";

import { interactiveFocusRingClass } from "@/lib/interactiveFocus";

interface SwitchControlProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "default" | "compact";
  frame?: "none" | "icon";
  title?: string;
  ariaLabel?: string;
  className?: string;
}

export const SwitchControl: React.FC<SwitchControlProps> = ({
  checked,
  onChange,
  disabled = false,
  size = "default",
  frame = "none",
  title,
  ariaLabel,
  className = "",
}) => {
  const isCompact = size === "compact";

  const frameClasses =
    frame === "icon"
      ? `inline-flex h-8 w-8 items-center justify-center rounded-full ${interactiveFocusRingClass}`
      : "inline-flex items-center";

  const trackClasses = isCompact
    ? "relative h-3.5 w-7 overflow-hidden rounded-full border transition-colors duration-200"
    : "relative h-6 w-11 overflow-hidden rounded-full border transition-colors duration-200";

  const trackStateClasses = checked
    ? "border-[var(--accent)] bg-[var(--accent)]"
    : isCompact
      ? "border-[color-mix(in_srgb,var(--text),transparent_50%)] bg-[color-mix(in_srgb,var(--text),transparent_65%)]"
      : "border-[color-mix(in_srgb,var(--text),transparent_50%)] bg-[color-mix(in_srgb,var(--text),transparent_78%)]";

  const thumbClasses = isCompact
    ? "absolute left-[2px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-all duration-200"
    : "absolute left-[2px] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border bg-[var(--card)] shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all duration-200";

  const thumbStateClasses = checked
    ? isCompact
      ? "translate-x-[14px] border-[var(--inverse-text)]/30"
      : "translate-x-[18px] border-[var(--inverse-text)]/30"
    : "border-[color-mix(in_srgb,var(--text),transparent_50%)]";

  return (
    <label
      className={`${frameClasses} ${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${className}`.trim()}
      title={title}
      aria-label={ariaLabel}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        className={`${trackClasses} ${trackStateClasses} peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--accent-glow)] peer-disabled:opacity-60`}
      >
        <span className={`${thumbClasses} ${thumbStateClasses}`} />
      </span>
    </label>
  );
};
