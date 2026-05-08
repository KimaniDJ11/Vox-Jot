#!/usr/bin/env bun
/**
 * Build a small audio regression manifest from the spelling corpus.
 *
 * The generated clips are synthetic macOS `say` audio. That keeps the test
 * reproducible and local while exercising the real STT engines with WAV input.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

interface SpellingCase {
  id: string;
  expected_output: string;
  category: string;
  notes?: string;
}

interface SpellingCorpus {
  metadata: {
    corpus_id: string;
    generated_at: string;
  };
  cases: SpellingCase[];
}

interface Config {
  casesPath: string;
  outputDir: string;
  voice: string;
  rate: string;
  limit: number | null;
  force: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
  };
  const has = (flag: string): boolean => args.includes(flag);
  const limitRaw = get("--limit", "");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;

  return {
    casesPath: get(
      "--cases",
      resolve(PROJECT_ROOT, "test-data/spelling-corpus/cases.json"),
    ),
    outputDir: get(
      "--output-dir",
      resolve(PROJECT_ROOT, "test-data/stt-spelling-regression"),
    ),
    voice: get("--voice", "Samantha"),
    rate: get("--rate", "185"),
    limit: Number.isFinite(limit) && limit !== null && limit > 0 ? limit : null,
    force: has("--force"),
  };
}

function ensureTool(tool: string) {
  const result = spawnSync("which", [tool], { stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error(`Required macOS audio tool not found: ${tool}`);
  }
}

function shellRun(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

function durationSeconds(wavPath: string): number {
  const output = shellRun("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    wavPath,
  ]);
  const duration = Number.parseFloat(output);
  if (!Number.isFinite(duration)) {
    throw new Error(`Could not probe WAV duration for ${wavPath}`);
  }
  return Number(duration.toFixed(3));
}

function textForSpeech(text: string): string {
  return text
    .replace(/\$3 billion/g, "three billion dollars")
    .replace(/--cov/g, "dash dash cov")
    .replace(/HMAC-SHA256/g, "HMAC SHA two fifty six")
    .replace(/TLS 1\.3/g, "TLS one point three");
}

function generateClip(
  entry: SpellingCase,
  config: Config,
  clipsDir: string,
): { wavPath: string; durationSecs: number } {
  const wavPath = resolve(clipsDir, `${entry.id}.wav`);
  if (existsSync(wavPath) && !config.force) {
    return { wavPath, durationSecs: durationSeconds(wavPath) };
  }

  const aiffPath = resolve(clipsDir, `${entry.id}.aiff`);
  shellRun("say", [
    "-v",
    config.voice,
    "-r",
    config.rate,
    "-o",
    aiffPath,
    textForSpeech(entry.expected_output),
  ]);
  shellRun("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", aiffPath, wavPath]);
  rmSync(aiffPath, { force: true });
  return { wavPath, durationSecs: durationSeconds(wavPath) };
}

function main() {
  ensureTool("say");
  ensureTool("afconvert");
  ensureTool("ffprobe");

  const config = parseArgs();
  const raw = readFileSync(config.casesPath, "utf-8");
  const corpus = JSON.parse(raw) as SpellingCorpus;
  const cases =
    config.limit === null ? corpus.cases : corpus.cases.slice(0, config.limit);

  const clipsDir = resolve(config.outputDir, "clips");
  mkdirSync(clipsDir, { recursive: true });

  const entries = cases.map((entry) => {
    const { wavPath, durationSecs } = generateClip(entry, config, clipsDir);
    return {
      id: entry.id,
      audio_path: wavPath,
      expected_text: entry.expected_output,
      duration_secs: durationSecs,
      source_relpath: `${entry.id}.wav`,
      speaker_id: `macos-say-${config.voice}`,
      chapter_id: entry.category,
      utterance_id: entry.id,
    };
  });

  const manifest = {
    metadata: {
      dataset_id: `synthetic-${corpus.metadata.corpus_id}`,
      dataset_url: config.casesPath,
      license: "local synthetic audio generated from repository test cases",
      generated_at: new Date().toISOString(),
      clip_count: entries.length,
      speech_synthesizer: "macOS say",
      voice: config.voice,
      rate: config.rate,
    },
    entries,
  };

  const manifestPath = resolve(config.outputDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Generated ${entries.length} STT spelling clips`);
  console.log(`Manifest: ${manifestPath}`);
}

main();
