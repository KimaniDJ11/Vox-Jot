import type { TFunction } from "i18next";

import { TestingTable } from "@/components/app-sections/testing/TestingTable";
import type { LeaderboardRowProps } from "@/components/app-sections/testing/types";
import { EmptyState } from "@/components/ui/EmptyState";

interface EvaluationRun {
  generatedAt: string;
  suite: string;
  corpus: string;
  methodologyVersion?: string;
  evidenceTier?: "legacy" | "diagnostic" | "ranked";
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

export function SuiteLeaderboard<T extends EvaluationResult>({
  run,
  ranked,
  unranked,
  renderRow,
  t,
}: SuiteLeaderboardProps<T>) {
  const rankedRows = ranked.map((result) => renderRow(result, t));
  const unrankedRows = unranked.map((result) => ({
    ...renderRow(result, t),
    rank: undefined,
  }));

  return (
    <section className="space-y-4">
      {run.evidenceTier === "legacy" ? (
        <p
          role="status"
          className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-xs leading-5 text-[var(--muted)]"
        >
          {t("testing.legacyMethodology", {
            defaultValue:
              "Legacy methodology result. Keep this historical ranking for context; rerun the complete v2 suite before comparing it with new results.",
          })}
        </p>
      ) : null}
      {ranked.length > 0 ? (
        <TestingTable rows={rankedRows} metricGuide={run.metricGuide} t={t} />
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
                defaultValue: "Blocked / unranked",
              })}
            </h4>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {t("testing.notRanked.description", {
                defaultValue:
                  "Rows stay out of rankings until full benchmark results exist. Blocked rows need runtime or download validation.",
              })}
            </p>
          </div>
          <TestingTable
            rows={unrankedRows}
            metricGuide={run.metricGuide}
            t={t}
            compact
          />
        </div>
      ) : null}
    </section>
  );
}
