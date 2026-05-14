#!/usr/bin/env bun
/*
 * Mirrors a GitHub Release's signed updater artifacts and installers to the
 * public Hugging Face `vox-jot-releases` repo, and writes the `latest.json`
 * manifest that the Tauri updater plugin consumes.
 *
 * Environment:
 *   GITHUB_TOKEN       Required. Used to download release assets via `gh`.
 *   HF_TOKEN           Required. Used to upload to Hugging Face via `hf`.
 *   GITHUB_REPOSITORY  Optional, defaults to "KimaniDJ11/Vox-Jot".
 *   HF_REPO            Optional, defaults to "IrieDinamik/vox-jot-releases".
 *   RELEASE_NOTES      Optional. Plain-text release notes embedded in latest.json.
 *
 * Usage:
 *   bun scripts/publish-release-to-hf.ts <version>
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

type PlatformKey =
  | "darwin-x86_64"
  | "darwin-aarch64"
  | "linux-x86_64"
  | "linux-aarch64"
  | "windows-x86_64"
  | "windows-aarch64";

type ManifestPlatform = { signature: string; url: string };

type Manifest = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Partial<Record<PlatformKey, ManifestPlatform>>;
};

const GH_REPO = process.env.GITHUB_REPOSITORY?.trim() || "KimaniDJ11/Vox-Jot";
const HF_REPO = process.env.HF_REPO?.trim() || "IrieDinamik/vox-jot-releases";
const HF_URL_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`;

function detectPlatform(filename: string): PlatformKey | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".app.tar.gz") || lower.endsWith(".app.tar.gz.sig")) {
    if (lower.includes("aarch64")) return "darwin-aarch64";
    if (lower.includes("x64") || lower.includes("x86_64"))
      return "darwin-x86_64";
  }
  if (
    lower.endsWith(".appimage.tar.gz") ||
    lower.endsWith(".appimage.tar.gz.sig")
  ) {
    if (lower.includes("arm64") || lower.includes("aarch64"))
      return "linux-aarch64";
    if (lower.includes("amd64") || lower.includes("x86_64"))
      return "linux-x86_64";
  }
  if (lower.endsWith(".nsis.zip") || lower.endsWith(".nsis.zip.sig")) {
    if (lower.includes("arm64") || lower.includes("aarch64"))
      return "windows-aarch64";
    return "windows-x86_64";
  }
  return null;
}

function isUpdaterArtifact(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".app.tar.gz") ||
    lower.endsWith(".app.tar.gz.sig") ||
    lower.endsWith(".appimage.tar.gz") ||
    lower.endsWith(".appimage.tar.gz.sig") ||
    lower.endsWith(".nsis.zip") ||
    lower.endsWith(".nsis.zip.sig")
  );
}

function isInstaller(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".dmg") ||
    lower.endsWith(".appimage") ||
    lower.endsWith(".deb") ||
    lower.endsWith(".rpm") ||
    lower.endsWith(".msi") ||
    (lower.endsWith(".exe") && lower.includes("setup"))
  );
}

async function main(): Promise<void> {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: bun scripts/publish-release-to-hf.ts <version>");
    process.exit(1);
  }
  const tag = `v${version}`;

  if (!process.env.GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN is required");
    process.exit(1);
  }
  if (!process.env.HF_TOKEN) {
    console.error("HF_TOKEN is required");
    process.exit(1);
  }

  const workDir = path.resolve("release-assets", tag);
  await mkdir(workDir, { recursive: true });

  console.log(`Downloading ${tag} assets from ${GH_REPO} into ${workDir}…`);
  await $`gh release download ${tag} --repo ${GH_REPO} --dir ${workDir} --clobber`.env(
    {
      ...process.env,
      GH_TOKEN: process.env.GITHUB_TOKEN,
    },
  );

  const downloaded = await readdir(workDir);
  console.log(`Downloaded ${downloaded.length} asset(s):`);
  for (const f of downloaded) console.log(`  ${f}`);

  const manifest: Manifest = {
    version,
    notes: process.env.RELEASE_NOTES?.trim() || `Vox Jot ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {},
  };

  const toUpload = downloaded.filter(
    (f) => isUpdaterArtifact(f) || isInstaller(f),
  );

  const sigFiles = toUpload.filter((f) => f.endsWith(".sig"));
  for (const sigName of sigFiles) {
    const platform = detectPlatform(sigName);
    if (!platform) continue;
    const archiveName = sigName.slice(0, -".sig".length);
    if (!existsSync(path.join(workDir, archiveName))) {
      console.warn(`  WARN: ${sigName} has no companion ${archiveName}`);
      continue;
    }
    const signature = (
      await readFile(path.join(workDir, sigName), "utf8")
    ).trim();
    manifest.platforms[platform] = {
      signature,
      url: `${HF_URL_BASE}/${tag}/${encodeURIComponent(archiveName)}`,
    };
    console.log(
      `  Manifest entry: ${platform} -> ${archiveName} (sig length ${signature.length})`,
    );
  }

  if (Object.keys(manifest.platforms).length === 0) {
    console.error("No platform signatures were collected. Aborting.");
    process.exit(1);
  }

  const manifestPath = path.resolve("latest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${manifestPath}`);

  console.log(`Uploading ${tag} assets to ${HF_REPO}…`);
  await $`hf upload ${HF_REPO} ${workDir} ${tag} --repo-type model --commit-message ${`Release ${tag}`}`.env(
    {
      ...process.env,
      HF_TOKEN: process.env.HF_TOKEN,
    },
  );

  console.log(`Uploading latest.json to ${HF_REPO} root…`);
  await $`hf upload ${HF_REPO} ${manifestPath} latest.json --repo-type model --commit-message ${`Update latest.json -> ${version}`}`.env(
    {
      ...process.env,
      HF_TOKEN: process.env.HF_TOKEN,
    },
  );

  console.log(`Done. Updater manifest available at:`);
  console.log(`  ${HF_URL_BASE}/latest.json`);
}

await main();
