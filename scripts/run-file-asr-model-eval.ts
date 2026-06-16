#!/usr/bin/env bun
/**
 * Evaluate file-transcription ASR sidecar models on the checked-in samples.
 *
 * This intentionally stays outside live dictation. It calls the same Python
 * sidecar used by file transcription and writes a stable JSON/Markdown report.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
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
const MLX_AUDIO_PYTHON = resolve(
  process.env.HOME ?? "",
  "Library/Application Support/com.iriedinamik.voxjot/mlx-audio-venv/bin/python",
);
const GEMMA_AUDIO_PYTHON = resolve(
  process.env.HOME ?? "",
  "Library/Application Support/com.iriedinamik.voxjot/gemma-audio-venv/bin/python",
);
const SPEECH_ANALYSIS_PYTHON = resolve(
  process.env.HOME ?? "",
  "Library/Application Support/com.iriedinamik.voxjot/speech-analysis-venv/bin/python",
);
const PROJECT_VENV_PYTHON = resolve(PROJECT_ROOT, ".venv/bin/python");
const REFERENCE =
  "This is a file transcription test for Vox Jot. One, two, three, four, five.";

interface Config {
  models: string[];
  samplePaths: string[];
  outputDir: string;
  attempts: number;
}

interface ModelSpec {
  id: string;
  label: string;
  sidecar: boolean;
}

const MLX_ASR_MODEL_IDS = new Set([
  "mlx-qwen3-asr-0.6b",
  "mlx-qwen3-asr",
  "mlx-fireredasr2-aed",
  "mlx-vibevoice-asr-bf16",
  "mlx-nemotron-asr-streaming-0.6b",
  "mlx-mega-asr",
]);

// Gemma 4 multimodal ASR runs through Transformers and needs the dedicated
// gemma-audio-venv (pinned torch + transformers), not the .venv or mlx venv.
const GEMMA_ASR_MODEL_IDS = new Set(["gemma4-e2b-audio", "gemma4-e4b-audio"]);

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
  sample_count?: number;
  exact_matches?: number;
  text?: string;
  wer?: number;
  exact_match?: boolean;
  latency_ms?: number;
  real_time_factor?: number;
  device?: string;
  reason?: string;
  samples?: SampleResult[];
}

interface SampleResult {
  sample_id: string;
  sample_path: string;
  sample_16k_path: string;
  status: "tested" | "failed";
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
    id: "higgs-audio-v3-stt",
    label: "Higgs Audio v3 STT",
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
    id: "mlx-nemotron-asr-streaming-0.6b",
    label: "Nemotron 3.5 ASR Streaming 0.6B (MLX)",
    sidecar: true,
  },
  {
    id: "mlx-mega-asr",
    label: "Mega-ASR 8-bit (MLX)",
    sidecar: true,
  },
  {
    id: "gemma4-e2b-audio",
    label: "Gemma 4 E2B Audio",
    sidecar: true,
  },
  {
    id: "gemma4-e4b-audio",
    label: "Gemma 4 E4B Audio",
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
  const sampleArg = get("--sample", "");
  const samplesDir = get(
    "--samples-dir",
    resolve(PROJECT_ROOT, "test-data/file-transcription-samples"),
  );
  return {
    models,
    samplePaths: sampleArg
      ? [resolve(PROJECT_ROOT, sampleArg)]
      : discoverSamplePaths(samplesDir),
    outputDir: get(
      "--output-dir",
      resolve(PROJECT_ROOT, "output/file-asr-model-eval"),
    ),
    attempts: Math.max(1, Number.parseInt(get("--attempts", "3"), 10) || 3),
  };
}

function discoverSamplePaths(samplesDir: string): string[] {
  const allowed = new Set([".wav", ".mp3", ".m4a", ".mp4"]);
  return readdirSync(samplesDir)
    .filter((entry) => entry.startsWith("sample_"))
    .filter((entry) => allowed.has(extname(entry).toLowerCase()))
    .sort()
    .map((entry) => resolve(samplesDir, entry));
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

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
}

function ensure16kSample(samplePath: string, outputRoot: string): string {
  const samplesDir = resolve(outputRoot, "samples-16k");
  mkdirSync(samplesDir, { recursive: true });
  const wav16k = resolve(
    samplesDir,
    `${safeSegment(basename(samplePath))}.wav`,
  );
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
  if (modelId === "higgs-audio-v3-stt") {
    return [
      "config.json",
      "generation_config.json",
      "higgs_audio_collator.py",
      "model-00001-of-00002.safetensors",
      "model-00002-of-00002.safetensors",
      "model.safetensors.index.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "transcribe.py",
    ].every((file) => existsSync(resolve(path, file)));
  }
  if (modelSnapshotReady(path)) return true;

  const sttMlxPaths: Record<string, string> = {
    "mlx-qwen3-asr-0.6b": "MLX/mlx-community/Qwen3-ASR-0.6B-8bit",
    "mlx-qwen3-asr": "MLX/mlx-community/Qwen3-ASR-1.7B-8bit",
    "mlx-fireredasr2-aed": "MLX/mlx-community/FireRedASR2-AED-mlx",
    "mlx-vibevoice-asr-bf16": "MLX/mlx-community/VibeVoice-ASR-bf16",
    "mlx-nemotron-asr-streaming-0.6b":
      "MLX/mlx-community/nemotron-3.5-asr-streaming-0.6b",
    "mlx-mega-asr": "MLX/mlx-community/Mega-ASR-8bit",
  };
  const sttPath = sttMlxPaths[modelId];
  if (sttPath)
    return modelSnapshotReady(resolve(STT_MODEL_ROOT, sttPath), true);

  const sttOtherPaths: Record<string, string> = {
    "gemma4-e2b-audio": "Gemma/google/gemma-4-E2B-it",
    "gemma4-e4b-audio": "Gemma/google/gemma-4-E4B-it",
  };
  const otherPath = sttOtherPaths[modelId];
  return otherPath
    ? modelSnapshotReady(resolve(STT_MODEL_ROOT, otherPath), true)
    : false;
}

function modelSnapshotReady(path: string, requireWeights = false): boolean {
  if (!existsSync(path)) return false;
  if (existsSync(resolve(path, "config.json"))) {
    if (existsSync(resolve(path, "model.safetensors"))) return true;
    if (
      existsSync(resolve(path, "model.safetensors.index.json")) &&
      readdirSync(path).some(
        (name) => name.startsWith("model-") && name.endsWith(".safetensors"),
      )
    ) {
      return true;
    }
  }
  if (requireWeights) return false;
  return existsSync(path);
}

function runSidecar(
  model: ModelSpec,
  sample16k: string,
  durationMs: number,
): ModelResult {
  const python = GEMMA_ASR_MODEL_IDS.has(model.id)
    ? GEMMA_AUDIO_PYTHON
    : MLX_ASR_MODEL_IDS.has(model.id)
      ? MLX_AUDIO_PYTHON
      : existsSync(SPEECH_ANALYSIS_PYTHON)
        ? SPEECH_ANALYSIS_PYTHON
        : PROJECT_VENV_PYTHON;
  if (!existsSync(python)) {
    return {
      model_id: model.id,
      label: model.label,
      status: "failed",
      attempts: 1,
      reason: `Python runtime is missing at ${python}`,
    };
  }
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
        PYTORCH_ENABLE_MPS_FALLBACK: "1",
        TOKENIZERS_PARALLELISM: "false",
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
  samples: { samplePath: string; sample16k: string; durationMs: number }[],
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
  const sampleResults: SampleResult[] = [];
  for (const sample of samples) {
    let sampleResult: ModelResult | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      sampleResult = runSidecar(model, sample.sample16k, sample.durationMs);
      sampleResult.attempts = attempt;
      if (sampleResult.status === "tested") break;
    }
    last = sampleResult;
    sampleResults.push({
      sample_id: basename(sample.samplePath),
      sample_path: sample.samplePath,
      sample_16k_path: sample.sample16k,
      status: sampleResult?.status === "tested" ? "tested" : "failed",
      attempts: sampleResult?.attempts ?? attempts,
      text: sampleResult?.text,
      wer: sampleResult?.wer,
      exact_match: sampleResult?.exact_match,
      latency_ms: sampleResult?.latency_ms,
      real_time_factor: sampleResult?.real_time_factor,
      device: sampleResult?.device,
      reason: sampleResult?.reason,
    });
  }

  const failed = sampleResults.find((sample) => sample.status === "failed");
  if (failed) {
    return {
      model_id: model.id,
      label: model.label,
      status: "failed",
      attempts: sampleResults.reduce((sum, sample) => sum + sample.attempts, 0),
      sample_count: sampleResults.length,
      reason: failed.reason ?? `${failed.sample_id} failed`,
      samples: sampleResults,
    };
  }

  const tested = sampleResults.filter(
    (
      sample,
    ): sample is SampleResult & {
      wer: number;
      exact_match: boolean;
      latency_ms: number;
      real_time_factor: number;
    } =>
      sample.wer !== undefined &&
      sample.exact_match !== undefined &&
      sample.latency_ms !== undefined &&
      sample.real_time_factor !== undefined,
  );
  if (tested.length === 0) {
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

  const latency = tested
    .map((sample) => sample.latency_ms)
    .sort((a, b) => a - b);
  const rtf = tested
    .map((sample) => sample.real_time_factor)
    .sort((a, b) => a - b);
  const wer =
    tested.reduce((sum, sample) => sum + sample.wer, 0) / tested.length;
  return {
    model_id: model.id,
    label: model.label,
    status: "tested",
    attempts: sampleResults.reduce((sum, sample) => sum + sample.attempts, 0),
    sample_count: tested.length,
    exact_matches: tested.filter((sample) => sample.exact_match).length,
    text: tested
      .map((sample) => `${sample.sample_id}: ${sample.text}`)
      .join("\n"),
    wer,
    exact_match: tested.every((sample) => sample.exact_match),
    latency_ms: percentile(latency, 0.5),
    real_time_factor: percentile(rtf, 0.5),
    device: tested.find((sample) => sample.device)?.device,
    samples: sampleResults,
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.round((sorted.length - 1) * q);
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
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
        result.exact_matches !== undefined && result.sample_count !== undefined
          ? `${result.exact_matches}/${result.sample_count}`
          : result.exact_match === undefined
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
        result.reason ??
          (result.status === "tested"
            ? `completed ${result.sample_count ?? 0} samples`
            : ""),
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
  if (config.samplePaths.length === 0) {
    throw new Error("No File ASR samples found.");
  }
  for (const samplePath of config.samplePaths) {
    if (!existsSync(samplePath)) {
      throw new Error(`Sample file not found: ${samplePath}`);
    }
  }
  mkdirSync(config.outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputRoot = resolve(config.outputDir, timestamp);
  const latestRoot = resolve(config.outputDir, "latest");
  mkdirSync(outputRoot, { recursive: true });

  const samples = config.samplePaths.map((samplePath) => {
    const sample16k = ensure16kSample(samplePath, outputRoot);
    return { samplePath, sample16k, durationMs: sampleDurationMs(sample16k) };
  });
  const results = selectedModels(config).map((model) =>
    evaluateModel(model, samples, config.attempts),
  );
  const report = {
    generated_at: new Date().toISOString(),
    sample_paths: config.samplePaths,
    sample_count: samples.length,
    samples,
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
