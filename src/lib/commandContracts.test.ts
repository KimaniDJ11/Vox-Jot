import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commands } from "@/bindings";
import type { commands as publishedCommands } from "../../tests/contracts/native-api.v1";

// TypeScript checks argument and response shapes structurally, so moving a
// response into a named type cannot hide a breaking change or fail spuriously.
const publicApi: typeof publishedCommands = commands;

describe("published native command contracts", () => {
  const source = readFileSync("tests/contracts/native-api.v1.ts", "utf8");

  it("preserves every published command name, arguments and return type", () => {
    const names = [...source.matchAll(/^\s+(\w+): \(/gm)];
    expect(names).toHaveLength(381);
    for (const match of names) {
      expect(publicApi, match[1]).toHaveProperty(match[1]);
    }
  });

  it("permits every published command through the app capability", () => {
    const permissions = readFileSync(
      "src-tauri/permissions/app-commands.toml",
      "utf8",
    );
    for (const match of source.matchAll(/\("([a-z][a-z_0-9]+)"(?:,|\))/g)) {
      expect(permissions, match[1]).toContain(`"${match[1]}"`);
    }
  });
});

describe("published local HTTP API routes", () => {
  it("preserves every route and method", () => {
    const contract = JSON.parse(
      readFileSync("tests/contracts/http-api.v1.json", "utf8"),
    ) as {
      routes: { path: string; methods: string[] }[];
    };
    const source = readFileSync("src-tauri/src/http_api/mod.rs", "utf8");
    const routes = new Map(
      [
        ...source.matchAll(
          /\.route\(\s*"([^"]+)"\s*,([\s\S]*?)(?=\n\s*\.route|\n\s*\.layer|\n\s*\.with_state)/g,
        ),
      ].map((match) => [
        match[1],
        [...match[2].matchAll(/\b(get|post|put|delete)\(/g)].map(
          (method) => method[1],
        ),
      ]),
    );
    for (const { path, methods } of contract.routes) {
      expect(routes.get(path), path).toEqual(methods);
    }
  });
});
