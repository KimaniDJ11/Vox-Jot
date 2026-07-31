import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

describe("Tauri command permissions", () => {
  it("keeps every registered app command in the app webview allowlist", () => {
    const root = process.cwd();
    const libSource = readFileSync(
      resolve(root, "src-tauri/src/lib.rs"),
      "utf8",
    );
    const permissionsSource = readFileSync(
      resolve(root, "src-tauri/permissions/app-commands.toml"),
      "utf8",
    );

    const commandStart = libSource.indexOf("collect_commands![");
    const commandEnd = libSource.indexOf("]);", commandStart);
    expect(commandStart).toBeGreaterThanOrEqual(0);
    expect(commandEnd).toBeGreaterThan(commandStart);

    const registeredCommands = [
      ...libSource
        .slice(commandStart, commandEnd)
        .matchAll(/^\s*(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*),\s*$/gm),
    ].map((match) => match[1]);

    const permissionBlock = permissionsSource.match(
      /\[\[permission\]\]\s*identifier = "app-commands"[\s\S]*?commands\.allow = \[([\s\S]*?)\n\]/,
    );
    expect(permissionBlock).not.toBeNull();
    const allowedCommands = [
      ...(permissionBlock?.[1] ?? "").matchAll(/"([A-Za-z_]\w*)"/g),
    ].map((match) => match[1]);

    expect(duplicateValues(registeredCommands)).toEqual([]);
    expect(duplicateValues(allowedCommands)).toEqual([]);
    expect([...new Set(allowedCommands)].sort()).toEqual(
      [...new Set(registeredCommands)].sort(),
    );
  });
});
