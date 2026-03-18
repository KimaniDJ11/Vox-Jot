/**
 * compare-regression-reports.ts
 *
 * Takes two regression report JSON files (baseline and candidate) and produces
 * a side-by-side comparison summary showing metric deltas, improvements,
 * regressions, and routing changes.
 *
 * Usage:
 *   bun run scripts/compare-regression-reports.ts <baseline.json> <candidate.json>
 */

import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// ── Report types (mirrors run-audio-regression.ts) ──────────────────────────

interface EntryReport {
  id: string;
  duration_secs: number;
  expected_text: string;
  raw_transcription: string | null;
  post_processed_text: string | null;
  final_paste_text: string | null;
  raw_wer: number | null;
  final_wer: number | null;
  raw_normalized_match: boolean;
  final_normalized_match: boolean;
  paste_gate_fallback_applied: boolean;
  error: string | null;
  route?: string;
}

interface ReportSummary {
  total_entries: number;
  processed_entries: number;
  failed_entries: number;
  raw_exact_matches: number;
  final_exact_matches: number;
  raw_normalized_matches: number;
  final_normalized_matches: number;
  improved_entries: number;
  worsened_entries: number;
  unchanged_entries: number;
  average_raw_wer: number;
  average_final_wer: number;
}

interface Report {
  generated_at: string;
  model_id: string;
  post_process_enabled: boolean;
  post_process_provider_id: string;
  post_process_model: string;
  summary: ReportSummary;
  entries: EntryReport[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadReport(filePath: string): Report {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Report;
}

function fmt(n: number, decimals = 3): string {
  return n.toFixed(decimals);
}

function fmtDelta(n: number, decimals = 3): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(decimals)}`;
}

function truncate(s: string | null, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// ── Comparison logic ────────────────────────────────────────────────────────

interface ComparisonEntry {
  id: string;
  baselineFinalWer: number;
  candidateFinalWer: number;
  delta: number;
  expected: string;
  baselineFinalText: string | null;
  candidateFinalText: string | null;
  baselineRoute?: string;
  candidateRoute?: string;
}

function buildComparison(baseline: Report, candidate: Report) {
  const baselineMap = new Map<string, EntryReport>();
  for (const entry of baseline.entries) {
    baselineMap.set(entry.id, entry);
  }

  const candidateMap = new Map<string, EntryReport>();
  for (const entry of candidate.entries) {
    candidateMap.set(entry.id, entry);
  }

  // Find entries present in both reports
  const commonIds = [...baselineMap.keys()].filter((id) =>
    candidateMap.has(id),
  );

  const improved: ComparisonEntry[] = [];
  const regressed: ComparisonEntry[] = [];
  const routeChanged: ComparisonEntry[] = [];

  for (const id of commonIds) {
    const b = baselineMap.get(id)!;
    const c = candidateMap.get(id)!;

    if (b.final_wer === null || c.final_wer === null) continue;

    const delta = c.final_wer - b.final_wer;
    const entry: ComparisonEntry = {
      id,
      baselineFinalWer: b.final_wer,
      candidateFinalWer: c.final_wer,
      delta,
      expected: b.expected_text,
      baselineFinalText: b.final_paste_text,
      candidateFinalText: c.final_paste_text,
      baselineRoute: b.route,
      candidateRoute: c.route,
    };

    if (delta < -0.0001) {
      improved.push(entry);
    } else if (delta > 0.0001) {
      regressed.push(entry);
    }

    if (b.route !== undefined && c.route !== undefined && b.route !== c.route) {
      routeChanged.push(entry);
    }
  }

  improved.sort((a, b) => a.delta - b.delta); // biggest improvement first
  regressed.sort((a, b) => b.delta - a.delta); // biggest regression first

  return { commonIds, improved, regressed, routeChanged };
}

// ── Markdown output ─────────────────────────────────────────────────────────

type SummaryKey = keyof ReportSummary;

const METRIC_LABELS: Array<[SummaryKey, string]> = [
  ["total_entries", "Total entries"],
  ["processed_entries", "Processed"],
  ["failed_entries", "Failed"],
  ["average_raw_wer", "Avg raw WER"],
  ["average_final_wer", "Avg final WER"],
  ["raw_normalized_matches", "Raw normalized matches"],
  ["final_normalized_matches", "Final normalized matches"],
  ["improved_entries", "Improved"],
  ["worsened_entries", "Worsened"],
  ["unchanged_entries", "Unchanged"],
];

const FLOAT_KEYS = new Set<SummaryKey>([
  "average_raw_wer",
  "average_final_wer",
]);

function formatMetricValue(key: SummaryKey, value: number): string {
  return FLOAT_KEYS.has(key) ? fmt(value) : String(value);
}

function generateMarkdown(
  baselinePath: string,
  candidatePath: string,
  baseline: Report,
  candidate: Report,
  comparison: ReturnType<typeof buildComparison>,
): string {
  const lines: string[] = [];

  lines.push("# Regression Comparison Report");
  lines.push("");
  lines.push(
    `**Baseline:** \`${path.basename(baselinePath)}\` (${baseline.generated_at})`,
  );
  lines.push(
    `**Candidate:** \`${path.basename(candidatePath)}\` (${candidate.generated_at})`,
  );
  lines.push("");

  // Model info
  lines.push("## Configuration");
  lines.push("");
  lines.push("| | Baseline | Candidate |");
  lines.push("|---|---|---|");
  lines.push(
    `| Model | ${baseline.model_id} | ${candidate.model_id} |`,
  );
  lines.push(
    `| Post-process | ${baseline.post_process_enabled ? `${baseline.post_process_provider_id}/${baseline.post_process_model}` : "disabled"} | ${candidate.post_process_enabled ? `${candidate.post_process_provider_id}/${candidate.post_process_model}` : "disabled"} |`,
  );
  lines.push("");

  // Side-by-side metrics
  lines.push("## Metrics Comparison");
  lines.push("");
  lines.push("| Metric | Baseline | Candidate | Delta |");
  lines.push("|---|---|---|---|");

  for (const [key, label] of METRIC_LABELS) {
    const bVal = baseline.summary[key] as number;
    const cVal = candidate.summary[key] as number;
    const delta = cVal - bVal;
    const bStr = formatMetricValue(key, bVal);
    const cStr = formatMetricValue(key, cVal);
    const deltaStr = FLOAT_KEYS.has(key) ? fmtDelta(delta) : fmtDelta(delta, 0);
    lines.push(`| ${label} | ${bStr} | ${cStr} | ${deltaStr} |`);
  }

  lines.push("");
  lines.push(
    `*Common entries compared: ${comparison.commonIds.length}*`,
  );

  // Improved entries
  if (comparison.improved.length > 0) {
    lines.push("");
    lines.push(
      `## Improved in Candidate (${comparison.improved.length} entries)`,
    );
    lines.push("");
    lines.push(
      "| ID | Baseline WER | Candidate WER | Delta | Expected | Baseline Text | Candidate Text |",
    );
    lines.push("|---|---|---|---|---|---|---|");

    for (const e of comparison.improved.slice(0, 30)) {
      lines.push(
        `| ${e.id} | ${fmt(e.baselineFinalWer)} | ${fmt(e.candidateFinalWer)} | ${fmtDelta(e.delta)} | ${truncate(e.expected, 40)} | ${truncate(e.baselineFinalText, 40)} | ${truncate(e.candidateFinalText, 40)} |`,
      );
    }

    if (comparison.improved.length > 30) {
      lines.push(
        `| ... | | | | *${comparison.improved.length - 30} more* | | |`,
      );
    }
  }

  // Regressed entries
  if (comparison.regressed.length > 0) {
    lines.push("");
    lines.push(
      `## Regressed in Candidate (${comparison.regressed.length} entries)`,
    );
    lines.push("");
    lines.push(
      "| ID | Baseline WER | Candidate WER | Delta | Expected | Baseline Text | Candidate Text |",
    );
    lines.push("|---|---|---|---|---|---|---|");

    for (const e of comparison.regressed.slice(0, 30)) {
      lines.push(
        `| ${e.id} | ${fmt(e.baselineFinalWer)} | ${fmt(e.candidateFinalWer)} | ${fmtDelta(e.delta)} | ${truncate(e.expected, 40)} | ${truncate(e.baselineFinalText, 40)} | ${truncate(e.candidateFinalText, 40)} |`,
      );
    }

    if (comparison.regressed.length > 30) {
      lines.push(
        `| ... | | | | *${comparison.regressed.length - 30} more* | | |`,
      );
    }
  }

  // Route changes
  if (comparison.routeChanged.length > 0) {
    lines.push("");
    lines.push(
      `## Routing Changes (${comparison.routeChanged.length} entries)`,
    );
    lines.push("");
    lines.push(
      "| ID | Baseline Route | Candidate Route | Baseline WER | Candidate WER | Delta |",
    );
    lines.push("|---|---|---|---|---|---|");

    for (const e of comparison.routeChanged) {
      lines.push(
        `| ${e.id} | ${e.baselineRoute ?? "n/a"} | ${e.candidateRoute ?? "n/a"} | ${fmt(e.baselineFinalWer)} | ${fmt(e.candidateFinalWer)} | ${fmtDelta(e.delta)} |`,
      );
    }
  }

  if (
    comparison.improved.length === 0 &&
    comparison.regressed.length === 0 &&
    comparison.routeChanged.length === 0
  ) {
    lines.push("");
    lines.push("## No per-entry differences detected.");
  }

  lines.push("");
  return lines.join("\n");
}

// ── Console output ──────────────────────────────────────────────────────────

function printSummary(
  baseline: Report,
  candidate: Report,
  comparison: ReturnType<typeof buildComparison>,
) {
  console.log("\n=== Regression Comparison ===\n");

  const colW = 14;
  const header = [
    "Metric".padEnd(28),
    "Baseline".padStart(colW),
    "Candidate".padStart(colW),
    "Delta".padStart(colW),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const [key, label] of METRIC_LABELS) {
    const bVal = baseline.summary[key] as number;
    const cVal = candidate.summary[key] as number;
    const delta = cVal - bVal;
    const bStr = formatMetricValue(key, bVal).padStart(colW);
    const cStr = formatMetricValue(key, cVal).padStart(colW);
    const dStr = (FLOAT_KEYS.has(key) ? fmtDelta(delta) : fmtDelta(delta, 0)).padStart(colW);
    console.log(`${label.padEnd(28)} ${bStr} ${cStr} ${dStr}`);
  }

  console.log(
    `\nCommon entries compared: ${comparison.commonIds.length}`,
  );

  if (comparison.improved.length > 0) {
    console.log(
      `\n--- Improved in Candidate (${comparison.improved.length}) ---`,
    );
    for (const e of comparison.improved.slice(0, 15)) {
      console.log(
        `  ${e.id}  WER ${fmt(e.baselineFinalWer)} -> ${fmt(e.candidateFinalWer)}  (${fmtDelta(e.delta)})`,
      );
    }
    if (comparison.improved.length > 15) {
      console.log(`  ... and ${comparison.improved.length - 15} more`);
    }
  }

  if (comparison.regressed.length > 0) {
    console.log(
      `\n--- Regressed in Candidate (${comparison.regressed.length}) ---`,
    );
    for (const e of comparison.regressed.slice(0, 15)) {
      console.log(
        `  ${e.id}  WER ${fmt(e.baselineFinalWer)} -> ${fmt(e.candidateFinalWer)}  (${fmtDelta(e.delta)})`,
      );
    }
    if (comparison.regressed.length > 15) {
      console.log(`  ... and ${comparison.regressed.length - 15} more`);
    }
  }

  if (comparison.routeChanged.length > 0) {
    console.log(
      `\n--- Route Changes (${comparison.routeChanged.length}) ---`,
    );
    for (const e of comparison.routeChanged) {
      console.log(
        `  ${e.id}  ${e.baselineRoute ?? "n/a"} -> ${e.candidateRoute ?? "n/a"}  WER ${fmtDelta(e.delta)}`,
      );
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: bun run scripts/compare-regression-reports.ts <baseline.json> <candidate.json>",
    );
    process.exit(1);
  }

  const baselinePath = path.resolve(args[0]);
  const candidatePath = path.resolve(args[1]);

  const baseline = loadReport(baselinePath);
  const candidate = loadReport(candidatePath);

  const comparison = buildComparison(baseline, candidate);

  // Print to stdout
  printSummary(baseline, candidate, comparison);

  // Write markdown file
  const ROOT = process.cwd();
  const reportsDir = path.join(
    ROOT,
    "test-data",
    "audio-regression",
    "reports",
  );
  mkdirSync(reportsDir, { recursive: true });

  const mdPath = path.join(reportsDir, "latest-comparison.md");
  const markdown = generateMarkdown(
    baselinePath,
    candidatePath,
    baseline,
    candidate,
    comparison,
  );
  writeFileSync(mdPath, markdown, "utf-8");

  console.log(`\nComparison report written to: ${mdPath}`);
}

main();
