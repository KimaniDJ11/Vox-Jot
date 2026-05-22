import React from "react";

export const LeaderboardStatusPill: React.FC<{
  status: string;
  label: string;
  className?: string;
}> = ({ status, label, className = "" }) => {
  const toneClassName =
    status === "tested"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : status === "pending"
        ? "bg-[var(--warning-soft)] text-[var(--warning)]"
        : status === "blocked" || status === "failed"
          ? "bg-[var(--danger-soft)] text-[var(--danger)]"
          : status === "download_required"
            ? "bg-[var(--info-soft)] text-[var(--info)]"
            : status === "runtime_ready"
              ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]"
              : "bg-[var(--panel-bg)] text-[var(--muted)]";

  return (
    <span
      className={`inline-flex max-w-full min-w-0 shrink items-center rounded-full border border-[color-mix(in_srgb,currentColor_22%,transparent)] px-2 py-0.5 text-[11px] font-semibold capitalize ${toneClassName} ${className}`}
    >
      <span className="truncate">{label}</span>
    </span>
  );
};
