import { existsSync, readFileSync } from "node:fs";
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

const validDomains = new Set([
  "stt",
  "tts",
  "ocr",
  "speech_analysis",
  "audio_cleanup",
]);
const validStatuses = new Set([
  "allowed_with_notice",
  "allowed_with_attribution",
  "allowed_with_attribution_gated",
  "allowed_with_notice_gated",
  "needs_review",
  "non_commercial",
  "research_only",
  "commercial_license_required",
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

  if (entry.commercial_status === "commercial_license_required") {
    if (!entry.ui_acknowledgement_required) {
      warn(
        `Commercial-license model ${entry.id} must require a UI acknowledgement gate.`,
      );
    }
    if (!entry.required_notices.includes("commercial_license_confirmation")) {
      warn(
        `Commercial-license model ${entry.id} must include commercial_license_confirmation in required_notices.`,
      );
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

const extractRecordGates = (
  source: string,
  recordName: string,
): Array<{ id: string; kind: string | null }> => {
  const start = source.indexOf(`const ${recordName}`);
  if (start < 0) return [];
  const end = source.indexOf("};", start);
  if (end < 0) return [];
  const body = source.slice(start, end);
  const entries = [...body.matchAll(/"([^"]+)":\s*\{/g)];
  return entries.map((match, index) => {
    const blockStart = (match.index ?? 0) + match[0].length;
    const blockEnd =
      index + 1 < entries.length
        ? (entries[index + 1].index ?? body.length)
        : body.length;
    const block = body.slice(blockStart, blockEnd);
    const kind = block.match(/\bkind:\s*"([^"]+)"/)?.[1] ?? null;
    return { id: match[1], kind };
  });
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
    ["NO_EMOTION_ID", "no_emotion"],
    ["EMOTION2VEC_PLUS_LARGE_ID", "emotion2vec-plus-large"],
  ]);
  return [...source.matchAll(/descriptor\(\s*(?:"([^"]+)"|([A-Z_]+))/g)]
    .map((match) => match[1] ?? constantIds.get(match[2] ?? "") ?? null)
    .filter((id): id is string => Boolean(id));
};

const ignoredCatalogIds = new Set([
  "current_dictation_engine",
  "no_speaker_labels",
  "no_emotion",
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

const uiGateSources = [
  {
    source: read(
      "src/components/settings/general/listen/sections/EngineLibraryPanel.tsx",
    ),
    recordName: "TTS_LICENSE_ACKNOWLEDGEMENT_GATES",
  },
  {
    source: read("src/components/model-hub/SpeechAnalysisEnginesSection.tsx"),
    recordName: "SPEECH_ANALYSIS_LICENSE_GATES",
  },
  {
    source: read("src/components/model-hub/OcrEnginesSection.tsx"),
    recordName: "OCR_LICENSE_ACKNOWLEDGEMENT_GATES",
  },
];

const uiGateKindsById = new Map<string, string | null>();
for (const { source, recordName } of uiGateSources) {
  for (const gate of extractRecordGates(source, recordName)) {
    if (uiGateKindsById.has(gate.id)) {
      warn(`Duplicate UI acknowledgement gate id: ${gate.id}.`);
    }
    uiGateKindsById.set(gate.id, gate.kind);
  }
}

const uiGateIds = new Set(uiGateKindsById.keys());

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

for (const entry of manifest.entries) {
  if (entry.commercial_status !== "commercial_license_required") continue;
  const gateIds = entry.catalog_ids?.length ? entry.catalog_ids : [entry.id];
  for (const catalogId of gateIds) {
    if (uiGateKindsById.get(catalogId) !== "commercial_license_required") {
      warn(
        `Commercial-license model ${entry.id} must use a commercial_license_required UI gate for ${catalogId}.`,
      );
    }
  }
}

const bundledBinaryNotices = [
  {
    binary: "src-tauri/resources/bin/macos-aarch64/polyvoice",
    notice: "src-tauri/resources/bin/macos-aarch64/LICENSE.polyvoice.txt",
    requiredText: "Copyright (c) 2026 Evgeny Khodzitsky",
  },
];
for (const bundled of bundledBinaryNotices) {
  if (!existsSync(path.join(root, bundled.binary))) continue;
  const noticePath = path.join(root, bundled.notice);
  if (!existsSync(noticePath)) {
    warn(`Bundled binary ${bundled.binary} is missing ${bundled.notice}.`);
    continue;
  }
  if (!readFileSync(noticePath, "utf8").includes(bundled.requiredText)) {
    warn(
      `Bundled binary notice ${bundled.notice} is missing its upstream copyright.`,
    );
  }
}

for (const runtimeBuilder of [
  "scripts/build-speech-runtime.sh",
  "scripts/build-ocr-runtime.sh",
]) {
  const source = read(runtimeBuilder);
  if (
    !source.includes("collect-python-runtime-notices.py") ||
    !source.includes("THIRD_PARTY_NOTICES.txt")
  ) {
    warn(`${runtimeBuilder} must preserve Python runtime dependency notices.`);
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
