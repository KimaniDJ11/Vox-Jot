import React from "react";
import { Binary, Cpu, Package } from "lucide-react";

import type { CompactBadgeItem } from "@/components/ui/CompactOverflow";

type IdentityChipInput = {
  params?: string | null;
  arch?: string | null;
  format?: string | null;
};

const ARCH_PATTERNS: Array<[RegExp, string]> = [
  [/distil[-\s]?whisper/i, "Distil-Whisper"],
  [/whisperx/i, "WhisperX"],
  [/whisper/i, "Whisper"],
  [/qwen3[-_\s]?asr|qwen3[-_\s]?tts|qwen/i, "Qwen"],
  [/parakeet/i, "Parakeet"],
  [/moonshine/i, "Moonshine"],
  [/apple.*speech|speechanalyzer|vision/i, "Apple"],
  [/sensevoice/i, "SenseVoice"],
  [/gigaam/i, "GigaAM"],
  [/kokoro/i, "Kokoro"],
  [/chatterbox/i, "Chatterbox"],
  [/\bdia\b/i, "Dia"],
  [/\bcsm\b/i, "CSM"],
  [/spark/i, "Spark"],
  [/outetts|oute/i, "OuteTTS"],
  [/ming[-_\s]?omni/i, "Ming Omni"],
  [/kugel/i, "KugelAudio"],
  [/bark/i, "Bark"],
  [/fish[-_\s]?audio/i, "Fish Audio"],
  [/\blfm/i, "LFM Audio"],
  [/pocket/i, "Pocket TTS"],
  [/voxcpm/i, "VoxCPM"],
  [/voxtral/i, "Voxtral"],
  [/longcat/i, "LongCat"],
  [/soprano/i, "Soprano"],
  [/melotts|melo/i, "MeloTTS"],
  [/higgs/i, "Higgs Audio"],
  [/moss/i, "MOSS"],
  [/irodori/i, "Irodori"],
  [/indextts|index/i, "IndexTTS"],
  [/omnivoice/i, "OmniVoice"],
  [/vibevoice/i, "VibeVoice"],
  [/openvoice/i, "OpenVoice"],
  [/\bxtts\b|coqui/i, "XTTS"],
  [/supertonic/i, "Supertonic"],
  [/sherpa|piper/i, "Piper"],
  [/llama/i, "Llama"],
  [/\bphi\b/i, "Phi"],
  [/gemma/i, "Gemma"],
  [/mistral|mixtral/i, "Mistral"],
  [/granite|ibm/i, "Granite"],
  [/cohere/i, "Cohere"],
  [/pyannote/i, "pyannote"],
  [/sortformer|nemo/i, "Sortformer"],
  [/reverb/i, "Reverb"],
  [/polyvoice/i, "Polyvoice"],
  [/paddle/i, "PaddleOCR"],
  [/tesseract|tessdata/i, "Tesseract"],
  [/transformers/i, "Transformers"],
];

const FORMAT_PATTERNS: Array<[RegExp, string]> = [
  [/gguf|llama\.cpp/i, "GGUF"],
  [/ggml|whisper\.cpp/i, "GGML"],
  [/\bmlx\b|mlx[-_\s]?audio/i, "MLX"],
  [/core\s?ml/i, "Core ML"],
  [/onnx|sherpa/i, "ONNX"],
  [/tessdata|tesseract/i, "Tessdata"],
  [/safetensors|hf[_\s-]?snapshot|hugging\s?face/i, "HF snapshot"],
  [/pytorch|torch/i, "PyTorch"],
];

export function buildModelIdentityChips({
  params,
  arch,
  format,
}: IdentityChipInput): CompactBadgeItem[] {
  return [
    params
      ? {
          id: "identity-params",
          label: `Params ${params}`,
          variant: "secondary" as const,
          icon: <Binary className="h-3 w-3" />,
          detail: "Published parameter count when known.",
        }
      : null,
    arch
      ? {
          id: "identity-arch",
          label: `Arch ${arch}`,
          variant: "secondary" as const,
          icon: <Cpu className="h-3 w-3" />,
          detail: "Model codebase or family this entry comes from.",
        }
      : null,
    format
      ? {
          id: "identity-format",
          label: `Format ${format}`,
          variant: "secondary" as const,
          icon: <Package className="h-3 w-3" />,
          detail: "Model artifact or package format Vox Jot runs.",
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];
}

export function mergeSizeWithIdentityChips(
  identityChips: CompactBadgeItem[],
  sizeChip: CompactBadgeItem | null | undefined,
): CompactBadgeItem[] {
  const params = identityChips.filter((chip) => chip.id === "identity-params");
  const remainingIdentity = identityChips.filter(
    (chip) => chip.id !== "identity-params",
  );
  return [...params, sizeChip, ...remainingIdentity].filter(
    Boolean,
  ) as CompactBadgeItem[];
}

export function dedupeCapabilityChips(
  chips: CompactBadgeItem[],
): CompactBadgeItem[] {
  const seen = new Set<string>();
  const seenIdentityConcepts = new Set<string>();
  const deduped: CompactBadgeItem[] = [];

  for (const chip of chips) {
    const key = normalizeExactChipLabel(chip.label);
    if (!key || seen.has(key)) continue;

    const identityConcept = identityConceptForChip(chip);
    const secondaryConcept = normalizeSemanticChipLabel(chip.label);
    if (
      !identityConcept &&
      isSecondaryMetadataChip(chip) &&
      seenIdentityConcepts.has(secondaryConcept)
    ) {
      continue;
    }

    seen.add(key);
    if (identityConcept) seenIdentityConcepts.add(identityConcept);
    deduped.push(chip);
  }

  return deduped;
}

export function inferParameterClass(
  values: Array<string | null | undefined>,
): string | null {
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  const exact =
    haystack.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*([bm])(?:\b|(?=[-_]))/i) ??
    haystack.match(/(?:^|[^a-z0-9])(\d+)-(\d+)([bm])(?:\b|(?=[-_]))/i);

  if (exact) {
    if (exact.length === 4) {
      return `${Number(`${exact[1]}.${exact[2]}`).toString()}${exact[3].toUpperCase()}`;
    }
    return `${Number(exact[1]).toString()}${exact[2].toUpperCase()}`;
  }

  return null;
}

export function inferArchitectureLabel(
  values: Array<string | null | undefined>,
  fallback?: string | null,
): string | null {
  const haystack = values.filter(Boolean).join(" ");
  for (const [pattern, label] of ARCH_PATTERNS) {
    if (pattern.test(haystack)) return label;
  }
  return normalizeShortLabel(fallback);
}

export function inferRuntimeFormat(
  values: Array<string | null | undefined>,
  fallback?: string | null,
): string | null {
  const haystack = values.filter(Boolean).join(" ");
  for (const [pattern, label] of FORMAT_PATTERNS) {
    if (pattern.test(haystack)) return label;
  }
  const fallbackValue = fallback?.trim();
  if (fallbackValue) {
    for (const [pattern, label] of FORMAT_PATTERNS) {
      if (pattern.test(fallbackValue)) return label;
    }
  }
  return null;
}

function normalizeShortLabel(value?: string | null): string | null {
  const normalized = value
    ?.replace(/\bruntime\b/gi, "")
    .replace(/\bengine\b/gi, "")
    .replace(/\bprovider\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function normalizeExactChipLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSemanticChipLabel(value: string): string {
  return normalizeExactChipLabel(value).replace(/^(params|arch|format)\s+/, "");
}

function identityConceptForChip(chip: CompactBadgeItem): string | null {
  if (chip.id !== "identity-arch" && chip.id !== "identity-format") {
    return null;
  }
  return normalizeSemanticChipLabel(chip.label);
}

function isSecondaryMetadataChip(chip: CompactBadgeItem): boolean {
  return (
    chip.id === "capability-engine" ||
    chip.id === "capability-backend" ||
    chip.id === "capability-source"
  );
}
