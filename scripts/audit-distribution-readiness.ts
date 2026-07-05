import { execFileSync, execSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type FindingLevel = "fail" | "warn";

type Finding = {
  level: FindingLevel;
  message: string;
  detail?: string;
};

type TauriConfig = {
  productName?: string;
  version?: string;
  identifier?: string;
  bundle?: {
    createUpdaterArtifacts?: boolean | string;
    license?: string;
    resources?: string[] | Record<string, string> | null;
    macOS?: {
      hardenedRuntime?: boolean;
      signingIdentity?: string | null;
      entitlements?: string | null;
      minimumSystemVersion?: string | null;
    };
    windows?: {
      signCommand?: string | null;
    };
  };
};

type BundleResources = NonNullable<TauriConfig["bundle"]>["resources"];

const repoRoot = process.cwd();
const findings: Finding[] = [];

function add(level: FindingLevel, message: string, detail?: string) {
  findings.push({ level, message, detail });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function flattenResources(resources: BundleResources): string[] {
  if (!resources) {
    return [];
  }
  if (Array.isArray(resources)) {
    return resources;
  }
  return Object.keys(resources);
}

function directorySize(path: string): number {
  const stack = [path];
  let total = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }

    const stat = lstatSync(current);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current)) {
        stack.push(join(current, entry));
      }
    } else {
      total += stat.size;
    }
  }

  return total;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

const tauriConfigPath = join(repoRoot, "src-tauri", "tauri.conf.json");
const tauriConfig = readJson<TauriConfig>(tauriConfigPath);
const resources = flattenResources(tauriConfig.bundle?.resources);
const releaseWorkflowPath = join(
  repoRoot,
  ".github",
  "workflows",
  "release.yml",
);
const releaseWorkflow = existsSync(releaseWorkflowPath)
  ? readFileSync(releaseWorkflowPath, "utf8")
  : "";

if (!tauriConfig.productName) {
  add("fail", "Tauri productName is missing.");
}

if (!tauriConfig.version) {
  add("fail", "Tauri version is missing.");
}

if (!tauriConfig.identifier) {
  add("fail", "Tauri bundle identifier is missing.");
}

if (!tauriConfig.bundle?.license) {
  add("warn", "Bundle license is missing.");
}

if (tauriConfig.bundle?.macOS?.hardenedRuntime !== true) {
  add("fail", "macOS hardened runtime is not enabled.");
}

if (
  !tauriConfig.bundle?.macOS?.signingIdentity?.includes(
    "Developer ID Application",
  )
) {
  add(
    "warn",
    "macOS signing identity is not a Developer ID Application identity.",
  );
}

if (!tauriConfig.bundle?.macOS?.entitlements) {
  add("fail", "macOS entitlements file is not configured.");
}

if (
  !tauriConfig.bundle?.windows?.signCommand?.includes("trusted-signing-cli")
) {
  add("fail", "Windows Trusted Signing command is not configured.");
}

if (!releaseWorkflow) {
  add(
    "warn",
    "Release workflow is missing; Windows release signing cannot be checked.",
  );
} else if (
  /platform:\s*["']windows-latest["'][\s\S]*?sign-binaries:\s*false/.test(
    releaseWorkflow,
  )
) {
  add(
    "warn",
    "Windows release builds are configured to ship unsigned.",
    "This is acceptable only while Azure Trusted Signing secrets are unavailable; the updater archives still need Tauri updater signatures.",
  );
}

if (tauriConfig.bundle?.createUpdaterArtifacts !== true) {
  add(
    "warn",
    "Tauri updater artifacts are disabled.",
    "Public distribution should enable signed updater artifacts and publish latest.json before broad beta.",
  );
}

const riskyResourceGlobs = resources.filter(
  (resource) =>
    resource.includes("../ocr-runtime/**/*") || resource.includes(".venv"),
);

for (const resource of riskyResourceGlobs) {
  add(
    "fail",
    `Risky bundled resource glob: ${resource}`,
    "Do not package OCR development virtualenvs or cache directories into production app bundles.",
  );
}

const ocrRuntimeDir = join(repoRoot, "ocr-runtime");
const ocrRuntimeVenv = join(ocrRuntimeDir, ".venv");
if (existsSync(ocrRuntimeVenv)) {
  const size = directorySize(ocrRuntimeVenv);
  add(
    "warn",
    `Local OCR virtualenv exists: ${formatBytes(size)}`,
    "This is fine for development, but it must not be included by bundle.resource globs.",
  );
}

const requiredOcrRuntimeResources = [
  "../ocr-runtime/README.md",
  "../ocr-runtime/pyproject.toml",
  "../ocr-runtime/ocr_runtime/**/*",
];
for (const resource of requiredOcrRuntimeResources) {
  if (!resources.includes(resource)) {
    add(
      "warn",
      `OCR runtime source resource is not explicitly bundled: ${resource}`,
    );
  }
}

// ── Credential & tooling readiness ──
// The prerequisites that actually block `release:local-mac` (notary, updater
// signing, R2, HF, Gumroad). If a required tool is absent we WARN (can't verify
// here); if the tool is present but the credential is missing we FAIL with the
// fix. Network checks are time-boxed so the audit can't hang.
function hasBin(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const home = homedir();

function commandErrorDetail(error: unknown): string {
  const err = error as {
    message?: string;
    stderr?: Buffer | string;
    stdout?: Buffer | string;
  };
  const parts = [err.stderr, err.stdout]
    .map((part) => {
      if (!part) {
        return "";
      }
      return Buffer.isBuffer(part) ? part.toString("utf8") : String(part);
    })
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join("\n") || err.message || "";
}

function runNotaryHistory(
  args: string[],
): { ok: true } | { ok: false; detail: string } {
  try {
    execFileSync("/usr/bin/xcrun", ["notarytool", "history", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: commandErrorDetail(error) };
  }
}

function verifyNotaryReadiness(): void {
  if (!hasBin("xcrun")) {
    add("warn", "Cannot verify notarization credentials (xcrun unavailable).");
    return;
  }

  const notaryProfile = process.env.NOTARY_KEYCHAIN_PROFILE || "voxjot-notary";
  const applePassword =
    process.env.APPLE_PASSWORD || process.env.APPLE_ID_PASSWORD;

  if (process.env.APPLE_ID && applePassword && process.env.APPLE_TEAM_ID) {
    const result = runNotaryHistory([
      "--apple-id",
      process.env.APPLE_ID,
      "--team-id",
      process.env.APPLE_TEAM_ID,
      "--password",
      applePassword,
    ]);
    if (!result.ok) {
      add(
        "fail",
        "Apple ID environment notarization credentials are not accepted.",
        result.detail ||
          "Check APPLE_ID, APPLE_PASSWORD or APPLE_ID_PASSWORD, and APPLE_TEAM_ID.",
      );
    }
    return;
  }

  if (
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_ISSUER &&
    process.env.APPLE_API_KEY_PATH
  ) {
    const result = runNotaryHistory([
      "--key",
      process.env.APPLE_API_KEY_PATH,
      "--key-id",
      process.env.APPLE_API_KEY,
      "--issuer",
      process.env.APPLE_API_ISSUER,
    ]);
    if (!result.ok) {
      add(
        "fail",
        "App Store Connect API notarization credentials are not accepted.",
        result.detail ||
          "Check APPLE_API_KEY, APPLE_API_ISSUER, and APPLE_API_KEY_PATH.",
      );
    }
    return;
  }

  const result = runNotaryHistory(["--keychain-profile", notaryProfile]);
  if (!result.ok) {
    add(
      "fail",
      `Notarization profile "${notaryProfile}" is not accepted by notarytool.`,
      result.detail ||
        `Restore with bun run mac:setup-notary or set NOTARY_KEYCHAIN_PROFILE to a valid profile. If notarytool returns HTTP 403, accept the pending Apple Developer agreement before retrying.`,
    );
  }
}

verifyNotaryReadiness();

const updaterKey = join(home, ".tauri", "voxjot-updater.key");
const updaterPwd = join(home, ".tauri", "voxjot-updater.password");
if (!existsSync(updaterKey)) {
  add("fail", `Updater signing key missing: ${updaterKey}`);
}
if (!existsSync(updaterPwd)) {
  add(
    "fail",
    `Updater key password file missing: ${updaterPwd}`,
    'The password lives in this file, not env/keychain. Pass TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/voxjot-updater.password)".',
  );
}

if (!hasBin("wrangler")) {
  add("fail", "wrangler is not installed (needed for the R2 upload).");
} else {
  try {
    const buckets = execSync("wrangler r2 bucket list", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    });
    if (!buckets.includes("vox-jot-downloads")) {
      add(
        "fail",
        "Cloudflare R2 bucket vox-jot-downloads is not visible to wrangler.",
        "Re-auth wrangler with R2 access. Note: `wrangler whoami` omits the r2 scope even when R2 works — trust `wrangler r2 bucket list`.",
      );
    }
  } catch {
    add(
      "fail",
      "wrangler cannot reach R2 (bucket list failed).",
      "Run `wrangler login` (grant R2) or set an R2-scoped CLOUDFLARE_API_TOKEN.",
    );
  }
}

const hfToken = join(home, ".cache", "huggingface", "token");
if (
  !existsSync(hfToken) &&
  !process.env.HF_TOKEN &&
  !process.env.HUGGINGFACE_TOKEN
) {
  add(
    "warn",
    "Hugging Face token not found (~/.cache/huggingface/token or HF_TOKEN).",
    "Needed to push latest.json to IrieDinamik/vox-jot-releases.",
  );
}

if (!hasBin("gumroad")) {
  add(
    "warn",
    "gumroad CLI not installed (release verifies the Gumroad product URL).",
  );
}

const hasFailures = findings.some((finding) => finding.level === "fail");

if (findings.length === 0) {
  console.log("Distribution readiness audit passed with no findings.");
} else {
  for (const finding of findings) {
    const prefix = finding.level === "fail" ? "FAIL" : "WARN";
    console.log(`${prefix}: ${finding.message}`);
    if (finding.detail) {
      console.log(`  ${finding.detail}`);
    }
  }
}

process.exit(hasFailures ? 1 : 0);
