import React from "react";

interface RankBadgeProps {
  rank?: number;
}

function rankClassName(rank?: number): string {
  if (rank === 1) {
    return "border-[color-mix(in_srgb,var(--accent-gold)_58%,var(--border))] bg-[color-mix(in_srgb,var(--accent-gold)_14%,transparent)] text-[var(--accent-gold-hover)]";
  }
  if (rank === 2) {
    return "border-[color-mix(in_srgb,var(--text)_42%,var(--border))] bg-[color-mix(in_srgb,var(--text)_8%,transparent)] text-[color-mix(in_srgb,var(--text)_60%,var(--bg))]";
  }
  if (rank === 3) {
    return "border-[color-mix(in_srgb,#cd7f32_54%,var(--border))] bg-[color-mix(in_srgb,#cd7f32_12%,transparent)] text-[color-mix(in_srgb,#cd7f32_80%,var(--bg))]";
  }
  return "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--muted)]";
}

export const RankBadge: React.FC<RankBadgeProps> = ({ rank }) => (
  <div
    className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border text-2xl font-bold shadow-[var(--shadow-sm)] ${rankClassName(
      rank,
    )}`}
    aria-label={rank ? `Rank ${rank}` : "Unranked"}
  >
    {rank ? `#${rank}` : "—"}
  </div>
);
