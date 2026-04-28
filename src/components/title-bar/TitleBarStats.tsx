import React from "react";
import { useTranslation } from "react-i18next";
import { Flame, LetterText, Target } from "lucide-react";
import { useDictationStats } from "@/hooks/useDictationStats";

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
};

const TitleBarStats: React.FC = () => {
  const { t } = useTranslation();
  const { stats } = useDictationStats();

  const labelClass =
    "title-bar-stats flex items-center gap-6 text-sm font-bold tabular-nums leading-none";

  if (!stats || stats.total_sessions === 0) {
    return (
      <span className="title-bar-stats text-[var(--muted)] text-sm font-bold tabular-nums leading-none">
        {t("titleBar.noStats")}
      </span>
    );
  }

  return (
    <div className={labelClass}>
      {/* Streak */}
      {stats.streak_days > 0 && (
        <div
          className="flex items-center gap-1.5"
          title={t("titleBar.streak", { count: stats.streak_days })}
        >
          <Flame
            className="h-[1.125rem] w-[1.125rem] shrink-0 fill-[var(--voice)] stroke-[var(--voice)]"
            strokeWidth={1.25}
            aria-hidden
          />
          <span>{stats.streak_days}</span>
        </div>
      )}

      {/* Total words */}
      <div
        className="flex items-center gap-1.5"
        title={t("titleBar.totalWords", { count: stats.total_words })}
      >
        <LetterText className="h-4 w-4 shrink-0" aria-hidden />
        <span>{formatNumber(stats.total_words)}</span>
      </div>

      {/* Today's words */}
      {stats.today_words > 0 && (
        <div
          className="flex items-center"
          title={t("titleBar.todayWords", { count: stats.today_words })}
        >
          <span>{t("titleBar.todayWords", { count: stats.today_words })}</span>
        </div>
      )}

      {/* Accuracy */}
      {stats.accuracy_percent !== null && (
        <div
          className="flex items-center gap-1.5"
          title={t("titleBar.accuracy", {
            value: Math.round(stats.accuracy_percent),
          })}
        >
          <Target className="h-4 w-4 shrink-0" aria-hidden />
          <span>{Math.round(stats.accuracy_percent)}%</span>
        </div>
      )}
    </div>
  );
};

export default TitleBarStats;
