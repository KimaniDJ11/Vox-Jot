import React, { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { TFunction } from "i18next";

import { RankBadge } from "@/components/app-sections/testing/RankBadge";
import { LeaderboardStatusPill } from "@/components/app-sections/testing/StatusPill";
import {
  buildMetricRanges,
  metricPerformance,
  metricPreference,
  parseMetricValue,
  realtimeSpeedBadge,
  type MetricRange,
} from "@/components/app-sections/testing/metricDisplay";
import type { LeaderboardRowProps } from "@/components/app-sections/testing/types";
import {
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import { Tooltip } from "@/components/ui/Tooltip";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import { crisp, press } from "@/motion/springs";

type SortDirection = "asc" | "desc";
type SortKey = "rank" | "label" | "status" | `metric:${string}`;

interface TestingTableProps {
  rows: LeaderboardRowProps[];
  metricGuide?: string[];
  t: TFunction;
  compact?: boolean;
}

interface SortState {
  key: SortKey;
  direction: SortDirection;
}

function metricFor(row: LeaderboardRowProps, label: string) {
  return row.metrics?.find((metric) => metric.label === label);
}

function textForSort(value?: string): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function compareRows(
  a: LeaderboardRowProps,
  b: LeaderboardRowProps,
  sort: SortState,
) {
  const direction = sort.direction === "asc" ? 1 : -1;

  if (sort.key === "rank") {
    const ar = a.rank ?? Number.MAX_SAFE_INTEGER;
    const br = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (ar !== br) return (ar - br) * direction;
    return a.label.localeCompare(b.label);
  }

  if (sort.key === "label") {
    return a.label.localeCompare(b.label) * direction;
  }

  if (sort.key === "status") {
    const statusCompare = a.statusLabel.localeCompare(b.statusLabel);
    return statusCompare !== 0
      ? statusCompare * direction
      : a.label.localeCompare(b.label);
  }

  const label = sort.key.replace("metric:", "");
  const aMetric = metricFor(a, label);
  const bMetric = metricFor(b, label);
  const aValue = aMetric ? parseMetricValue(aMetric.value) : undefined;
  const bValue = bMetric ? parseMetricValue(bMetric.value) : undefined;

  if (aValue !== undefined && bValue !== undefined && aValue !== bValue) {
    return (aValue - bValue) * direction;
  }

  if (aValue !== undefined && bValue === undefined) return -1;
  if (aValue === undefined && bValue !== undefined) return 1;

  const textCompare = textForSort(aMetric?.value).localeCompare(
    textForSort(bMetric?.value),
  );
  return textCompare !== 0
    ? textCompare * direction
    : a.label.localeCompare(b.label);
}

function nextSortDirection(key: SortKey, current: SortState): SortDirection {
  if (current.key === key) {
    return current.direction === "asc" ? "desc" : "asc";
  }

  if (key.startsWith("metric:")) {
    const label = key.replace("metric:", "");
    return metricPreference(label) === "higher" ? "desc" : "asc";
  }

  return "asc";
}

function metricTone(value: string, range?: MetricRange): string {
  const parsed = parseMetricValue(value);
  if (parsed === undefined || !range) {
    return "bg-transparent text-[var(--text)]";
  }

  const performance = metricPerformance(parsed, range);
  if (performance === undefined) {
    return "bg-transparent text-[var(--text)]";
  }

  if (performance >= 0.78) {
    return "bg-[var(--success-soft)] text-[var(--success)]";
  }

  if (performance <= 0.24) {
    return "bg-[var(--danger-soft)] text-[var(--danger)]";
  }

  return "bg-[var(--warning-soft)] text-[var(--warning)]";
}

function modelProviderId(row: LeaderboardRowProps): string {
  const identityText = [row.label, row.modelId].filter(Boolean).join(" ");
  return resolveModelProviderId(identityText, row.providerId);
}

function columnWidths(metricCount: number) {
  const rank = 8;
  const status = 12;
  const model = metricCount >= 5 ? 27 : 32;
  const metric = Math.max(7, (100 - rank - status - model) / metricCount);

  return { rank, model, status, metric };
}

function normalizeGuideKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function guideForHeader(
  label: string,
  metricGuide: string[] | undefined,
  t: TFunction,
): string {
  const normalizedLabel = normalizeGuideKey(label);
  const matchingGuide = metricGuide?.find((item) => {
    const [guideLabel = item] = item.split(":");
    const normalizedGuide = normalizeGuideKey(guideLabel);
    return (
      normalizedGuide === normalizedLabel ||
      normalizedGuide.includes(normalizedLabel) ||
      normalizedLabel.includes(normalizedGuide)
    );
  });

  if (matchingGuide) {
    return matchingGuide;
  }

  if (normalizedLabel === "model") {
    return t("testing.table.help.model", {
      defaultValue: "Model: benchmarked model or engine name.",
    });
  }

  if (normalizedLabel === "status") {
    return t("testing.table.help.status", {
      defaultValue:
        "Status: tested models have full benchmark results; other states explain readiness or blockers.",
    });
  }

  return t("testing.table.help.metric", {
    defaultValue: "{{label}}: click to sort this benchmark column.",
    label,
  });
}

const SortIndicator: React.FC<{
  active: boolean;
  direction: SortDirection;
}> = ({ active, direction }) => {
  if (!active) {
    return <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />;
  }

  return direction === "asc" ? (
    <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
  ) : (
    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
  );
};

const SortHeaderButton: React.FC<{
  active: boolean;
  alignRight?: boolean;
  direction: SortDirection;
  help: string;
  label: string;
  onClick: () => void;
}> = ({ active, alignRight = false, direction, help, label, onClick }) => {
  const [showHelp, setShowHelp] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipId = `testing-header-help-${normalizeGuideKey(label)}`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        onFocus={() => setShowHelp(true)}
        onBlur={() => setShowHelp(false)}
        onMouseEnter={() => setShowHelp(true)}
        onMouseLeave={() => setShowHelp(false)}
        className={`inline-flex min-h-8 max-w-full items-center gap-1 rounded-md px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)] hover:text-[var(--text)] ${interactiveFocusRingClass} ${
          alignRight ? "w-full justify-end" : ""
        }`}
        aria-describedby={showHelp ? tooltipId : undefined}
        title={help}
      >
        <span className="shrink-0 whitespace-nowrap">{label}</span>
        <SortIndicator active={active} direction={direction} />
      </button>
      {showHelp ? (
        <Tooltip targetRef={buttonRef} id={tooltipId} position="bottom">
          <span className="text-xs leading-5">{help}</span>
        </Tooltip>
      ) : null}
    </>
  );
};

export const TestingTable: React.FC<TestingTableProps> = ({
  rows,
  metricGuide,
  t,
  compact = false,
}) => {
  const [sort, setSort] = useState<SortState>({
    key: "rank",
    direction: "asc",
  });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const metricColumns = useMemo(() => {
    const labels: string[] = [];

    rows.forEach((row) => {
      row.metrics?.forEach((metric) => {
        if (!labels.includes(metric.label)) {
          labels.push(metric.label);
        }
      });
    });

    return labels;
  }, [rows]);
  const metricRanges = useMemo(() => buildMetricRanges(rows), [rows]);
  const widths = columnWidths(metricColumns.length || 1);
  const effectiveSort =
    sort.key.startsWith("metric:") &&
    !metricColumns.includes(sort.key.replace("metric:", ""))
      ? { key: "rank" as const, direction: "asc" as const }
      : sort;
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => compareRows(a, b, effectiveSort)),
    [effectiveSort, rows],
  );

  const setSortKey = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: nextSortDirection(key, current),
    }));
  };

  const toggleRow = (label: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const headerButton = (key: SortKey, label: string, alignRight = false) => {
    const active = effectiveSort.key === key;
    return (
      <SortHeaderButton
        active={active}
        alignRight={alignRight}
        direction={effectiveSort.direction}
        help={guideForHeader(label, metricGuide, t)}
        label={label}
        onClick={() => setSortKey(key)}
      />
    );
  };

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
      <div data-testing-table-viewport="" className="overflow-x-auto">
        <table className="min-w-[900px] w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col style={{ width: `${widths.rank}%` }} />
            <col style={{ width: `${widths.model}%` }} />
            <col style={{ width: `${widths.status}%` }} />
            {metricColumns.map((label) => (
              <col key={label} style={{ width: `${widths.metric}%` }} />
            ))}
          </colgroup>
          <thead className="bg-[color-mix(in_srgb,var(--panel-bg)_82%,transparent)]">
            <tr className="border-b border-[var(--border)]">
              <th
                scope="col"
                aria-sort={
                  effectiveSort.key === "rank"
                    ? effectiveSort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                className="px-2 py-2 text-left"
              >
                {headerButton(
                  "rank",
                  t("testing.table.rank", { defaultValue: "Rank" }),
                )}
              </th>
              <th
                scope="col"
                aria-sort={
                  effectiveSort.key === "label"
                    ? effectiveSort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                className="px-2 py-2 text-left"
              >
                {headerButton(
                  "label",
                  t("testing.table.model", { defaultValue: "Model" }),
                )}
              </th>
              <th
                scope="col"
                aria-sort={
                  effectiveSort.key === "status"
                    ? effectiveSort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                className="px-2 py-2 text-left"
              >
                {headerButton(
                  "status",
                  t("testing.table.status", { defaultValue: "Status" }),
                )}
              </th>
              {metricColumns.map((label) => (
                <th
                  key={label}
                  scope="col"
                  aria-sort={
                    effectiveSort.key === `metric:${label}`
                      ? effectiveSort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className="px-2 py-2 text-right"
                >
                  {headerButton(`metric:${label}`, label, true)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const expanded = expandedRows.has(row.label);
              const detailId = `testing-detail-${row.label
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")}`;

              return (
                <React.Fragment key={row.label}>
                  <motion.tr
                    layout="position"
                    transition={crisp}
                    className={`border-b border-[var(--border)] last:border-b-0 hover:bg-[color-mix(in_srgb,var(--accent)_5%,var(--card))] ${
                      expanded
                        ? "bg-[color-mix(in_srgb,var(--accent)_6%,var(--card))]"
                        : ""
                    }`}
                    onClick={() => toggleRow(row.label)}
                  >
                    <td className="px-2 py-2 align-middle">
                      <RankBadge rank={row.rank} />
                    </td>
                    <td className="min-w-0 px-2 py-2 align-middle">
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.99 }}
                        transition={press}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleRow(row.label);
                        }}
                        aria-expanded={expanded}
                        aria-controls={detailId}
                        className={`flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md text-left text-sm font-semibold text-[var(--text)] ${interactiveFocusRingClass}`}
                      >
                        {expanded ? (
                          <ChevronUp
                            className="h-4 w-4 shrink-0 text-[var(--muted)]"
                            aria-hidden="true"
                          />
                        ) : (
                          <ChevronDown
                            className="h-4 w-4 shrink-0 text-[var(--muted)]"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          data-testing-model-icon=""
                          className="inline-flex shrink-0 items-center justify-center"
                        >
                          <ProviderIcon
                            providerId={modelProviderId(row)}
                            size="sm"
                          />
                        </span>
                        <span className="truncate">{row.label}</span>
                      </motion.button>
                    </td>
                    <td className="min-w-0 px-2 py-2 align-middle">
                      <LeaderboardStatusPill
                        status={row.status}
                        label={row.statusLabel}
                        className="max-w-full"
                      />
                    </td>
                    {metricColumns.map((label) => {
                      const metric = metricFor(row, label);
                      const tag = metric
                        ? realtimeSpeedBadge(label, metric.value)
                        : undefined;
                      return (
                        <td
                          key={`${row.label}-${label}`}
                          className="min-w-0 px-2 py-2 text-right align-middle"
                        >
                          {metric ? (
                            <div className="inline-flex w-full min-w-0 flex-col items-end gap-1">
                              <span
                                className={`inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,currentColor_20%,transparent)] px-2 py-1 text-xs font-semibold ${metricTone(
                                  metric.value,
                                  metricRanges[label],
                                )}`}
                              >
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
                                  aria-hidden="true"
                                />
                                <span className="min-w-0 truncate">
                                  {metric.value}
                                </span>
                              </span>
                              {tag ? (
                                <span className="max-w-full truncate rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--success)]">
                                  {tag}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--muted)]">
                              {t("testing.metrics.notAvailable", {
                                defaultValue: "n/a",
                              })}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </motion.tr>
                  <AnimatePresence initial={false}>
                    {expanded ? (
                      <tr className="border-b border-[var(--border)] last:border-b-0">
                        <td
                          id={detailId}
                          colSpan={metricColumns.length + 3}
                          className="bg-[color-mix(in_srgb,var(--panel-bg)_58%,transparent)] px-3 py-0"
                        >
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={crisp}
                            className="overflow-hidden"
                          >
                            <div
                              className={`grid gap-2 py-3 text-xs leading-5 text-[var(--muted)] ${
                                compact ? "" : "md:grid-cols-[1fr_auto]"
                              }`}
                            >
                              <p className="min-w-0">
                                {row.notes ??
                                  t("testing.table.noNotes", {
                                    defaultValue:
                                      "No additional benchmark notes.",
                                  })}
                              </p>
                              {row.footer ? (
                                <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[11px] text-[var(--muted)]">
                                  {row.footer}
                                </div>
                              ) : null}
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    ) : null}
                  </AnimatePresence>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
