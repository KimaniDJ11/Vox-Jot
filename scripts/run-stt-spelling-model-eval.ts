#!/usr/bin/env bun
/**
 * Evaluate locally installed speech-to-text models against the spelling audio
 * corpus. This uses the existing Rust audio regression harness with
 * post-processing disabled so the numbers reflect raw STT behavior.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const APP_SUPPORT = resolve(
  process.env.HOME ?? "",
  "Library/Application Support/com.iriedinamik.voxjot",
);
const STT_MODELS_DIR = resolve(APP_SUPPORT, "models/stt");
const MLX_AUDIO_PYTHON = resolve(APP_SUPPORT, "mlx-audio-venv/bin/python");
const MLX_AUDIO_DEFAULT_PORT = 8008;
const MLX_AUDIO_FALLBACK_PORT = 8018;

interface Config {
  models: string[];
  manifestPath: string;
  casesPath: string;
  outputDir: string;
  summaryName: string;
  suiteTitle: string;
  description: string;
  limit: string | null;
  skipGenerate: boolean;
  categories: boolean;
}

interface NativeModel {
  id: string;
  label: string;
  engine: string;
  path?: string;
  directory: boolean;
  runtime?: "native" | "mlx" | "apple";
}

interface UnsupportedModel {
  id: string;
  label: string;
  reason: string;
  path?: string;
}

interface RegressionEntry {
  id: string;
  raw_wer: number | null;
  raw_exact_match: boolean;
  raw_normalized_match: boolean;
  stt_latency_ms: number | null;
  stt_real_time_factor: number | null;
  error: string | null;
}

interface RegressionReport {
  generated_at: string;
  model_id: string;
  model_path: string;
  summary: {
    total_entries: number;
    processed_entries: number;
    failed_entries: number;
    raw_exact_matches: number;
    raw_normalized_matches: number;
    average_raw_wer: number;
    stt_latency_ms_p50: number;
    stt_latency_ms_p95: number;
    stt_latency_ms_max: number;
    stt_rtf_p50: number;
    stt_rtf_p95: number;
  };
  entries: RegressionEntry[];
}

interface SpellingCase {
  id: string;
  category: string;
}

interface ManifestEntry {
  id: string;
  audio_path: string;
  expected_text: string;
  duration_secs: number;
  source_relpath: string;
  speaker_id: string;
  chapter_id: string;
  utterance_id: string;
}

interface AudioManifest {
  metadata: Record<string, unknown>;
  entries: ManifestEntry[];
}

interface ModelSummary {
  id: string;
  label: string;
  engine: string;
  status: "passed" | "failed" | "skipped";
  reason?: string;
  report_path?: string;
  total?: number;
  processed?: number;
  failed?: number;
  exact?: number;
  normalized?: number;
  average_raw_wer?: number;
  latency_p50_ms?: number;
  latency_p95_ms?: number;
  rtf_p50?: number;
  rtf_p95?: number;
}

const NATIVE_MODELS: NativeModel[] = [
  {
    id: "tiny",
    label: "Whisper Tiny",
    engine: "Whisper.cpp",
    path: "ggml-tiny.bin",
    directory: false,
  },
  {
    id: "tiny.en",
    label: "Whisper Tiny English",
    engine: "Whisper.cpp",
    path: "ggml-tiny.en.bin",
    directory: false,
  },
  {
    id: "base",
    label: "Whisper Base",
    engine: "Whisper.cpp",
    path: "ggml-base.bin",
    directory: false,
  },
  {
    id: "base.en",
    label: "Whisper Base English",
    engine: "Whisper.cpp",
    path: "ggml-base.en.bin",
    directory: false,
  },
  {
    id: "small",
    label: "Whisper Small",
    engine: "Whisper.cpp",
    path: "ggml-small.bin",
    directory: false,
  },
  {
    id: "small.en",
    label: "Whisper Small English",
    engine: "Whisper.cpp",
    path: "ggml-small.en.bin",
    directory: false,
  },
  {
    id: "medium",
    label: "Whisper Medium",
    engine: "Whisper.cpp",
    path: "ggml-medium.bin",
    directory: false,
  },
  {
    id: "medium.en",
    label: "Whisper Medium English",
    engine: "Whisper.cpp",
    path: "ggml-medium.en.bin",
    directory: false,
  },
  {
    id: "whisper-medium-q4_1",
    label: "Whisper Medium Q4",
    engine: "Whisper.cpp",
    path: "whisper-medium-q4_1.bin",
    directory: false,
  },
  {
    id: "turbo",
    label: "Whisper Turbo",
    engine: "Whisper.cpp",
    path: "ggml-large-v3-turbo.bin",
    directory: false,
  },
  {
    id: "large",
    label: "Whisper Large",
    engine: "Whisper.cpp",
    path: "ggml-large-v3-q5_0.bin",
    directory: false,
  },
  {
    id: "breeze-asr",
    label: "Breeze ASR",
    engine: "Whisper.cpp",
    path: "breeze-asr-q5_k.bin",
    directory: false,
  },
  {
    id: "parakeet-tdt-0.6b-v3",
    label: "Parakeet V3",
    engine: "Parakeet",
    path: "parakeet-tdt-0.6b-v3-int8",
    directory: true,
  },
  {
    id: "parakeet-tdt-0.6b-v2",
    label: "Parakeet V2",
    engine: "Parakeet",
    path: "parakeet-tdt-0.6b-v2-int8",
    directory: true,
  },
  {
    id: "moonshine-tiny-streaming-en",
    label: "Moonshine V2 Tiny",
    engine: "Moonshine streaming",
    path: "moonshine-tiny-streaming-en",
    directory: true,
  },
  {
    id: "moonshine-small-streaming-en",
    label: "Moonshine V2 Small",
    engine: "Moonshine streaming",
    path: "moonshine-small-streaming-en",
    directory: true,
  },
  {
    id: "moonshine-medium-streaming-en",
    label: "Moonshine V2 Medium",
    engine: "Moonshine streaming",
    path: "moonshine-medium-streaming-en",
    directory: true,
  },
  {
    id: "moonshine-base",
    label: "Moonshine Base",
    engine: "Moonshine",
    path: "moonshine-base",
    directory: true,
  },
  {
    id: "sense-voice-int8",
    label: "SenseVoice",
    engine: "SenseVoice",
    path: "sense-voice-int8",
    directory: true,
  },
  {
    id: "gigaam-v3-e2e-ctc",
    label: "GigaAM v3",
    engine: "GigaAM",
    path: "gigaam-v3-e2e-ctc",
    directory: true,
  },
  {
    id: "mlx-whisper-large-v3-turbo",
    label: "Whisper Large V3 Turbo (MLX)",
    engine: "mlx-audio",
    path: "MLX/mlx-community/whisper-large-v3-turbo-asr-fp16",
    directory: true,
    runtime: "mlx",
  },
  {
    id: "mlx-distil-whisper-large-v3",
    label: "Distil-Whisper Large V3 (MLX)",
    engine: "mlx-audio",
    path: "MLX/distil-whisper/distil-large-v3",
    directory: true,
    runtime: "mlx",
  },
  {
    id: "mlx-qwen3-asr",
    label: "Qwen3 ASR (MLX)",
    engine: "mlx-audio",
    path: "MLX/mlx-community/Qwen3-ASR-1.7B-8bit",
    directory: true,
    runtime: "mlx",
  },
  {
    id: "mlx-parakeet-v3",
    label: "Parakeet V3 (MLX)",
    engine: "mlx-audio",
    path: "MLX/mlx-community/parakeet-tdt-0.6b-v3",
    directory: true,
    runtime: "mlx",
  },
  {
    id: "mlx-voxtral-mini-3b",
    label: "Voxtral Mini 3B (MLX)",
    engine: "mlx-audio",
    path: "MLX/mlx-community/Voxtral-Mini-3B-2507-bf16",
    directory: true,
    runtime: "mlx",
  },
  {
    id: "mlx-voxtral-mini-4b-realtime",
    label: "Voxtral Mini 4B Realtime (MLX)",
    engine: "mlx-audio",
    path: "MLX/mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
    directory: true,
    runtime: "mlx",
  },
  {
    id: "apple-speech-analyzer",
    label: "Apple Speech",
    engine: "Apple SpeechAnalyzer",
    directory: false,
    runtime: "apple",
  },
  {
    id: "apple-speech-progressive",
    label: "Apple Speech (Progressive)",
    engine: "Apple SpeechAnalyzer progressive",
    directory: false,
    runtime: "apple",
  },
];

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.lastIndexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
  };
  const has = (flag: string): boolean => args.includes(flag);
  const modelArg = get("--models", "");

  return {
    models: modelArg
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
    manifestPath: get(
      "--manifest",
      resolve(PROJECT_ROOT, "test-data/stt-spelling-regression/manifest.json"),
    ),
    casesPath: get(
      "--cases",
      resolve(PROJECT_ROOT, "test-data/spelling-corpus/cases.json"),
    ),
    outputDir: get(
      "--output-dir",
      resolve(PROJECT_ROOT, "output/stt-spelling-model-eval"),
    ),
    summaryName: get("--summary-name", "stt-spelling-summary"),
    suiteTitle: get("--suite-title", "STT Spelling Model Evaluation Matrix"),
    description: get(
      "--description",
      "Synthetic macOS `say` audio generated from `test-data/spelling-corpus/cases.json`. Post-processing is disabled, so this measures raw transcription only.",
    ),
    limit: get("--limit", ""),
    skipGenerate: has("--skip-generate"),
    categories: !has("--no-categories"),
  };
}

function modelPathExists(model: NativeModel): boolean {
  if (model.runtime === "apple") return process.platform === "darwin";
  if (!model.path) return false;
  return existsSync(resolve(STT_MODELS_DIR, model.path));
}

function discoverNativeModels(config: Config): NativeModel[] {
  const installed = NATIVE_MODELS.filter(modelPathExists);
  if (config.models.length === 0) return installed;
  const requested = new Set(config.models);
  return installed.filter((model) => requested.has(model.id));
}

function discoverUnsupportedModels(config: Config): UnsupportedModel[] {
  const unsupported: UnsupportedModel[] = [];
  const gigaPackageDir = resolve(STT_MODELS_DIR, "gigaam-v3-e2e-ctc");
  const legacyGigaFile = resolve(STT_MODELS_DIR, "giga-am-v3.int8.onnx");
  if (!existsSync(gigaPackageDir) && existsSync(legacyGigaFile)) {
    unsupported.push({
      id: "gigaam-v3-e2e-ctc",
      label: "GigaAM v3",
      path: legacyGigaFile,
      reason:
        "Only a legacy ONNX file is present. GigaAM needs a directory package with model.int8.onnx and vocab.txt.",
    });
  }

  if (config.models.length === 0) return unsupported;
  const requested = new Set(config.models);
  return unsupported.filter((model) => requested.has(model.id));
}

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
}

function ensureManifest(config: Config) {
  if (config.skipGenerate && existsSync(config.manifestPath)) return;

  const args = [
    resolve(PROJECT_ROOT, "scripts/generate-stt-spelling-audio.ts"),
    "--cases",
    config.casesPath,
    "--output-dir",
    dirname(config.manifestPath),
  ];
  if (config.limit) {
    args.push("--limit", config.limit);
  }

  execFileSync("bun", args, { cwd: PROJECT_ROOT, stdio: "inherit" });
}

function repairLocalAudioManifest(config: Config) {
  if (!existsSync(config.manifestPath)) return;

  let parsed: AudioManifest;
  try {
    parsed = JSON.parse(
      readFileSync(config.manifestPath, "utf-8"),
    ) as AudioManifest;
  } catch {
    return;
  }

  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) return;

  const missing = parsed.entries.filter(
    (entry) => !existsSync(entry.audio_path),
  );
  if (missing.length === 0) return;

  const clipDir = resolve(PROJECT_ROOT, "test-data/audio-regression/clips");
  const repairedEntries = parsed.entries
    .map((entry) => {
      if (existsSync(entry.audio_path)) return entry;
      const localClip = resolve(clipDir, basename(entry.audio_path));
      if (!existsSync(localClip)) return null;
      return { ...entry, audio_path: localClip };
    })
    .filter((entry): entry is ManifestEntry => entry !== null);

  if (repairedEntries.length === 0) return;

  const outputPath = resolve(
    PROJECT_ROOT,
    "test-data/audio-regression/reports/local-existing-manifest.json",
  );
  const repaired: AudioManifest = {
    ...parsed,
    metadata: {
      ...parsed.metadata,
      clip_count: repairedEntries.length,
      repaired_from: config.manifestPath,
      repaired_at: new Date().toISOString(),
    },
    entries: repairedEntries,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(repaired, null, 2)}\n`);
  config.manifestPath = outputPath;
  console.log(
    `Repaired manifest paths for ${repairedEntries.length}/${parsed.entries.length} local audio clips.`,
  );
}

function mlxAudioBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function serviceResponds(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function mlxAudioHealthy(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForMlxAudio(
  baseUrl: string,
  attempts: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await mlxAudioHealthy(baseUrl)) return true;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
  }
  return false;
}

async function ensureMlxAudioSidecar(
  models: NativeModel[],
): Promise<{ baseUrl?: string; stop: () => void }> {
  if (!models.some((model) => model.runtime === "mlx")) {
    return { stop: () => {} };
  }

  const defaultBaseUrl = mlxAudioBaseUrl(MLX_AUDIO_DEFAULT_PORT);
  if (await mlxAudioHealthy(defaultBaseUrl)) {
    return { baseUrl: defaultBaseUrl, stop: () => {} };
  }

  if (!existsSync(MLX_AUDIO_PYTHON)) {
    throw new Error(
      `MLX models are installed, but the managed mlx-audio Python runtime is missing at ${MLX_AUDIO_PYTHON}. Open Vox Jot once with the MLX backend, or install the runtime before running this benchmark.`,
    );
  }

  const port = (await serviceResponds(defaultBaseUrl))
    ? MLX_AUDIO_FALLBACK_PORT
    : MLX_AUDIO_DEFAULT_PORT;
  const baseUrl = mlxAudioBaseUrl(port);

  console.log(
    `Starting mlx-audio sidecar for STT benchmark coverage on ${baseUrl}...`,
  );
  const child: ChildProcess = spawn(
    MLX_AUDIO_PYTHON,
    ["-m", "mlx_audio.server", "--port", String(port)],
    {
      cwd: dirname(dirname(MLX_AUDIO_PYTHON)),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );

  if (!(await waitForMlxAudio(baseUrl, 60))) {
    child.kill();
    throw new Error(
      "Timed out waiting for mlx-audio sidecar to become healthy.",
    );
  }

  return {
    baseUrl,
    stop: () => {
      child.kill();
    },
  };
}

function runModel(
  model: NativeModel,
  config: Config,
  outputRoot: string,
  mlxAudioBaseUrl?: string,
): ModelSummary {
  const modelDir = resolve(outputRoot, safeSegment(model.id));
  mkdirSync(modelDir, { recursive: true });
  const reportPath = resolve(modelDir, "report.json");

  const args = [
    "run",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--",
    "--regression-manifest",
    config.manifestPath,
    "--regression-output",
    reportPath,
    "--regression-model-id",
    model.id,
    "--regression-skip-post-process",
  ];
  if (config.limit) {
    args.push("--regression-limit", config.limit);
  }

  console.log("");
  console.log(`Running STT spelling eval: ${model.label} (${model.id})`);
  try {
    execFileSync("cargo", args, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(model.runtime === "mlx" && mlxAudioBaseUrl
          ? { VOX_JOT_MLX_AUDIO_BASE_URL: mlxAudioBaseUrl }
          : {}),
      },
    });
  } catch (error) {
    return {
      id: model.id,
      label: model.label,
      engine: model.engine,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      report_path: existsSync(reportPath) ? reportPath : undefined,
    };
  }

  const report = JSON.parse(
    readFileSync(reportPath, "utf-8"),
  ) as RegressionReport;
  return {
    id: model.id,
    label: model.label,
    engine: model.engine,
    status: report.summary.failed_entries > 0 ? "failed" : "passed",
    report_path: reportPath,
    total: report.summary.total_entries,
    processed: report.summary.processed_entries,
    failed: report.summary.failed_entries,
    exact: report.summary.raw_exact_matches,
    normalized: report.summary.raw_normalized_matches,
    average_raw_wer: report.summary.average_raw_wer,
    latency_p50_ms: report.summary.stt_latency_ms_p50,
    latency_p95_ms: report.summary.stt_latency_ms_p95,
    rtf_p50: report.summary.stt_rtf_p50,
    rtf_p95: report.summary.stt_rtf_p95,
  };
}

function loadCaseCategories(casesPath: string): Map<string, string> {
  if (!existsSync(casesPath)) return new Map();
  const raw = readFileSync(casesPath, "utf-8");
  const parsed = JSON.parse(raw) as { cases: SpellingCase[] };
  return new Map(parsed.cases.map((entry) => [entry.id, entry.category]));
}

function buildCategoryReport(
  summaries: ModelSummary[],
  caseCategories: Map<string, string>,
): string[] {
  const lines: string[] = [];
  for (const summary of summaries) {
    if (!summary.report_path || !existsSync(summary.report_path)) continue;
    const report = JSON.parse(
      readFileSync(summary.report_path, "utf-8"),
    ) as RegressionReport;
    const categories = new Map<
      string,
      { total: number; normalized: number; werTotal: number; werCount: number }
    >();
    for (const entry of report.entries) {
      const category = caseCategories.get(entry.id) ?? "unknown";
      const bucket = categories.get(category) ?? {
        total: 0,
        normalized: 0,
        werTotal: 0,
        werCount: 0,
      };
      bucket.total += 1;
      if (entry.raw_normalized_match) bucket.normalized += 1;
      if (entry.raw_wer !== null) {
        bucket.werTotal += entry.raw_wer;
        bucket.werCount += 1;
      }
      categories.set(category, bucket);
    }

    lines.push(`## ${summary.label} Category Breakdown`);
    lines.push("");
    lines.push("| Category | Normalized | Avg raw WER |");
    lines.push("| --- | ---: | ---: |");
    for (const [category, bucket] of [...categories.entries()].sort()) {
      const wer = bucket.werCount > 0 ? bucket.werTotal / bucket.werCount : 0;
      lines.push(
        `| ${category} | ${bucket.normalized}/${bucket.total} | ${wer.toFixed(3)} |`,
      );
    }
    lines.push("");
  }
  return lines;
}

function buildMarkdown(
  config: Config,
  summaries: ModelSummary[],
  unsupported: UnsupportedModel[],
  caseCategories: Map<string, string>,
): string {
  const lines: string[] = [];
  lines.push(`# ${config.suiteTitle}`);
  lines.push("");
  lines.push(config.description);
  lines.push("");
  lines.push(
    "| Model | Engine | Status | Normalized | Exact | Avg raw WER | p50 latency | p95 latency | p50 RTF |",
  );
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const summary of summaries) {
    lines.push(
      [
        summary.label,
        summary.engine,
        summary.status,
        summary.total ? `${summary.normalized}/${summary.total}` : "n/a",
        summary.total ? `${summary.exact}/${summary.total}` : "n/a",
        summary.average_raw_wer?.toFixed(3) ?? "n/a",
        summary.latency_p50_ms !== undefined
          ? `${summary.latency_p50_ms} ms`
          : "n/a",
        summary.latency_p95_ms !== undefined
          ? `${summary.latency_p95_ms} ms`
          : "n/a",
        summary.rtf_p50?.toFixed(2) ?? "n/a",
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");

  if (unsupported.length > 0) {
    lines.push("## Skipped Runtime-Backed Models");
    lines.push("");
    lines.push("| Model | Reason |");
    lines.push("| --- | --- |");
    for (const model of unsupported) {
      lines.push(`| ${model.label} | ${model.reason} |`);
    }
    lines.push("");
  }

  if (config.categories && caseCategories.size > 0) {
    lines.push(...buildCategoryReport(summaries, caseCategories));
  }
  return lines.join("\n");
}

async function main() {
  const config = parseArgs();
  ensureManifest(config);
  repairLocalAudioManifest(config);

  const nativeModels = discoverNativeModels(config);
  const unsupported = discoverUnsupportedModels(config);

  if (nativeModels.length === 0 && unsupported.length === 0) {
    console.error("No installed STT models found for evaluation.");
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputRoot = resolve(config.outputDir, timestamp);
  mkdirSync(outputRoot, { recursive: true });

  const mlxAudioSidecar = await ensureMlxAudioSidecar(nativeModels);
  try {
    const summaries = nativeModels.map((model) =>
      runModel(model, config, outputRoot, mlxAudioSidecar.baseUrl),
    );
    const skippedSummaries: ModelSummary[] = unsupported.map((model) => ({
      id: model.id,
      label: model.label,
      engine: "runtime-backed",
      status: "skipped",
      reason: model.reason,
    }));
    const allSummaries = [...summaries, ...skippedSummaries];
    const caseCategories = loadCaseCategories(config.casesPath);
    const markdown = buildMarkdown(
      config,
      allSummaries,
      unsupported,
      caseCategories,
    );

    writeFileSync(resolve(outputRoot, `${config.summaryName}.md`), markdown);
    writeFileSync(
      resolve(outputRoot, `${config.summaryName}.json`),
      `${JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          manifest_path: config.manifestPath,
          native_models: summaries,
          skipped_models: unsupported,
        },
        null,
        2,
      )}\n`,
    );

    console.log("");
    console.log(markdown);
    console.log("");
    console.log(`Summary written to ${outputRoot}`);
  } finally {
    mlxAudioSidecar.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
