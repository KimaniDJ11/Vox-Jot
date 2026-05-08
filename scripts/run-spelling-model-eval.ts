#!/usr/bin/env bun
/**
 * Run the spelling corpus across locally available post-process models.
 *
 * By default this discovers installed Ollama models and evaluates each one in
 * two modes:
 *   1. production-routes: mirrors Vox Jot routing, including skip decisions.
 *   2. force-llm: sends every case to the model to isolate spelling capability.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

interface Config {
  provider: string;
  baseUrl: string;
  models: string[];
  casesPath: string;
  outputDir: string;
  concurrency: string;
  mode: "both" | "production-routes" | "force-llm";
}

interface EvalSummary {
  provider: string;
  model: string;
  force_llm_on_skip: boolean;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  blocked_candidates: number;
  drift_fallbacks: number;
  exact_matches: number;
  pass_rate: number;
  avg_similarity: number;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
  };

  const provider = get("--provider", "ollama");
  const modelArg = get("--models", "");
  const models = modelArg
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return {
    provider,
    baseUrl: get(
      "--base-url",
      provider === "ollama"
        ? "http://127.0.0.1:11434/v1"
        : "https://api.openai.com/v1",
    ),
    models,
    casesPath: get(
      "--cases",
      resolve(PROJECT_ROOT, "test-data/spelling-corpus/cases.json"),
    ),
    outputDir: get(
      "--output-dir",
      resolve(PROJECT_ROOT, "output/spelling-model-eval"),
    ),
    concurrency: get("--concurrency", "1"),
    mode: get("--mode", "both") as Config["mode"],
  };
}

function discoverOllamaModels(): string[] {
  try {
    const output = execFileSync("ollama", ["list"], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
  } catch {
    return [];
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
}

function runEval(
  model: string,
  forceLlm: boolean,
  config: Config,
  outputRoot: string,
): EvalSummary | null {
  const label = forceLlm ? "force-llm" : "production-routes";
  const outDir = resolve(outputRoot, safeSegment(model), label);
  mkdirSync(outDir, { recursive: true });

  const args = [
    resolve(PROJECT_ROOT, "scripts/eval-post-process.ts"),
    "--cases",
    config.casesPath,
    "--provider",
    config.provider,
    "--model",
    model,
    "--base-url",
    config.baseUrl,
    "--output-dir",
    outDir,
    "--concurrency",
    config.concurrency,
    "--exact-match",
  ];
  if (forceLlm) {
    args.push("--force-llm-on-skip");
  }

  console.log("");
  console.log(`Running ${label}: ${model}`);
  try {
    execFileSync("bun", args, { cwd: PROJECT_ROOT, stdio: "inherit" });
  } catch {
    console.error(
      `Eval command failed for ${model} (${label}); reading partial output if present.`,
    );
  }

  const summaryPath = resolve(outDir, "eval-results.json");
  if (!existsSync(summaryPath)) {
    return null;
  }
  return JSON.parse(readFileSync(summaryPath, "utf-8")) as EvalSummary;
}

function buildReport(summaries: EvalSummary[]): string {
  const lines: string[] = [];
  lines.push("# Spelling Model Evaluation Matrix");
  lines.push("");
  lines.push(
    "| Provider | Model | Mode | Exact | Passed | Errors | Skipped LLM | Blocked | Drift | Avg Similarity |",
  );
  lines.push(
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const summary of summaries) {
    lines.push(
      [
        summary.provider,
        summary.model,
        summary.force_llm_on_skip ? "force-llm" : "production-routes",
        `${summary.exact_matches}/${summary.total}`,
        `${summary.passed}/${summary.total}`,
        summary.errors.toString(),
        summary.skipped.toString(),
        summary.blocked_candidates.toString(),
        summary.drift_fallbacks.toString(),
        `${(summary.avg_similarity * 100).toFixed(1)}%`,
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push(
    "Production-routes mode measures what the app would paste today. Force-LLM mode isolates model spelling capability by bypassing router skips.",
  );
  return lines.join("\n");
}

function main() {
  const config = parseArgs();
  const models =
    config.models.length > 0
      ? config.models
      : config.provider === "ollama"
        ? discoverOllamaModels()
        : [];

  if (models.length === 0) {
    console.error(
      "No models found. Pass --models model-a,model-b or install/start Ollama.",
    );
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputRoot = resolve(config.outputDir, timestamp);
  mkdirSync(outputRoot, { recursive: true });

  const forceModes =
    config.mode === "both"
      ? [false, true]
      : config.mode === "force-llm"
        ? [true]
        : [false];

  const summaries: EvalSummary[] = [];
  for (const model of models) {
    for (const forceLlm of forceModes) {
      const summary = runEval(model, forceLlm, config, outputRoot);
      if (summary) summaries.push(summary);
    }
  }

  const report = buildReport(summaries);
  writeFileSync(resolve(outputRoot, "model-spelling-summary.md"), report);
  writeFileSync(
    resolve(outputRoot, "model-spelling-summary.json"),
    JSON.stringify(
      { generated_at: new Date().toISOString(), summaries },
      null,
      2,
    ),
  );

  console.log("");
  console.log(report);
  console.log("");
  console.log(`Summary written to ${outputRoot}`);
}

main();
