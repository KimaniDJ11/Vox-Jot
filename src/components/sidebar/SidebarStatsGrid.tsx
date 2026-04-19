import React from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Flame, LetterText, Target } from "lucide-react";
import { useDictationStats } from "@/hooks/useDictationStats";

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
};

type StatCardProps = {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: string;
  label: string;
  title?: string;
};

const StatCard: React.FC<StatCardProps> = ({
  icon,
  iconBg,
  iconColor,
  value,
  label,
  title,
}) => (
  <div
    className="flat-card flex flex-col gap-2 rounded-2xl px-3 py-2.5"
    title={title}
  >
    <div className="flex items-center justify-between gap-2">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: iconBg, color: iconColor }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="text-sm font-semibold tabular-nums leading-none text-[var(--muted)]">
        {value}
      </span>
    </div>
    <span className="text-[13px] font-semibold leading-tight text-[var(--text)]">
      {label}
    </span>
  </div>
);

const SidebarStatsGrid: React.FC = () => {
  const { t } = useTranslation();
  const { stats } = useDictationStats();

  if (!stats || stats.total_sessions === 0) {
    return (
      <div className="flat-card rounded-2xl px-3 py-2.5 text-xs font-semibold text-[var(--muted)]">
        {t("titleBar.noStats")}
      </div>
    );
  }

  const accuracyValue =
    stats.accuracy_percent !== null
      ? `${Math.round(stats.accuracy_percent)}%`
      : "—";

  return (
    <div className="grid grid-cols-2 gap-2">
      <StatCard
        icon={
          <Flame
            className="h-4 w-4 fill-current"
            strokeWidth={1.5}
            aria-hidden
          />
        }
        iconBg="color-mix(in srgb, var(--voice) 18%, transparent)"
        iconColor="var(--voice)"
        value={String(stats.streak_days)}
        label={t("titleBar.streakLabel", { defaultValue: "Streak" })}
        title={t("titleBar.streak", { count: stats.streak_days })}
      />
      <StatCard
        icon={<LetterText className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--accent) 18%, transparent)"
        iconColor="var(--accent)"
        value={formatNumber(stats.total_words)}
        label={t("titleBar.totalWordsLabel", { defaultValue: "Words" })}
        title={t("titleBar.totalWords", { count: stats.total_words })}
      />
      <StatCard
        icon={<CalendarDays className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--success, #22c55e) 18%, transparent)"
        iconColor="var(--success, #22c55e)"
        value={formatNumber(stats.today_words)}
        label={t("titleBar.todayLabel", { defaultValue: "Today" })}
        title={t("titleBar.todayWords", { count: stats.today_words })}
      />
      <StatCard
        icon={<Target className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--accent) 14%, transparent)"
        iconColor="var(--accent)"
        value={accuracyValue}
        label={t("titleBar.accuracyLabel", { defaultValue: "Accuracy" })}
        title={
          stats.accuracy_percent !== null
            ? t("titleBar.accuracy", {
                value: Math.round(stats.accuracy_percent),
              })
            : undefined
        }
      />
    </div>
  );
};

export default SidebarStatsGrid;
