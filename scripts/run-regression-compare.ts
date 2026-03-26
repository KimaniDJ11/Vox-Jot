/**
 * run-regression-compare.ts
 *
 * Convenience script that runs the audio regression harness twice:
 *   1. With post-processing enabled  -> reports/with-pp.json
 *   2. Without post-processing       -> reports/without-pp.json
 * Then runs the comparison script on both reports.
 *
 * Usage:
 *   bun run scripts/run-regression-compare.ts [-- extra args like --regression-limit 10]
 */

import path from "node:path";
import { mkdirSync } from "node:fs";

const ROOT = process.cwd();
const reportsDir = path.join(ROOT, "test-data", "audio-regression", "reports");
mkdirSync(reportsDir, { recursive: true });

const withPpPath = path.join(reportsDir, "with-pp.json");
const withoutPpPath = path.join(reportsDir, "without-pp.json");

// Collect extra args passed after "--"
const rawArgs = process.argv.slice(2);
const separatorIdx = rawArgs.indexOf("--");
const extraArgs = separatorIdx >= 0 ? rawArgs.slice(separatorIdx + 1) : rawArgs;

// ── Run with post-processing ────────────────────────────────────────────────

console.log("=== Running regression WITH post-processing ===\n");

const withPpArgs = [
  "run",
  "scripts/run-audio-regression.ts",
  "--regression-output",
  withPpPath,
  ...extraArgs,
];

const withPpResult = Bun.spawnSync(["bun", ...withPpArgs], {
  cwd: ROOT,
  stdout: "inherit",
  stderr: "inherit",
});

if (withPpResult.exitCode !== 0) {
  console.error(
    `Regression with post-processing failed (exit ${withPpResult.exitCode})`,
  );
  process.exit(withPpResult.exitCode);
}

// ── Run without post-processing ─────────────────────────────────────────────

console.log("\n=== Running regression WITHOUT post-processing ===\n");

const withoutPpArgs = [
  "run",
  "scripts/run-audio-regression.ts",
  "--regression-skip-post-process",
  "--regression-output",
  withoutPpPath,
  ...extraArgs,
];

const withoutPpResult = Bun.spawnSync(["bun", ...withoutPpArgs], {
  cwd: ROOT,
  stdout: "inherit",
  stderr: "inherit",
});

if (withoutPpResult.exitCode !== 0) {
  console.error(
    `Regression without post-processing failed (exit ${withoutPpResult.exitCode})`,
  );
  process.exit(withoutPpResult.exitCode);
}

// ── Run comparison ──────────────────────────────────────────────────────────

console.log("\n=== Comparing reports ===\n");

const compareResult = Bun.spawnSync(
  [
    "bun",
    "run",
    "scripts/compare-regression-reports.ts",
    withoutPpPath,
    withPpPath,
  ],
  {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  },
);

if (compareResult.exitCode !== 0) {
  console.error(`Comparison failed (exit ${compareResult.exitCode})`);
  process.exit(compareResult.exitCode);
}
