#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputPath = path.join(
  repoRoot,
  "src-tauri",
  "resources",
  "THIRD_PARTY_NOTICES.txt",
);
const checkOnly = process.argv.includes("--check");
const noticeFilePattern =
  /^(?:licen[cs]e|copying|notice|copyright|authors)(?:[._-].*)?$/i;
const ignoredDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "target",
  "__pycache__",
]);

type PackageJson = {
  name?: string;
  version?: string;
  license?: unknown;
  licenses?: unknown;
  author?: unknown;
  contributors?: unknown;
  repository?: string | { url?: string };
  homepage?: string;
};

type CargoPackage = {
  id: string;
  name: string;
  version: string;
  source: string | null;
  license: string | null;
  license_file: string | null;
  authors: string[];
  repository: string | null;
  homepage: string | null;
  manifest_path: string;
};

type CargoMetadata = {
  packages: CargoPackage[];
  resolve: { nodes: Array<{ id: string }> } | null;
  workspace_members: string[];
};

type NoticeDocument = {
  relativePath: string;
  content: string;
};

type PackageNotice = {
  ecosystem: "npm" | "Cargo";
  name: string;
  version: string;
  license: string;
  attribution: string;
  source: string;
  documents: NoticeDocument[];
};

function readUtf8(filePath: string): string {
  const buffer = readFileSync(filePath);
  if (buffer.includes(0)) {
    throw new Error(`Notice file is not UTF-8 text: ${filePath}`);
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    content = new TextDecoder("windows-1252", { fatal: true }).decode(buffer);
  }
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

function stableJson(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function repositoryUrl(repository: PackageJson["repository"]): string {
  if (typeof repository === "string") {
    return repository;
  }
  return repository?.url ?? "";
}

function findNoticeDocuments(packageRoot: string): NoticeDocument[] {
  const documents: NoticeDocument[] = [];
  const seenRealPaths = new Set<string>();
  const stack = [packageRoot];

  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) continue;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith("._")) continue;
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          stack.push(absolutePath);
        }
        continue;
      }

      const isFile =
        entry.isFile() ||
        (entry.isSymbolicLink() && statSync(absolutePath).isFile());
      if (!isFile || !noticeFilePattern.test(entry.name)) continue;
      const realPath = realpathSync(absolutePath);
      if (seenRealPaths.has(realPath)) continue;
      seenRealPaths.add(realPath);

      documents.push({
        relativePath: path
          .relative(packageRoot, absolutePath)
          .split(path.sep)
          .join("/"),
        content: readUtf8(absolutePath),
      });
    }
  }

  return documents.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function discoverNodePackages(nodeModulesPath: string): string[] {
  if (!existsSync(nodeModulesPath)) {
    throw new Error(
      "node_modules is missing. Run `bun install --frozen-lockfile` before generating notices.",
    );
  }

  const packageRoots: string[] = [];
  const seenRoots = new Set<string>();
  const nodeModulesQueue = [nodeModulesPath];

  while (nodeModulesQueue.length > 0) {
    const currentNodeModules = nodeModulesQueue.pop();
    if (!currentNodeModules || !existsSync(currentNodeModules)) continue;

    for (const entry of readdirSync(currentNodeModules, {
      withFileTypes: true,
    })) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(currentNodeModules, entry.name);
      const candidateRoots = entry.name.startsWith("@")
        ? readdirSync(entryPath, { withFileTypes: true })
            .filter((child) => child.isDirectory() || child.isSymbolicLink())
            .map((child) => path.join(entryPath, child.name))
        : [entryPath];

      for (const candidateRoot of candidateRoots) {
        const packageJsonPath = path.join(candidateRoot, "package.json");
        if (!existsSync(packageJsonPath)) continue;
        const realRoot = realpathSync(candidateRoot);
        if (seenRoots.has(realRoot)) continue;
        seenRoots.add(realRoot);
        packageRoots.push(realRoot);

        const nestedNodeModules = path.join(realRoot, "node_modules");
        if (existsSync(nestedNodeModules)) {
          nodeModulesQueue.push(nestedNodeModules);
        }
      }
    }
  }

  return packageRoots;
}

function collectNodeNotices(): PackageNotice[] {
  const notices: PackageNotice[] = [];
  const missingLicenses: string[] = [];

  for (const packageRoot of discoverNodePackages(
    path.join(repoRoot, "node_modules"),
  )) {
    const packageJson = JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as PackageJson;
    const name = packageJson.name ?? path.basename(packageRoot);
    const version = packageJson.version ?? "unknown";
    const documents = findNoticeDocuments(packageRoot);
    const license =
      stableJson(packageJson.license) || stableJson(packageJson.licenses);

    if (!license && documents.length === 0) {
      missingLicenses.push(`${name}@${version}`);
      continue;
    }

    notices.push({
      ecosystem: "npm",
      name,
      version,
      license: license || "See preserved upstream notice files below",
      attribution:
        stableJson(packageJson.author) ||
        stableJson(packageJson.contributors) ||
        "Not specified in package metadata",
      source:
        repositoryUrl(packageJson.repository) ||
        packageJson.homepage ||
        "Not specified in package metadata",
      documents,
    });
  }

  if (missingLicenses.length > 0) {
    throw new Error(
      `npm packages without license metadata or notice files:\n- ${missingLicenses.sort().join("\n- ")}`,
    );
  }

  return notices;
}

function cargoMetadata(): CargoMetadata {
  const result = spawnSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--format-version",
      "1",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `cargo metadata failed:\n${result.stderr || result.stdout || "unknown error"}`,
    );
  }

  return JSON.parse(result.stdout) as CargoMetadata;
}

function collectCargoNotices(): PackageNotice[] {
  const metadata = cargoMetadata();
  const workspaceMembers = new Set(metadata.workspace_members);
  const resolvedIds = new Set(
    metadata.resolve?.nodes.map((node) => node.id) ?? [],
  );
  const notices: PackageNotice[] = [];
  const missingLicenses: string[] = [];

  for (const packageInfo of metadata.packages) {
    if (
      workspaceMembers.has(packageInfo.id) ||
      (resolvedIds.size > 0 && !resolvedIds.has(packageInfo.id))
    ) {
      continue;
    }

    const packageRoot = path.dirname(packageInfo.manifest_path);
    const documents = findNoticeDocuments(packageRoot);
    if (packageInfo.license_file) {
      const declaredLicensePath = path.resolve(
        packageRoot,
        packageInfo.license_file,
      );
      if (!existsSync(declaredLicensePath)) {
        throw new Error(
          `Cargo package ${packageInfo.name}@${packageInfo.version} declares missing license_file ${packageInfo.license_file}`,
        );
      }
      const relativePath = path
        .relative(packageRoot, declaredLicensePath)
        .split(path.sep)
        .join("/");
      if (
        !documents.some((document) => document.relativePath === relativePath)
      ) {
        documents.push({
          relativePath,
          content: readUtf8(declaredLicensePath),
        });
        documents.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      }
    }

    if (!packageInfo.license && documents.length === 0) {
      missingLicenses.push(`${packageInfo.name}@${packageInfo.version}`);
      continue;
    }

    notices.push({
      ecosystem: "Cargo",
      name: packageInfo.name,
      version: packageInfo.version,
      license:
        packageInfo.license || "See preserved upstream notice files below",
      attribution:
        packageInfo.authors.join(", ") || "Not specified in package metadata",
      source:
        packageInfo.repository ||
        packageInfo.homepage ||
        packageInfo.source ||
        packageInfo.id,
      documents,
    });
  }

  if (missingLicenses.length > 0) {
    throw new Error(
      `Cargo packages without license metadata or notice files:\n- ${missingLicenses.sort().join("\n- ")}`,
    );
  }

  return notices;
}

function renderPackageNotices(
  title: string,
  packages: PackageNotice[],
): string {
  const sortedPackages = [...packages].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
  const sections = [`${title}\n${"=".repeat(title.length)}`];

  for (const packageNotice of sortedPackages) {
    const heading = `${packageNotice.name} ${packageNotice.version}`;
    const lines = [
      heading,
      "-".repeat(heading.length),
      `Ecosystem: ${packageNotice.ecosystem}`,
      `Declared license: ${packageNotice.license}`,
      `Upstream attribution: ${packageNotice.attribution}`,
      `Upstream source: ${packageNotice.source}`,
    ];

    if (packageNotice.documents.length === 0) {
      lines.push(
        "Preserved notice files: none published in the installed package; metadata above is reproduced verbatim.",
      );
    } else {
      for (const document of packageNotice.documents) {
        lines.push(
          "",
          `----- BEGIN UPSTREAM FILE: ${document.relativePath} -----`,
          document.content,
          `----- END UPSTREAM FILE: ${document.relativePath} -----`,
        );
      }
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

function renderBundledBinaryNotices(): string {
  const binaryRoot = path.join(repoRoot, "src-tauri", "resources", "bin");
  const documents = findNoticeDocuments(binaryRoot);
  if (documents.length === 0) {
    throw new Error(
      "Bundled binaries have no preserved license or notice files.",
    );
  }

  const title = "BUNDLED BINARY NOTICES";
  const lines = [title, "=".repeat(title.length)];
  for (const document of documents) {
    lines.push(
      "",
      `----- BEGIN UPSTREAM FILE: resources/bin/${document.relativePath} -----`,
      document.content,
      `----- END UPSTREAM FILE: resources/bin/${document.relativePath} -----`,
    );
  }
  return lines.join("\n");
}

function generateNoticeText(): {
  text: string;
  npmCount: number;
  cargoCount: number;
} {
  const projectLicense = readUtf8(path.join(repoRoot, "LICENSE"));
  const modelNotices = readUtf8(
    path.join(
      repoRoot,
      "src-tauri",
      "resources",
      "THIRD_PARTY_MODEL_NOTICES.md",
    ),
  );
  const npmNotices = collectNodeNotices();
  const cargoNotices = collectCargoNotices();

  const preamble = [
    "VOX JOT OPEN SOURCE AND THIRD-PARTY NOTICES",
    "===========================================",
    "",
    "This file is generated by scripts/generate-third-party-notices.ts.",
    "It preserves the copyright, attribution, license, and NOTICE material",
    "published with the application source, model manifest, bundled binaries,",
    "installed npm packages, and resolved Cargo packages. Do not edit it by hand.",
    "",
    "VOX JOT LICENSE AND PRESERVED UPSTREAM COPYRIGHT",
    "=================================================",
    projectLicense,
    "",
    "THIRD-PARTY MODEL AND RUNTIME NOTICES",
    "=====================================",
    modelNotices,
    "",
    renderBundledBinaryNotices(),
    "",
    renderPackageNotices("NPM PACKAGE NOTICES", npmNotices),
    "",
    renderPackageNotices("CARGO PACKAGE NOTICES", cargoNotices),
    "",
  ].join("\n");

  return {
    text: preamble,
    npmCount: npmNotices.length,
    cargoCount: cargoNotices.length,
  };
}

function main(): void {
  const generated = generateNoticeText();

  if (checkOnly) {
    if (!existsSync(outputPath)) {
      throw new Error(
        "Generated notice bundle is missing. Run `bun run licenses:generate`.",
      );
    }
    const current = readFileSync(outputPath, "utf8");
    if (current !== generated.text) {
      throw new Error(
        "Generated notice bundle is stale. Run `bun run licenses:generate` and commit the result.",
      );
    }
  } else {
    writeFileSync(outputPath, generated.text, "utf8");
  }

  const size = checkOnly
    ? statSync(outputPath).size
    : Buffer.byteLength(generated.text);
  console.log(
    `${checkOnly ? "Verified" : "Generated"} ${path.relative(repoRoot, outputPath)} (${generated.npmCount} npm packages, ${generated.cargoCount} Cargo packages, ${Math.round(size / 1024)} KiB).`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
