import React from "react";
import { AlertCircle, AlertTriangle, Info, CheckCircle } from "lucide-react";

type AlertVariant = "error" | "warning" | "info" | "success";

interface AlertProps {
  variant?: AlertVariant;
  /** When true, removes rounded corners for use inside containers */
  contained?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<
  AlertVariant,
  { container: string; icon: string; text: string }
> = {
  error: {
    container: "border border-[color-mix(in_srgb,var(--danger),transparent_75%)] bg-[var(--danger-soft)]",
    icon: "text-[var(--danger)]",
    text: "text-[var(--danger)]",
  },
  warning: {
    container: "border border-[color-mix(in_srgb,var(--warning),transparent_72%)] bg-[var(--warning-soft)]",
    icon: "text-[var(--warning)]",
    text: "text-[var(--warning)]",
  },
  info: {
    container: "border border-[color-mix(in_srgb,var(--info),transparent_74%)] bg-[var(--info-soft)]",
    icon: "text-[var(--info)]",
    text: "text-[var(--info)]",
  },
  success: {
    container: "border border-[color-mix(in_srgb,var(--success),transparent_74%)] bg-[var(--success-soft)]",
    icon: "text-[var(--success)]",
    text: "text-[var(--success)]",
  },
};

const variantIcons: Record<AlertVariant, React.ElementType> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle,
};

export const Alert: React.FC<AlertProps> = ({
  variant = "error",
  contained = false,
  children,
  className = "",
}) => {
  const styles = variantStyles[variant];
  const Icon = variantIcons[variant];

  return (
    <div
      className={`flex items-start gap-3 p-4 ${styles.container} ${contained ? "" : "rounded-2xl"} ${className}`}
    >
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${styles.icon}`} />
      <div className={`text-sm ${styles.text} min-w-0`}>{children}</div>
    </div>
  );
};
