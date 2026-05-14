import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
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
    "fail",
    "Windows release builds are configured to ship unsigned.",
    "Set the windows-latest release matrix entry to sign-binaries: true before broad distribution.",
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
