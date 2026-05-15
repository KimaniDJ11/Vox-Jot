import { readFileSync } from "node:fs";
import path from "node:path";

type LicenseEntry = {
  id: string;
  domains: string[];
  name: string;
  upstream: string;
  distribution_source: string;
  license: string;
  commercial_status: string;
  required_notices: string[];
  catalog_ids?: string[];
  ui_acknowledgement_required?: boolean;
};

type LicenseManifest = {
  schema_version: number;
  notice_file: string;
  entries: LicenseEntry[];
};

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

const manifest = JSON.parse(
  read("src-tauri/resources/models.licenses.json"),
) as LicenseManifest;

const failures: string[] = [];
const warn = (message: string) => failures.push(message);

const requiredFields: Array<keyof LicenseEntry> = [
  "id",
  "domains",
  "name",
  "upstream",
  "distribution_source",
  "license",
  "commercial_status",
  "required_notices",
];

const validDomains = new Set(["stt", "tts", "ocr", "speech_analysis"]);
const validStatuses = new Set([
  "allowed_with_notice",
  "allowed_with_attribution",
  "allowed_with_attribution_gated",
  "allowed_with_notice_gated",
  "needs_review",
  "non_commercial",
  "research_only",
  "restricted_custom",
  "platform_runtime",
]);

if (manifest.schema_version !== 1) {
  warn("models.licenses.json schema_version must be 1.");
}

if (!manifest.notice_file) {
  warn("models.licenses.json must point at a notice_file.");
}

const entriesById = new Map<string, LicenseEntry>();
const coveredCatalogIds = new Set<string>();
const acknowledgementRequiredIds = new Set<string>();

for (const entry of manifest.entries) {
  for (const field of requiredFields) {
    if (entry[field] === undefined || entry[field] === null) {
      warn(`License entry ${entry.id ?? "<missing id>"} is missing ${field}.`);
    }
  }

  if (entriesById.has(entry.id)) {
    warn(`Duplicate license entry id: ${entry.id}.`);
  }
  entriesById.set(entry.id, entry);
  coveredCatalogIds.add(entry.id);
  for (const catalogId of entry.catalog_ids ?? []) {
    coveredCatalogIds.add(catalogId);
  }

  if (
    !entry.domains?.length ||
    entry.domains.some((domain) => !validDomains.has(domain))
  ) {
    warn(`License entry ${entry.id} has invalid domains.`);
  }
  if (!validStatuses.has(entry.commercial_status)) {
    warn(
      `License entry ${entry.id} has unknown commercial_status ${entry.commercial_status}.`,
    );
  }
  if (!entry.required_notices?.length) {
    warn(`License entry ${entry.id} must list required_notices.`);
  }
  if (
    entry.commercial_status.includes("attribution") &&
    !entry.required_notices.includes("model_attribution")
  ) {
    warn(
      `License entry ${entry.id} requires attribution but lacks model_attribution notice.`,
    );
  }
  if (
    entry.commercial_status !== "platform_runtime" &&
    !entry.required_notices.some((notice) =>
      ["license_text", "license_link", "platform_terms"].includes(notice),
    )
  ) {
    warn(`License entry ${entry.id} must preserve a license text/link notice.`);
  }

  if (entry.ui_acknowledgement_required) {
    const gateIds = entry.catalog_ids?.length ? entry.catalog_ids : [entry.id];
    for (const catalogId of gateIds) {
      acknowledgementRequiredIds.add(catalogId);
    }
  }
}

const noticeText = read("src-tauri/resources/THIRD_PARTY_MODEL_NOTICES.md");
for (const entry of manifest.entries) {
  if (
    !noticeText.includes(entry.name) &&
    !noticeText.includes(entry.id) &&
    !noticeText.includes(entry.upstream)
  ) {
    warn(`Notice file does not mention ${entry.id} (${entry.name}).`);
  }
}

const extractRecordKeys = (source: string, recordName: string): string[] => {
  const start = source.indexOf(`const ${recordName}`);
  if (start < 0) return [];
  const end = source.indexOf("};", start);
  if (end < 0) return [];
  return [...source.slice(start, end).matchAll(/"([^"]+)":\s*\{/g)].map(
    (match) => match[1],
  );
};

const extractRustStringField = (source: string, field: string): string[] =>
  [...source.matchAll(new RegExp(`^\\s*${field}: "([^"]+)"`, "gm"))].map(
    (match) => match[1],
  );

const extractSpeechAnalysisIds = (): string[] => {
  const source = read("src-tauri/src/speech_analysis.rs");
  const constantIds = new Map([
    ["CURRENT_DICTATION_ASR_ID", "current_dictation_engine"],
    ["NO_DIARIZATION_ID", "no_speaker_labels"],
  ]);
  return [...source.matchAll(/descriptor\(\s*(?:"([^"]+)"|([A-Z_]+))/g)]
    .map((match) => match[1] ?? constantIds.get(match[2] ?? "") ?? null)
    .filter((id): id is string => Boolean(id));
};

const ignoredCatalogIds = new Set([
  "current_dictation_engine",
  "no_speaker_labels",
  "system-voice",
  "local-openai-compatible",
]);

const catalogIds = new Set<string>();

for (const id of [
  ...extractRustStringField(read("src-tauri/src/tts/catalog.rs"), "model_id"),
  ...extractRustStringField(read("src-tauri/src/tts/catalog.rs"), "id").filter(
    (id) => id.startsWith("tts-"),
  ),
  ...extractRustStringField(read("src-tauri/src/ocr_models.rs"), "id"),
  ...extractSpeechAnalysisIds(),
]) {
  if (!ignoredCatalogIds.has(id)) {
    catalogIds.add(id);
  }
}

for (const id of [...catalogIds].sort()) {
  if (!coveredCatalogIds.has(id)) {
    warn(`Catalog model ${id} is not covered by models.licenses.json.`);
  }
}

const uiGateIds = new Set<string>([
  ...extractRecordKeys(
    read(
      "src/components/settings/general/listen/sections/EngineLibraryPanel.tsx",
    ),
    "TTS_LICENSE_ACKNOWLEDGEMENT_GATES",
  ),
  ...extractRecordKeys(
    read("src/components/model-hub/SpeechAnalysisEnginesSection.tsx"),
    "SPEECH_ANALYSIS_LICENSE_GATES",
  ),
  ...extractRecordKeys(
    read("src/components/model-hub/OcrEnginesSection.tsx"),
    "OCR_LICENSE_ACKNOWLEDGEMENT_GATES",
  ),
]);

for (const id of [...acknowledgementRequiredIds].sort()) {
  if (!uiGateIds.has(id)) {
    warn(
      `Restricted model ${id} requires a UI acknowledgement gate but has none.`,
    );
  }
}

for (const id of [...uiGateIds].sort()) {
  if (!coveredCatalogIds.has(id)) {
    warn(`UI acknowledgement gate ${id} has no manifest coverage.`);
  }
}

const mirrorModelsScript = read("scripts/mirror-models.sh");
if (
  !mirrorModelsScript.includes("download_hf_notice_metadata") ||
  !mirrorModelsScript.includes("VOX_JOT_UPSTREAM.json")
) {
  warn("scripts/mirror-models.sh must preserve upstream notice metadata.");
}

const mirrorTtsScript = read("scripts/mirror-tts-assets.sh");
if (
  !mirrorTtsScript.includes("download_sherpa_notice_metadata") ||
  !mirrorTtsScript.includes("VOX_JOT_UPSTREAM.json")
) {
  warn("scripts/mirror-tts-assets.sh must preserve upstream notice metadata.");
}

const ocrMirrorScript = read("scripts/upload_ocr_mirrors_to_hf.py");
if (
  !ocrMirrorScript.includes("write_mirror_metadata") ||
  !ocrMirrorScript.includes("VOX_JOT_UPSTREAM.json") ||
  !ocrMirrorScript.includes("upstream-notices")
) {
  warn(
    "scripts/upload_ocr_mirrors_to_hf.py must write mirror cards and upstream notices.",
  );
}

if (failures.length > 0) {
  console.error("Model license compliance check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Model license compliance check passed (${manifest.entries.length} entries, ${catalogIds.size} catalog ids).`,
);
