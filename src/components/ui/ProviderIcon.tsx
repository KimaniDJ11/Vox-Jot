import React from "react";
import type { EngineType } from "@/bindings";

// ---------- Types ----------

export type ProviderIconSize = "xs" | "sm" | "md" | "lg";

interface ProviderIconProps {
  providerId: string;
  size?: ProviderIconSize;
  className?: string;
}

// ---------- Size Configurations ----------

const SIZE_CONFIG = {
  xs: { px: 16, font: 9, r: 3.5 },
  sm: { px: 20, font: 11, r: 4.5 },
  md: { px: 24, font: 13, r: 5.5 },
  lg: { px: 32, font: 17, r: 7 },
} as const;

// ---------- SVG Mark Components ----------

function OpenAIMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.6;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={color}>
      <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zM3.6 18.3a4.47 4.47 0 0 1-.53-3.01l.14.08 4.78 2.76c.24.14.54.14.78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06l-4.83 2.79a4.5 4.5 0 0 1-6.15-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.97V11.6c0 .28.15.54.39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.86-5.84-3.37 2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.5 4.5 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.68zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.79.79 0 0 0-.4.68zm1.1-2.36 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z" />
    </svg>
  );
}

function AppleMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.6;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={color}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.81-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function NvidiaMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.62;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={color}>
      <path d="M8.94 7.13v1.44c-.09.01-.17.01-.26.02C5.9 8.96 3.86 11.2 3.86 12c0 1.35 2.34 3.62 5.04 3.62.1 0 .04 0 .04 0v1.54c-4.14-.21-7.04-2.8-7.04-5.16s3.02-4.83 7.04-4.87zm.84-2.1v2.04l.36-.03c4.68-.21 7.32 3.03 7.32 4.53 0 1.28-1.2 2.66-2.76 3.44l-.48.24v-3.08a3.81 3.81 0 0 0-3.12-3.72L9.78 8.2V3.21l.36.03A11.2 11.2 0 0 1 18 7.08c-.24-.24 2.04 2.22 2.04 4.56 0 3.06-3.78 5.7-7.8 5.7h-.36v1.08H9.78v-1.38l-.6-.03c-5.88-.54-7.98-4.1-7.98-5.57 0-1.02.78-3.08 4.38-4.46a9.3 9.3 0 0 1 3.36-.62l.84-.03v-1.3z" />
    </svg>
  );
}

function MistralMark({ size }: { size: number; color: string }) {
  const s = size * 0.55;
  const barH = s / 7;
  const colors = ["#F7D046", "#F2A73B", "#EE792F", "#EB5829", "#E8362A"];
  return (
    <svg width={s} height={s} viewBox="0 0 20 20">
      {colors.map((c, i) => (
        <rect
          key={c}
          x={2}
          y={2 + i * (barH + 0.8)}
          width={16}
          height={barH}
          rx={barH / 3}
          fill={c}
        />
      ))}
    </svg>
  );
}

function MicrosoftMark({ size }: { size: number; color: string }) {
  // Iconic 4-square Microsoft logo with brand colors.
  const s = size * 0.6;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <rect x={1} y={1} width={10} height={10} fill="#F25022" />
      <rect x={13} y={1} width={10} height={10} fill="#7FBA00" />
      <rect x={1} y={13} width={10} height={10} fill="#00A4EF" />
      <rect x={13} y={13} width={10} height={10} fill="#FFB900" />
    </svg>
  );
}

function GoogleMark({ size }: { size: number; color: string }) {
  // Multi-color Google "G".
  const s = size * 0.66;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.45c-.28 1.45-1.12 2.68-2.39 3.5v2.92h3.86c2.27-2.09 3.57-5.17 3.57-8.66z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.86-2.99c-1.07.72-2.43 1.16-4.09 1.16-3.14 0-5.81-2.12-6.76-4.97H1.27v3.13C3.25 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.24 14.29c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.58H1.27C.46 8.16 0 9.96 0 12c0 2.04.46 3.84 1.27 5.42l3.97-3.13z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.81l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.27 6.58l3.97 3.13C6.19 6.86 8.86 4.75 12 4.75z"
      />
    </svg>
  );
}

function MetaMark({ size }: { size: number; color: string }) {
  // Stylized infinity-loop "M" inspired by the Meta wordmark glyph.
  const s = size * 0.66;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#0866FF"
        d="M5.16 4.5c-2.34 0-4.16 2.4-4.16 5.43 0 3.13 1.71 5.34 4.07 5.34 1.7 0 2.93-.86 5.04-4.61 0 0 .82-1.49 1.39-2.5.2.32.41.66.63 1.02l.95 1.6c1.85 3.13 2.94 4.49 4.83 4.49 2.39 0 3.76-2.21 3.76-5.42 0-3.31-1.6-5.45-4.06-5.45-1.4 0-2.49.96-3.69 2.78-.16.24-.31.49-.45.74-.27-.43-.51-.81-.74-1.16-1.21-1.83-2.31-2.36-3.62-2.36zm.27 2.59c.66 0 1.21.42 2.27 2.04l.6.92c-1.79 2.99-2.34 3.74-3.32 3.74-.95 0-1.66-1.07-1.66-3.07 0-2.05.74-3.63 2.11-3.63zm12.96 0c1.32 0 2.07 1.5 2.07 3.5 0 2.09-.79 3.31-1.94 3.31-.97 0-1.51-.71-3.34-3.79l-.55-.92c.95-1.5 1.59-2.1 2.34-2.1z"
      />
    </svg>
  );
}

function AnthropicMark({ size, color }: { size: number; color: string }) {
  // Anthropic asterisk-like glyph.
  const s = size * 0.62;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M14.6 4h-3.66l5.97 16h3.66L14.6 4ZM8.06 4 2.1 20h3.74l1.2-3.36h6.07l1.21 3.36h3.74L11.98 4H8.06Zm-.05 9.74L10.06 8l2.05 5.74H8.01Z" />
    </svg>
  );
}

function DeepSeekMark({ size, color }: { size: number; color: string }) {
  // Simplified whale-like wave glyph.
  const s = size * 0.62;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M19.2 5.4a4.7 4.7 0 0 0-3.45 1.49 7 7 0 0 0-1-.06 7.4 7.4 0 0 0-7.4 7.4c0 2.04.83 3.88 2.16 5.21l-1.7.16c-.5.05-.86.5-.81 1 .04.5.5.86 1 .81l3.62-.34c.97.34 2.02.53 3.13.53a7.4 7.4 0 0 0 7.4-7.4c0-1-.21-1.95-.57-2.81a4.7 4.7 0 0 0-2.38-6.99zm.4 4.59a3 3 0 0 1-.18.7 7.45 7.45 0 0 0-1.95-1.74 3 3 0 0 1 2.13 1.04zm-4.78 7.91a1.55 1.55 0 1 1 0-3.1 1.55 1.55 0 0 1 0 3.1z" />
    </svg>
  );
}

function HuggingFaceMark({ size }: { size: number; color: string }) {
  // Simplified hugging face emoji glyph (face with hands).
  const s = size * 0.66;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx={12} cy={12} r={8} fill="#FFD21E" />
      <circle cx={9} cy={11} r={1.1} fill="#1F2937" />
      <circle cx={15} cy={11} r={1.1} fill="#1F2937" />
      <path
        d="M9 14.5c.7 1.1 1.8 1.7 3 1.7s2.3-.6 3-1.7"
        stroke="#1F2937"
        strokeWidth={1.4}
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx={5.5} cy={15.5} rx={1.7} ry={1.4} fill="#FF7B7B" />
      <ellipse cx={18.5} cy={15.5} rx={1.7} ry={1.4} fill="#FF7B7B" />
    </svg>
  );
}

// ---------- Brand Configurations ----------

type MarkComponent = (props: {
  size: number;
  color: string;
}) => React.JSX.Element;

interface BrandConfig {
  bg: string;
  fg: string;
  letter: string;
  mark?: MarkComponent;
}

const BRANDS: Record<string, BrandConfig> = {
  openai: { bg: "#000000", fg: "#FFFFFF", letter: "O", mark: OpenAIMark },
  nvidia: { bg: "#76B900", fg: "#FFFFFF", letter: "N", mark: NvidiaMark },
  apple: { bg: "#000000", fg: "#FFFFFF", letter: "", mark: AppleMark },
  mistral: { bg: "#1A1A2E", fg: "#FFFFFF", letter: "M", mark: MistralMark },
  anthropic: {
    bg: "#D97757",
    fg: "#FFFFFF",
    letter: "A",
    mark: AnthropicMark,
  },
  meta: { bg: "#FFFFFF", fg: "#0866FF", letter: "M", mark: MetaMark },
  microsoft: {
    bg: "#FFFFFF",
    fg: "#1F2937",
    letter: "M",
    mark: MicrosoftMark,
  },
  google: { bg: "#FFFFFF", fg: "#4285F4", letter: "G", mark: GoogleMark },
  deepseek: { bg: "#4D6BFE", fg: "#FFFFFF", letter: "D", mark: DeepSeekMark },
  groq: { bg: "#F55036", fg: "#FFFFFF", letter: "G" },
  cerebras: { bg: "#0F172A", fg: "#FFFFFF", letter: "C" },
  openrouter: { bg: "#111827", fg: "#FFFFFF", letter: "OR" },
  zai: { bg: "#2563EB", fg: "#FFFFFF", letter: "Z" },
  lmstudio: { bg: "#0EA5A4", fg: "#FFFFFF", letter: "LM" },
  qwen: { bg: "#6F42C1", fg: "#FFFFFF", letter: "Q" },
  useful_sensors: { bg: "#6366F1", fg: "#FFFFFF", letter: "U" },
  funaudillm: { bg: "#FF6A00", fg: "#FFFFFF", letter: "S" },
  sber: { bg: "#21A038", fg: "#FFFFFF", letter: "G" },
  huggingface: {
    bg: "#FFD21E",
    fg: "#1F2937",
    letter: "HF",
    mark: HuggingFaceMark,
  },
  hume: { bg: "#F43F5E", fg: "#FFFFFF", letter: "H" },
  system: {
    bg: "var(--text-subtle)",
    fg: "var(--inverse-text)",
    letter: "OS",
  },
  sherpa: { bg: "#2563EB", fg: "#FFFFFF", letter: "S" },
  myshell: { bg: "#3B82F6", fg: "#FFFFFF", letter: "M" },
  resemble: { bg: "#7C3AED", fg: "#FFFFFF", letter: "R" },
  kokoro: { bg: "#EF4444", fg: "#FFFFFF", letter: "K" },
  coqui: { bg: "#00C853", fg: "#FFFFFF", letter: "C" },
  fish_audio: { bg: "#0EA5E9", fg: "#FFFFFF", letter: "F" },
  nari: { bg: "#2563EB", fg: "#FFFFFF", letter: "N" },
  sesame: { bg: "#F97316", fg: "#FFFFFF", letter: "S" },
  sparkaudio: { bg: "#DC2626", fg: "#FFFFFF", letter: "S" },
  outetts: { bg: "#14B8A6", fg: "#FFFFFF", letter: "O" },
  ming: { bg: "#92400E", fg: "#FFFFFF", letter: "M" },
  kugelaudio: { bg: "#1F2937", fg: "#FFFFFF", letter: "K" },
  ollama: { bg: "#1A1A2E", fg: "#FFFFFF", letter: "O" },
  custom: { bg: "var(--accent-2)", fg: "var(--inverse-text)", letter: "C" },
  generic: { bg: "var(--muted)", fg: "var(--inverse-text)", letter: "?" },
};

// ---------- Provider ID → Brand Key Mapping ----------

const PROVIDER_BRAND: Record<string, string> = {
  // STT providers
  stt_whisper: "openai",
  stt_parakeet: "nvidia",
  stt_moonshine: "useful_sensors",
  stt_moonshine_streaming: "useful_sensors",
  stt_sensevoice: "funaudillm",
  stt_gigaam: "sber",
  stt_qwen: "qwen",
  stt_mlx_audio: "apple",
  stt_apple_speech: "apple",
  stt_whisperkit: "openai",
  stt_hf_verified: "huggingface",
  // TTS builtin providers
  system_builtin: "system",
  system_tts: "system",
  sherpa_pack: "sherpa",
  sherpa_onnx: "sherpa",
  qwen3_native: "qwen",
  tada_local: "hume",
  hf_s2s_local: "huggingface",
  local_sidecar_api: "generic",
  // TTS managed runtime providers
  openvoice: "myshell",
  chatterbox: "resemble",
  kokoro: "kokoro",
  xtts: "coqui",
  // TTS MLX Audio providers
  mlx_kokoro: "kokoro",
  mlx_chatterbox: "resemble",
  mlx_qwen3tts: "qwen",
  mlx_dia: "nari",
  mlx_csm: "sesame",
  mlx_spark: "sparkaudio",
  mlx_oute: "outetts",
  mlx_ming_omni: "ming",
  mlx_kugel: "kugelaudio",
  mlx_bark: "huggingface",
  mlx_fish_audio: "fish_audio",
  mlx_lfm_audio: "huggingface",
  mlx_pocket_tts: "huggingface",
  mlx_voxcpm: "huggingface",
  mlx_voxtral_tts: "mistral",
  // LLM providers
  ollama: "ollama",
  apple_intelligence: "apple",
  openai: "openai",
  zai: "zai",
  openrouter: "openrouter",
  anthropic: "anthropic",
  groq: "groq",
  cerebras: "cerebras",
  lmstudio: "lmstudio",
  custom: "custom",
  huggingface: "huggingface",
  // Model family aliases (used by inferModelBrand below)
  meta: "meta",
  microsoft: "microsoft",
  google: "google",
  deepseek: "deepseek",
  gemma: "google",
  gemini: "google",
  llama: "meta",
  phi: "microsoft",
  mistral: "mistral",
  claude: "anthropic",
};

// ---------- Engine Type → Provider ID (for STT ModelInfo) ----------

const ENGINE_TO_PROVIDER: Record<EngineType, string> = {
  Whisper: "stt_whisper",
  Parakeet: "stt_parakeet",
  Moonshine: "stt_moonshine",
  MoonshineStreaming: "stt_moonshine_streaming",
  SenseVoice: "stt_sensevoice",
  GigaAM: "stt_gigaam",
  QwenAudio: "stt_qwen",
  MlxAudioStt: "stt_mlx_audio",
  AppleSpeech: "stt_apple_speech",
  AppleSpeechStreaming: "stt_apple_speech",
  WhisperKitStreaming: "stt_whisperkit",
};

export function engineTypeToProviderId(engineType: EngineType): string {
  return ENGINE_TO_PROVIDER[engineType] ?? "";
}

// ---------- Family Inference (title → provider id) ----------

/**
 * Provider IDs that are "runtime hosts" rather than model families. When the
 * caller knows a model title, we prefer the family-specific brand over the
 * runtime icon (e.g. show Meta for "Llama 3.2" running on Ollama).
 */
const RUNTIME_HOST_IDS = new Set([
  "ollama",
  "lmstudio",
  "huggingface",
  "stt_hf_verified",
  "custom",
  "generic",
  "",
]);

interface FamilyRule {
  // Lowercase keyword to match in the model title or id.
  keyword: string;
  // Resolved provider id (must exist in PROVIDER_BRAND).
  providerId: string;
}

// Order matters: more specific keywords should win over broader ones.
const FAMILY_RULES: FamilyRule[] = [
  { keyword: "apple intelligence", providerId: "apple" },
  { keyword: "whisperkit", providerId: "stt_whisperkit" },
  { keyword: "whisper", providerId: "stt_whisper" },
  { keyword: "parakeet", providerId: "stt_parakeet" },
  { keyword: "moonshine", providerId: "stt_moonshine" },
  { keyword: "sensevoice", providerId: "stt_sensevoice" },
  { keyword: "gigaam", providerId: "stt_gigaam" },
  { keyword: "qwen-audio", providerId: "stt_qwen" },
  { keyword: "qwen2-audio", providerId: "stt_qwen" },
  { keyword: "deepseek", providerId: "deepseek" },
  { keyword: "llama", providerId: "meta" },
  { keyword: "gemma", providerId: "google" },
  { keyword: "gemini", providerId: "google" },
  { keyword: "phi-", providerId: "microsoft" },
  { keyword: "phi ", providerId: "microsoft" },
  { keyword: "phi4", providerId: "microsoft" },
  { keyword: "phi3", providerId: "microsoft" },
  { keyword: "phi2", providerId: "microsoft" },
  { keyword: "ministral", providerId: "mistral" },
  { keyword: "mixtral", providerId: "mistral" },
  { keyword: "mistral", providerId: "mistral" },
  { keyword: "qwen", providerId: "qwen" },
  { keyword: "claude", providerId: "anthropic" },
  { keyword: "gpt-", providerId: "openai" },
  { keyword: "gpt4", providerId: "openai" },
  { keyword: "gpt5", providerId: "openai" },
  { keyword: "o1-", providerId: "openai" },
  { keyword: "o3-", providerId: "openai" },
  { keyword: "o4-", providerId: "openai" },
  { keyword: "o4 ", providerId: "openai" },
  { keyword: "o3 ", providerId: "openai" },
  { keyword: "o1 ", providerId: "openai" },
];

/**
 * Infer a brand provider id from a free-form model title or id
 * (e.g. "Llama 3.2 3B Instruct" → "meta", "phi-4-mini" → "microsoft").
 * Returns null if no family keyword matches.
 */
export function inferModelBrand(title: string | null | undefined): string | null {
  if (!title) return null;
  const lower = title.toLowerCase();
  for (const rule of FAMILY_RULES) {
    if (lower.includes(rule.keyword)) {
      return rule.providerId;
    }
  }
  return null;
}

/**
 * Pick the most informative provider id for a model: family-specific brand
 * inferred from the title (when available) wins over a generic runtime
 * provider id (Ollama, LM Studio, Hugging Face, etc.). Falls back to the
 * supplied runtime provider id.
 */
export function resolveModelProviderId(
  title: string | null | undefined,
  runtimeProviderId: string | null | undefined,
): string {
  const runtime = (runtimeProviderId ?? "").trim();
  const inferred = inferModelBrand(title);
  if (inferred && (RUNTIME_HOST_IDS.has(runtime) || !PROVIDER_BRAND[runtime])) {
    return inferred;
  }
  if (inferred && runtime && PROVIDER_BRAND[runtime] === "generic") {
    return inferred;
  }
  if (runtime) return runtime;
  return inferred ?? "generic";
}

// ---------- Component ----------

export const ProviderIcon: React.FC<ProviderIconProps> = ({
  providerId,
  size = "sm",
  className = "",
}) => {
  const brandKey = PROVIDER_BRAND[providerId] ?? "generic";
  const brand = BRANDS[brandKey] ?? BRANDS.generic;
  const cfg = SIZE_CONFIG[size];
  const Mark = brand.mark;

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{
        width: cfg.px,
        height: cfg.px,
        borderRadius: cfg.r,
        backgroundColor: brand.bg,
        color: brand.fg,
      }}
      aria-hidden="true"
    >
      {Mark ? (
        <Mark size={cfg.px} color={brand.fg} />
      ) : (
        <span
          style={{
            fontSize: brand.letter.length > 1 ? cfg.font * 0.72 : cfg.font,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: brand.letter.length > 1 ? "-0.03em" : undefined,
          }}
        >
          {brand.letter}
        </span>
      )}
    </div>
  );
};
