import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, "..", "src", "i18n", "locales");
const REFERENCE_LANG = "en";
const SAMPLE_LIMIT = 20;

type TranslationTree = Record<string, unknown>;
type FlatTranslations = Map<string, string>;

const EXACT_VALUE_ALLOWLIST = new Set([
  "",
  "API",
  "ASR",
  "Auto",
  "CPU",
  "CPU%",
  "Diarize",
  "GPU",
  "GGUF",
  "JSON",
  "LLM",
  "OCR",
  "PersonaPlex",
  "RTF",
  "STT",
  "TTS",
  "VAD",
  "Vox Jot",
  "WER",
]);

const PATH_ALLOWLIST = [
  /^modelHub\.ocr\.vendor\./,
  /^onboarding\.modelSelection\.models\./,
  /^settings\.advanced\.theme\.options\.[^.]+\.id$/,
  /^settings\.debug\.paths\./,
  /^testing\.(?:llm|tts)\./,
];

const VALUE_PATTERNS_ALLOWLIST = [
  /^[A-Z0-9_.:/+ -]+$/,
  /^Ctrl\+/,
  /^Shift\+/,
  /^\{\{[^}]+\}\}$/,
  /^https?:\/\//,
  /^[a-z0-9_.-]+\.(json|onnx|mlmodelc|gguf)$/i,
];

function readJson(filePath: string): TranslationTree {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as TranslationTree;
}

function getLocaleFiles(): Map<string, string> {
  const entries = fs.readdirSync(LOCALES_DIR, { withFileTypes: true });
  const localeFiles = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(entry.name)) {
      continue;
    }
    localeFiles.set(
      entry.name,
      path.join(LOCALES_DIR, entry.name, "translation.json"),
    );
  }

  return localeFiles;
}

function flattenTranslations(
  value: unknown,
  prefix: string[] = [],
  output: FlatTranslations = new Map(),
): FlatTranslations {
  if (typeof value === "string") {
    output.set(prefix.join("."), value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      flattenTranslations(item, [...prefix, String(index)], output),
    );
    return output;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      flattenTranslations(child, [...prefix, key], output);
    }
  }

  return output;
}

function isAllowedIdenticalValue(keyPath: string, value: string): boolean {
  const trimmed = value.trim();

  if (EXACT_VALUE_ALLOWLIST.has(trimmed)) {
    return true;
  }

  if (PATH_ALLOWLIST.some((pattern) => pattern.test(keyPath))) {
    return true;
  }

  return VALUE_PATTERNS_ALLOWLIST.some((pattern) => pattern.test(trimmed));
}

function auditUntranslatedLocales(): void {
  const localeFiles = getLocaleFiles();
  const referencePath = localeFiles.get(REFERENCE_LANG);

  if (!referencePath) {
    console.error(`Missing ${REFERENCE_LANG}/translation.json`);
    process.exit(1);
  }

  const reference = flattenTranslations(readJson(referencePath));
  const languages = [...localeFiles.keys()]
    .filter((language) => language !== REFERENCE_LANG)
    .sort();

  let totalCandidates = 0;
  const failOnUntranslated = process.argv.includes("--fail-on-untranslated");

  console.log("\nUntranslated locale value audit\n");
  console.log(`Reference keys: ${reference.size}`);
  console.log("Comparing non-English values against English source values.");
  console.log("Exact technical tokens and known identifier paths are ignored.\n");

  for (const language of languages) {
    const localePath = localeFiles.get(language);
    if (!localePath) continue;

    const locale = flattenTranslations(readJson(localePath));
    const untranslated: Array<[string, string]> = [];

    for (const [keyPath, englishValue] of reference.entries()) {
      const localeValue = locale.get(keyPath);
      if (
        typeof localeValue === "string" &&
        localeValue === englishValue &&
        !isAllowedIdenticalValue(keyPath, englishValue)
      ) {
        untranslated.push([keyPath, englishValue]);
      }
    }

    totalCandidates += untranslated.length;
    const status = untranslated.length === 0 ? "OK" : "NEEDS WORK";
    console.log(
      `${language.padEnd(5)} ${status.padEnd(10)} ${String(
        untranslated.length,
      ).padStart(4)} copied English values`,
    );

    for (const [keyPath, value] of untranslated.slice(0, SAMPLE_LIMIT)) {
      console.log(`  - ${keyPath}: ${JSON.stringify(value)}`);
    }
    if (untranslated.length > SAMPLE_LIMIT) {
      console.log(`  ... ${untranslated.length - SAMPLE_LIMIT} more`);
    }
    if (untranslated.length > 0) {
      console.log("");
    }
  }

  if (totalCandidates > 0) {
    console.log(`${totalCandidates} copied English values found.`);
    if (failOnUntranslated) {
      process.exit(1);
    }
  } else {
    console.log("No copied English values found outside the allowlist.");
  }
}

auditUntranslatedLocales();
