#!/usr/bin/env bun
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type StorySoundMode = "sfx" | "ambience" | "music" | "song" | "composition";
type CreativeAudioStatus =
  "tested" | "pending" | "download_required" | "failed" | "blocked";

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
  promptAdherence?: number;
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
  promptAdherence?: number;
  notes: string;
  cases: CaseResult[];
}

interface EvalSummary {
  generatedAt: string;
  methodologyVersion: "2.0.0";
  evidenceTier: "ranked" | "diagnostic";
  rankingEligible: boolean;
  rankingBlocker?: string;
  suite: string;
  corpus: string;
  limitations: string;
  apiUrl: string;
  promptAdherence: {
    method: "clap_prompt_adherence_v1" | "disabled";
    modelId?: string;
    modelRevision?: string;
  };
  performanceProtocol: {
    warmupRuns: number;
    measuredRunsPerCase: number;
  };
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
const noClap = args.has("--no-clap");
const clapModel = valueArg("--clap-model") ?? "laion/clap-htsat-unfused";
const clapRevision =
  valueArg("--clap-revision") ?? "8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a";
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
const warmupRuns = 0;
const measuredRunsPerCase = 1;
const performanceProtocolComplete = warmupRuns >= 1 && measuredRunsPerCase >= 3;

if (updateResults && !performanceProtocolComplete) {
  throw new Error(
    "--update-results requires a ranking-eligible run with at least one warm-up and three measured generations per prompt.",
  );
}

if (!apiToken) {
  throw new Error(
    "Set VOX_JOT_API_TOKEN, or set VOX_JOT_ACCEPTANCE_READ_KEYCHAIN=1 for local keychain lookup.",
  );
}
if (updateResults && noClap) {
  throw new Error("--update-results requires CLAP prompt-adherence scoring.");
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

if (!noClap) {
  scorePromptAdherence(results, clapModel, clapRevision);
  for (const result of results) {
    const model = catalog.models.find(
      (candidate) => candidate.id === result.modelId,
    );
    if (model && result.cases.length > 0) {
      Object.assign(result, summarizeModel(model, result.cases));
    }
  }
}

const rankingEligible = !noClap && performanceProtocolComplete;
const rankingBlocker = rankingEligible
  ? undefined
  : "The current runner records one generation per prompt; v2 ranking requires one warm-up and three measured runs plus the full system profile.";
if (rankingEligible) rankResults(results);

const summary: EvalSummary = {
  generatedAt: runStarted.toISOString(),
  methodologyVersion: "2.0.0",
  evidenceTier: rankingEligible ? "ranked" : "diagnostic",
  rankingEligible,
  rankingBlocker,
  suite: "creative_audio_real_world_app_path",
  corpus:
    "Story Studio sound-design prompts covering SFX, ambience, music beds, full-song sketches, and symbolic composition.",
  limitations:
    "Automatic scores use app-path generation success, LAION CLAP audio-text prompt adherence, generated-WAV health, duration accuracy, and real-time factor. Blind human preference remains a separate external panel and never changes the local rank.",
  apiUrl: baseUrl,
  promptAdherence: {
    method: noClap ? "disabled" : "clap_prompt_adherence_v1",
    modelId: noClap ? undefined : clapModel,
    modelRevision: noClap ? undefined : clapRevision,
  },
  performanceProtocol: {
    warmupRuns,
    measuredRunsPerCase,
  },
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
  const adherenceCases = testedCases.filter(
    (result) => result.promptAdherence !== undefined,
  );
  const hasRequiredAdherence =
    testedCases.length > 0 && adherenceCases.length === testedCases.length;
  const score =
    cases.length === 0 || !hasRequiredAdherence
      ? undefined
      : round1(
          average(adherenceCases.map((result) => result.promptAdherence ?? 0)) *
            35 +
            (passedCases / cases.length) * 35 +
            average(testedCases.map((result) => result.durationAccuracy ?? 0)) *
              12 +
            average(testedCases.map((result) => result.audioHealth ?? 0)) * 10 +
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
    promptAdherence: hasRequiredAdherence
      ? round3(
          average(adherenceCases.map((result) => result.promptAdherence ?? 0)),
        )
      : undefined,
    notes: !hasRequiredAdherence
      ? `Creative Audio generation completed, but CLAP prompt adherence is missing; this result is diagnostic and unranked.`
      : status === "tested"
        ? `Full installed-app Creative Audio suite passed for ${model.provider_id}/${model.id}.`
        : `Installed-app Creative Audio suite failed ${cases.length - passedCases}/${cases.length} cases.`,
    cases,
  };
}

function scorePromptAdherence(
  results: ModelResult[],
  modelId: string,
  modelRevision: string,
) {
  const items = results.flatMap((result) =>
    result.cases.flatMap((caseResult) => {
      if (!caseResult.outputPath) return [];
      const testCase = CASES.find(
        (candidate) => candidate.id === caseResult.caseId,
      );
      if (!testCase) return [];
      return [
        {
          id: `${result.modelId}:${caseResult.caseId}`,
          audio_path: caseResult.outputPath,
          prompt: testCase.prompt,
        },
      ];
    }),
  );
  if (items.length === 0) return;

  const inputPath = path.resolve(outputRoot, "clap-score-input.json");
  writeFileSync(inputPath, JSON.stringify({ items }, null, 2));
  const venvPython = path.resolve(".venv/bin/python");
  const python = existsSync(venvPython) ? venvPython : "python3";
  const scorer = path.resolve("scripts/score-audio-text-clap.py");
  const completed = spawnSync(
    python,
    [
      scorer,
      "--input",
      inputPath,
      "--model",
      modelId,
      "--revision",
      modelRevision,
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30 * 60_000,
    },
  );
  if (completed.status !== 0) {
    throw new Error(
      `CLAP prompt-adherence scoring failed: ${(completed.stderr || completed.stdout || completed.error?.message || "unknown error").trim()}`,
    );
  }
  const payload = JSON.parse(completed.stdout) as {
    method: string;
    results: Array<{ id: string; score: number }>;
  };
  if (payload.method !== "clap_prompt_adherence_v1") {
    throw new Error(`Unexpected CLAP scorer method: ${payload.method}`);
  }
  const scores = new Map(
    payload.results.map((result) => [
      result.id,
      Math.max(0, Math.min(1, result.score)),
    ]),
  );
  for (const result of results) {
    for (const caseResult of result.cases) {
      caseResult.promptAdherence = scores.get(
        `${result.modelId}:${caseResult.caseId}`,
      );
    }
  }
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
    `| Rank | Model | Status | Score | CLAP | Pass | p50 | Speed | Notes |`,
    `| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |`,
  ];
  for (const result of summary.results) {
    lines.push(
      `| ${result.rank ?? ""} | ${result.label} | ${result.status} | ${result.score ?? ""} | ${result.promptAdherence ?? ""} | ${result.passedCases ?? 0}/${result.sampleCount ?? 0} | ${result.latencyP50Ms ?? ""} | ${result.realTimeFactorP50 && result.realTimeFactorP50 > 0 ? round1(1 / result.realTimeFactorP50) : ""}x | ${result.notes.replaceAll("|", "\\|")} |`,
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
  promptAdherence?: number;
  notes: string;
}

export const CREATIVE_AUDIO_EVALUATION_RUN = ${JSON.stringify(
    {
      generatedAt: summary.generatedAt,
      methodologyVersion: summary.methodologyVersion,
      evidenceTier: summary.evidenceTier,
      rankingEligible: summary.rankingEligible,
      rankingBlocker: summary.rankingBlocker,
      suite: summary.suite,
      corpus: summary.corpus,
      limitations: summary.limitations,
      metricGuide: [
        "Rank: #1 is best for this installed-app Story Studio suite.",
        "Score and pass: higher is better.",
        "p50 latency and RTF: lower is faster.",
        "Duration and audio health: higher is better.",
        "CLAP prompt adherence: higher audio-text cosine similarity is better.",
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
