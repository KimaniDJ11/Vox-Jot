import React from "react";

import { interactiveFocusRingClass, minTapTargetHeightClass } from "@/lib/interactiveFocus";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "primary-soft"
    | "secondary"
    | "danger"
    | "danger-ghost"
    | "ghost";
  size?: "sm" | "md" | "lg" | "icon";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const baseClasses = [
    "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full border font-medium",
    "transition-[background-color,border-color,color,transform] duration-200",
    "disabled:cursor-not-allowed disabled:opacity-50",
    interactiveFocusRingClass,
  ].join(" ");

  const variantClasses = {
    primary:
      "border-[var(--accent)] bg-[var(--accent)] text-[var(--inverse-text)] hover:border-[var(--accent-hover)] hover:bg-[var(--accent-hover)] active:translate-y-px",
    "primary-soft":
      "border-transparent bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent),transparent_85%)]",
    secondary:
      "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text)] hover:bg-[var(--input)]",
    danger:
      "border-[var(--danger)] bg-[var(--danger)] text-[var(--inverse-text)] hover:border-[color-mix(in_srgb,var(--danger),black_12%)] hover:bg-[color-mix(in_srgb,var(--danger),black_12%)]",
    "danger-ghost":
      "border-[var(--border)] text-[var(--danger)] hover:border-[var(--danger)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]",
    ghost:
      "border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]",
  };

  const sizeClasses = {
    sm: `${minTapTargetHeightClass} px-3 py-2 text-xs`,
    md: `${minTapTargetHeightClass} px-4 py-2 text-sm`,
    lg: "min-h-[48px] px-5 py-2.5 text-base",
    icon: "h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 p-0 [&>svg]:shrink-0",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
