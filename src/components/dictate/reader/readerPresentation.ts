import type { ReaderDocumentKind } from "@/lib/readerLibraryStorage";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";

export const READER_LANGUAGE_OPTIONS = [
  "auto",
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "pl",
  "ru",
  "uk",
  "tr",
  "ar",
  "hi",
  "zh",
  "ja",
  "ko",
  "vi",
] as const;

const READER_LANGUAGE_LABELS: Record<
  (typeof READER_LANGUAGE_OPTIONS)[number],
  string
> = {
  auto: "Auto",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  tr: "Turkish",
  ar: "Arabic",
  hi: "Hindi",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  vi: "Vietnamese",
};

export function splitReaderWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function readerLanguageLabel(value: string): string {
  return (
    READER_LANGUAGE_LABELS[value as (typeof READER_LANGUAGE_OPTIONS)[number]] ??
    value.toUpperCase()
  );
}

const readerPlaybackRateOptions = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function kindLabel(kind: ReaderDocumentKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "docx":
      return "DOCX";
    case "epub":
      return "EPUB";
    case "markdown":
      return "MD";
    case "text":
      return "TXT";
  }
}

export function readerPresetLabel(preset: TtsVoicePreset | null): string {
  return (
    preset?.label?.trim() ||
    preset?.voice_label_snapshot?.trim() ||
    preset?.model_id ||
    preset?.id ||
    ""
  );
}

export function clampIndex(
  value: number | null | undefined,
  maxExclusive: number,
) {
  if (!Number.isFinite(value) || maxExclusive <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(value ?? 0), maxExclusive - 1));
}

export function normalizeReaderPlaybackRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return readerPlaybackRateOptions.includes(value) ? value : 1;
}
