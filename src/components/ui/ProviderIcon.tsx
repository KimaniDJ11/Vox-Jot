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

function MistralMark({ size, color }: { size: number; color: string }) {
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
  anthropic: { bg: "#D97757", fg: "#FFFFFF", letter: "A" },
  groq: { bg: "#F55036", fg: "#FFFFFF", letter: "G" },
  cerebras: { bg: "#0F172A", fg: "#FFFFFF", letter: "C" },
  openrouter: { bg: "#111827", fg: "#FFFFFF", letter: "OR" },
  zai: { bg: "#2563EB", fg: "#FFFFFF", letter: "Z" },
  lmstudio: { bg: "#0EA5A4", fg: "#FFFFFF", letter: "LM" },
  qwen: { bg: "#6F42C1", fg: "#FFFFFF", letter: "Q" },
  useful_sensors: { bg: "#6366F1", fg: "#FFFFFF", letter: "U" },
  funaudillm: { bg: "#FF6A00", fg: "#FFFFFF", letter: "S" },
  sber: { bg: "#21A038", fg: "#FFFFFF", letter: "G" },
  huggingface: { bg: "#FFD21E", fg: "#000000", letter: "HF" },
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
  fish_speech: "fish_audio",
  fish_speech_local: "fish_audio",
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
};

export function engineTypeToProviderId(engineType: EngineType): string {
  return ENGINE_TO_PROVIDER[engineType] ?? "";
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
