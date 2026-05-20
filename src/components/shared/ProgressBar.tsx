import React from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

export interface ProgressData {
  id: string;
  percentage: number;
  speed?: number;
  label?: string;
}

interface ProgressBarProps {
  progress: ProgressData[];
  className?: string;
  size?: "small" | "medium" | "large";
  showSpeed?: boolean;
  showLabel?: boolean;
  ariaLabel?: string;
}

const sizeHeight = {
  small: "h-[3px]",
  medium: "h-1",
  large: "h-1.5",
};

const sizeWidth = {
  small: "w-16",
  medium: "w-24",
  large: "w-32",
};

const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  className = "",
  size = "medium",
  showSpeed = false,
  showLabel = false,
  ariaLabel,
}) => {
  const { t } = useTranslation();
  const heightClass = sizeHeight[size];
  const widthClass = sizeWidth[size];

  if (progress.length === 0) {
    return null;
  }

  if (progress.length === 1) {
    const item = progress[0];
    const percentage = Math.max(0, Math.min(100, item.percentage));
    const indeterminate = percentage <= 0;
    const label =
      item.label ??
      ariaLabel ??
      t("common.downloadProgress", { defaultValue: "Download progress" });
    const valueText = indeterminate
      ? t("modelSelector.waitingForData", {
          defaultValue: "Waiting for data...",
        })
      : t("common.percentComplete", {
          defaultValue: "{{percentage}}% complete",
          percentage: Math.round(percentage),
        });

    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div
          className={`${widthClass} ${heightClass} relative overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_12%,transparent)]`}
          role="progressbar"
          aria-label={label}
          aria-valuenow={indeterminate ? undefined : percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={valueText}
        >
          {indeterminate ? (
            <motion.div
              className="absolute inset-y-0 w-[40%] rounded-full bg-[var(--accent)]"
              initial={{ x: "-100%" }}
              animate={{ x: "250%" }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ) : (
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
              initial={false}
              animate={{ width: `${percentage}%` }}
              transition={{ type: "spring", stiffness: 180, damping: 28 }}
            />
          )}
        </div>
        {(showSpeed || showLabel) && (
          <div className="text-[11px] text-[var(--muted)] tabular-nums min-w-fit">
            {showLabel && item.label && (
              <span className="me-2">{item.label}</span>
            )}
            {showSpeed && item.speed !== undefined && item.speed >= 0.05 ? (
              // eslint-disable-next-line i18next/no-literal-string
              <span>{item.speed.toFixed(1)} MB/s</span>
            ) : showSpeed && item.speed !== undefined ? (
              <span>
                {t("modelSelector.waitingForData", {
                  defaultValue: "Waiting for data...",
                })}
              </span>
            ) : showSpeed ? (
              <span>{t("common.downloading")}</span>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  // Multiple progress bars
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex gap-1">
        {progress.map((item) => {
          const percentage = Math.max(0, Math.min(100, item.percentage));
          const label =
            item.label ??
            t("common.downloadProgressForItem", {
              defaultValue: "Download progress for {{id}}",
              id: item.id,
            });
          return (
            <div
              key={item.id}
              className={`w-3 ${heightClass} relative overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_12%,transparent)]`}
              title={item.label || `${percentage}%`}
              role="progressbar"
              aria-label={label}
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={t("common.percentComplete", {
                defaultValue: "{{percentage}}% complete",
                percentage: Math.round(percentage),
              })}
            >
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
                initial={false}
                animate={{ width: `${percentage}%` }}
                transition={{ type: "spring", stiffness: 180, damping: 28 }}
              />
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-[var(--muted)] min-w-fit">
        {t("common.downloadingCount", {
          defaultValue: "{{count}} downloading...",
          count: progress.length,
        })}
      </div>
    </div>
  );
};

export default ProgressBar;
