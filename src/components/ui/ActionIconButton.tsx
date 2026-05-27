import React from "react";

type ActionIconButtonTone = "default" | "danger" | "confirm";

interface ActionIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ActionIconButtonTone;
  active?: boolean;
}

export const actionIconSize = 18;

export const ActionIconButton: React.FC<ActionIconButtonProps> = ({
  active = false,
  children,
  className = "",
  tone = "default",
  type = "button",
  ...props
}) => {
  const toneClassName =
    tone === "confirm"
      ? "bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger-soft)_70%,var(--danger)_30%)]"
      : tone === "danger"
        ? "bg-transparent text-[var(--text)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:hover:bg-transparent disabled:hover:text-[var(--text)]"
        : active
          ? "bg-[var(--accent-soft)] text-[var(--accent)] hover:text-[var(--accent)]/80 disabled:hover:bg-[var(--accent-soft)] disabled:hover:text-[var(--accent)]"
          : "bg-transparent text-[var(--text)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:hover:bg-transparent disabled:hover:text-[var(--text)]";

  return (
    <button
      {...props}
      type={type}
      className={[
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
        "[&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:shrink-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        toneClassName,
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
};
