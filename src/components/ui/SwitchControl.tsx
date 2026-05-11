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
      ? `inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full ${interactiveFocusRingClass}`
      : `inline-flex min-h-[44px] min-w-[60px] shrink-0 items-center justify-center rounded-full ${interactiveFocusRingClass}`;

  // Default: 56x30 track / 24x24 thumb.
  // Compact keeps dense list rows balanced while still reading as a switch.
  const trackClasses = isCompact
    ? "relative block h-[26px] w-[46px] overflow-hidden rounded-full border transition-colors duration-150"
    : "relative block h-[30px] w-[56px] overflow-hidden rounded-full border transition-colors duration-150";

  const trackStateClasses = checked
    ? "border-[var(--accent)] bg-[var(--accent)]"
    : "border-[color-mix(in_srgb,var(--text),transparent_70%)] bg-[color-mix(in_srgb,var(--text),transparent_82%)]";

  const thumbSizeClasses = isCompact
    ? "h-[20px] w-[20px]"
    : "h-[24px] w-[24px]";

  // Thumb travel: (track - 2*inset - thumb)
  const thumbTravel = isCompact ? 20 : 26;

  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? title}
      className={`${frameClasses} ${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${className}`.trim()}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={press}
    >
      <span
        className={`${trackClasses} ${trackStateClasses} ${disabled ? "opacity-60" : ""} shadow-[inset_0_1px_1px_rgba(0,0,0,0.18)]`}
      >
        <motion.span
          aria-hidden
          initial={false}
          animate={{ x: checked ? thumbTravel : 0 }}
          transition={press}
          className={`absolute left-[3px] top-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35),0_0_0_0.5px_rgba(0,0,0,0.08)] ${thumbSizeClasses}`}
        />
      </span>
    </motion.button>
  );
};
