import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
}

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  disabled,
  ...props
}) => {
  const baseClasses =
    "min-w-0 rounded-full border border-[var(--border)] bg-[var(--input)] text-start text-sm font-semibold text-[var(--text)] transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-[var(--muted)]";

  const interactiveClasses = disabled
    ? "cursor-not-allowed opacity-60"
    : "hover:border-[var(--accent)] hover:bg-[var(--bg)] focus:border-[var(--accent)] focus:outline-none focus:ring-4 focus:ring-[var(--accent-glow)]";

  const variantClasses = {
    default: "px-3 py-2",
    compact: "px-2 py-1",
  } as const;

  return (
    <input
      className={`${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
};
