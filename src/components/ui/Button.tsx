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
    "cursor-pointer rounded-lg border font-medium transition-[background-color,border-color,color,transform] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-logo-primary),transparent_62%)]";

  const variantClasses = {
    primary:
      "border-background-ui bg-background-ui text-white hover:border-background-ui/85 hover:bg-background-ui/85 active:translate-y-px",
    "primary-soft":
      "border-transparent bg-[color-mix(in_srgb,var(--color-logo-primary),transparent_80%)] text-[var(--color-logo-primary)] hover:bg-[color-mix(in_srgb,var(--color-logo-primary),transparent_72%)]",
    secondary:
      "border-[color-mix(in_srgb,var(--color-text),transparent_75%)] bg-[color-mix(in_srgb,var(--glass-bg),white_8%)] text-[color-mix(in_srgb,var(--color-text),transparent_10%)] hover:bg-[color-mix(in_srgb,var(--glass-bg-elevated),white_12%)]",
    danger:
      "border-red-500 bg-red-600 text-white hover:border-red-600 hover:bg-red-700",
    "danger-ghost":
      "border-transparent text-red-400 hover:bg-red-500/10 hover:text-red-300",
    ghost:
      "border-transparent text-current hover:border-[color-mix(in_srgb,var(--color-logo-primary),transparent_70%)] hover:bg-[color-mix(in_srgb,var(--glass-bg),white_8%)]",
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
