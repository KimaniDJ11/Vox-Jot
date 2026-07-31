#!/usr/bin/env bun

import { readFileSync } from "node:fs";

const PRIVATE_GITHUB_RELEASE =
  "github.com/KimaniDJ11/Vox-Jot/releases/download/v0.1.0-models";

const MODEL_MANAGER = readFileSync("src-tauri/src/managers/model.rs", "utf8");
const SPEECH_ANALYSIS = readFileSync(
  "src-tauri/src/speech_analysis.rs",
  "utf8",
);
const TTS_CATALOG = readFileSync("src-tauri/src/tts/catalog.rs", "utf8");
const TTS_MANAGER = readFileSync("src-tauri/src/tts.rs", "utf8");

type HfRepoInfo = {
  id?: string;
  private?: boolean;
  gated?: boolean | "auto" | "manual";
  disabled?: boolean;
  siblings?: Array<{ rfilename?: string }>;
};

const errors: string[] = [];

function fail(message: string) {
  errors.push(message);
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function extractAll(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function recommendedModelBlocks(): string[] {
  return MODEL_MANAGER.split(/available_models\.insert\(/).filter((block) =>
    block.includes("is_recommended: true"),
  );
}

async function headOk(url: string): Promise<boolean> {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  return response.ok;
}

async function hfRepoInfo(repoId: string): Promise<HfRepoInfo> {
  const response = await fetch(`https://huggingface.co/api/models/${repoId}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as HfRepoInfo;
}

function assertNoPrivateReleaseReferences() {
  for (const [label, source] of [
    ["ModelManager", MODEL_MANAGER],
    ["speech_analysis", SPEECH_ANALYSIS],
    ["TTS catalog", TTS_CATALOG],
    ["TTS manager", TTS_MANAGER],
  ] as const) {
    if (source.includes(PRIVATE_GITHUB_RELEASE)) {
      fail(`${label} still references private GitHub model release assets.`);
    }
  }
}

async function assertManagedSpeechRuntimeIsPublic() {
  const baseUrl = TTS_MANAGER.match(
    /const DEFAULT_TTS_ASSET_BASE_URL[^=]*=\s*"([^"]+)"/s,
  )?.[1];
  if (!baseUrl) {
    fail("Could not resolve DEFAULT_TTS_ASSET_BASE_URL.");
    return;
  }
  const runtimeUrl = `${baseUrl.replace(/\/$/, "")}/speech-runtime-macos-aarch64.tar.gz`;
  if (!(await headOk(runtimeUrl))) {
    fail(
      `Managed macOS speech runtime is not anonymously reachable: ${runtimeUrl}`,
    );
  }
}

async function assertRecommendedModelsArePublic() {
  for (const block of recommendedModelBlocks()) {
    const id = block.match(/id: "([^"]+)"/)?.[1] ?? "<unknown>";

    const directUrl = block.match(/url: Some\(\s*"([^"]+)"/s)?.[1];
    if (directUrl?.includes(PRIVATE_GITHUB_RELEASE)) {
      fail(`${id} is recommended but points at the private GitHub release.`);
    }
    if (directUrl?.startsWith("https://")) {
      if (!(await headOk(directUrl))) {
        fail(
          `${id} recommended URL is not anonymously reachable: ${directUrl}`,
        );
      }
    }

    const hfSnapshot = block.match(/hf_snapshot_url\("([^"]+)"\)/)?.[1];
    if (hfSnapshot) {
      try {
        const info = await hfRepoInfo(hfSnapshot);
        if (info.private || info.gated || info.disabled) {
          fail(
            `${id} is recommended but HF repo ${hfSnapshot} is not public-ready: private=${info.private} gated=${info.gated} disabled=${info.disabled}`,
          );
        }
      } catch (error) {
        fail(
          `${id} recommended HF repo ${hfSnapshot} could not be queried: ${error}`,
        );
      }
    }
  }
}

async function assertVoxJotModelAssetsExist() {
  const assetPaths = unique(
    extractAll(MODEL_MANAGER, /vox_jot_models_resolve_url\(\s*"([^"]+)"/g),
  );

  for (const path of assetPaths) {
    const url = `https://huggingface.co/IrieDinamik/vox-jot-models/resolve/main/${path}`;
    if (!(await headOk(url))) {
      fail(`Missing public Vox Jot model asset: ${url}`);
    }
  }
}

async function assertHfReposAreNotPrivateOrDisabled() {
  const repoIds = unique([
    ...extractAll(MODEL_MANAGER, /hf_snapshot_url\("([^"]+)"\)/g),
    ...extractAll(SPEECH_ANALYSIS, /Some\("([A-Za-z0-9_.-]+\/[^"]+)"\)/g),
    ...extractAll(TTS_CATALOG, /hf_repo_id: Some\("([^"]+)"\)/g),
    ...extractAll(TTS_CATALOG, /hf_model_id: "([^"]+)"/g),
  ]);

  for (const repoId of repoIds) {
    try {
      const info = await hfRepoInfo(repoId);
      if (info.private || info.disabled) {
        fail(
          `${repoId} is not public-ready: private=${info.private} disabled=${info.disabled}`,
        );
      }
    } catch (error) {
      fail(`${repoId} could not be queried from Hugging Face: ${error}`);
    }
  }
}

async function main() {
  assertNoPrivateReleaseReferences();
  await assertManagedSpeechRuntimeIsPublic();
  await assertRecommendedModelsArePublic();
  await assertVoxJotModelAssetsExist();
  await assertHfReposAreNotPrivateOrDisabled();

  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exit(1);
  }

  console.log("Public model catalog validation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
