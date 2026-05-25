#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type StorySoundMode = "sfx" | "ambience" | "music" | "song" | "composition";
type CreativeAudioStatus =
  | "tested"
  | "pending"
  | "download_required"
  | "failed"
  | "blocked";

interface CreativeAudioModel {
  id: string;
  label: string;
  provider_id: string;
  installed: boolean;
  runnable: boolean;
  downloadable: boolean;
  modes: StorySoundMode[];
  status_label: string;
  unavailable_reason?: string | null;
}

interface CreativeAudioCatalog {
  models: CreativeAudioModel[];
}

interface StoryAudioItem {
  output_path: string;
  duration_ms: number;
  generation_time_ms: number;
  sample_rate_hz: number;
}

interface EvalCase {
  id: string;
  mode: StorySoundMode;
  title: string;
  prompt: string;
  seconds: number;
  seed: number;
}

interface CaseResult {
  caseId: string;
  mode: StorySoundMode;
  passed: boolean;
  latencyMs?: number;
  rtf?: number;
  durationAccuracy?: number;
  audioHealth?: number;
  outputPath?: string;
  error?: string;
}

interface ModelResult {
  modelId: string;
  providerId?: string;
  label: string;
  status: CreativeAudioStatus;
  rank?: number;
  sampleCount?: number;
  passedCases?: number;
  score?: number;
  latencyP50Ms?: number;
  realTimeFactorP50?: number;
  durationAccuracy?: number;
  audioHealth?: number;
  notes: string;
  cases: CaseResult[];
}

interface EvalSummary {
  generatedAt: string;
  suite: string;
  corpus: string;
  limitations: string;
  apiUrl: string;
  results: ModelResult[];
}

const CASES: EvalCase[] = [
  {
    id: "sfx-foley",
    mode: "sfx",
    title: "Ceramic mug set down",
    prompt:
      "single close realistic ceramic mug placed on a wooden desk, short dry foley, no music, no voice",
    seconds: 4,
    seed: 1001,
  },
  {
    id: "ambience-room-tone",
    mode: "ambience",
    title: "Rainy apartment room",
    prompt:
      "subtle rainy apartment room tone, distant traffic outside, quiet refrigerator hum, loopable background ambience, no melody, no voice",
    seconds: 12,
    seed: 1002,
  },
  {
    id: "music-story-bed",
    mode: "music",
    title: "Investigative synth bed",
    prompt:
      "low cinematic investigative underscore, restrained analog synth pulse, sparse percussion, seamless story background bed, no vocals",
    seconds: 15,
    seed: 1003,
  },
  {
    id: "music-transition",
    mode: "music",
    title: "Warm chapter transition",
    prompt:
      "short warm chapter transition cue, soft piano and strings, gentle lift, clean ending, no voice",
    seconds: 12,
    seed: 1004,
  },
  {
    id: "song-theme",
    mode: "song",
    title: "Podcast intro theme",
    prompt:
      "upbeat cinematic pop intro theme for a narrative podcast, clear verse to chorus lift, polished drums, vocals optional, clean ending",
    seconds: 30,
    seed: 1005,
  },
  {
    id: "composition-piano",
    mode: "composition",
    title: "Sparse piano motif",
    prompt:
      "expressive sparse piano motif in A minor, four-bar phrase, gentle left hand, suitable under narration",
    seconds: 20,
    seed: 1006,
  },
];

const args = new Set(process.argv.slice(2));
const updateResults = args.has("--update-results");
const skipDownload = args.has("--skip-download");
const baseUrl =
  valueArg("--api-url") ??
  process.env.VOX_JOT_API_URL ??
  "http://127.0.0.1:8978";
const apiToken =
  process.env.VOX_JOT_API_TOKEN?.trim() ||
  (process.env.VOX_JOT_ACCEPTANCE_READ_KEYCHAIN === "1"
    ? readApiTokenFromKeychain()
    : "");
const outputRoot =
  valueArg("--output-dir") ?? "output/creative-audio-eval/app-full-latest";

if (!apiToken) {
  throw new Error(
    "Set VOX_JOT_API_TOKEN, or set VOX_JOT_ACCEPTANCE_READ_KEYCHAIN=1 for local keychain lookup.",
  );
}

const runStarted = new Date();
mkdirSync(outputRoot, { recursive: true });

const catalog = await apiGet<CreativeAudioCatalog>("/v1/creative-audio/models");
const results: ModelResult[] = [];

for (const model of catalog.models) {
  let current = model;
  if (!skipDownload && !current.runnable && current.downloadable) {
    try {
      current = await apiPost<CreativeAudioModel>(
        "/v1/creative-audio/download",
        {
          model_id: current.id,
        },
      );
    } catch (error) {
      results.push({
        modelId: model.id,
        providerId: model.provider_id,
        label: model.label,
        status: "failed",
        sampleCount: 0,
        passedCases: 0,
        notes: `Download failed through app-managed Creative Audio catalog: ${errorMessage(error)}`,
        cases: [],
      });
      continue;
    }
  }

  if (!current.runnable) {
    results.push({
      modelId: model.id,
      providerId: model.provider_id,
      label: model.label,
      status: current.downloadable ? "download_required" : "blocked",
      sampleCount: 0,
      passedCases: 0,
      notes:
        current.unavailable_reason ||
        `${current.label} is not runnable through the Creative Audio catalog (${current.status_label}).`,
      cases: [],
    });
    continue;
  }

  const cases = CASES.filter((testCase) =>
    current.modes.includes(testCase.mode),
  );
  const caseResults: CaseResult[] = [];
  for (const testCase of cases) {
    caseResults.push(await runCase(current, testCase));
  }

  results.push(summarizeModel(current, caseResults));
}

rankResults(results);

const summary: EvalSummary = {
  generatedAt: runStarted.toISOString(),
  suite: "creative_audio_real_world_app_path",
  corpus:
    "Story Studio sound-design prompts covering SFX, ambience, music beds, full-song sketches, and symbolic composition.",
  limitations:
    "Automatic scores use app-path generation success, generated-WAV health, duration accuracy, and real-time factor. Human listening preference and semantic prompt-adherence panels are not included.",
  apiUrl: baseUrl,
  results,
};

const summaryPath = path.join(outputRoot, "creative-audio-eval-summary.json");
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
writeFileSync(
  path.join(outputRoot, "creative-audio-eval-results.md"),
  renderMarkdown(summary),
);

if (updateResults) {
  writeFileSync(
    "src/lib/creativeAudioEvaluationResults.ts",
    renderResultsTs(summary, summaryPath),
  );
}

console.log(`Wrote ${summaryPath}`);

async function runCase(
  model: CreativeAudioModel,
  testCase: EvalCase,
): Promise<CaseResult> {
  const started = Date.now();
  try {
    const item = await apiPost<StoryAudioItem>(
      "/v1/creative-audio/generate",
      {
        prompt: testCase.prompt,
        model_id: model.id,
        mode: testCase.mode,
        duration_seconds: testCase.seconds,
        title: testCase.title,
        seed: testCase.seed,
      },
      45 * 60_000,
    );
    const latencyMs = item.generation_time_ms || Date.now() - started;
    const wav = analyzeWav(item.output_path);
    const expectedMs = testCase.seconds * 1000;
    const actualMs = wav.durationMs || item.duration_ms;
    const durationAccuracy = Math.max(
      0,
      1 - Math.abs(actualMs - expectedMs) / Math.max(expectedMs, 1),
    );
    const audioHealth = audioHealthScore(wav);
    const passed = audioHealth >= 0.7 && durationAccuracy >= 0.55;
    return {
      caseId: testCase.id,
      mode: testCase.mode,
      passed,
      latencyMs,
      rtf: latencyMs / Math.max(actualMs, 1),
      durationAccuracy,
      audioHealth,
      outputPath: item.output_path,
    };
  } catch (error) {
    return {
      caseId: testCase.id,
      mode: testCase.mode,
      passed: false,
      error: errorMessage(error),
    };
  }
}

function summarizeModel(
  model: CreativeAudioModel,
  cases: CaseResult[],
): ModelResult {
  const passedCases = cases.filter((result) => result.passed).length;
  const testedCases = cases.filter((result) => result.latencyMs !== undefined);
  const score =
    cases.length === 0
      ? undefined
      : round1(
          (passedCases / cases.length) * 60 +
            average(testedCases.map((result) => result.durationAccuracy ?? 0)) *
              20 +
            average(testedCases.map((result) => result.audioHealth ?? 0)) * 12 +
            average(
              testedCases.map((result) =>
                result.rtf === undefined ? 0 : Math.max(0, 1 - result.rtf / 4),
              ),
            ) *
              8,
        );
  const status: CreativeAudioStatus =
    cases.length > 0 && passedCases === cases.length ? "tested" : "failed";
  return {
    modelId: model.id,
    providerId: model.provider_id,
    label: model.label,
    status,
    sampleCount: cases.length,
    passedCases,
    score,
    latencyP50Ms: Math.round(
      p50(testedCases.map((result) => result.latencyMs ?? 0)) ?? 0,
    ),
    realTimeFactorP50: round3(
      p50(testedCases.map((result) => result.rtf ?? 0)),
    ),
    durationAccuracy: round3(
      average(testedCases.map((result) => result.durationAccuracy ?? 0)),
    ),
    audioHealth: round3(
      average(testedCases.map((result) => result.audioHealth ?? 0)),
    ),
    notes:
      status === "tested"
        ? `Full installed-app Creative Audio suite passed for ${model.provider_id}/${model.id}.`
        : `Installed-app Creative Audio suite failed ${cases.length - passedCases}/${cases.length} cases.`,
    cases,
  };
}

function rankResults(results: ModelResult[]) {
  const tested = results
    .filter(
      (result) => result.status === "tested" && result.score !== undefined,
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  tested.forEach((result, index) => {
    result.rank = index + 1;
  });
}

async function apiGet<T>(pathname: string): Promise<T> {
  return apiFetch<T>(pathname, { method: "GET" });
}

async function apiPost<T>(
  pathname: string,
  body: unknown,
  timeoutMs = 30 * 60_000,
): Promise<T> {
  return apiFetch<T>(
    pathname,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
}

async function apiFetch<T>(
  pathname: string,
  init: RequestInit,
  timeoutMs = 60_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${pathname}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "x-vox-jot-api-token": apiToken,
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(json.error || `HTTP ${response.status}`);
    }
    return json as T;
  } finally {
    clearTimeout(timeout);
  }
}

function analyzeWav(filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`Generated file does not exist: ${filePath}`);
  }
  const bytes = readFileSync(filePath);
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`Generated file is not a WAV: ${filePath}`);
  }
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      audioFormat = bytes.readUInt16LE(start);
      channels = bytes.readUInt16LE(start + 2);
      sampleRate = bytes.readUInt32LE(start + 4);
      bitsPerSample = bytes.readUInt16LE(start + 14);
    } else if (id === "data") {
      dataOffset = start;
      dataSize = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  if (dataOffset < 0 || channels < 1 || sampleRate < 1 || bitsPerSample < 1) {
    throw new Error(`Generated WAV is missing format/data chunks: ${filePath}`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = dataSize / Math.max(bytesPerSample * channels, 1);
  let peak = 0;
  let squareSum = 0;
  let count = 0;
  for (
    let pos = dataOffset;
    pos + bytesPerSample <= dataOffset + dataSize;
    pos += bytesPerSample
  ) {
    let value = 0;
    if (audioFormat === 3 && bitsPerSample === 32) {
      value = bytes.readFloatLE(pos);
    } else if (bitsPerSample === 16) {
      value = bytes.readInt16LE(pos) / 32768;
    } else if (bitsPerSample === 24) {
      value = bytes.readIntLE(pos, 3) / 8388608;
    } else if (bitsPerSample === 32) {
      value = bytes.readInt32LE(pos) / 2147483648;
    }
    const abs = Math.abs(value);
    peak = Math.max(peak, abs);
    squareSum += value * value;
    count += 1;
  }
  return {
    durationMs: (frameCount / sampleRate) * 1000,
    sampleRate,
    peak,
    rms: Math.sqrt(squareSum / Math.max(count, 1)),
  };
}

function audioHealthScore(wav: ReturnType<typeof analyzeWav>): number {
  const peakScore =
    wav.peak >= 0.02 && wav.peak <= 1.01 ? 1 : wav.peak > 1.01 ? 0.4 : 0;
  const rmsScore =
    wav.rms >= 0.002 && wav.rms <= 0.6 ? 1 : wav.rms > 0.6 ? 0.5 : 0;
  return round3((peakScore + rmsScore) / 2);
}

function renderMarkdown(summary: EvalSummary) {
  const lines = [
    `# Creative Audio Eval`,
    ``,
    `Generated: ${summary.generatedAt}`,
    ``,
    `| Rank | Model | Status | Score | Pass | p50 | RTF | Notes |`,
    `| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |`,
  ];
  for (const result of summary.results) {
    lines.push(
      `| ${result.rank ?? ""} | ${result.label} | ${result.status} | ${result.score ?? ""} | ${result.passedCases ?? 0}/${result.sampleCount ?? 0} | ${result.latencyP50Ms ?? ""} | ${result.realTimeFactorP50 ?? ""} | ${result.notes.replaceAll("|", "\\|")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderResultsTs(summary: EvalSummary, summaryPath: string) {
  const publicResults = summary.results.map(
    ({ cases: _cases, ...result }) => result,
  );
  return `export type CreativeAudioEvaluationStatus =
  | "tested"
  | "pending"
  | "download_required"
  | "failed"
  | "blocked";

export interface CreativeAudioEvaluationResult {
  modelId: string;
  providerId?: string;
  label: string;
  status: CreativeAudioEvaluationStatus;
  rank?: number;
  sampleCount?: number;
  passedCases?: number;
  score?: number;
  latencyP50Ms?: number;
  realTimeFactorP50?: number;
  durationAccuracy?: number;
  audioHealth?: number;
  notes: string;
}

export const CREATIVE_AUDIO_EVALUATION_RUN = ${JSON.stringify(
    {
      generatedAt: summary.generatedAt,
      suite: summary.suite,
      corpus: summary.corpus,
      limitations: summary.limitations,
      metricGuide: [
        "Rank: #1 is best for this installed-app Story Studio suite.",
        "Score and pass: higher is better.",
        "p50 latency and RTF: lower is faster.",
        "Duration and audio health: higher is better.",
      ],
      reportPath: summaryPath,
    },
    null,
    2,
  )};

export const CREATIVE_AUDIO_EVALUATION_RESULTS: CreativeAudioEvaluationResult[] = ${JSON.stringify(
    publicResults,
    null,
    2,
  )};
`;
}

function valueArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const raw = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return raw?.slice(prefix.length);
}

function p50(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 1000) / 1000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readApiTokenFromKeychain(): string {
  try {
    return execFileSync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        "com.voxjot.post_process_api_keys",
        "-a",
        "http_api:loopback_token",
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}
