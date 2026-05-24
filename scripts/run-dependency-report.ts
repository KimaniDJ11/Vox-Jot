#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type CommandResult = {
  label: string;
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  missingTool?: string;
};

type FrontendUpdate = {
  packageName: string;
  current: string;
  update: string;
  latest: string;
};

type CargoUpdate = {
  packageName: string;
  current: string;
  update: string;
};

type CargoBlocked = {
  packageName: string;
  current: string;
  available: string;
};

const REPORT_PATH = join("reports", "dependency-report.md");
const ARCHIVE_DIR = join("reports", "archive");

const commands = {
  bunOutdated: {
    label: "Bun outdated",
    command: ["bun", "outdated"],
  },
  cargoDryRun: {
    label: "Cargo update dry run",
    command: [
      "cargo",
      "update",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--dry-run",
      "--verbose",
    ],
  },
  frontendAudit: {
    label: "Frontend audit",
    command: ["bun", "run", "audit:frontend"],
  },
  backendAudit: {
    label: "Backend audit",
    command: ["bun", "run", "audit:backend"],
  },
} as const;

function commandText(command: string[]): string {
  return command.join(" ");
}

async function runCommand(label: string, command: string[]): Promise<CommandResult> {
  const start = performance.now();

  try {
    const proc = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return {
      label,
      command,
      exitCode,
      stdout,
      stderr,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingTool = message.includes("ENOENT") ? command[0] : undefined;

    return {
      label,
      command,
      exitCode: null,
      stdout: "",
      stderr: message,
      durationMs: Math.round(performance.now() - start),
      missingTool,
    };
  }
}

function parseBunOutdated(output: string): FrontendUpdate[] {
  const updates: FrontendUpdate[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || /^[-|]+$/.test(trimmed.replace(/\s/g, ""))) {
      continue;
    }

    const columns = trimmed
      .slice(1, -1)
      .split("|")
      .map((column) => column.trim());

    if (columns.length !== 4 || columns[0] === "Package") {
      continue;
    }

    updates.push({
      packageName: columns[0],
      current: columns[1],
      update: columns[2],
      latest: columns[3],
    });
  }

  return updates;
}

function parseCargoCompatibleUpdates(output: string): CargoUpdate[] {
  const updates: CargoUpdate[] = [];

  for (const line of output.split("\n")) {
    const match = line.match(/^\s*Updating\s+(\S+)\s+v?(\S+)\s+->\s+v?(\S+)/);
    if (!match) {
      continue;
    }

    updates.push({
      packageName: match[1],
      current: match[2],
      update: match[3],
    });
  }

  return updates;
}

function parseCargoBlockedUpdates(output: string): CargoBlocked[] {
  const blocked: CargoBlocked[] = [];

  for (const line of output.split("\n")) {
    const match = line.match(
      /^\s*Unchanged\s+(\S+)\s+v?(\S+)\s+\(available:\s+v?([^)]+)\)/,
    );
    if (!match) {
      continue;
    }

    blocked.push({
      packageName: match[1],
      current: match[2],
      available: match[3],
    });
  }

  return blocked;
}

function markdownEscape(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return "_None found._";
  }

  const header = `| ${headers.map(markdownEscape).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${row.map((cell) => markdownEscape(cell)).join(" | ")} |`)
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}

function renderCommandStatus(results: CommandResult[]): string {
  return renderTable(
    ["Check", "Command", "Status", "Duration"],
    results.map((result) => [
      result.label,
      commandText(result.command),
      result.missingTool
        ? `missing tool: ${result.missingTool}`
        : result.exitCode === 0
          ? "ok"
          : `exit ${result.exitCode}`,
      `${result.durationMs} ms`,
    ]),
  );
}

function renderCommandOutput(result: CommandResult): string {
  const output = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n\n");

  if (!output) {
    return "_No output._";
  }

  return `\`\`\`text\n${output}\n\`\`\``;
}

function currentReportDate(): { isoDate: string; displayTime: string } {
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const displayTime = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: "America/New_York",
  }).format(now);

  return { isoDate, displayTime };
}

function renderReport(results: CommandResult[]): string {
  const bunUpdates = parseBunOutdated(results[0].stdout);
  const compatibleFrontend = bunUpdates.filter(
    (update) => update.update !== update.current,
  );
  const rangeConstrainedFrontend = bunUpdates.filter(
    (update) => update.latest !== update.update,
  );

  const cargoOutput = [results[1].stdout, results[1].stderr].join("\n");
  const cargoUpdates = parseCargoCompatibleUpdates(cargoOutput);
  const cargoBlocked = parseCargoBlockedUpdates(cargoOutput);

  const auditResults = [results[2], results[3]];
  const auditFindings = auditResults.filter((result) => result.exitCode !== 0);
  const missingTools = results.filter((result) => result.missingTool);
  const failedCommands = results.filter(
    (result) => !result.missingTool && result.exitCode !== 0,
  );
  const { isoDate, displayTime } = currentReportDate();

  const summaryRows = [
    ["Compatible frontend updates", String(compatibleFrontend.length)],
    ["Major/range-constrained frontend updates", String(rangeConstrainedFrontend.length)],
    ["Cargo-compatible lockfile updates", String(cargoUpdates.length)],
    ["Cargo packages blocked by constraints", String(cargoBlocked.length)],
    ["Audit commands with findings or failures", String(auditFindings.length)],
    ["Missing required tools", String(missingTools.length)],
  ];

  return `# Vox Jot Dependency Report

Generated: ${displayTime}

This report is informational only. It does not update dependency manifests, lockfiles, stage files, commit, push, or open pull requests.

## Summary

${renderTable(["Metric", "Count"], summaryRows)}

## Command Status

${renderCommandStatus(results)}

## Security and Advisory Findings

${
  auditFindings.length === 0
    ? "_No audit findings reported by the configured audit commands._"
    : auditFindings
        .map(
          (result) =>
            `### ${result.label}\n\nStatus: ${
              result.missingTool
                ? `missing tool: ${result.missingTool}`
                : `exit ${result.exitCode}`
            }\n\n${renderCommandOutput(result)}`,
        )
        .join("\n\n")
}

## Safe/Compatible Frontend Updates

${renderTable(
  ["Package", "Current", "Compatible Update", "Latest"],
  compatibleFrontend.map((update) => [
    update.packageName,
    update.current,
    update.update,
    update.latest,
  ]),
)}

## Major Frontend Updates Needing Review

${renderTable(
  ["Package", "Current", "Allowed Update", "Latest"],
  rangeConstrainedFrontend.map((update) => [
    update.packageName,
    update.current,
    update.update,
    update.latest,
  ]),
)}

## Cargo-Compatible Lockfile Updates

${renderTable(
  ["Package", "Current", "Compatible Update"],
  cargoUpdates.map((update) => [
    update.packageName,
    update.current,
    update.update,
  ]),
)}

## Cargo Packages Blocked by Constraints

${renderTable(
  ["Package", "Current", "Available"],
  cargoBlocked.map((update) => [
    update.packageName,
    update.current,
    update.available,
  ]),
)}

## Failed or Missing Checks

${
  failedCommands.length === 0 && missingTools.length === 0
    ? "_None._"
    : renderTable(
        ["Check", "Command", "Status"],
        [...failedCommands, ...missingTools].map((result) => [
          result.label,
          commandText(result.command),
          result.missingTool
            ? `missing tool: ${result.missingTool}`
            : `exit ${result.exitCode}`,
        ]),
      )
}

## Raw Command Output

${results
  .map((result) => `### ${result.label}\n\n${renderCommandOutput(result)}`)
  .join("\n\n")}

<!-- report-date: ${isoDate} -->
`;
}

async function main() {
  const results = await Promise.all(
    Object.values(commands).map(({ label, command }) => runCommand(label, command)),
  );
  const report = renderReport(results);
  const { isoDate } = currentReportDate();

  await mkdir(ARCHIVE_DIR, { recursive: true });
  await writeFile(REPORT_PATH, report);
  await writeFile(
    join(ARCHIVE_DIR, `dependency-report-${isoDate}.md`),
    report,
  );

  const bunUpdates = parseBunOutdated(results[0].stdout);
  const cargoOutput = [results[1].stdout, results[1].stderr].join("\n");
  const auditFindings = results.filter((result) =>
    ["Frontend audit", "Backend audit"].includes(result.label),
  ).filter((result) => result.exitCode !== 0);
  const missingTools = results.filter((result) => result.missingTool);

  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`Wrote ${join(ARCHIVE_DIR, `dependency-report-${isoDate}.md`)}`);
  console.log(`Frontend packages with newer versions: ${bunUpdates.length}`);
  console.log(
    `Cargo-compatible lockfile updates: ${parseCargoCompatibleUpdates(cargoOutput).length}`,
  );
  console.log(
    `Cargo packages blocked by constraints: ${parseCargoBlockedUpdates(cargoOutput).length}`,
  );
  console.log(`Audit commands with findings or failures: ${auditFindings.length}`);
  console.log(`Missing required tools: ${missingTools.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
