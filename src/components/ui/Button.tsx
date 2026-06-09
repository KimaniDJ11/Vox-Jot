import React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";
import { press } from "@/motion/springs";

interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?:
    | "primary"
    | "primary-soft"
    | "secondary"
    | "danger"
    | "danger-ghost"
    | "ghost";
  size?: "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-xs";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const isIconButtonSize =
    size === "icon" || size === "icon-sm" || size === "icon-xs";

  const baseClasses = [
    "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full border font-medium",
    "transition-[background-color,border-color,color,transform] duration-150",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-[0.6]",
    interactiveFocusRingClass,
  ].join(" ");

  const variantClasses = {
    primary:
      "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[var(--primary-control-highlight)] hover:border-[var(--accent-hover)] hover:bg-[var(--accent-hover)] active:translate-y-px",
    "primary-soft":
      "border-transparent bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent),transparent_85%)]",
    secondary:
      "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text)] hover:bg-[var(--input)]",
    danger:
      "border-[var(--danger)] bg-[var(--danger)] text-[var(--danger-foreground)] hover:border-[color-mix(in_srgb,var(--danger),var(--text)_12%)] hover:bg-[color-mix(in_srgb,var(--danger),var(--text)_12%)]",
    "danger-ghost": isIconButtonSize
      ? "border-transparent bg-transparent text-[var(--muted)] hover:border-transparent hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
      : "border-[var(--border)] text-[var(--danger)] hover:border-[var(--danger)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]",
    ghost: isIconButtonSize
      ? "border-transparent bg-transparent text-[var(--muted)] hover:border-transparent hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
      : "border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]",
  };

  const sizeClasses = {
    sm: `${minTapTargetHeightClass} px-3 py-2 text-xs`,
    md: `${minTapTargetHeightClass} px-4 py-2 text-sm`,
    lg: "min-h-[48px] px-5 py-2.5 text-base",
    icon: "h-11 w-11 shrink-0 p-0 [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:shrink-0",
    "icon-sm":
      "h-11 w-11 shrink-0 p-0 [&>svg]:h-[14px] [&>svg]:w-[14px] [&>svg]:shrink-0",
    "icon-xs":
      "h-11 w-11 shrink-0 p-0 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:shrink-0",
  };

  return (
    <motion.button
      whileTap={props.disabled ? undefined : { scale: 0.97 }}
      transition={press}
      {...props}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </motion.button>
  );
};
