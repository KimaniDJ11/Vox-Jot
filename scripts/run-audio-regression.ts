import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const manifestPath = path.join(ROOT, "test-data", "audio-regression", "manifest.json");
const outputPath = path.join(
  ROOT,
  "test-data",
  "audio-regression",
  "reports",
  "latest-report.json",
);
const summaryPath = path.join(
  ROOT,
  "test-data",
  "audio-regression",
  "reports",
  "latest-summary.md",
);

const forwardedArgs = process.argv.slice(2);
const args = [
  "run",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--",
  "--regression-manifest",
  manifestPath,
  "--regression-output",
  outputPath,
  ...forwardedArgs,
];

const result = Bun.spawnSync(["cargo", ...args], {
  cwd: ROOT,
  stdout: "inherit",
  stderr: "inherit",
});

if (result.exitCode !== 0) {
  process.exit(result.exitCode);
}

console.log(`Regression report: ${outputPath}`);

// ---------------------------------------------------------------------------
// Generate markdown summary from the JSON report
// ---------------------------------------------------------------------------

interface EntryReport {
  id: string;
  expected_text: string;
  raw_transcription: string | null;
  final_paste_text: string | null;
  raw_wer: number | null;
  final_wer: number | null;
  post_process_route: string | null;
  error: string | null;
}

interface ReportSummary {
  total_entries: number;
  processed_entries: number;
  failed_entries: number;
  raw_exact_matches: number;
  final_exact_matches: number;
  average_raw_wer: number;
  average_final_wer: number;
  improved_entries: number;
  worsened_entries: number;
  unchanged_entries: number;
}

interface RegressionReport {
  generated_at: string;
  model_id: string;
  model_path: string;
  post_process_enabled: boolean;
  post_process_provider_id: string;
  post_process_model: string;
  summary: ReportSummary;
  entries: EntryReport[];
}

try {
  const raw = fs.readFileSync(outputPath, "utf-8");
  const report: RegressionReport = JSON.parse(raw);
  const md = buildMarkdownSummary(report);
  fs.writeFileSync(summaryPath, md, "utf-8");
  console.log(`Summary markdown: ${summaryPath}`);
} catch (err) {
  console.error("Failed to generate markdown summary:", err);
  process.exit(1);
}

function buildMarkdownSummary(report: RegressionReport): string {
  const s = report.summary;
  const lines: string[] = [];

  lines.push(`# Audio Regression Report`);
  lines.push("");
  lines.push(`**Generated:** ${report.generated_at}`);
  lines.push(`**Model:** ${report.model_id}`);
  lines.push(
    `**Post-process:** ${report.post_process_enabled ? `${report.post_process_provider_id} / ${report.post_process_model}` : "disabled"}`,
  );
  lines.push("");

  // --- Overall summary ---
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total entries | ${s.total_entries} |`);
  lines.push(`| Processed | ${s.processed_entries} |`);
  lines.push(`| Failed | ${s.failed_entries} |`);
  lines.push(`| Raw exact matches | ${s.raw_exact_matches} |`);
  lines.push(`| Final exact matches | ${s.final_exact_matches} |`);
  lines.push(`| Avg raw WER | ${s.average_raw_wer.toFixed(4)} |`);
  lines.push(`| Avg final WER | ${s.average_final_wer.toFixed(4)} |`);
  lines.push(`| Improved | ${s.improved_entries} |`);
  lines.push(`| Worsened | ${s.worsened_entries} |`);
  lines.push(`| Unchanged | ${s.unchanged_entries} |`);
  lines.push("");

  // --- Route distribution ---
  const routeCounts: Record<string, number> = {};
  for (const entry of report.entries) {
    const route = entry.post_process_route ?? "unknown";
    routeCounts[route] = (routeCounts[route] ?? 0) + 1;
  }

  lines.push("## Post-Process Route Distribution");
  lines.push("");
  lines.push("| Route | Count | % |");
  lines.push("|-------|------:|--:|");
  const total = report.entries.length || 1;
  for (const [route, count] of Object.entries(routeCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / total) * 100).toFixed(1);
    lines.push(`| ${route} | ${count} | ${pct}% |`);
  }
  lines.push("");

  // --- Regressions (worsened) ---
  const worsened = report.entries.filter(
    (e) => e.raw_wer !== null && e.final_wer !== null && e.final_wer > e.raw_wer + 0.0001,
  );
  if (worsened.length > 0) {
    lines.push("## Regressions");
    lines.push("");
    lines.push("| ID | Route | Raw WER | Final WER | Delta |");
    lines.push("|----|-------|--------:|----------:|------:|");
    for (const e of worsened.sort((a, b) => (b.final_wer! - b.raw_wer!) - (a.final_wer! - a.raw_wer!))) {
      const delta = (e.final_wer! - e.raw_wer!).toFixed(4);
      lines.push(
        `| ${e.id} | ${e.post_process_route ?? "—"} | ${e.raw_wer!.toFixed(4)} | ${e.final_wer!.toFixed(4)} | +${delta} |`,
      );
    }
    lines.push("");
  }

  // --- Improvements ---
  const improved = report.entries.filter(
    (e) => e.raw_wer !== null && e.final_wer !== null && e.final_wer + 0.0001 < e.raw_wer,
  );
  if (improved.length > 0) {
    lines.push("## Improvements");
    lines.push("");
    lines.push("| ID | Route | Raw WER | Final WER | Delta |");
    lines.push("|----|-------|--------:|----------:|------:|");
    for (const e of improved.sort((a, b) => (a.final_wer! - a.raw_wer!) - (b.final_wer! - b.raw_wer!))) {
      const delta = (e.final_wer! - e.raw_wer!).toFixed(4);
      lines.push(
        `| ${e.id} | ${e.post_process_route ?? "—"} | ${e.raw_wer!.toFixed(4)} | ${e.final_wer!.toFixed(4)} | ${delta} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
