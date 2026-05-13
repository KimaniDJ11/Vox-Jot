#!/usr/bin/env bun
/**
 * Post-process test bank evaluation runner.
 *
 * Runs the post-process eval against both the original dictation corpus and the
 * new audio-test-bank cases, producing separate + combined results.
 *
 * Usage:
 *   bun run scripts/run-test-bank-eval.ts                    # dry-run (no LLM)
 *   bun run scripts/run-test-bank-eval.ts --live              # full LLM eval
 *   bun run scripts/run-test-bank-eval.ts --live --provider ollama --model llama3
 *   bun run scripts/run-test-bank-eval.ts --suite sanity      # Suite A (15 cases)
 *   bun run scripts/run-test-bank-eval.ts --suite coverage    # Suite B (all cases)
 *
 * This is a thin orchestration layer — it calls eval-post-process.ts under the
 * hood for each case set and then merges the results.
 */

import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const SAFE_OUTPUT_SEGMENT = /^[A-Za-z0-9._-]+$/;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Config {
  live: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  suite: "sanity" | "coverage" | "all";
  outputDir: string;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const provider = get("--provider", "openai");

  return {
    live: has("--live"),
    provider,
    model: get("--model", "gpt-4o-mini"),
    baseUrl: get(
      "--base-url",
      provider === "ollama"
        ? "http://localhost:11434/v1"
        : provider === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : "https://api.openai.com/v1",
    ),
    suite: (get("--suite", "all") as Config["suite"]) || "all",
    outputDir: get(
      "--output-dir",
      resolve(PROJECT_ROOT, "output/test-bank-eval"),
    ),
  };
}

function assertSafePathSegment(segment: string, field: string): void {
  if (!SAFE_OUTPUT_SEGMENT.test(segment)) {
    throw new Error(`Unsafe ${field}: ${segment}`);
  }
}

function childPath(parent: string, segment: string, field: string): string {
  assertSafePathSegment(segment, field);
  return `${parent}/${segment}`;
}

function fixedChildPath(parent: string, filename: string): string {
  return `${parent}/${filename}`;
}

// ---------------------------------------------------------------------------
// Suite filtering
// ---------------------------------------------------------------------------

interface TestCase {
  id: string;
  raw_stt: string;
  expected_output: string;
  category: string;
  notes?: string;
}

interface CasesFile {
  metadata: Record<string, unknown>;
  cases: TestCase[];
}

/**
 * Suite A (sanity) — ~15 cases from the test-bank set + a few from spelling:
 *   5 clean/passthrough, 3 disfluency, 3 names, 2 code-ish, 2 numbers,
 *   + 5 spelling (homophones, confused words, STT misspelling, possessives, compounds)
 */
const SANITY_IDS = new Set([
  // numbers
  "num-01",
  "num-03",
  // names
  "name-01",
  "name-02",
  "name-04",
  // code-ish
  "code-01",
  "code-02",
  // disfluency
  "disf-01",
  "disf-02",
  "disf-04",
  // non-speech resilience
  "nsr-01",
  "nsr-02",
  "nsr-03",
  // punctuation
  "punc-01",
  "punc-03",
  // spelling (from spelling-corpus)
  "hom-01",
  "conf-01",
  "stt-01",
  "poss-01",
  "dbl-01",
]);

/**
 * Suite B (coverage) — all test-bank cases + the original dictation corpus.
 */

function filterCases(cases: TestCase[], suite: Config["suite"]): TestCase[] {
  if (suite === "sanity") {
    return cases.filter((c) => SANITY_IDS.has(c.id));
  }
  return cases;
}

// ---------------------------------------------------------------------------
// Run eval
// ---------------------------------------------------------------------------

function runEval(
  casesPath: string,
  outputDir: string,
  label: string,
  config: Config,
): string {
  const outDir = childPath(outputDir, label, "output label");
  mkdirSync(outDir, { recursive: true });

  const evalScript = resolve(PROJECT_ROOT, "scripts/eval-post-process.ts");

  const args = [
    evalScript,
    "--cases",
    casesPath,
    "--provider",
    config.provider,
    "--model",
    config.model,
    "--base-url",
    config.baseUrl,
    "--output-dir",
    outDir,
  ];
  if (!config.live) {
    args.push("--dry-run");
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Running: ${label}`);
  console.log(`Cases:   ${casesPath}`);
  console.log(`Output:  ${outDir}`);
  console.log(`${"─".repeat(60)}\n`);

  try {
    execFileSync("bun", args, { stdio: "inherit", cwd: PROJECT_ROOT });
  } catch (e) {
    console.error(`\n⚠ ${label} eval exited with error (continuing)\n`);
  }

  return outDir;
}

// ---------------------------------------------------------------------------
// Merge results
// ---------------------------------------------------------------------------

interface EvalResult {
  id: string;
  category: string;
  raw_stt: string;
  expected_output: string;
  actual_output: string | null;
  route: { route: string; score: number; rewrite_strength: number };
  match: boolean;
  similarity: number;
  notes?: string;
  error?: string;
}

interface EvalSummary {
  provider: string;
  model: string;
  mode: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  pass_rate: number;
  avg_similarity: number;
  by_category: Record<
    string,
    { total: number; passed: number; avg_similarity: number }
  >;
  results: EvalResult[];
}

function mergeResults(dirs: string[], outputDir: string): void {
  const allResults: (EvalResult & { source: string })[] = [];

  for (const dir of dirs) {
    const jsonPath = fixedChildPath(dir, "eval-results.json");
    if (!existsSync(jsonPath)) continue;
    const data: EvalSummary = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const source = dir.split("/").pop() || "unknown";
    for (const r of data.results) {
      allResults.push({ ...r, source });
    }
  }

  if (allResults.length === 0) {
    console.log("No results to merge.");
    return;
  }

  // Build combined summary
  const evaluated = allResults.filter(
    (r) => !r.error && r.actual_output !== null,
  );
  const passed = allResults.filter((r) => r.match).length;
  const errors = allResults.filter((r) => r.error).length;

  const byCategory: Record<
    string,
    { total: number; passed: number; avg_similarity: number }
  > = {};
  for (const r of allResults) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, passed: 0, avg_similarity: 0 };
    }
    byCategory[r.category].total++;
    if (r.match) byCategory[r.category].passed++;
  }
  for (const cat of Object.keys(byCategory)) {
    const catEval = allResults.filter(
      (r) => r.category === cat && r.actual_output !== null && !r.error,
    );
    byCategory[cat].avg_similarity =
      catEval.length > 0
        ? catEval.reduce((s, r) => s + r.similarity, 0) / catEval.length
        : 0;
  }

  const combined = {
    generated_at: new Date().toISOString(),
    total: allResults.length,
    passed,
    failed: allResults.length - passed - errors,
    errors,
    pass_rate: allResults.length > 0 ? passed / allResults.length : 0,
    avg_similarity:
      evaluated.length > 0
        ? evaluated.reduce((s, r) => s + r.similarity, 0) / evaluated.length
        : 0,
    by_category: byCategory,
    results: allResults,
  };

  const combinedDir = fixedChildPath(outputDir, "combined");
  mkdirSync(combinedDir, { recursive: true });

  writeFileSync(
    fixedChildPath(combinedDir, "combined-results.json"),
    JSON.stringify(combined, null, 2),
  );

  // Build combined markdown
  const lines: string[] = [];
  lines.push("# Combined Post-Process Test Results");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total | ${combined.total} |`);
  lines.push(`| Passed | ${combined.passed} |`);
  lines.push(`| Failed | ${combined.failed} |`);
  lines.push(`| Errors | ${combined.errors} |`);
  lines.push(`| Pass rate | ${(combined.pass_rate * 100).toFixed(1)}% |`);
  lines.push(
    `| Avg similarity | ${(combined.avg_similarity * 100).toFixed(1)}% |`,
  );
  lines.push("");
  lines.push("## By Category");
  lines.push("");
  lines.push("| Category | Total | Passed | Avg Similarity |");
  lines.push("|----------|-------|--------|----------------|");
  for (const [cat, stats] of Object.entries(combined.by_category)) {
    lines.push(
      `| ${cat} | ${stats.total} | ${stats.passed} | ${(stats.avg_similarity * 100).toFixed(1)}% |`,
    );
  }
  lines.push("");
  lines.push("## Route Distribution");
  lines.push("");
  const routeCounts: Record<string, number> = {};
  for (const r of allResults) {
    const route = r.route?.route || "unknown";
    routeCounts[route] = (routeCounts[route] || 0) + 1;
  }
  lines.push("| Route | Count |");
  lines.push("|-------|-------|");
  for (const [route, count] of Object.entries(routeCounts).sort()) {
    lines.push(`| ${route} | ${count} |`);
  }

  writeFileSync(
    fixedChildPath(combinedDir, "combined-results.md"),
    lines.join("\n"),
  );

  console.log(`\nCombined results → ${combinedDir}/`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = childPath(
    resolve(config.outputDir),
    timestamp,
    "timestamp",
  );
  mkdirSync(outputDir, { recursive: true });

  console.log(`\n╔${"═".repeat(58)}╗`);
  console.log(`║  Vox Jot Post-Process Test Bank Evaluation${" ".repeat(14)}║`);
  console.log(`╠${"═".repeat(58)}╣`);
  console.log(
    `║  Mode:     ${config.live ? "LIVE (LLM)" : "DRY RUN (route only)"}${" ".repeat(config.live ? 27 : 18)}║`,
  );
  console.log(
    `║  Suite:    ${config.suite}${" ".repeat(Math.max(0, 47 - config.suite.length))}║`,
  );
  console.log(
    `║  Provider: ${config.provider}${" ".repeat(Math.max(0, 46 - config.provider.length))}║`,
  );
  console.log(
    `║  Model:    ${config.model}${" ".repeat(Math.max(0, 47 - config.model.length))}║`,
  );
  console.log(
    `║  Output:   ${outputDir.slice(-46)}${" ".repeat(Math.max(0, 46 - outputDir.slice(-46).length))}║`,
  );
  console.log(`╚${"═".repeat(58)}╝`);

  const resultDirs: string[] = [];

  // 1. Run against audio-test-bank cases
  const testBankCases = resolve(
    PROJECT_ROOT,
    "test-data/audio-test-bank/post-process-cases.json",
  );
  if (existsSync(testBankCases)) {
    // Apply suite filter if needed
    if (config.suite === "sanity") {
      const file: CasesFile = JSON.parse(readFileSync(testBankCases, "utf-8"));
      const filtered = filterCases(file.cases, config.suite);
      const tmpPath = fixedChildPath(
        outputDir,
        "_filtered-test-bank-cases.json",
      );
      writeFileSync(
        tmpPath,
        JSON.stringify({ metadata: file.metadata, cases: filtered }, null, 2),
      );
      resultDirs.push(runEval(tmpPath, outputDir, "test-bank", config));
    } else {
      resultDirs.push(runEval(testBankCases, outputDir, "test-bank", config));
    }
  }

  // 1b. Run sanity-filtered spelling cases
  if (config.suite === "sanity") {
    const spellingCases = resolve(
      PROJECT_ROOT,
      "test-data/spelling-corpus/cases.json",
    );
    if (existsSync(spellingCases)) {
      const file: CasesFile = JSON.parse(readFileSync(spellingCases, "utf-8"));
      const filtered = filterCases(file.cases, config.suite);
      if (filtered.length > 0) {
        const tmpPath = fixedChildPath(
          outputDir,
          "_filtered-spelling-cases.json",
        );
        writeFileSync(
          tmpPath,
          JSON.stringify({ metadata: file.metadata, cases: filtered }, null, 2),
        );
        resultDirs.push(runEval(tmpPath, outputDir, "spelling-corpus", config));
      }
    }
  }

  // 2. Run against original dictation corpus (for coverage/all suites)
  if (config.suite !== "sanity") {
    const dictationCases = resolve(
      PROJECT_ROOT,
      "test-data/dictation-corpus/cases.json",
    );
    if (existsSync(dictationCases)) {
      resultDirs.push(
        runEval(dictationCases, outputDir, "dictation-corpus", config),
      );
    }
  }

  // 3. Run against spelling corpus (for coverage/all suites)
  if (config.suite !== "sanity") {
    const spellingCases = resolve(
      PROJECT_ROOT,
      "test-data/spelling-corpus/cases.json",
    );
    if (existsSync(spellingCases)) {
      resultDirs.push(
        runEval(spellingCases, outputDir, "spelling-corpus", config),
      );
    }
  }

  // 4. Merge results
  mergeResults(resultDirs, outputDir);

  console.log(`\n✅ Test bank evaluation complete.`);
  console.log(`   Results: ${outputDir}/`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
