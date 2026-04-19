import React from "react";
import { motion } from "framer-motion";

import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import { press } from "@/motion/springs";

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

  // Default: 28×16 track / 12×12 thumb (Linear/Raycast feel).
  // Compact: 22×12 track / 8×8 thumb.
  const trackClasses = isCompact
    ? "relative h-[12px] w-[22px] overflow-visible rounded-full border transition-colors duration-150"
    : "relative h-[16px] w-[28px] overflow-visible rounded-full border transition-colors duration-150";

  const trackStateClasses = checked
    ? "border-[var(--accent)] bg-[var(--accent)]"
    : "border-[color-mix(in_srgb,var(--text),transparent_70%)] bg-[color-mix(in_srgb,var(--text),transparent_82%)]";

  const thumbSizeClasses = isCompact ? "h-[8px] w-[8px]" : "h-[12px] w-[12px]";

  // Thumb travel: (track - 2*inset - thumb)
  const thumbTravel = isCompact ? 10 : 12;

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
        className={`${trackClasses} ${trackStateClasses} peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--bg)] peer-disabled:opacity-60 shadow-[inset_0_1px_1px_rgba(0,0,0,0.18)]`}
      >
        <motion.span
          aria-hidden
          initial={false}
          animate={{ x: checked ? thumbTravel : 0 }}
          transition={press}
          className={`absolute left-[2px] top-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(0,0,0,0.08)] ${thumbSizeClasses}`}
        />
      </span>
    </label>
  );
};
