import React from "react";
import type { TFunction } from "i18next";

import { LeaderboardRow } from "@/components/app-sections/testing/LeaderboardRow";
import type { LeaderboardRowProps } from "@/components/app-sections/testing/LeaderboardRow";
import { EmptyState } from "@/components/ui/EmptyState";

interface EvaluationRun {
  generatedAt: string;
  suite: string;
  corpus: string;
  reportPath: string;
  limitations?: string;
  metricGuide?: string[];
}

interface EvaluationResult {
  label: string;
  status: string;
}

interface SuiteLeaderboardProps<T extends EvaluationResult> {
  run: EvaluationRun;
  ranked: T[];
  unranked: T[];
  renderRow: (result: T, t: TFunction) => LeaderboardRowProps;
  t: TFunction;
}

function countByStatus(results: EvaluationResult[]) {
  return results.reduce(
    (counts, result) => {
      if (result.status === "tested") {
        counts.tested += 1;
      } else if (result.status === "pending") {
        counts.pending += 1;
      } else {
        counts.blocked += 1;
      }
      return counts;
    },
    { tested: 0, pending: 0, blocked: 0 },
  );
}

export function SuiteLeaderboard<T extends EvaluationResult>({
  run,
  ranked,
  unranked,
  renderRow,
  t,
}: SuiteLeaderboardProps<T>) {
  const counts = countByStatus([...ranked, ...unranked]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--text)]">
            {run.suite}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            {run.corpus}
          </p>
          {run.limitations ? (
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">
              {run.limitations}
            </p>
          ) : null}
          {run.metricGuide && run.metricGuide.length > 0 ? (
            <div className="mt-3 flex max-w-3xl flex-wrap gap-2">
              {run.metricGuide.map((item) => (
                <span
                  key={item}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1 text-[11px] font-medium leading-5 text-[var(--text)]"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
            <span>
              {t("testing.counts.tested", {
                defaultValue: "{{count}} tested",
                count: counts.tested,
              })}
            </span>
            <span aria-hidden>·</span>
            <span>
              {t("testing.counts.pending", {
                defaultValue: "{{count}} pending",
                count: counts.pending,
              })}
            </span>
            <span aria-hidden>·</span>
            <span>
              {t("testing.counts.blocked", {
                defaultValue: "{{count}} blocked",
                count: counts.blocked,
              })}
            </span>
          </div>
        </div>

        <div className="flex max-w-xs flex-col items-start gap-1 text-xs text-[var(--muted)] sm:items-end">
          <span className="font-medium">
            {t("testing.overview.updated", {
              defaultValue: "Updated {{date}}",
              date: run.generatedAt,
            })}
          </span>
          <p className="max-w-full truncate rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-1 font-medium">
            {t("testing.reportPath", {
              defaultValue: "Report: {{path}}",
              path: run.reportPath,
            })}
          </p>
        </div>
      </div>

      {ranked.length > 0 ? (
        <div className="space-y-2.5">
          {ranked.map((result) => {
            const row = renderRow(result, t);
            return <LeaderboardRow key={result.label} {...row} />;
          })}
        </div>
      ) : (
        <EmptyState
          title={t("testing.empty.title", {
            defaultValue: "No ranked results",
          })}
          description={t("testing.empty.description", {
            defaultValue: "Run the benchmark to populate this leaderboard.",
          })}
        />
      )}

      {unranked.length > 0 ? (
        <div className="space-y-2 pt-2">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
              {t("testing.notRanked.title", {
                defaultValue: "Not yet ranked",
              })}
            </h4>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {t("testing.notRanked.description", {
                defaultValue:
                  "Models awaiting benchmark, blocked, or pending download.",
              })}
            </p>
          </div>
          <div className="space-y-2">
            {unranked.map((result) => {
              const row = renderRow(result, t);
              return (
                <LeaderboardRow
                  key={result.label}
                  {...row}
                  rank={undefined}
                  metrics={[]}
                  footer={undefined}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
