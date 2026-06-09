import React from "react";

interface RankBadgeProps {
  rank?: number;
  className?: string;
}

function rankClassName(rank?: number): string {
  if (rank === 1) {
    return "border-[color-mix(in_srgb,var(--accent-gold)_58%,var(--border))] bg-[color-mix(in_srgb,var(--accent-gold)_14%,transparent)] text-[var(--accent-gold-hover)]";
  }
  if (rank === 2) {
    return "border-[color-mix(in_srgb,var(--text)_42%,var(--border))] bg-[color-mix(in_srgb,var(--text)_8%,transparent)] text-[color-mix(in_srgb,var(--text)_60%,var(--bg))]";
  }
  if (rank === 3) {
    return "border-[color-mix(in_srgb,var(--rank-bronze)_54%,var(--border))] bg-[color-mix(in_srgb,var(--rank-bronze)_12%,transparent)] text-[color-mix(in_srgb,var(--rank-bronze)_80%,var(--bg))]";
  }
  return "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--muted)]";
}

export const RankBadge: React.FC<RankBadgeProps> = ({
  rank,
  className = "",
}) => (
  <div
    className={`inline-flex h-8 min-w-12 shrink-0 items-center justify-center rounded-full border px-2 text-sm font-bold shadow-[var(--shadow-sm)] ${rankClassName(
      rank,
    )} ${className}`}
    aria-label={rank ? `Rank ${rank}` : "Unranked"}
  >
    {rank ? `#${rank}` : "—"}
  </div>
);
