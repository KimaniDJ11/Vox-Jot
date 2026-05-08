import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const REGRESSION_DIR = path.join(ROOT, "test-data", "audio-regression");
const DOWNLOAD_DIR = path.join(REGRESSION_DIR, "downloads");
const EXTRACT_DIR = path.join(REGRESSION_DIR, "extracted");
const CLIPS_DIR = path.join(REGRESSION_DIR, "clips");
const MANIFEST_PATH = path.join(REGRESSION_DIR, "manifest.json");

const DATASET = {
  id: "openslr-slr31-dev-clean-2",
  label: "OpenSLR SLR31 Mini LibriSpeech dev-clean-2",
  archiveName: "dev-clean-2.tar.gz",
  url: "https://openslr.trmal.net/resources/31/dev-clean-2.tar.gz",
  datasetUrl: "https://www.openslr.org/31/",
  license: "CC BY 4.0",
  expectedMd5: "6d7ab67ac6a1d2c993d050e16d61080d",
};

type ClipRecord = {
  id: string;
  audio_path: string;
  expected_text: string;
  duration_secs: number;
  source_relpath: string;
  speaker_id: string;
  chapter_id: string;
  utterance_id: string;
};

const args = new Map<string, string | boolean>();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) {
    args.set(arg, true);
  } else {
    args.set(arg, next);
    i += 1;
  }
}

const requestedLimit = Number(args.get("--limit") ?? 120);
const limit =
  Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 120;

async function ensureDirs() {
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  await mkdir(EXTRACT_DIR, { recursive: true });
  await mkdir(CLIPS_DIR, { recursive: true });
}

async function downloadArchive(archivePath: string) {
  if (await fileExists(archivePath)) {
    console.log(`Using existing archive: ${archivePath}`);
    return;
  }

  console.log(`Downloading ${DATASET.label} from ${DATASET.url}`);
  const partialPath = `${archivePath}.partial`;
  const result = Bun.spawnSync(
    [
      "curl",
      "-L",
      "--fail",
      "--continue-at",
      "-",
      "--output",
      partialPath,
      DATASET.url,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (result.exitCode !== 0) {
    throw new Error(`curl download failed with exit code ${result.exitCode}`);
  }
  await rename(partialPath, archivePath);
}

async function verifyArchiveMd5(archivePath: string) {
  const buffer = await readFile(archivePath);
  const hash = createHash("md5").update(buffer).digest("hex");
  if (hash !== DATASET.expectedMd5) {
    throw new Error(
      `Archive checksum mismatch for ${archivePath}. Expected ${DATASET.expectedMd5}, got ${hash}`,
    );
  }
}

async function extractArchive(archivePath: string) {
  const corpusRoot = path.join(EXTRACT_DIR, "LibriSpeech", "dev-clean-2");
  if (await fileExists(corpusRoot)) {
    console.log(`Using existing extracted corpus: ${corpusRoot}`);
    return corpusRoot;
  }

  console.log(`Extracting ${archivePath}`);
  const extractResult = Bun.spawnSync(
    ["tar", "-xzf", archivePath, "-C", EXTRACT_DIR],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (extractResult.exitCode !== 0) {
    throw new Error(
      `tar extraction failed with exit code ${extractResult.exitCode}`,
    );
  }

  return corpusRoot;
}

async function collectTranscriptMap(rootDir: string) {
  const transcriptFiles = await walk(rootDir, (entryPath) =>
    entryPath.endsWith(".trans.txt"),
  );
  const transcriptMap = new Map<string, string>();

  for (const file of transcriptFiles) {
    const content = await readFile(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const firstSpace = line.indexOf(" ");
      if (firstSpace === -1) continue;
      transcriptMap.set(
        line.slice(0, firstSpace),
        line.slice(firstSpace + 1).trim(),
      );
    }
  }

  return transcriptMap;
}

async function collectAudioFiles(rootDir: string) {
  return walk(rootDir, (entryPath) => entryPath.endsWith(".flac"));
}

async function probeDuration(audioPath: string) {
  const result = Bun.spawnSync(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(`ffprobe failed for ${audioPath}`);
  }

  const value = result.stdout.toString().trim();
  return Number.parseFloat(value);
}

async function buildClipPlan(corpusRoot: string, requestedCount: number) {
  const transcriptMap = await collectTranscriptMap(corpusRoot);
  const flacFiles = await collectAudioFiles(corpusRoot);
  const planned: Array<{
    id: string;
    sourcePath: string;
    expectedText: string;
    durationSecs: number;
    sourceRelpath: string;
    speakerId: string;
    chapterId: string;
    utteranceId: string;
  }> = [];

  for (const file of flacFiles) {
    const utteranceId = path.basename(file, ".flac");
    const expectedText = transcriptMap.get(utteranceId);
    if (!expectedText) continue;

    const durationSecs = await probeDuration(file);
    const [speakerId, chapterId] = utteranceId.split("-").slice(0, 2);
    planned.push({
      id: utteranceId,
      sourcePath: file,
      expectedText,
      durationSecs,
      sourceRelpath: path.relative(corpusRoot, file),
      speakerId,
      chapterId,
      utteranceId,
    });
  }

  planned.sort((left, right) => {
    if (left.durationSecs !== right.durationSecs) {
      return left.durationSecs - right.durationSecs;
    }
    return left.id.localeCompare(right.id);
  });

  return planned.slice(0, requestedCount);
}

async function resetGeneratedClips() {
  await rm(CLIPS_DIR, { recursive: true, force: true });
  await mkdir(CLIPS_DIR, { recursive: true });
}

async function convertPlanToWav(
  plan: Awaited<ReturnType<typeof buildClipPlan>>,
) {
  const entries: ClipRecord[] = [];

  for (const item of plan) {
    const wavPath = path.join(CLIPS_DIR, `${item.id}.wav`);
    const result = Bun.spawnSync(
      [
        "ffmpeg",
        "-loglevel",
        "error",
        "-y",
        "-i",
        item.sourcePath,
        "-ar",
        "16000",
        "-ac",
        "1",
        wavPath,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    if (result.exitCode !== 0) {
      throw new Error(`ffmpeg conversion failed for ${item.sourcePath}`);
    }

    entries.push({
      id: item.id,
      audio_path: wavPath,
      expected_text: item.expectedText,
      duration_secs: Number(item.durationSecs.toFixed(3)),
      source_relpath: item.sourceRelpath,
      speaker_id: item.speakerId,
      chapter_id: item.chapterId,
      utterance_id: item.utteranceId,
    });
  }

  return entries;
}

async function writeManifest(entries: ClipRecord[]) {
  const manifest = {
    metadata: {
      dataset_id: DATASET.id,
      dataset_url: DATASET.datasetUrl,
      license: DATASET.license,
      generated_at: new Date().toISOString(),
      clip_count: entries.length,
    },
    entries,
  };

  await Bun.write(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function walk(
  rootDir: string,
  predicate: (entryPath: string) => boolean,
): Promise<string[]> {
  const results: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (predicate(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

async function fileExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await ensureDirs();
  const archivePath = path.join(DOWNLOAD_DIR, DATASET.archiveName);
  await downloadArchive(archivePath);
  await verifyArchiveMd5(archivePath);
  const corpusRoot = await extractArchive(archivePath);
  const plan = await buildClipPlan(corpusRoot, limit);
  await resetGeneratedClips();
  const entries = await convertPlanToWav(plan);
  await writeManifest(entries);

  console.log(`Built regression manifest with ${entries.length} clips`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
