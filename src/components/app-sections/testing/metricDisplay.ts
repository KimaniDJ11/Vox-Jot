import type { LeaderboardMetric } from "@/components/app-sections/testing/types";

export type MetricPreference = "higher" | "lower" | "neutral";

export interface MetricRange {
  min: number;
  max: number;
  preference: MetricPreference;
}

export type MetricRanges = Record<string, MetricRange>;

const LOWER_IS_BETTER_LABELS = [
  "wer",
  "der",
  "latency",
  "p50",
  "p95",
  "rtf",
  "fallback",
  "confusion",
];

const HIGHER_IS_BETTER_LABELS = [
  "score",
  "pass",
  "match",
  "similarity",
  "confidence",
  "clone",
  "style",
  "coverage",
  "listener preference",
  "phrases",
  "speakers",
  "turns",
  "speed",
  "elo",
];

export function metricPreference(label: string): MetricPreference {
  const normalized = label.trim().toLowerCase();

  if (LOWER_IS_BETTER_LABELS.some((item) => normalized.includes(item))) {
    return "lower";
  }

  if (HIGHER_IS_BETTER_LABELS.some((item) => normalized.includes(item))) {
    return "higher";
  }

  return "neutral";
}

export function realtimeSpeedBadge(
  label: string,
  value: string,
): string | null {
  const rtfMatch = value.match(/\brtf\s+(-?\d+(?:\.\d+)?)/i);
  if (rtfMatch) {
    const rtf = Number(rtfMatch[1]);
    return Number.isFinite(rtf) && rtf > 0 && rtf < 1 ? "Real-time+" : null;
  }

  if (label.toLowerCase().includes("rtf")) {
    const parsed = parseMetricValue(value);
    return parsed !== undefined && parsed < 1 ? "Real-time+" : null;
  }

  return null;
}

export function parseMetricValue(value: string): number | undefined {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed || trimmed === "n/a") {
    return undefined;
  }

  const ratioMatch = trimmed.match(
    /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/,
  );
  if (ratioMatch) {
    const numerator = Number(ratioMatch[1]);
    const denominator = Number(ratioMatch[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator)) {
      return denominator === 0 ? numerator : numerator / denominator;
    }
  }

  const numberMatch = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!numberMatch) {
    return undefined;
  }

  const valueNumber = Number(numberMatch[0]);
  return Number.isFinite(valueNumber) ? valueNumber : undefined;
}

export function metricPerformance(
  value: number,
  range: MetricRange,
): number | undefined {
  if (range.preference === "neutral") {
    return undefined;
  }

  if (range.max === range.min) {
    return 1;
  }

  const normalized =
    range.preference === "lower"
      ? (range.max - value) / (range.max - range.min)
      : (value - range.min) / (range.max - range.min);

  return Math.max(0, Math.min(1, normalized));
}

export function buildMetricRanges(
  rows: Array<{ metrics?: LeaderboardMetric[] }>,
): MetricRanges {
  const valuesByLabel = new Map<string, number[]>();

  rows.forEach((row) => {
    row.metrics?.forEach((metric) => {
      const value = parseMetricValue(metric.value);
      if (value === undefined) return;

      const values = valuesByLabel.get(metric.label) ?? [];
      values.push(value);
      valuesByLabel.set(metric.label, values);
    });
  });

  return Array.from(valuesByLabel.entries()).reduce<MetricRanges>(
    (ranges, [label, values]) => {
      ranges[label] = {
        min: Math.min(...values),
        max: Math.max(...values),
        preference: metricPreference(label),
      };
      return ranges;
    },
    {},
  );
}
