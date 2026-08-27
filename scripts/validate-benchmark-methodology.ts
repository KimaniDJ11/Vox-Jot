#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const SPEC_PATH = resolve(PROJECT_ROOT, "benchmarks/methodology-v2.json");
const DOC_PATH = resolve(PROJECT_ROOT, "docs/benchmark-methodology-v2.md");

interface MethodologySuite {
  id: string;
  runner: string;
  primaryMetric: string;
  requiredMetrics: string[];
  domains: string[];
  rankedGate: string;
}

interface Methodology {
  $schema: string;
  methodologyVersion: string;
  name: string;
  warmupRuns: number;
  measuredRuns: number;
  percentiles: number[];
  rankingPolicy: {
    fullSuiteOnly: boolean;
    requireInstalledAppPath: boolean;
    missingRequiredMetric: string;
    failedRequiredCase: string;
    externalMetricsAffectRank: boolean;
    aggregatePolicy: string;
    legacyResults: string;
  };
  systemProfile: { required: string[]; performanceMetrics: string[] };
  suites: MethodologySuite[];
  externalContext: { allowed: string[]; prohibited: string[] };
}

const EXPECTED_SUITES = new Set([
  "live-stt",
  "file-asr",
  "speaker-isolation",
  "screen-ocr",
  "refine-llm",
  "tts",
  "tts-style",
  "tts-voice-clone",
  "creative-audio",
]);

const IMPLEMENTATION_SIGNALS: Array<{
  file: string;
  signal: string;
  purpose: string;
}> = [
  {
    file: "scripts/run-stt-app-api-eval.py",
    signal: '"speed_factor_p50"',
    purpose: "STT speed factor",
  },
  {
    file: "scripts/eval-post-process.ts",
    signal: "zero_drift_purity",
    purpose: "direct-model zero-drift scoring",
  },
  {
    file: "scripts/run-tts-model-eval.py",
    signal: "campplus_embedding_cosine_v1",
    purpose: "speaker-embedding clone similarity",
  },
  {
    file: "scripts/run-tts-model-eval.py",
    signal: "performance_protocol_complete",
    purpose: "TTS v2 performance ranking gate",
  },
  {
    file: "scripts/run-screen-ocr-eval.swift",
    signal: '"character_error_rate"',
    purpose: "OCR character error rate",
  },
  {
    file: "scripts/run-speaker-isolation-eval.py",
    signal: "optimal_speaker_mapping_v2",
    purpose: "one-to-one diarization mapping",
  },
  {
    file: "scripts/run-creative-audio-model-eval.ts",
    signal: "clap_prompt_adherence_v1",
    purpose: "creative-audio prompt adherence",
  },
  {
    file: "scripts/run-creative-audio-model-eval.ts",
    signal: "--update-results requires a ranking-eligible run",
    purpose: "creative-audio ranked-results publication gate",
  },
  {
    file: "src/components/app-sections/testing/suiteAdapters.ts",
    signal: "formatSpeedFactor",
    purpose: "user-readable speed factor",
  },
  {
    file: "src/lib/ttsExternalBenchmarkContext.ts",
    signal: 'leaderboard: "provider-voice"',
    purpose: "dated external TTS context",
  },
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function validate(): string[] {
  const errors: string[] = [];
  if (!existsSync(SPEC_PATH)) return [`Missing ${SPEC_PATH}`];
  if (!existsSync(DOC_PATH)) errors.push(`Missing ${DOC_PATH}`);

  const spec = readJson<Methodology>(SPEC_PATH);
  if (!spec.$schema.trim())
    errors.push("$schema must identify the schema file");
  if (!/^\d+\.\d+\.\d+$/.test(spec.methodologyVersion)) {
    errors.push("methodologyVersion must be semantic x.y.z");
  }
  if (!spec.name.trim()) errors.push("name must not be empty");
  if (spec.warmupRuns < 1) errors.push("warmupRuns must be at least 1");
  if (spec.measuredRuns < 3) errors.push("measuredRuns must be at least 3");
  if (!spec.percentiles.includes(50) || !spec.percentiles.includes(95)) {
    errors.push("percentiles must include p50 and p95");
  }
  if (!spec.rankingPolicy.fullSuiteOnly) {
    errors.push("rankingPolicy.fullSuiteOnly must be true");
  }
  if (!spec.rankingPolicy.requireInstalledAppPath) {
    errors.push("rankingPolicy.requireInstalledAppPath must be true");
  }
  if (spec.rankingPolicy.externalMetricsAffectRank) {
    errors.push("external metrics must not affect the local rank");
  }
  if (spec.rankingPolicy.missingRequiredMetric !== "unranked") {
    errors.push("missing required metrics must make a result unranked");
  }
  if (spec.rankingPolicy.failedRequiredCase !== "unranked") {
    errors.push("failed required cases must make a result unranked");
  }
  if (!spec.rankingPolicy.aggregatePolicy.trim()) {
    errors.push("rankingPolicy.aggregatePolicy must not be empty");
  }
  if (!spec.rankingPolicy.legacyResults.trim()) {
    errors.push("rankingPolicy.legacyResults must not be empty");
  }

  const ids = spec.suites.map((suite) => suite.id);
  if (!unique(ids)) errors.push("suite IDs must be unique");
  for (const expected of EXPECTED_SUITES) {
    if (!ids.includes(expected))
      errors.push(`missing required suite: ${expected}`);
  }
  for (const id of ids) {
    if (!EXPECTED_SUITES.has(id)) errors.push(`unexpected suite: ${id}`);
  }

  for (const suite of spec.suites) {
    const runnerPath = resolve(PROJECT_ROOT, suite.runner);
    if (!existsSync(runnerPath)) {
      errors.push(`${suite.id}: runner does not exist: ${suite.runner}`);
    }
    if (suite.requiredMetrics.length < 3 || !unique(suite.requiredMetrics)) {
      errors.push(
        `${suite.id}: requiredMetrics must contain at least 3 unique metrics`,
      );
    }
    if (suite.domains.length === 0 || !unique(suite.domains)) {
      errors.push(`${suite.id}: domains must be non-empty and unique`);
    }
    if (!suite.rankedGate.trim())
      errors.push(`${suite.id}: rankedGate is empty`);
  }

  const requiredSystemFields = new Set(spec.systemProfile.required);
  for (const field of [
    "gitCommit",
    "appVersion",
    "modelRevision",
    "runtime",
    "hardwarePath",
  ]) {
    if (!requiredSystemFields.has(field)) {
      errors.push(`systemProfile.required is missing ${field}`);
    }
  }
  if (
    !spec.systemProfile.performanceMetrics.includes("peakProcessTreeRssBytes")
  ) {
    errors.push("systemProfile must require peakProcessTreeRssBytes");
  }

  if (spec.externalContext.prohibited.length === 0) {
    errors.push("externalContext.prohibited must not be empty");
  }

  for (const check of IMPLEMENTATION_SIGNALS) {
    const path = resolve(PROJECT_ROOT, check.file);
    if (!existsSync(path)) {
      errors.push(
        `missing implementation file for ${check.purpose}: ${check.file}`,
      );
      continue;
    }
    if (!readFileSync(path, "utf8").includes(check.signal)) {
      errors.push(
        `${check.file}: missing ${check.purpose} signal ${check.signal}`,
      );
    }
  }

  if (existsSync(DOC_PATH)) {
    const doc = readFileSync(DOC_PATH, "utf8");
    for (const heading of [
      "## Live STT",
      "## File ASR",
      "## Speaker isolation and diarization",
      "## Screen OCR",
      "## Refine LLMs",
      "## TTS",
      "## TTS style",
      "## Voice cloning",
      "## Creative audio",
    ]) {
      if (!doc.includes(heading))
        errors.push(`methodology document is missing ${heading}`);
    }
  }

  return errors;
}

const errors = validate();
const json = process.argv.includes("--json");
if (json) {
  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0,
        methodologyPath: SPEC_PATH,
        errors,
      },
      null,
      2,
    ),
  );
} else if (errors.length === 0) {
  console.log("Benchmark methodology v2 validation passed.");
} else {
  console.error("Benchmark methodology v2 validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
}

process.exit(errors.length === 0 ? 0 : 1);
