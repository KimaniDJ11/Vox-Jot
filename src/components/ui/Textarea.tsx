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
    "resize-y rounded-lg border border-[color-mix(in_srgb,var(--color-text),transparent_76%)] bg-[color-mix(in_srgb,var(--glass-bg),white_12%)] px-3 py-2 text-start text-sm font-medium text-[color-mix(in_srgb,var(--color-text),transparent_8%)] transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-[color-mix(in_srgb,var(--color-text),transparent_55%)] hover:border-[color-mix(in_srgb,var(--color-logo-primary),transparent_62%)] hover:bg-[color-mix(in_srgb,var(--glass-bg-elevated),white_14%)] focus:outline-none focus:border-[color-mix(in_srgb,var(--color-logo-primary),transparent_56%)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-logo-primary),transparent_72%)]";

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
