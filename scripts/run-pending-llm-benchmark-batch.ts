#!/usr/bin/env bun
/**
 * Download, benchmark, update the testing view, and remove pending LLM models.
 *
 * The runner keeps at most one model download and one model evaluation active:
 * once model N is available, it starts downloading model N+1 while model N is
 * being tested. Models that were not installed before the batch are deleted
 * after their evaluation completes.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LLM_EVALUATION_RESULTS,
  type LlmEvaluationResult,
} from "../src/lib/llmEvaluationResults.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const OUTPUT_ROOT = resolve(
  PROJECT_ROOT,
  "output/llm-model-eval-pending-2026-05-12",
);
const DOWNLOAD_DIR = resolve(OUTPUT_ROOT, "_downloads");
const ORIGINAL_INSTALLED_PATH = resolve(
  OUTPUT_ROOT,
  "originally-installed-ollama-models.json",
);
const CASES_PATH = resolve(
  PROJECT_ROOT,
  "test-data/audio-test-bank/post-process-cases.json",
);
const RESULTS_SOURCE_PATH = resolve(
  PROJECT_ROOT,
  "src/lib/llmEvaluationResults.ts",
);

type ModelSpec = {
  modelIds: string[];
  label: string;
  runtimeModelId: string;
  approxSizeMb: number;
  source:
    | { kind: "ollama" }
    | {
        kind: "hf-gguf";
        repoId: string;
        fileName: string;
      };
};

type EvalSummary = {
  model: string;
  total: number;
  passed: number;
  errors: number;
  blocked_candidates: number;
  drift_fallbacks: number;
  pass_rate: number;
  avg_similarity: number;
  latency_p50_ms?: number;
  latency_p95_ms?: number;
  prompt_profile: string;
  by_category: Record<
    string,
    {
      total: number;
      passed: number;
      avg_similarity: number;
    }
  >;
};

type DownloadOutcome =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

const PENDING_MODELS: ModelSpec[] = (
  [
    {
      modelIds: ["smollm2:135m"],
      label: "SmolLM2 135M",
      runtimeModelId: "smollm2:135m",
      approxSizeMb: 200,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["falcon3:1b"],
      label: "Falcon 3 1B",
      runtimeModelId: "falcon3:1b",
      approxSizeMb: 700,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["tinydolphin:1.1b"],
      label: "TinyDolphin 1.1B",
      runtimeModelId: "tinydolphin:1.1b",
      approxSizeMb: 600,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["lfm2-1.2b-tool-q4_k_m"],
      label: "LFM2 1.2B Tool Q4_K_M",
      runtimeModelId: "lfm2-1.2b-tool-q4_k_m",
      approxSizeMb: 850,
      source: {
        kind: "hf-gguf",
        repoId: "LiquidAI/LFM2-1.2B-Tool-GGUF",
        fileName: "LFM2-1.2B-Tool-Q4_K_M.gguf",
      },
    },
    {
      modelIds: ["granite3.1-moe:1b"],
      label: "Granite 3.1 MoE 1B",
      runtimeModelId: "granite3.1-moe:1b",
      approxSizeMb: 900,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["qwen2.5-coder:1.5b"],
      label: "Qwen 2.5 Coder 1.5B",
      runtimeModelId: "qwen2.5-coder:1.5b",
      approxSizeMb: 1000,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["gemma2:2b"],
      label: "Gemma 2 2B",
      runtimeModelId: "gemma2:2b",
      approxSizeMb: 1600,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["codegemma:2b"],
      label: "CodeGemma 2B",
      runtimeModelId: "codegemma:2b",
      approxSizeMb: 1600,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["granite3.1-dense:2b"],
      label: "Granite 3.1 Dense 2B",
      runtimeModelId: "granite3.1-dense:2b",
      approxSizeMb: 1600,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["llama3.2:3b", "llama-3.2-3b-instruct-q4_k_m"],
      label: "Llama 3.2 3B",
      runtimeModelId: "llama3.2:3b",
      approxSizeMb: 2000,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["phi3:mini"],
      label: "Phi-3 Mini",
      runtimeModelId: "phi3:mini",
      approxSizeMb: 2200,
      source: { kind: "ollama" },
    },
    {
      modelIds: ["mistral:7b-instruct-q2_K"],
      label: "Mistral 7B Instruct Q2_K",
      runtimeModelId: "mistral:7b-instruct-q2_K",
      approxSizeMb: 2700,
      source: { kind: "ollama" },
    },
  ] satisfies ModelSpec[]
).sort((a, b) => a.approxSizeMb - b.approxSizeMb);

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; label: string },
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    console.log(`\n[${options.label}] ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd: options.cwd ?? PROJECT_ROOT,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${options.label} exited with code ${code}`));
      }
    });
  });
}

function ollamaList(): string[] {
  const proc = spawnSync("ollama", ["list"], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  });
  if (proc.status !== 0) {
    throw new Error(`Unable to list Ollama models: ${proc.stderr}`);
  }
  return proc.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function loadOriginallyInstalledModels(): Set<string> {
  if (existsSync(ORIGINAL_INSTALLED_PATH)) {
    const values = JSON.parse(
      readFileSync(ORIGINAL_INSTALLED_PATH, "utf-8"),
    ) as string[];
    return new Set(values.map((model) => model.replace(/:latest$/, "")));
  }

  const installed = ollamaList().map((model) => model.replace(/:latest$/, ""));
  writeFileSync(ORIGINAL_INSTALLED_PATH, JSON.stringify(installed, null, 2));
  return new Set(installed);
}

function installedMatches(installed: string[], modelId: string): boolean {
  const normalized = modelId.replace(/:latest$/, "");
  return installed.some(
    (model) => model.replace(/:latest$/, "") === normalized,
  );
}

async function downloadModel(model: ModelSpec): Promise<void> {
  if (model.source.kind === "ollama") {
    await runCommand("ollama", ["pull", model.runtimeModelId], {
      label: `download ${model.label}`,
    });
    return;
  }

  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const modelDir = resolve(DOWNLOAD_DIR, safeSegment(model.runtimeModelId));
  mkdirSync(modelDir, { recursive: true });
  const ggufPath = resolve(modelDir, model.source.fileName);
  const url = `https://huggingface.co/${model.source.repoId}/resolve/main/${model.source.fileName}?download=true`;

  if (!existsSync(ggufPath)) {
    await runCommand("curl", ["-L", "--fail", "-o", ggufPath, url], {
      label: `download ${model.label}`,
    });
  }

  const modelfilePath = resolve(modelDir, "Modelfile");
  writeFileSync(modelfilePath, `FROM ${ggufPath}\n`);
  await runCommand(
    "ollama",
    ["create", model.runtimeModelId, "-f", modelfilePath],
    {
      label: `import ${model.label}`,
    },
  );
}

async function evaluateModel(model: ModelSpec): Promise<EvalSummary> {
  const outputDir = resolve(OUTPUT_ROOT, safeSegment(model.runtimeModelId));
  await runCommand(
    "bun",
    [
      resolve(PROJECT_ROOT, "scripts/eval-post-process.ts"),
      "--cases",
      CASES_PATH,
      "--provider",
      "ollama",
      "--model",
      model.runtimeModelId,
      "--base-url",
      "http://127.0.0.1:11434/v1",
      "--output-dir",
      outputDir,
      "--concurrency",
      "1",
      "--timeout-ms",
      "10000",
      "--prompt-profile",
      "auto",
    ],
    { label: `evaluate ${model.label}` },
  );

  return JSON.parse(
    readFileSync(resolve(outputDir, "eval-results.json"), "utf-8"),
  ) as EvalSummary;
}

function readExistingSummary(model: ModelSpec): EvalSummary | null {
  const summaryPath = resolve(
    OUTPUT_ROOT,
    safeSegment(model.runtimeModelId),
    "eval-results.json",
  );
  if (!existsSync(summaryPath)) return null;
  return JSON.parse(readFileSync(summaryPath, "utf-8")) as EvalSummary;
}

async function deleteModelIfNeeded(
  model: ModelSpec,
  originallyInstalled: Set<string>,
): Promise<void> {
  if (originallyInstalled.has(model.runtimeModelId.replace(/:latest$/, ""))) {
    console.log(`[keep] ${model.label} was installed before this batch`);
    return;
  }

  if (!installedMatches(ollamaList(), model.runtimeModelId)) {
    console.log(`[delete skipped] ${model.label} is already absent`);
    return;
  }

  try {
    await runCommand("ollama", ["rm", model.runtimeModelId], {
      label: `delete ${model.label}`,
    });
  } catch (error) {
    console.error(`[delete failed] ${model.label}: ${error}`);
  }

  const downloadCache = resolve(
    DOWNLOAD_DIR,
    safeSegment(model.runtimeModelId),
  );
  if (existsSync(downloadCache)) {
    rmSync(downloadCache, { recursive: true, force: true });
  }
}

function categoryName(
  summary: EvalSummary,
  pick: "strongest" | "weakest",
): string | undefined {
  const categories = Object.entries(summary.by_category);
  if (categories.length === 0) return undefined;
  categories.sort(([, a], [, b]) => {
    const passDelta = b.passed / b.total - a.passed / a.total;
    if (passDelta !== 0) return pick === "strongest" ? passDelta : -passDelta;
    const simDelta = b.avg_similarity - a.avg_similarity;
    return pick === "strongest" ? simDelta : -simDelta;
  });
  return categories[0]?.[0];
}

function resultFromSummary(
  model: ModelSpec,
  summary: EvalSummary,
): LlmEvaluationResult {
  const fallbacks = summary.blocked_candidates + summary.drift_fallbacks;
  const latency =
    summary.latency_p50_ms === undefined
      ? "unknown p50 latency"
      : `p50 ${summary.latency_p50_ms} ms`;

  return {
    modelIds: model.modelIds,
    label: model.label,
    status: "tested",
    passed: summary.passed,
    totalCases: summary.total,
    passRate: summary.pass_rate,
    averageSimilarity: summary.avg_similarity,
    latencyP50Ms: summary.latency_p50_ms,
    latencyP95Ms: summary.latency_p95_ms,
    promptProfile: summary.prompt_profile,
    errors: summary.errors,
    blockedCandidates: summary.blocked_candidates,
    driftFallbacks: summary.drift_fallbacks,
    strongestCategory: categoryName(summary, "strongest"),
    weakestCategory: categoryName(summary, "weakest"),
    notes:
      `Completed in the pending local batch; ${summary.passed}/${summary.total} passed, ` +
      `${fallbacks} guardrail fallback${fallbacks === 1 ? "" : "s"}, ${latency}.`,
  };
}

function rankTestedResults(
  results: LlmEvaluationResult[],
): LlmEvaluationResult[] {
  const tested = results.filter((result) => result.status === "tested");
  tested.sort((a, b) => {
    const passedDelta = (b.passed ?? 0) - (a.passed ?? 0);
    if (passedDelta !== 0) return passedDelta;
    const fallbackDelta =
      (a.blockedCandidates ?? 0) +
      (a.driftFallbacks ?? 0) -
      ((b.blockedCandidates ?? 0) + (b.driftFallbacks ?? 0));
    if (fallbackDelta !== 0) return fallbackDelta;
    const errorDelta = (a.errors ?? 0) - (b.errors ?? 0);
    if (errorDelta !== 0) return errorDelta;
    const similarityDelta =
      (b.averageSimilarity ?? 0) - (a.averageSimilarity ?? 0);
    if (similarityDelta !== 0) return similarityDelta;
    return (
      (a.latencyP50Ms ?? Number.MAX_SAFE_INTEGER) -
      (b.latencyP50Ms ?? Number.MAX_SAFE_INTEGER)
    );
  });

  return tested.map((result, index) => ({
    ...result,
    rank: index + 1,
  }));
}

function writeResultsSource(
  results: LlmEvaluationResult[],
  reportPath: string,
): void {
  const tested = rankTestedResults(results);
  const pending = results
    .filter((result) => result.status !== "tested")
    .map((result) => {
      const copy = { ...result };
      delete copy.rank;
      return copy;
    });
  const ordered = [...tested, ...pending];

  const body = `export type LlmEvaluationStatus = "tested" | "pending";

export interface LlmEvaluationResult {
  modelIds: string[];
  label: string;
  status: LlmEvaluationStatus;
  rank?: number;
  passed?: number;
  totalCases?: number;
  passRate?: number;
  averageSimilarity?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  promptProfile?: string;
  errors?: number;
  blockedCandidates?: number;
  driftFallbacks?: number;
  strongestCategory?: string;
  weakestCategory?: string;
  notes?: string;
}

export const LLM_EVALUATION_RUN = {
  generatedAt: ${JSON.stringify(new Date().toISOString())},
  suite: "LLM post-process sanity",
  corpus:
    "46 real-world dictation cleanup cases from the Vox Jot audio test bank",
  limitations:
    "Pass counts include production safety fallbacks. The fallback metric shows how often output was blocked or reverted for drift, which is separate from direct model quality.",
  metricGuide: [
    "Rank: #1 is best for this suite.",
    "Pass and similarity: higher is better.",
    "p50 latency: lower is faster.",
    "Fallback: lower is better.",
    "Profile is informational.",
  ],
  reportPath: ${JSON.stringify(reportPath)},
  timeoutMs: 10000,
};

export const LLM_EVALUATION_RESULTS: LlmEvaluationResult[] = ${JSON.stringify(
    ordered,
    null,
    2,
  )};

export function getLlmEvaluationResult(
  modelId: string,
): LlmEvaluationResult | undefined {
  const normalizedModelId = modelId.trim().replace(/:latest$/, "");
  return LLM_EVALUATION_RESULTS.find((result) =>
    result.modelIds.some((id) => {
      const normalizedId = id.trim().replace(/:latest$/, "");
      return normalizedId === normalizedModelId;
    }),
  );
}
`;

  writeFileSync(RESULTS_SOURCE_PATH, body);
}

function writeBatchSummary(
  completed: Array<{ model: ModelSpec; summary: EvalSummary }>,
  downloadFailures: Array<{ model: ModelSpec; error: string }>,
): void {
  const rows = completed
    .map(({ model, summary }) =>
      [
        model.label,
        `${summary.passed}/${summary.total}`,
        `${(summary.avg_similarity * 100).toFixed(1)}%`,
        summary.latency_p50_ms === undefined
          ? "n/a"
          : `${summary.latency_p50_ms} ms`,
        `${summary.blocked_candidates + summary.drift_fallbacks}/${summary.total}`,
        summary.errors.toString(),
      ].join(" | "),
    )
    .map((row) => `| ${row} |`);
  const failureRows = downloadFailures.map(
    ({ model, error }) =>
      `| ${model.label} | ${error.replace(/\s+/g, " ").trim()} |`,
  );
  const markdown = [
    "# Pending LLM Benchmark Batch",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Model | Passed | Similarity | p50 | Fallback | Errors |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    ...(failureRows.length > 0
      ? [
          "## Download Failures",
          "",
          "| Model | Error |",
          "| --- | --- |",
          ...failureRows,
          "",
        ]
      : []),
    "Each model was downloaded or imported, evaluated against the 46-case Vox Jot post-process bank, then removed if it was not installed before this run.",
    "",
  ].join("\n");
  writeFileSync(resolve(OUTPUT_ROOT, "pending-llm-batch-summary.md"), markdown);
}

async function main() {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const originallyInstalled = loadOriginallyInstalledModels();
  const results = LLM_EVALUATION_RESULTS.map((result) => ({ ...result }));
  const completed: Array<{ model: ModelSpec; summary: EvalSummary }> = [];
  const downloadFailures: Array<{ model: ModelSpec; error: string }> = [];
  const downloadPromises = new Map<string, Promise<DownloadOutcome>>();

  for (const model of PENDING_MODELS) {
    const summary = readExistingSummary(model);
    if (!summary) continue;
    completed.push({ model, summary });
    const replacement = resultFromSummary(model, summary);
    const existingIndex = results.findIndex((result) =>
      result.modelIds.some((id) => model.modelIds.includes(id)),
    );
    if (existingIndex >= 0) {
      results[existingIndex] = replacement;
    } else {
      results.push(replacement);
    }
  }

  const startDownload = (model: ModelSpec) => {
    const normalized = model.runtimeModelId.replace(/:latest$/, "");
    if (downloadPromises.has(model.runtimeModelId)) return;
    if (readExistingSummary(model)) {
      downloadPromises.set(model.runtimeModelId, Promise.resolve({ ok: true }));
      return;
    }
    if (
      originallyInstalled.has(normalized) ||
      installedMatches(ollamaList(), model.runtimeModelId)
    ) {
      console.log(`[download skipped] ${model.label} already installed`);
      downloadPromises.set(model.runtimeModelId, Promise.resolve({ ok: true }));
      return;
    }
    downloadPromises.set(
      model.runtimeModelId,
      downloadModel(model)
        .then(() => ({ ok: true }) as DownloadOutcome)
        .catch(
          (error) =>
            ({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }) as DownloadOutcome,
        ),
    );
  };

  startDownload(PENDING_MODELS[0]);

  for (let index = 0; index < PENDING_MODELS.length; index++) {
    const model = PENDING_MODELS[index];
    const download = downloadPromises.get(model.runtimeModelId);
    if (!download)
      throw new Error(`Missing download promise for ${model.label}`);

    const outcome = await download;

    const next = PENDING_MODELS[index + 1];
    if (next) startDownload(next);

    if (!outcome.ok) {
      console.error(`[download failed] ${model.label}: ${outcome.error}`);
      downloadFailures.push({ model, error: outcome.error });
      const existingIndex = results.findIndex((result) =>
        result.modelIds.some((id) => model.modelIds.includes(id)),
      );
      const pendingResult: LlmEvaluationResult = {
        modelIds: model.modelIds,
        label: model.label,
        status: "pending",
        notes: `Download failed during the local benchmark batch: ${outcome.error}`,
      };
      if (existingIndex >= 0) {
        results[existingIndex] = pendingResult;
      } else {
        results.push(pendingResult);
      }
      writeBatchSummary(completed, downloadFailures);
      writeResultsSource(results, "output/llm-model-eval-pending-2026-05-12");
      continue;
    }

    const summary = readExistingSummary(model) ?? (await evaluateModel(model));
    if (
      !completed.some(
        (entry) => entry.model.runtimeModelId === model.runtimeModelId,
      )
    ) {
      completed.push({ model, summary });
    }

    const replacement = resultFromSummary(model, summary);
    const existingIndex = results.findIndex((result) =>
      result.modelIds.some((id) => model.modelIds.includes(id)),
    );
    if (existingIndex >= 0) {
      results[existingIndex] = replacement;
    } else {
      results.push(replacement);
    }
    writeBatchSummary(completed, downloadFailures);
    writeResultsSource(results, "output/llm-model-eval-pending-2026-05-12");

    await deleteModelIfNeeded(model, originallyInstalled);
  }

  console.log("\nPending LLM batch complete.");
  console.log(
    `Summary: ${resolve(OUTPUT_ROOT, "pending-llm-batch-summary.md")}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
