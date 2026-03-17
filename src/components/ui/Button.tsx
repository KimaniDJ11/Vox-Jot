import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "primary-soft"
    | "secondary"
    | "danger"
    | "danger-ghost"
    | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const baseClasses =
    "cursor-pointer rounded-lg border font-medium transition-[background-color,border-color,color,transform] duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-glow)]";

  const variantClasses = {
    primary:
      "border-[var(--accent)] bg-[var(--accent)] text-white hover:border-[var(--accent-hover)] hover:bg-[var(--accent-hover)] active:translate-y-px",
    "primary-soft":
      "border-transparent bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent),transparent_85%)]",
    secondary:
      "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text)] hover:bg-[var(--input)]",
    danger:
      "border-red-500 bg-red-600 text-white hover:border-red-600 hover:bg-red-700",
    "danger-ghost":
      "border-transparent text-red-500 hover:bg-red-500/10 hover:text-red-600",
    ghost:
      "border-transparent text-[var(--text)] hover:border-[var(--accent-soft)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]",
  };

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-4 py-[5px] text-sm",
    lg: "px-4 py-2 text-base",
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
