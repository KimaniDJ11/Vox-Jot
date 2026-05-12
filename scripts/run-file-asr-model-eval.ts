#!/usr/bin/env bun
/**
 * Evaluate file-transcription ASR sidecar models on the checked-in sample.
 *
 * This intentionally stays outside live dictation. It calls the same Python
 * sidecar used by file transcription and writes a stable JSON/Markdown report.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const MODEL_ROOT = resolve(
  process.env.HOME ?? "",
  "Library/Application Support/com.iriedinamik.voxjot/models/speech-analysis",
);
const STT_MODEL_ROOT = resolve(
  process.env.HOME ?? "",
  "Library/Application Support/com.iriedinamik.voxjot/models/stt",
);
const REFERENCE =
  "This is a file transcription test for Vox Jot. One, two, three, four, five.";

interface Config {
  models: string[];
  samplePath: string;
  outputDir: string;
  attempts: number;
}

interface ModelSpec {
  id: string;
  label: string;
  sidecar: boolean;
}

interface SidecarPayload {
  ok: boolean;
  text?: string;
  segments?: unknown[];
  speaker_turns?: unknown[];
  device?: string;
  error?: string;
}

interface ModelResult {
  model_id: string;
  label: string;
  status: "tested" | "skipped" | "failed";
  attempts: number;
  text?: string;
  wer?: number;
  exact_match?: boolean;
  latency_ms?: number;
  real_time_factor?: number;
  device?: string;
  reason?: string;
}

function parseSidecarPayload(stdout: string): SidecarPayload {
  const lines = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.reverse()) {
    if (!line.startsWith("{")) continue;
    return JSON.parse(line) as SidecarPayload;
  }
  throw new Error("sidecar did not emit a JSON payload");
}

const MODELS: ModelSpec[] = [
  {
    id: "current_dictation_engine",
    label: "Current Dictation Engine",
    sidecar: false,
  },
  {
    id: "granite-speech-4-1-2b",
    label: "Granite Speech 4.1 2B",
    sidecar: true,
  },
  {
    id: "cohere-transcribe-03-2026",
    label: "Cohere Transcribe 03-2026",
    sidecar: true,
  },
  {
    id: "mlx-qwen3-asr-0.6b",
    label: "Qwen3 ASR 0.6B (MLX)",
    sidecar: true,
  },
  {
    id: "mlx-qwen3-asr",
    label: "Qwen3 ASR 1.7B (MLX)",
    sidecar: true,
  },
  {
    id: "mlx-fireredasr2-aed",
    label: "FireRedASR2 AED (MLX)",
    sidecar: true,
  },
  {
    id: "mlx-vibevoice-asr-bf16",
    label: "VibeVoice ASR 9B (MLX)",
    sidecar: true,
  },
  {
    id: "whisper-diarization",
    label: "Whisper Diarization",
    sidecar: true,
  },
];

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
  };
  const models = get("--models", "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return {
    models,
    samplePath: get(
      "--sample",
      resolve(
        PROJECT_ROOT,
        "test-data/file-transcription-samples/sample_speech_48k_mono.wav",
      ),
    ),
    outputDir: get(
      "--output-dir",
      resolve(PROJECT_ROOT, "output/file-asr-model-eval"),
    ),
    attempts: Math.max(1, Number.parseInt(get("--attempts", "3"), 10) || 3),
  };
}

function selectedModels(config: Config): ModelSpec[] {
  if (config.models.length === 0) return MODELS;
  const requested = new Set(config.models);
  return MODELS.filter((model) => requested.has(model.id));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left: string[], right: string[]): number {
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j < previous.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length];
}

function wordErrorRate(reference: string, hypothesis: string): number {
  const referenceWords = normalizeText(reference).split(" ").filter(Boolean);
  const hypothesisWords = normalizeText(hypothesis).split(" ").filter(Boolean);
  if (referenceWords.length === 0) return hypothesisWords.length === 0 ? 0 : 1;
  return editDistance(referenceWords, hypothesisWords) / referenceWords.length;
}

function ensure16kSample(samplePath: string, outputRoot: string): string {
  const wav16k = resolve(outputRoot, "sample-16k.wav");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      samplePath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      wav16k,
    ],
    { cwd: PROJECT_ROOT, stdio: "inherit" },
  );
  return wav16k;
}

function sampleDurationMs(samplePath: string): number {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      samplePath,
    ],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
  return Math.round(Number.parseFloat(output.trim()) * 1000);
}

function modelDownloaded(modelId: string): boolean {
  const path = resolve(MODEL_ROOT, modelId);
  if (existsSync(path)) return true;

  const sttMlxPaths: Record<string, string> = {
    "mlx-qwen3-asr-0.6b": "MLX/mlx-community/Qwen3-ASR-0.6B-8bit",
    "mlx-qwen3-asr": "MLX/mlx-community/Qwen3-ASR-1.7B-8bit",
    "mlx-fireredasr2-aed": "MLX/mlx-community/FireRedASR2-AED-mlx",
    "mlx-vibevoice-asr-bf16": "MLX/mlx-community/VibeVoice-ASR-bf16",
  };
  const sttPath = sttMlxPaths[modelId];
  return sttPath ? existsSync(resolve(STT_MODEL_ROOT, sttPath)) : false;
}

function runSidecar(
  model: ModelSpec,
  sample16k: string,
  durationMs: number,
): ModelResult {
  const python = resolve(PROJECT_ROOT, ".venv/bin/python");
  const sidecar = resolve(PROJECT_ROOT, "scripts/speech_analysis_sidecar.py");
  const started = performance.now();
  const result = spawnSync(
    python,
    [
      sidecar,
      "--audio",
      sample16k,
      "--asr-model",
      model.id,
      "--diarization-model",
      "no_speaker_labels",
    ],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        VOX_JOT_SPEECH_ANALYSIS_MODEL_ROOT: MODEL_ROOT,
        VOX_JOT_STT_MODEL_ROOT: STT_MODEL_ROOT,
      },
      encoding: "utf-8",
      timeout: 20 * 60 * 1000,
    },
  );
  const elapsedMs = Math.round(performance.now() - started);

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return {
      model_id: model.id,
      label: model.label,
      status: "failed",
      attempts: 1,
      reason: detail || `sidecar exited with ${result.status}`,
    };
  }

  let payload: SidecarPayload;
  try {
    payload = parseSidecarPayload(result.stdout);
  } catch (error) {
    return {
      model_id: model.id,
      label: model.label,
      status: "failed",
      attempts: 1,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!payload.ok) {
    return {
      model_id: model.id,
      label: model.label,
      status: "failed",
      attempts: 1,
      reason: payload.error ?? "sidecar returned ok=false",
    };
  }

  const text = payload.text ?? "";
  return {
    model_id: model.id,
    label: model.label,
    status: "tested",
    attempts: 1,
    text,
    wer: wordErrorRate(REFERENCE, text),
    exact_match: normalizeText(REFERENCE) === normalizeText(text),
    latency_ms: elapsedMs,
    real_time_factor: durationMs > 0 ? elapsedMs / durationMs : undefined,
    device: payload.device,
  };
}

function evaluateModel(
  model: ModelSpec,
  sample16k: string,
  durationMs: number,
  attempts: number,
): ModelResult {
  if (!model.sidecar) {
    return {
      model_id: model.id,
      label: model.label,
      status: "skipped",
      attempts: 0,
      reason:
        "Current Dictation Engine requires the in-app TranscriptionManager; use the STT spelling benchmark for that selected model.",
    };
  }

  if (!modelDownloaded(model.id)) {
    return {
      model_id: model.id,
      label: model.label,
      status: "skipped",
      attempts: 0,
      reason: `model weights are not downloaded at ${resolve(MODEL_ROOT, model.id)}`,
    };
  }

  let last: ModelResult | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = runSidecar(model, sample16k, durationMs);
    last.attempts = attempt;
    if (last.status === "tested") return last;
  }
  return (
    last ?? {
      model_id: model.id,
      label: model.label,
      status: "failed",
      attempts,
      reason: "no attempt ran",
    }
  );
}

function buildMarkdown(results: ModelResult[]): string {
  const lines = [
    "# File ASR Model Evaluation",
    "",
    `Reference: ${REFERENCE}`,
    "",
    "| Model | Status | Exact | WER | Latency | RTF | Device | Notes |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  for (const result of results) {
    lines.push(
      [
        result.label,
        result.status,
        result.exact_match === undefined
          ? "n/a"
          : result.exact_match
            ? "yes"
            : "no",
        result.wer === undefined ? "n/a" : result.wer.toFixed(3),
        result.latency_ms === undefined ? "n/a" : `${result.latency_ms} ms`,
        result.real_time_factor === undefined
          ? "n/a"
          : result.real_time_factor.toFixed(2),
        result.device ?? "n/a",
        result.reason ?? result.text ?? "",
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const config = parseArgs();
  if (!existsSync(config.samplePath)) {
    throw new Error(`Sample file not found: ${config.samplePath}`);
  }
  mkdirSync(config.outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputRoot = resolve(config.outputDir, timestamp);
  const latestRoot = resolve(config.outputDir, "latest");
  mkdirSync(outputRoot, { recursive: true });

  const sample16k = ensure16kSample(config.samplePath, outputRoot);
  const durationMs = sampleDurationMs(sample16k);
  const results = selectedModels(config).map((model) =>
    evaluateModel(model, sample16k, durationMs, config.attempts),
  );
  const report = {
    generated_at: new Date().toISOString(),
    sample_path: config.samplePath,
    sample_16k_path: sample16k,
    reference: REFERENCE,
    model_root: MODEL_ROOT,
    results,
  };
  const markdown = buildMarkdown(results);

  writeFileSync(
    resolve(outputRoot, "file-asr-summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(resolve(outputRoot, "file-asr-summary.md"), markdown);

  rmSync(latestRoot, { recursive: true, force: true });
  mkdirSync(latestRoot, { recursive: true });
  writeFileSync(
    resolve(latestRoot, "file-asr-summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(resolve(latestRoot, "file-asr-summary.md"), markdown);

  console.log(markdown);
  console.log(`Summary written to ${outputRoot}`);
}

main();
