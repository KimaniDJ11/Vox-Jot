#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_NAME = "Vox Jot";
const APP_BUNDLE_NAME = `${APP_NAME}.app`;
const PRODUCT_ID = "8UhuqxxzvPRLgPfGc37FFw==";
const DEFAULT_HF_REPO = "IrieDinamik/vox-jot-releases";
const DEFAULT_DOWNLOADS_BASE_URL = "https://downloads.iriedinamik.org";
const DEFAULT_R2_PREFIX = "voxjot";

type ReleaseOptions = {
  version: string;
  skipBuild: boolean;
  skipValidation: boolean;
  skipR2: boolean;
  skipHf: boolean;
  skipGumroad: boolean;
  skipWebsiteCheck: boolean;
  skipUpdater: boolean;
};

type ManifestPlatform = {
  signature: string;
  url: string;
};

type Manifest = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: {
    "darwin-aarch64": ManifestPlatform;
  };
};

type RunOptions = {
  capture?: boolean;
  env?: NodeJS.ProcessEnv;
};

function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    if (options.capture) {
      child.stdout?.on("data", (chunk) =>
        stdoutChunks.push(Buffer.from(chunk)),
      );
      child.stderr?.on("data", (chunk) =>
        stderrChunks.push(Buffer.from(chunk)),
      );
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with ${code ?? "unknown"}${
            stderr ? `\n${stderr}` : ""
          }`,
        ),
      );
    });
  });
}

async function runText(command: string, args: string[]): Promise<string> {
  const result = await run(command, args, { capture: true });
  return result.stdout;
}

function usage(exitCode = 1): never {
  console.error(`Usage:
  bun scripts/distribute-macos-release.ts <version> [options]

Options:
  --skip-build           Reuse existing local macOS release artifacts.
  --skip-validation      Skip build/lint/test/cargo validation.
  --skip-r2              Do not upload DMG/checksum to Cloudflare R2.
  --skip-hf              Do not upload updater artifacts/latest.json to Hugging Face.
  --skip-gumroad         Do not inspect Gumroad product content.
  --skip-website-check   Do not verify the public website points to Gumroad.
  --skip-updater         Do not create/sign updater archive.

Required for R2 upload unless --skip-r2:
  VOX_JOT_R2_BUCKET      Cloudflare R2 bucket name.

Required for updater archive unless --skip-updater:
  TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD when the key is encrypted.

Optional:
  VOX_JOT_R2_PREFIX              Defaults to ${DEFAULT_R2_PREFIX}
  VOX_JOT_DOWNLOADS_BASE_URL     Defaults to ${DEFAULT_DOWNLOADS_BASE_URL}
  HF_REPO                        Defaults to ${DEFAULT_HF_REPO}
  RELEASE_NOTES                  Defaults to "Vox Jot <version>"
`);
  process.exit(exitCode);
}

function parseArgs(): ReleaseOptions {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage(0);
  }

  const version = args.find((arg) => !arg.startsWith("--"));
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    usage();
  }

  const has = (flag: string) => args.includes(flag);
  return {
    version,
    skipBuild: has("--skip-build"),
    skipValidation: has("--skip-validation"),
    skipR2: has("--skip-r2"),
    skipHf: has("--skip-hf"),
    skipGumroad: has("--skip-gumroad"),
    skipWebsiteCheck: has("--skip-website-check"),
    skipUpdater: has("--skip-updater"),
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function bumpVersion(repoRoot: string, version: string): Promise<void> {
  const packageJsonPath = path.join(repoRoot, "package.json");
  const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");

  const packageJson = await readJson<Record<string, unknown>>(packageJsonPath);
  packageJson.version = version;
  await writeJson(packageJsonPath, packageJson);

  const tauriConfig = await readJson<Record<string, unknown>>(tauriConfigPath);
  tauriConfig.version = version;
  await writeJson(tauriConfigPath, tauriConfig);

  const cargoToml = await readFile(cargoTomlPath, "utf8");
  if (!/(^version\s*=\s*")[^"]+(")/m.test(cargoToml)) {
    throw new Error(`Could not find version field in ${cargoTomlPath}`);
  }
  const nextCargoToml = cargoToml.replace(
    /(^version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`,
  );
  await writeFile(cargoTomlPath, nextCargoToml);
}

async function runValidation(): Promise<void> {
  await run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
  await run("bun", [
    "run",
    "test:unit",
    "--",
    "src/lib/utils/customUpdateChecker.test.ts",
    "src/stores/updateStore.test.ts",
  ]);
  await run("bun", ["run", "build"]);
  await run("bun", ["run", "lint"]);
  await run("bun", ["scripts/audit-distribution-readiness.ts"]);
  await run("git", ["diff", "--check"]);
}

function archName(): string {
  if (process.arch === "arm64") return "aarch64";
  if (process.arch === "x64") return "x86_64";
  return process.arch;
}

async function ensureFile(filePath: string, label: string): Promise<void> {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}`);
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() && !fileStat.isDirectory()) {
    throw new Error(`${label} is not a file/directory: ${filePath}`);
  }
}

async function sha256(filePath: string): Promise<string> {
  return (await runText("/usr/bin/shasum", ["-a", "256", filePath])).split(
    /\s+/,
  )[0];
}

async function createUpdaterArchive(
  appPath: string,
  archivePath: string,
): Promise<string> {
  const appParent = path.dirname(appPath);
  await run(
    "/usr/bin/tar",
    ["-czf", archivePath, "-C", appParent, APP_BUNDLE_NAME],
    {
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
      },
    },
  );

  const signature = (
    await runText("bun", ["run", "tauri", "signer", "sign", archivePath])
  ).trim();
  const isValid =
    signature.includes("signature from tauri secret key") ||
    signature.includes(
      "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK",
    ) ||
    signature.includes(
      "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXk",
    );
  if (!isValid) {
    throw new Error(
      "Tauri signer did not return the expected updater signature.",
    );
  }

  let cleanSignature = signature.trim();
  if (signature.includes("Public signature:")) {
    const match = signature.match(
      /Public signature:\s*\n\s*([A-Za-z0-9+/=\s\n\r]+)/,
    );
    if (match) {
      cleanSignature = match[1].trim();
    }
  }
  cleanSignature = cleanSignature
    .split(/\n\s*\n/)[0]
    .trim()
    .replace(/[\r\n\s]+/g, "");

  await writeFile(`${archivePath}.sig`, `${cleanSignature}\n`);
  return cleanSignature;
}

async function getWranglerAuth(): Promise<{
  accountId: string;
  token: string;
} | null> {
  try {
    const configPath = path.join(
      process.env.HOME || "",
      "Library/Preferences/.wrangler/config/default.toml",
    );
    if (!existsSync(configPath)) return null;
    const content = await readFile(configPath, "utf8");
    const match = content.match(/oauth_token\s*=\s*"([^"]+)"/);
    if (!match) return null;
    return {
      accountId: "0143685a9b54cfaddadab8f41e906f97",
      token: match[1],
    };
  } catch {
    return null;
  }
}

async function uploadR2Object(
  bucket: string,
  key: string,
  filePath: string,
  contentType: string,
  cacheControl: string,
): Promise<void> {
  const auth = await getWranglerAuth();
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (auth) {
        const url = `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/r2/buckets/${bucket}/objects/${key}`;
        await run("curl", [
          "-s",
          "-f",
          "-X",
          "PUT",
          "-H",
          `Authorization: Bearer ${auth.token}`,
          "-H",
          `Content-Type: ${contentType}`,
          "-H",
          `Cache-Control: ${cacheControl}`,
          "-T",
          filePath,
          url,
        ]);
        console.log(`Uploaded ${key} to R2 bucket ${bucket}.`);
        return;
      }

      await run("bunx", [
        "wrangler",
        "r2",
        "object",
        "put",
        `${bucket}/${key}`,
        "--file",
        filePath,
        "--remote",
        "--content-type",
        contentType,
        "--cache-control",
        cacheControl,
        "--force",
      ]);
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      console.warn(
        `Upload attempt ${attempt} for ${key} failed, retrying in 2s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function headOk(url: string): Promise<void> {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HEAD ${url} returned ${response.status}`);
  }
}

async function verifyWebsitePointsToGumroad(): Promise<void> {
  const url = "https://www.iriedinamik.org/voxjot/";
  const html = await fetch(url).then((response) => response.text());
  if (!html.includes("gumroad.com") && !html.includes("/l/voxjot")) {
    throw new Error(`${url} does not appear to link to Gumroad.`);
  }
}

async function verifyGumroadContainsLatestUrl(
  latestDmgUrl: string,
): Promise<void> {
  const output = await runText("gumroad", [
    "products",
    "view",
    PRODUCT_ID,
    "--json",
    "--no-input",
    "--quiet",
  ]);
  const product = JSON.parse(output) as unknown;
  if (!JSON.stringify(product).includes(latestDmgUrl)) {
    throw new Error(
      `Gumroad product ${PRODUCT_ID} does not contain ${latestDmgUrl}.`,
    );
  }
}

function requireUpdaterSigningEnv(): void {
  if (
    !process.env.TAURI_SIGNING_PRIVATE_KEY &&
    !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH
  ) {
    throw new Error(
      "Updater signing key missing. Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH, or pass --skip-updater.",
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  process.chdir(repoRoot);

  const version = options.version;
  const tag = `v${version}`;
  const arch = archName();
  const targetRoot =
    process.env.CARGO_TARGET_DIR ??
    path.join(repoRoot, ".local-targets", "vox-jot");
  const bundleRoot = path.join(targetRoot, "release", "bundle");
  const appPath = path.join(bundleRoot, "macos", APP_BUNDLE_NAME);
  const localDmgPath = path.join(
    bundleRoot,
    "dmg",
    `${APP_NAME}_${version}_${arch}.dmg`,
  );
  const releaseRoot = path.join(repoRoot, "release-assets", tag);
  const downloadsBaseUrl =
    process.env.VOX_JOT_DOWNLOADS_BASE_URL?.replace(/\/+$/, "") ??
    DEFAULT_DOWNLOADS_BASE_URL;
  const r2Prefix = (process.env.VOX_JOT_R2_PREFIX ?? DEFAULT_R2_PREFIX).replace(
    /^\/+|\/+$/g,
    "",
  );
  const r2Bucket = process.env.VOX_JOT_R2_BUCKET;
  const hfRepo = process.env.HF_REPO ?? DEFAULT_HF_REPO;

  const versionedDmgName = `Vox-Jot_${version}_${arch}.dmg`;
  const latestDmgName = `Vox-Jot-latest-${arch}.dmg`;
  const versionedDmgPath = path.join(releaseRoot, versionedDmgName);
  const versionedShaPath = path.join(releaseRoot, `${versionedDmgName}.sha256`);
  const latestShaPath = path.join(releaseRoot, `${latestDmgName}.sha256`);
  const noticeSourcePath = path.join(
    repoRoot,
    "src-tauri",
    "resources",
    "THIRD_PARTY_NOTICES.txt",
  );
  const versionedNoticeName = `Vox-Jot_${version}_THIRD_PARTY_NOTICES.txt`;
  const latestNoticeName = "Vox-Jot-latest-THIRD_PARTY_NOTICES.txt";
  const versionedNoticePath = path.join(releaseRoot, versionedNoticeName);
  const updaterDir = path.join(releaseRoot, "updater");
  const updaterArchiveName = `Vox.Jot_${arch}.app.tar.gz`;
  const updaterArchivePath = path.join(updaterDir, updaterArchiveName);
  const hfManifestPath = path.join(releaseRoot, "latest.hf.json");
  const r2ManifestPath = path.join(releaseRoot, "latest.r2.json");
  const latestDmgUrl = `${downloadsBaseUrl}/${r2Prefix}/latest/${latestDmgName}`;
  const latestShaUrl = `${downloadsBaseUrl}/${r2Prefix}/latest/${latestDmgName}.sha256`;
  const latestNoticeUrl = `${downloadsBaseUrl}/${r2Prefix}/latest/${latestNoticeName}`;

  console.log(`Preparing Vox Jot ${version} local macOS distribution.`);

  if (!options.skipUpdater) {
    requireUpdaterSigningEnv();
  }

  await bumpVersion(repoRoot, version);

  if (!options.skipValidation) {
    await runValidation();
  }

  if (!options.skipBuild) {
    await run("bun", ["run", "mac:release"]);
  }

  await ensureFile(appPath, "Signed app bundle");
  await ensureFile(localDmgPath, "Notarized DMG");
  await ensureFile(noticeSourcePath, "Third-party notice bundle");

  await mkdir(releaseRoot, { recursive: true });
  await mkdir(updaterDir, { recursive: true });
  await copyFile(localDmgPath, versionedDmgPath);
  await copyFile(noticeSourcePath, versionedNoticePath);

  const dmgHash = await sha256(versionedDmgPath);
  await writeFile(versionedShaPath, `${dmgHash}  ${versionedDmgName}\n`);
  await writeFile(latestShaPath, `${dmgHash}  ${latestDmgName}\n`);

  let hfManifest: Manifest | null = null;
  let r2Manifest: Manifest | null = null;

  if (!options.skipUpdater) {
    const signature = await createUpdaterArchive(appPath, updaterArchivePath);

    hfManifest = {
      version,
      notes: process.env.RELEASE_NOTES?.trim() || `Vox Jot ${version}`,
      pub_date: new Date().toISOString(),
      platforms: {
        "darwin-aarch64": {
          signature,
          url: `https://huggingface.co/${hfRepo}/resolve/main/${tag}/${encodeURIComponent(
            updaterArchiveName,
          )}`,
        },
      },
    };
    await writeFile(hfManifestPath, `${JSON.stringify(hfManifest, null, 2)}\n`);

    r2Manifest = {
      ...hfManifest,
      platforms: {
        "darwin-aarch64": {
          signature,
          url: `${downloadsBaseUrl}/${r2Prefix}/updater/releases/${tag}/${updaterArchiveName}`,
        },
      },
    };
    await writeFile(r2ManifestPath, `${JSON.stringify(r2Manifest, null, 2)}\n`);
  }

  if (!options.skipR2) {
    if (!r2Bucket) {
      throw new Error("VOX_JOT_R2_BUCKET is required for R2 upload.");
    }

    const longCache = "public, max-age=31536000, immutable";
    const shortCache = "public, max-age=300";
    await uploadR2Object(
      r2Bucket,
      `${r2Prefix}/releases/${tag}/${versionedDmgName}`,
      versionedDmgPath,
      "application/x-apple-diskimage",
      longCache,
    );
    await uploadR2Object(
      r2Bucket,
      `${r2Prefix}/releases/${tag}/${versionedDmgName}.sha256`,
      versionedShaPath,
      "text/plain; charset=utf-8",
      longCache,
    );
    await uploadR2Object(
      r2Bucket,
      `${r2Prefix}/latest/${latestDmgName}`,
      versionedDmgPath,
      "application/x-apple-diskimage",
      shortCache,
    );
    await uploadR2Object(
      r2Bucket,
      `${r2Prefix}/latest/${latestDmgName}.sha256`,
      latestShaPath,
      "text/plain; charset=utf-8",
      shortCache,
    );
    await uploadR2Object(
      r2Bucket,
      `${r2Prefix}/releases/${tag}/${versionedNoticeName}`,
      versionedNoticePath,
      "text/plain; charset=utf-8",
      longCache,
    );
    await uploadR2Object(
      r2Bucket,
      `${r2Prefix}/latest/${latestNoticeName}`,
      versionedNoticePath,
      "text/plain; charset=utf-8",
      shortCache,
    );

    if (!options.skipUpdater && r2Manifest) {
      await uploadR2Object(
        r2Bucket,
        `${r2Prefix}/updater/releases/${tag}/${updaterArchiveName}`,
        updaterArchivePath,
        "application/gzip",
        longCache,
      );
      await uploadR2Object(
        r2Bucket,
        `${r2Prefix}/updater/releases/${tag}/${updaterArchiveName}.sig`,
        `${updaterArchivePath}.sig`,
        "text/plain; charset=utf-8",
        longCache,
      );
      await uploadR2Object(
        r2Bucket,
        `${r2Prefix}/updater/latest.json`,
        r2ManifestPath,
        "application/json; charset=utf-8",
        shortCache,
      );
    }

    await headOk(latestDmgUrl);
    await headOk(latestShaUrl);
    await headOk(latestNoticeUrl);
  }

  if (!options.skipHf && !options.skipUpdater && hfManifest) {
    await run("hf", ["auth", "whoami"]);
    await run("hf", [
      "upload",
      hfRepo,
      updaterDir,
      tag,
      "--repo-type",
      "model",
      "--commit-message",
      `Release ${tag}`,
    ]);
    await run("hf", [
      "upload",
      hfRepo,
      hfManifestPath,
      "latest.json",
      "--repo-type",
      "model",
      "--commit-message",
      `Update latest.json -> ${version}`,
    ]);
    await headOk(`https://huggingface.co/${hfRepo}/resolve/main/latest.json`);
  }

  if (!options.skipGumroad) {
    await verifyGumroadContainsLatestUrl(latestDmgUrl);
  }

  if (!options.skipWebsiteCheck) {
    await verifyWebsitePointsToGumroad();
  }

  console.log("");
  console.log(`Vox Jot ${version} local distribution prepared.`);
  console.log(`  Release assets: ${releaseRoot}`);
  console.log(`  DMG: ${versionedDmgPath}`);
  console.log(`  Latest DMG URL: ${latestDmgUrl}`);
  if (!options.skipUpdater) {
    console.log(`  Updater archive: ${updaterArchivePath}`);
    console.log(`  HF manifest: ${hfManifestPath}`);
    console.log(`  R2 manifest: ${r2ManifestPath}`);
  }
}

await main();
