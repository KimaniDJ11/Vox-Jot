import React from "react";

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
}

export const Textarea: React.FC<TextareaProps> = ({
  className = "",
  variant = "default",
  ...props
}) => {
  const baseClasses =
    "resize-y rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-start text-sm font-medium text-[var(--text)] transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-[var(--muted)] hover:border-[var(--accent)] hover:bg-[var(--bg)] focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-glow)]";

  const variantClasses = {
    default: "px-3 py-2 min-h-[100px]",
    compact: "px-2 py-1 min-h-[80px]",
  };

  return (
    <textarea
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
};
