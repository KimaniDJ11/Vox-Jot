#!/usr/bin/env bun
/**
 * Download every built-in STT model asset that Vox Jot exposes.
 *
 * This mirrors ModelManager's storage layout so the app sees the same installed
 * files after the script completes. It is intentionally sequential to avoid
 * saturating disk/network while large MLX snapshots are being fetched.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

const APP_SUPPORT = resolve(
  process.env.HOME ?? "",
  "Library/Application Support/com.iriedinamik.voxjot",
);
const STT_MODELS_DIR = resolve(APP_SUPPORT, "models/stt");
const RELEASE_BASE =
  process.env.VOX_JOT_STT_MODELS_BASE_URL ??
  "https://github.com/KimaniDJ11/Vox-Jot/releases/download/v0.1.0-models";

type ModelSpec =
  | {
      id: string;
      filename: string;
      kind: "file" | "archive";
      url: string;
    }
  | {
      id: string;
      filename: string;
      kind: "hf-snapshot";
      repo: string;
    };

const modelSpecs: ModelSpec[] = [
  whisper("tiny", "ggml-tiny.bin"),
  whisper("tiny.en", "ggml-tiny.en.bin"),
  whisper("base", "ggml-base.bin"),
  whisper("base.en", "ggml-base.en.bin"),
  whisper("small", "ggml-small.bin"),
  whisper("small.en", "ggml-small.en.bin"),
  whisper("medium", "ggml-medium.bin"),
  whisper("medium.en", "ggml-medium.en.bin"),
  hfFile(
    "whisper-medium-q4_1",
    "whisper-medium-q4_1.bin",
    "IrieDinamik/vox-jot-stt-whisper-medium-q4_1",
  ),
  whisper("turbo", "ggml-large-v3-turbo.bin"),
  whisper("large", "ggml-large-v3-q5_0.bin"),
  releaseFile("breeze-asr", "breeze-asr-q5_k.bin"),
  releaseArchive(
    "parakeet-tdt-0.6b-v2",
    "parakeet-tdt-0.6b-v2-int8",
    "parakeet-v2-int8.tar.gz",
  ),
  releaseArchive(
    "parakeet-tdt-0.6b-v3",
    "parakeet-tdt-0.6b-v3-int8",
    "parakeet-v3-int8.tar.gz",
  ),
  releaseArchive("moonshine-base", "moonshine-base", "moonshine-base.tar.gz"),
  releaseArchive(
    "moonshine-tiny-streaming-en",
    "moonshine-tiny-streaming-en",
    "moonshine-tiny-streaming-en.tar.gz",
  ),
  releaseArchive(
    "moonshine-small-streaming-en",
    "moonshine-small-streaming-en",
    "moonshine-small-streaming-en.tar.gz",
  ),
  releaseArchive(
    "moonshine-medium-streaming-en",
    "moonshine-medium-streaming-en",
    "moonshine-medium-streaming-en.tar.gz",
  ),
  releaseArchive(
    "sense-voice-int8",
    "sense-voice-int8",
    "sense-voice-int8.tar.gz",
  ),
  releaseArchive("gigaam-v3-e2e-ctc", "gigaam-v3-e2e-ctc", "giga-am-v3.tar.gz"),
  hfSnapshot(
    "mlx-whisper-large-v3-turbo",
    "MLX/mlx-community/whisper-large-v3-turbo-asr-fp16",
    "mlx-community/whisper-large-v3-turbo-asr-fp16",
  ),
  hfSnapshot(
    "mlx-distil-whisper-large-v3",
    "MLX/distil-whisper/distil-large-v3",
    "distil-whisper/distil-large-v3",
  ),
  hfSnapshot(
    "mlx-qwen3-asr",
    "MLX/mlx-community/Qwen3-ASR-1.7B-8bit",
    "mlx-community/Qwen3-ASR-1.7B-8bit",
  ),
  hfSnapshot(
    "mlx-parakeet-v3",
    "MLX/mlx-community/parakeet-tdt-0.6b-v3",
    "mlx-community/parakeet-tdt-0.6b-v3",
  ),
  hfSnapshot(
    "mlx-voxtral-mini-3b",
    "MLX/mlx-community/Voxtral-Mini-3B-2507-bf16",
    "mlx-community/Voxtral-Mini-3B-2507-bf16",
  ),
  hfSnapshot(
    "mlx-voxtral-mini-4b-realtime",
    "MLX/mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
    "mlx-community/Voxtral-Mini-4B-Realtime-2602-4bit",
  ),
];

function whisper(id: string, filename: string): ModelSpec {
  return hfFile(id, filename, "ggerganov/whisper.cpp");
}

function hfFile(id: string, filename: string, repo: string): ModelSpec {
  return {
    id,
    filename,
    kind: "file",
    url: `https://huggingface.co/${repo}/resolve/main/${filename}`,
  };
}

function releaseFile(id: string, filename: string): ModelSpec {
  return { id, filename, kind: "file", url: `${RELEASE_BASE}/${filename}` };
}

function releaseArchive(
  id: string,
  filename: string,
  asset: string,
): ModelSpec {
  return { id, filename, kind: "archive", url: `${RELEASE_BASE}/${asset}` };
}

function hfSnapshot(id: string, filename: string, repo: string): ModelSpec {
  return { id, filename, kind: "hf-snapshot", repo };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--models");
  const only =
    onlyIdx >= 0 && args[onlyIdx + 1]
      ? new Set(
          args[onlyIdx + 1]
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        )
      : null;
  return {
    only,
    force: args.includes("--force"),
  };
}

function run(command: string, args: string[]) {
  const status = tryRun(command, args);
  if (status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${status}`);
  }
}

function tryRun(command: string, args: string[]): number | null {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  return result.status;
}

function ensureTool(tool: string) {
  const result = spawnSync("which", [tool], { stdio: "ignore" });
  if (result.status !== 0) throw new Error(`Required tool not found: ${tool}`);
}

function hasDirectoryContents(path: string): boolean {
  return existsSync(path) && readdirSync(path).length > 0;
}

function githubReleaseAssetName(url: string): string | null {
  const prefix =
    "https://github.com/KimaniDJ11/Vox-Jot/releases/download/v0.1.0-models/";
  return url.startsWith(prefix) ? basename(url) : null;
}

function downloadReleaseAsset(asset: string, outputPath: string) {
  rmSync(outputPath, { force: true });
  run("gh", [
    "release",
    "download",
    "v0.1.0-models",
    "--repo",
    "KimaniDJ11/Vox-Jot",
    "--pattern",
    asset,
    "--output",
    outputPath,
  ]);
}

function finalizeExtract(stagingDir: string, finalPath: string) {
  const dirs = readdirSync(stagingDir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  rmSync(finalPath, { recursive: true, force: true });
  if (dirs.length === 1) {
    renameSync(resolve(stagingDir, dirs[0].name), finalPath);
    rmSync(stagingDir, { recursive: true, force: true });
  } else {
    renameSync(stagingDir, finalPath);
  }
}

function normalizeExtractedLayout(
  spec: Extract<ModelSpec, { kind: "archive" }>,
) {
  if (spec.id !== "gigaam-v3-e2e-ctc") return;

  const finalPath = resolve(STT_MODELS_DIR, spec.filename);
  const expected = resolve(finalPath, "model.onnx");
  const mirrored = resolve(finalPath, "v3_e2e_ctc.int8.onnx");
  if (!existsSync(expected) && existsSync(mirrored)) {
    try {
      linkSync(mirrored, expected);
    } catch {
      copyFileSync(mirrored, expected);
    }
  }

  const vocab = resolve(finalPath, "vocab.txt");
  if (!existsSync(vocab)) {
    const mirroredVocab = resolve(finalPath, "v3_e2e_ctc_vocab.txt");
    if (existsSync(mirroredVocab)) {
      copyFileSync(mirroredVocab, vocab);
    } else {
      run("curl", [
        "-L",
        "--fail",
        "--output",
        vocab,
        "https://huggingface.co/istupakov/gigaam-v3-onnx/resolve/main/v3_e2e_ctc_vocab.txt",
      ]);
    }
  }
}

function downloadFile(
  spec: Extract<ModelSpec, { kind: "file" }>,
  force: boolean,
) {
  const target = resolve(STT_MODELS_DIR, spec.filename);
  if (existsSync(target) && !force) {
    console.log(`Already installed: ${spec.id}`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  console.log(`Downloading ${spec.id}`);
  const status = tryRun("curl", [
    "-L",
    "--fail",
    "--continue-at",
    "-",
    "--output",
    partial,
    spec.url,
  ]);
  if (status !== 0) {
    const asset = githubReleaseAssetName(spec.url);
    if (!asset) {
      throw new Error(`curl download failed for ${spec.id} with ${status}`);
    }
    console.log(`Retrying ${spec.id} with GitHub release asset API`);
    downloadReleaseAsset(asset, partial);
  }
  renameSync(partial, target);
}

function downloadArchive(
  spec: Extract<ModelSpec, { kind: "archive" }>,
  force: boolean,
) {
  const finalPath = resolve(STT_MODELS_DIR, spec.filename);
  if (hasDirectoryContents(finalPath) && !force) {
    console.log(`Already installed: ${spec.id}`);
    return;
  }
  mkdirSync(dirname(finalPath), { recursive: true });
  const archivePath = resolve(
    STT_MODELS_DIR,
    `${basename(spec.filename)}.tar.gz.partial`,
  );
  const stagingDir = resolve(STT_MODELS_DIR, `${spec.filename}.extracting`);
  rmSync(stagingDir, { recursive: true, force: true });
  console.log(`Downloading ${spec.id}`);
  const status = tryRun("curl", [
    "-L",
    "--fail",
    "--continue-at",
    "-",
    "--output",
    archivePath,
    spec.url,
  ]);
  if (status !== 0) {
    const asset = githubReleaseAssetName(spec.url);
    if (!asset) {
      throw new Error(`curl download failed for ${spec.id} with ${status}`);
    }
    console.log(`Retrying ${spec.id} with GitHub release asset API`);
    downloadReleaseAsset(asset, archivePath);
  }
  mkdirSync(stagingDir, { recursive: true });
  run("tar", ["-xzf", archivePath, "-C", stagingDir]);
  finalizeExtract(stagingDir, finalPath);
  normalizeExtractedLayout(spec);
  rmSync(archivePath, { force: true });
}

function downloadSnapshot(
  spec: Extract<ModelSpec, { kind: "hf-snapshot" }>,
  force: boolean,
) {
  const finalPath = resolve(STT_MODELS_DIR, spec.filename);
  if (hasDirectoryContents(finalPath) && !force) {
    console.log(`Already installed: ${spec.id}`);
    return;
  }
  mkdirSync(dirname(finalPath), { recursive: true });
  console.log(`Downloading ${spec.id}`);
  const args = [
    "download",
    spec.repo,
    "--local-dir",
    finalPath,
    "--max-workers",
    "4",
  ];
  if (force) args.push("--force-download");
  run("hf", args);
}

function main() {
  const { only, force } = parseArgs();
  ensureTool("curl");
  ensureTool("tar");
  ensureTool("hf");
  ensureTool("gh");
  mkdirSync(STT_MODELS_DIR, { recursive: true });

  const selected = only
    ? modelSpecs.filter((spec) => only.has(spec.id))
    : modelSpecs;
  for (const spec of selected) {
    if (spec.kind === "file") downloadFile(spec, force);
    if (spec.kind === "archive") downloadArchive(spec, force);
    if (spec.kind === "hf-snapshot") downloadSnapshot(spec, force);
  }
  console.log("STT model download pass complete.");
}

main();
