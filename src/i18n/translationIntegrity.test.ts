import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES_DIR = path.join(process.cwd(), "src", "i18n", "locales");
const REFERENCE_LOCALE = "en";

type TranslationTree = Record<string, unknown>;

function runTranslationScript(script: string, args: string[] = []) {
  try {
    execFileSync("bun", [script, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const failure = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      message: string;
    };
    const output = [failure.stdout, failure.stderr]
      .filter(Boolean)
      .map((value) => value?.toString())
      .join("\n");
    throw new Error(`${script} failed:\n${output || failure.message}`);
  }
}

function localeFiles() {
  return fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((locale) => ({
      locale,
      filePath: path.join(LOCALES_DIR, locale, "translation.json"),
    }));
}

function readTranslation(filePath: string): TranslationTree {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as TranslationTree;
}

function flattenStrings(
  value: unknown,
  prefix: string[] = [],
  output = new Map<string, string>(),
) {
  if (typeof value === "string") {
    output.set(prefix.join("."), value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      flattenStrings(item, [...prefix, String(index)], output),
    );
    return output;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      flattenStrings(child, [...prefix, key], output);
    }
  }

  return output;
}

function interpolationTokens(value: string) {
  const tokens = new Set<string>();
  for (const match of value.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)) {
    tokens.add(match[1]);
  }
  return [...tokens].sort();
}

describe("translation integrity", () => {
  it("keeps every locale structurally aligned with English", () => {
    runTranslationScript("scripts/check-translations.ts");
  });

  it("fails when non-English locales copy English user-facing text", () => {
    runTranslationScript("scripts/audit-untranslated-locales.ts", [
      "--fail-on-untranslated",
    ]);
  });

  it("preserves interpolation placeholders in every translated string", () => {
    const files = localeFiles();
    const referencePath = files.find(
      (entry) => entry.locale === REFERENCE_LOCALE,
    )?.filePath;
    expect(referencePath).toBeTruthy();

    const reference = flattenStrings(readTranslation(referencePath!));
    const failures: string[] = [];

    for (const { locale, filePath } of files) {
      if (locale === REFERENCE_LOCALE) continue;
      const translation = flattenStrings(readTranslation(filePath));

      for (const [keyPath, englishValue] of reference.entries()) {
        const translatedValue = translation.get(keyPath);
        if (translatedValue === undefined) continue;

        const expected = interpolationTokens(englishValue);
        const actual = interpolationTokens(translatedValue);
        if (expected.join("\u0000") !== actual.join("\u0000")) {
          failures.push(
            `${locale}:${keyPath} expected {{${expected.join("}}, {{")}}} but found {{${actual.join("}}, {{")}}}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
