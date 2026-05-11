import React from "react";
import { Link2 } from "lucide-react";

import { subtleCardClassName } from "@/components/ui/subtleCard";

export type SectionToneToken =
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "neutral";

const toneToCssBg: Record<SectionToneToken, string> = {
  accent:
    "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_18%,var(--card))_0%,color-mix(in_srgb,var(--accent)_4%,var(--card))_100%)]",
  info: "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--info)_16%,var(--card))_0%,color-mix(in_srgb,var(--info)_3%,var(--card))_100%)]",
  success:
    "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--success)_16%,var(--card))_0%,color-mix(in_srgb,var(--success)_3%,var(--card))_100%)]",
  warning:
    "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--warning)_16%,var(--card))_0%,color-mix(in_srgb,var(--warning)_3%,var(--card))_100%)]",
  neutral:
    "bg-[linear-gradient(135deg,var(--panel-bg)_0%,color-mix(in_srgb,var(--text)_3%,var(--panel-bg))_100%)]",
};

const toneToIconBg: Record<SectionToneToken, string> = {
  accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
  info: "bg-[var(--info-soft)] text-[var(--info)]",
  success: "bg-[var(--success-soft)] text-[var(--success)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  neutral: "bg-[var(--card)] text-[var(--muted)]",
};

const toneToRing: Record<SectionToneToken, string> = {
  accent: "ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]",
  info: "ring-[color-mix(in_srgb,var(--info)_22%,transparent)]",
  success: "ring-[color-mix(in_srgb,var(--success)_22%,transparent)]",
  warning: "ring-[color-mix(in_srgb,var(--warning)_22%,transparent)]",
  neutral: "ring-[var(--ring-hairline)]",
};

interface SectionHeroProps {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  tone?: SectionToneToken;
  stats?: Array<{ label: string; value: string }>;
  action?: React.ReactNode;
  visual?: React.ReactNode;
}

export const SectionHero: React.FC<SectionHeroProps> = ({
  icon,
  eyebrow,
  title,
  description,
  tone = "accent",
  stats,
  action,
  visual,
}) => {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-[var(--ring-hairline)] ring-1 ${toneToRing[tone]} ${toneToCssBg[tone]} shadow-[inset_0_1px_0_var(--edge-highlight),0_2px_8px_rgba(0,0,0,0.10)]`}
    >
      <div className="grid gap-5 px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${toneToIconBg[tone]} shadow-[inset_0_1px_0_var(--edge-highlight)]`}
              aria-hidden
            >
              {icon}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                {eyebrow}
              </p>
              <h2 className="heading-display mt-0.5 text-xl font-semibold tracking-tight text-[var(--text)]">
                {title}
              </h2>
            </div>
          </div>
          <p className="mt-3 max-w-prose text-[13px] leading-6 text-[var(--muted)]">
            {description}
          </p>
          {stats && stats.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {stats.map((stat) => (
                <span
                  key={stat.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ring-hairline)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text)]"
                >
                  <span className="text-[var(--muted)]">{stat.label}</span>
                  <span className="text-[var(--text)]">{stat.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
        {visual ? (
          <div className="shrink-0 md:max-w-[260px]">{visual}</div>
        ) : null}
      </div>
    </div>
  );
};

interface SettingsTipProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const SettingsTip: React.FC<SettingsTipProps> = ({ icon, children }) => (
  <div
    className={`flex items-start gap-3 ${subtleCardClassName} py-3 text-[12.5px] leading-5 text-[var(--muted)]`}
  >
    {icon ? (
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
        {icon}
      </span>
    ) : null}
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

interface CrossLinkCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  destination: string;
  onClick: () => void;
}

export const CrossLinkCard: React.FC<CrossLinkCardProps> = ({
  icon,
  title,
  description,
  destination,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group flex w-full items-center gap-3 rounded-xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] px-4 py-3 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_42%,var(--border))] hover:bg-[color-mix(in_srgb,var(--accent)_6%,var(--panel-bg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
  >
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text)]">
        {title}
        <Link2
          className="h-3 w-3 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
          aria-hidden
        />
      </div>
      <p className="mt-0.5 truncate text-[11.5px] text-[var(--muted)]">
        {description}
      </p>
    </div>
    <span className="hidden shrink-0 rounded-md border border-[var(--ring-hairline)] bg-[var(--card)] px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] sm:inline">
      {destination}
    </span>
  </button>
);

interface BoardListProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  columns?: 1 | 2;
}

export const BoardList: React.FC<BoardListProps> = ({
  title,
  description,
  children,
  columns = 1,
}) => (
  <section className="space-y-3">
    {title || description ? (
      <header className="px-1">
        {title ? (
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle,var(--muted))]">
            {title}
          </h3>
        ) : null}
        {description ? (
          <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
            {description}
          </p>
        ) : null}
      </header>
    ) : null}
    <div className={columns === 2 ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
      {children}
    </div>
  </section>
);

interface MetricTileProps {
  label: string;
  value: string | React.ReactNode;
  icon?: React.ReactNode;
  tone?: SectionToneToken;
  hint?: string;
}

export const MetricTile: React.FC<MetricTileProps> = ({
  label,
  value,
  icon,
  tone = "neutral",
  hint,
}) => (
  <div className="rounded-xl border border-[var(--ring-hairline)] bg-[var(--card)] px-4 py-3 shadow-[inset_0_1px_0_var(--edge-highlight)]">
    <div className="flex items-center gap-2">
      {icon ? (
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${toneToIconBg[tone]}`}
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </p>
    </div>
    <p className="mt-1.5 text-[15px] font-semibold leading-tight text-[var(--text)]">
      {value}
    </p>
    {hint ? (
      <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{hint}</p>
    ) : null}
  </div>
);

interface PreviewSlateProps {
  children: React.ReactNode;
  className?: string;
}

export const PreviewSlate: React.FC<PreviewSlateProps> = ({
  children,
  className = "",
}) => (
  <div
    className={`relative overflow-hidden rounded-xl border border-[var(--ring-hairline)] bg-[color-mix(in_srgb,var(--text)_3%,var(--card))] p-4 shadow-[inset_0_1px_0_var(--edge-highlight)] ${className}`}
  >
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.04]"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
        backgroundSize: "12px 12px",
        color: "var(--text)",
      }}
      aria-hidden
    />
    <div className="relative">{children}</div>
  </div>
);
