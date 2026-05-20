import React from "react";

import { RankBadge } from "@/components/app-sections/testing/RankBadge";

export interface LeaderboardMetric {
  label: string;
  value: string;
}

export interface LeaderboardRowProps {
  rank?: number;
  label: string;
  status: string;
  statusLabel: string;
  notes?: string;
  metrics?: LeaderboardMetric[];
  footer?: React.ReactNode;
}

function topRankClassName(rank?: number): string {
  if (rank === 1) {
    return "border-l-4 border-l-[var(--accent-gold)] bg-[color-mix(in_srgb,var(--accent-gold)_6%,var(--card))]";
  }
  if (rank === 2) {
    return "border-l-4 border-l-[color-mix(in_srgb,var(--text)_44%,var(--bg))] bg-[color-mix(in_srgb,var(--text)_6%,var(--card))]";
  }
  if (rank === 3) {
    return "border-l-4 border-l-[color-mix(in_srgb,#cd7f32_82%,var(--bg))] bg-[color-mix(in_srgb,#cd7f32_6%,var(--card))]";
  }
  return "bg-[var(--card)]";
}

const MetricChip: React.FC<LeaderboardMetric> = ({ label, value }) => (
  <div className="min-w-[5.5rem] rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5">
    <p className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
      {label}
    </p>
    <p className="mt-0.5 truncate text-xs font-semibold text-[var(--text)]">
      {value}
    </p>
  </div>
);

const StatusPill: React.FC<{ status: string; label: string }> = ({
  status,
  label,
}) => {
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
      className={`shrink-0 rounded-full border border-[color-mix(in_srgb,currentColor_22%,transparent)] px-2 py-0.5 text-[11px] font-semibold capitalize ${toneClassName}`}
    >
      {label}
    </span>
  );
};

export const LeaderboardRow: React.FC<LeaderboardRowProps> = ({
  rank,
  label,
  status,
  statusLabel,
  notes,
  metrics = [],
  footer,
}) => {
  const isRanked = rank !== undefined;

  return (
    <article
      className={`rounded-xl border border-[var(--border)] px-4 shadow-[var(--shadow-sm)] ${
        isRanked ? `py-3 ${topRankClassName(rank)}` : "bg-[var(--card)] py-2"
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        {isRanked ? <RankBadge rank={rank} /> : null}

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h4 className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">
              {label}
            </h4>
            <StatusPill status={status} label={statusLabel} />
          </div>

          <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            {notes ? (
              <p className="text-xs leading-5 text-[var(--muted)]">{notes}</p>
            ) : null}

            {metrics.length > 0 ? (
              <div className="flex flex-wrap gap-2 md:ml-auto md:max-w-md md:justify-end">
                {metrics.map((metric) => (
                  <MetricChip
                    key={`${metric.label}-${metric.value}`}
                    label={metric.label}
                    value={metric.value}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {footer ? (
            <div className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
};
