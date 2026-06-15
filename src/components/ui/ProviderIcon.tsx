import React from "react";
import type { EngineType } from "@/bindings";

// ---------- Types ----------

export type ProviderIconSize = "xs" | "sm" | "md" | "lg" | "xl";

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
  xl: { px: 40, font: 21, r: 9 },
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
  const s = size * 0.78;
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

function QwenMark({ size }: { size: number; color: string }) {
  const s = size * 0.82;
  return (
    <svg width={s} height={s} viewBox="0 0 200 200" aria-hidden>
      <path
        d="M174.82 108.75 155.38 75l10.26-17.25a4.65 4.65 0 0 0 0-4.66l-10.26-17.25a3.01 3.01 0 0 0-2.6-1.51h-37.9l-8.74-15.3a3.01 3.01 0 0 0-2.6-1.51H83.3a3.01 3.01 0 0 0-2.6 1.51L61.26 52.77H41.02a3.01 3.01 0 0 0-2.6 1.51L28.16 71.53a4.65 4.65 0 0 0 0 4.66l17.36 31.31-8.74 15.3a4.65 4.65 0 0 0 0 4.66l10.26 17.25a3.01 3.01 0 0 0 2.6 1.51h37.9l8.74 15.3a3.01 3.01 0 0 0 2.6 1.51h20.24a3.01 3.01 0 0 0 2.6-1.51l19.44-33.74h17.36a3.01 3.01 0 0 0 2.6-1.51l10.26-17.25a4.65 4.65 0 0 0 0-4.66l3.44 4.39Z"
        fill="#665CEE"
      />
      <path
        d="M119.12 163.03H98.88l-11.34-18.32h-37.9l11.62-18.32H80.7L38.42 55.29h22.84L83.3 19.03l10.26 18.32L83.3 55.29h78.28l-10.26 17.25 19.44 33.74h-19.44l-10.16-17.94-39.98 74.69h17.94Z"
        fill="#FFFFFF"
      />
      <path d="M127.86 79.83H76.14l25.04 42.28 26.68-42.28Z" fill="#665CEE" />
    </svg>
  );
}

function UsefulSensorsMark({ size }: { size: number; color: string }) {
  const s = size * 0.66;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 6.8v5.4c0 3.8 2.9 6.8 7 6.8s7-3 7-6.8V6.8"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d="M8.3 5.4v6.7c0 2.1 1.5 3.6 3.7 3.6s3.7-1.5 3.7-3.6V5.4"
        fill="none"
        stroke="#A7F3D0"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <circle cx={12} cy={4.5} r={2.2} fill="#FFFFFF" />
    </svg>
  );
}

function FunAudioMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4 15.5c2.2-6.8 5.6-9.8 10.1-9 4.2.8 5.3 4.5 5.9 8.3"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <path
        d="M5.2 16.4c2.7 1.7 5.6 2.1 8.6 1.1 2.3-.8 4-2.2 5.2-4.4"
        fill="none"
        stroke="#FFE2C6"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={15.2} cy={10.3} r={2.1} fill="#FFFFFF" />
      <circle cx={15.2} cy={10.3} r={0.9} fill="#FF6A00" />
    </svg>
  );
}

function SberMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx={12} cy={12} r={9} fill="#FFFFFF" />
      <path
        d="M7.2 11.8 10.6 15 17.5 8"
        fill="none"
        stroke="#21A038"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 10a8.2 8.2 0 0 1 13-5"
        fill="none"
        stroke="#F7C948"
        strokeWidth={2.1}
        strokeLinecap="round"
      />
      <path
        d="M20.1 9.7a8.2 8.2 0 0 1-2.6 8.6"
        fill="none"
        stroke="#21A038"
        strokeWidth={2.1}
        strokeLinecap="round"
      />
    </svg>
  );
}

function LiquidAIMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3c3.4 3.7 5.1 6.6 5.1 9.2a5.1 5.1 0 0 1-10.2 0C6.9 9.6 8.6 6.7 12 3Z"
        fill="#FFFFFF"
      />
      <path
        d="M8.8 13.6c1.6 1 3.3 1.1 5 .2 1-.5 1.8-1.2 2.3-2.2"
        fill="none"
        stroke="#00A7A7"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function TencentMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M4 4h16v4.1h-5.8V20H9.8V8.1H4V4Z" fill="#FFFFFF" />
      <path d="M9.8 8.1h4.4v3.5H9.8V8.1Z" fill="#2563EB" opacity={0.95} />
    </svg>
  );
}

function LightOnMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M8 5v14h8.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.4 5.5 18 10l-4.6 4.5"
        fill="none"
        stroke="#A5B4FC"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DatalabMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx={8} cy={12} r={3.2} fill="#FFFFFF" />
      <circle cx={16} cy={8} r={3.2} fill="#DDD6FE" />
      <circle cx={16} cy={16} r={3.2} fill="#FFFFFF" />
      <path
        d="M10.8 10.8 13.2 9.2M10.8 13.2l2.4 1.6"
        stroke="#7C3AED"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}

function Ai2Mark({ size }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4.5 19 10.5 5h3L19.5 19h-3.2l-1-2.7H8.7l-1 2.7H4.5Z"
        fill="#FFFFFF"
      />
      <path d="M9.7 13.4h4.6L12 7.5l-2.3 5.9Z" fill="#0F766E" />
      <path
        d="M18.2 6.2h1.7v7.5"
        fill="none"
        stroke="#A7F3D0"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ZhipuMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M6 6h12L7 18h11"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 6.5c1.4 1.5 2.1 3.3 2.1 5.5s-.7 4-2.1 5.5"
        fill="none"
        stroke="#BFDBFE"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SystemMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4 8.5h8.5v10H4v-10Zm10.5-3H20v13h-5.5v-13Z"
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <path
        d="M6.5 12h3.4M16.5 9h1.5M16.5 12h1.5M16.5 15h1.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function PolyvoiceMark({ size }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4.5 16.2c1.7-3.3 3.8-3.3 5.4 0s3.8 3.3 5.4 0 3.8-3.3 5.2 0"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.3}
        strokeLinecap="round"
      />
      <path
        d="M5.5 10.3c1.4-2.4 3.1-2.4 4.5 0s3.2 2.4 4.5 0 3.1-2.4 4.2 0"
        fill="none"
        stroke="#BAE6FD"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <circle cx={7.2} cy={5.8} r={2.1} fill="#FFFFFF" />
      <circle cx={12} cy={5.8} r={2.1} fill="#DBEAFE" />
      <circle cx={16.8} cy={5.8} r={2.1} fill="#FFFFFF" />
    </svg>
  );
}

function SherpaMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M3 18 9.5 6l3.2 5.7L15 8l6 10H3Z" fill="#FFFFFF" />
      <path
        d="M8.5 12.4 9.5 6l3.2 5.7 1.4-2.2 1.4 8.5H3l5.5-5.6Z"
        fill="#BFDBFE"
      />
    </svg>
  );
}

function HumeMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 4 20 9v6l-8 5-8-5V9l8-5Z" fill="#FFFFFF" opacity={0.95} />
      <path
        d="M7.2 12c1.5-2.7 3.1-2.7 4.8 0s3.3 2.7 4.8 0"
        fill="none"
        stroke="#F43F5E"
        strokeWidth={2.1}
        strokeLinecap="round"
      />
    </svg>
  );
}

function MyShellMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M4 15.5c1.2-5.8 4.2-9 8-9s6.8 3.2 8 9H4Z" fill="#FFFFFF" />
      <path
        d="M7 15.5c.8-3 2.6-4.7 5-4.7s4.2 1.7 5 4.7M12 6.5v9"
        fill="none"
        stroke="#3B82F6"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ResembleMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 14c2.1-4.8 4.5-4.8 7.1 0s4.8 4.8 6.9 0"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d="M5 9.5c2.1 4.8 4.5 4.8 7.1 0s4.8-4.8 6.9 0"
        fill="none"
        stroke="#E9D5FF"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SupertonicMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M6.2 7.4h11.6M6.2 12h11.6M6.2 16.6h11.6"
        stroke="#FFFFFF"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <path
        d="M8.1 7.4c1.3 2.2 2.6 2.2 3.9 0s2.6-2.2 3.9 0M8.1 16.6c1.3-2.2 2.6-2.2 3.9 0s2.6 2.2 3.9 0"
        fill="none"
        stroke="#F9A8D4"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function KokoroMark({ size }: { size: number; color: string }) {
  const s = size * 0.66;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 20c-4.8-3.3-7.5-5.9-7.5-9.2A4.1 4.1 0 0 1 12 8.5a4.1 4.1 0 0 1 7.5 2.3c0 3.3-2.7 5.9-7.5 9.2Z"
        fill="#111827"
      />
    </svg>
  );
}

function CoquiMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 12.5c0-3.2 3.1-5.8 7-5.8s7 2.6 7 5.8-3.1 5.8-7 5.8-7-2.6-7-5.8Z"
        fill="#FFFFFF"
      />
      <circle cx={8.3} cy={8} r={2.1} fill="#FFFFFF" />
      <circle cx={15.7} cy={8} r={2.1} fill="#FFFFFF" />
      <circle cx={8.3} cy={8} r={0.9} fill="#00C853" />
      <circle cx={15.7} cy={8} r={0.9} fill="#00C853" />
      <path
        d="M8.5 13.5c2.2 1.5 4.8 1.5 7 0"
        fill="none"
        stroke="#00C853"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}

function FishAudioMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M3.5 12c3.4-4.3 8.7-5.2 14-1.5L21 7.8v8.4l-3.5-2.7c-5.3 3.7-10.6 2.8-14-1.5Z"
        fill="#FFFFFF"
      />
      <circle cx={8.2} cy={11.2} r={0.9} fill="#0EA5E9" />
    </svg>
  );
}

function NariMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M5 8.5h14v7H9.8L5 19V8.5Z" fill="#FFFFFF" />
      <path
        d="M8.4 12h1.6m2 0h1.6m2 0h1.6"
        stroke="#2563EB"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SesameMark({ size }: { size: number; color: string }) {
  const s = size * 0.66;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <ellipse
        cx={9}
        cy={12}
        rx={4.2}
        ry={7.5}
        fill="#FFFFFF"
        transform="rotate(-18 9 12)"
      />
      <ellipse
        cx={15}
        cy={12}
        rx={4.2}
        ry={7.5}
        fill="#FED7AA"
        transform="rotate(18 15 12)"
      />
      <circle cx={12} cy={12} r={2.1} fill="#F97316" />
    </svg>
  );
}

function SparkAudioMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2.8 14.6 9l6.6 3-6.6 3L12 21.2 9.4 15l-6.6-3 6.6-3L12 2.8Z"
        fill="#FFFFFF"
      />
      <path
        d="M12 8.4 13.1 11l2.5 1-2.5 1L12 15.6 10.9 13l-2.5-1 2.5-1L12 8.4Z"
        fill="#DC2626"
      />
    </svg>
  );
}

function OuteTTSMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx={12} cy={12} r={8} fill="#FFFFFF" />
      <path
        d="M7.2 12c1.6-3.2 3.2-3.2 4.8 0s3.2 3.2 4.8 0"
        fill="none"
        stroke="#14B8A6"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function InclusionAIMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3 21 8v8l-9 5-9-5V8l9-5Z" fill="#FFFFFF" />
      <path
        d="M7.2 8.8 12 6.1l4.8 2.7v5.4L12 17l-4.8-2.8V8.8Z"
        fill="#0F172A"
      />
      <circle cx={12} cy={12} r={2.2} fill="#FFFFFF" />
    </svg>
  );
}

function KugelAudioMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx={12} cy={12} r={8.5} fill="#FFFFFF" />
      <path
        d="M5 12h14M12 3.5c2.2 2.4 3.2 5.2 3.2 8.5s-1 6.1-3.2 8.5M12 3.5C9.8 5.9 8.8 8.7 8.8 12s1 6.1 3.2 8.5"
        fill="none"
        stroke="#1F2937"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function KyutaiMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3.2 15 9l6 3-6 3-3 5.8L9 15l-6-3 6-3 3-5.8Z"
        fill="#FFFFFF"
      />
      <circle cx={12} cy={12} r={2.4} fill="#FF4F8B" />
    </svg>
  );
}

function OpenBmbMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx={6.8} cy={12} r={3.4} fill="#FFFFFF" />
      <circle cx={17.2} cy={8} r={3.4} fill="#BFDBFE" />
      <circle cx={17.2} cy={16} r={3.4} fill="#FFFFFF" />
      <path
        d="M9.6 11 14.1 9.2M9.6 13 14.1 14.8"
        stroke="#2563EB"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SunoMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx={12} cy={12} r={6.2} fill="#FFFFFF" />
      <path
        d="M4 12c2-2.2 4-2.2 6 0s4 2.2 6 0 3-2.2 4 0"
        fill="none"
        stroke="#7C3AED"
        strokeWidth={2}
        strokeLinecap="round"
      />
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

function RnnoiseMark({ size }: { size: number; color: string }) {
  // Clean voice waveform for the learned speech denoiser.
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M3 12h2.4M18.6 12H21"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M6.6 8.5v7M9.6 5v14M12.6 8.5v7M15.6 10.5v3"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpectralMark({ size }: { size: number; color: string }) {
  // Frequency-bin spectrum bars for spectral subtraction.
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 16V11M9 16V6M13 16V9M17 16V12.5"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="M4 19h16"
        stroke="#C7D2FE"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeepFilterNetMark({ size }: { size: number; color: string }) {
  // Neural filter funnel with a sparkle for the full-band denoiser.
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M4 5.5h16l-6 6.6V19l-4 1.6v-9L4 5.5Z" fill="#FFFFFF" />
      <path
        d="m17.6 3.2.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z"
        fill="#BFDBFE"
      />
    </svg>
  );
}

function VoxJotMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3.5c-2.1 0-3.8 1.7-3.8 3.8v4.1c0 2.1 1.7 3.8 3.8 3.8s3.8-1.7 3.8-3.8V7.3c0-2.1-1.7-3.8-3.8-3.8Z"
        fill={color}
      />
      <path
        d="M5.7 10.8c0 3.5 2.8 6.3 6.3 6.3s6.3-2.8 6.3-6.3M12 17.1v3.4M8.8 20.5h6.4"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M10.7 7.3h2.6M10.7 10.3h2.6"
        stroke="var(--panel-bg)"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

function FalconMark({ size }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M5 5h14v3.6H9.1v3.1h8.2v3.5H9.1V20H5V5Z" fill="#FFFFFF" />
      <path
        d="M12.5 5c3.5 1.3 5.7 3.4 6.5 6.3-2.2-.9-4.4-.9-6.5 0"
        fill="none"
        stroke="#C4B5FD"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IbmMark({ size }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      {[5, 8.5, 12, 15.5].map((y) => (
        <path
          key={y}
          d={`M3 ${y}h4.2M9 ${y}h2.6l1.1 1.8L13.8 ${y}h2.6M18.1 ${y}H21`}
          stroke="#FFFFFF"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function OpenMossMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 18V7l4.7 6.2L14.4 7v11"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.8 9.5c1.6 1.4 2.4 3 2.4 4.6s-.8 3.2-2.4 4.4"
        fill="none"
        stroke="#BBF7D0"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IrodoriMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 5v14"
        stroke="#FFFFFF"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d="M8 7.5c3.2-2.2 6-2.2 8.4 0M7.4 16.5c3.2 2.2 6.3 2.2 9.2 0"
        fill="none"
        stroke="#FBCFE8"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IndexTtsMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <rect x={6} y={4} width={12} height={16} rx={2} fill="#FFFFFF" />
      <path
        d="M9 8h6M9 12h6M9 16h3"
        stroke="#F97316"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function LongCatMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M6 18V6h3.8v8.7H18V18H6Z" fill="#111827" />
      <path
        d="M11.2 6.5c3.9.7 6.2 2.9 6.8 6.7-2-1-4-1.1-6-.3"
        fill="none"
        stroke="#F97316"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function SopranoMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M6 16.5c2.2 2.1 9.8 2.1 12 0 1.2-1.1.6-3.2-1-4.1l-7.5-4.1c-1.9-1-1.5-3.8.7-4.2 2.1-.4 4.7.1 6.1 1.3"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="M8.2 12.5h7.6"
        stroke="#E9D5FF"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function MeloTtsMark({ size }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 18V7l4.3 5.8L13.6 7v11"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.3 8.5c1.7.9 2.7 2.2 2.7 3.8s-1 2.9-2.7 3.8"
        fill="none"
        stroke="#BFDBFE"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function KittenMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M6 4l2.4 3.6M18 4l-2.4 3.6"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx="12" cy="13" r="6.4" fill="#FFFFFF" />
      <circle cx="9.7" cy="12.4" r="1" fill="#F472B6" />
      <circle cx="14.3" cy="12.4" r="1" fill="#F472B6" />
      <path
        d="M12 14.2v1.1M10.3 15.8c.6.6 2.8.6 3.4 0"
        fill="none"
        stroke="#F472B6"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MisoMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M4.5 11h15c-.4 4-3.6 7-7.5 7s-7.1-3-7.5-7z" fill="#FFFFFF" />
      <path
        d="M3.5 11h17"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M9 4.5c-.9 1-.9 2.1 0 3.1M12 4c-.9 1-.9 2.1 0 3.1M15 4.5c-.9 1-.9 2.1 0 3.1"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function CohereMark({ size }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 12a7 7 0 0 1 14 0v.3c0 2.7-2.2 4.7-4.9 4.7H10c-.9 0-1.7-.4-2.3-1H6a3 3 0 1 1 0-6h5.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PyAnnoteMark({ size }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx={7.2} cy={12} r={2.4} fill="#FFFFFF" />
      <circle cx={16.8} cy={12} r={2.4} fill="#FFFFFF" />
      <path
        d="M4 7.5c0-1.4 1-2.4 2.4-2.4M20 7.5c0-1.4-1-2.4-2.4-2.4M4 16.5c0 1.4 1 2.4 2.4 2.4M20 16.5c0 1.4-1 2.4-2.4 2.4"
        fill="none"
        stroke="#F472B6"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <path
        d="M10 12h4"
        stroke="#FFFFFF"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}

function RevaiMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5.5 5h6.2a4.1 4.1 0 0 1 0 8.2H9V19H5.5V5Zm3.5 5.6h2.4a1.5 1.5 0 0 0 0-3H9v3Z"
        fill="#FFFFFF"
      />
      <path d="m13.4 12.8 4.7 6.2h-3.8l-3.6-4.8" fill="#FFFFFF" />
      <circle cx={18.5} cy={6.5} r={1.6} fill="#22D3EE" />
    </svg>
  );
}

function WhisperXMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M3.5 12c2.4-3.6 5.5-3.6 8 0s5.6 3.6 8 0"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="m15 6 4 4-4 4M19 6l-4 4 4 4"
        fill="none"
        stroke="#F87171"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OllamaMark({ size }: { size: number; color: string }) {
  const s = size * 0.66;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M8 3.4c-1.6.7-2.4 2.6-2.4 4.7v3.6c-1 .6-1.6 1.8-1.6 3.1 0 1.6.8 3 2 3.6V20h3v-1.5h5V20h3v-1.6c1.2-.6 2-2 2-3.6 0-1.3-.6-2.5-1.6-3.1V8.1c0-2.1-.8-4-2.4-4.7-1.5 1.3-2.6 2.7-3 4.4h-.6c-.4-1.7-1.5-3.1-3-4.4Z"
        fill="#FFFFFF"
      />
      <circle cx={9.5} cy={12.4} r={1.1} fill="#111827" />
      <circle cx={14.5} cy={12.4} r={1.1} fill="#111827" />
    </svg>
  );
}

function GroqMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3a8.4 8.4 0 0 0-7.2 12.7L3.4 21l5.3-1.4A8.4 8.4 0 1 0 12 3Z"
        fill="#FFFFFF"
      />
      <path
        d="M11 8h2.5a2.6 2.6 0 0 1 2.5 2.6c0 1.5-1.1 2.6-2.5 2.6H11M11 8v8M11 13.2h.6L15 16.5"
        fill="none"
        stroke="#F55036"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CerebrasMark({ size }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 4a8 8 0 1 0 6 13.3"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="M8 8.2a6 6 0 1 0 7 8"
        fill="none"
        stroke="#F97316"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={17.5} cy={6.5} r={1.5} fill="#F97316" />
    </svg>
  );
}

function OpenRouterMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M3 12c2.5-2 5-2 7.5 0s5 2 7.5 0"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="m17 7 4 5-4 5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={6} cy={12} r={1.5} fill="#A78BFA" />
    </svg>
  );
}

function LmStudioMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <rect x={3.5} y={5} width={17} height={11} rx={2} fill="#FFFFFF" />
      <path
        d="M7 19h10"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M8 9v3.5h3"
        fill="none"
        stroke="#0EA5A4"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 12.5V9l1.7 2 1.7-2v3.5"
        fill="none"
        stroke="#0EA5A4"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PaddlePaddleMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3.5 19 8v8l-7 4.5L5 16V8l7-4.5Z" fill="#FFFFFF" />
      <path
        d="M9.5 9.5h3.6a2.4 2.4 0 0 1 0 4.8H9.5V9.5Zm0 4.8V18"
        fill="none"
        stroke="#2563EB"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TesseractMark({ size }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M6 4h12v3.5h-4.2V20h-3.6V7.5H6V4Z" fill="#FFFFFF" />
      <path
        d="M7.5 9.5h2M14.5 9.5h2M7.5 15h2M14.5 15h2"
        stroke="#F59E0B"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function DotsMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle cx={6.5} cy={12} r={2.2} fill="#FFFFFF" />
      <circle cx={12} cy={12} r={2.2} fill="#FFFFFF" />
      <circle cx={17.5} cy={12} r={2.2} fill="#FFFFFF" />
    </svg>
  );
}

function NanonetsMark({ size }: { size: number; color: string }) {
  // Connected-node graph (nano + nets) for the Nanonets OCR family.
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M6.5 7.5 12 12l5.5-4.5M6.5 16.5 12 12l5.5 4.5"
        fill="none"
        stroke="#93C5FD"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={6.5} cy={7.5} r={1.9} fill="#FFFFFF" />
      <circle cx={6.5} cy={16.5} r={1.9} fill="#FFFFFF" />
      <circle cx={17.5} cy={7.5} r={1.9} fill="#FFFFFF" />
      <circle cx={17.5} cy={16.5} r={1.9} fill="#FFFFFF" />
      <circle cx={12} cy={12} r={2.4} fill="#FFFFFF" />
    </svg>
  );
}

function OrpheusMark({ size }: { size: number; color: string }) {
  // Lyre glyph — the mythic musician Orpheus.
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M7 4.5c-2.3 1.3-3.5 3.6-3.5 6.9 0 3.4 1.6 6.4 3.9 8.6M17 4.5c2.3 1.3 3.5 3.6 3.5 6.9 0 3.4-1.6 6.4-3.9 8.6"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <path
        d="M6.4 7.6h11.2"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M9.3 8.2v8.4M12 8.2v9.2M14.7 8.2v8.4"
        stroke="#FDE68A"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

function ZonosMark({ size }: { size: number; color: string }) {
  // Bold "Z" with a voice wave for Zyphra ZONOS2.
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M6.5 6.2h11L7 17.8h11"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.6 12c1.1-1.8 2.3-1.8 3.4 0s2.3 1.8 3.4 0"
        fill="none"
        stroke="#C7D2FE"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function K2FsaMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 5v14M5 12l6-7M5 12l6 7"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 7.5c1.4-.7 3-.7 3.6.4.7 1.2-.3 2.6-1.6 3.5l-2 1.4h3.6V14"
        fill="none"
        stroke="#BFDBFE"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FireRedMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3.2c2.1 2.4 2.5 4.6 1.3 6.6 1.7-.5 3-.2 4.1 1 1.6 1.7 2.4 4.2 1.3 6.4-1.2 2.4-3.6 3.6-6.7 3.6-3 0-5.4-1.2-6.7-3.6-1.2-2.2-.3-4.7 1.4-6.4 1-1.2 2.4-1.5 4.1-1-1.2-2-.8-4.2 1.2-6.6Z"
        fill="#FFFFFF"
      />
      <path
        d="M12 11c1 1.4 1.4 2.6.4 3.8.9-.2 1.6 0 2.1.7.8 1 .6 2.4-.4 3.2-1 .8-2.5.8-3.6 0-1-.8-1.2-2.2-.4-3.2.5-.7 1.2-.9 2.1-.7-1-1.2-.5-2.4.5-3.8Z"
        fill="#DC2626"
      />
    </svg>
  );
}

function BosonMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <ellipse
        cx={12}
        cy={12}
        rx={9}
        ry={4}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2}
      />
      <ellipse
        cx={12}
        cy={12}
        rx={9}
        ry={4}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2}
        transform="rotate(60 12 12)"
      />
      <ellipse
        cx={12}
        cy={12}
        rx={9}
        ry={4}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2}
        transform="rotate(120 12 12)"
      />
      <circle cx={12} cy={12} r={2} fill="#FFFFFF" />
    </svg>
  );
}

function PiperMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 17c2.8-9.2 8.2-13 14-12-1.6 6.4-5.1 10.6-10 11l-1.8 4.5L5 17Z"
        fill="#FFFFFF"
      />
      <path
        d="M9 14c2.4-4.3 5.2-6.4 8.5-7"
        fill="none"
        stroke="#7C3AED"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <circle cx={16} cy={8.5} r={1.1} fill="#7C3AED" />
    </svg>
  );
}

function F5TtsMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path d="M7 5h9v3.2H10v3h5v3.1h-5V19H7V5Z" fill="#FFFFFF" />
      <path
        d="M14.5 13.5c1.4 0 2.5 1 2.5 2.4s-1.1 2.5-2.5 2.5"
        fill="none"
        stroke="#F472B6"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={18.3} cy={6.2} r={1.6} fill="#F472B6" />
    </svg>
  );
}

function ParlerMark({ size }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4 11c0-3.9 3.6-7 8-7s8 3.1 8 7-3.6 7-8 7c-.9 0-1.7-.1-2.5-.3L5 20l1.4-3.5C5 15.2 4 13.2 4 11Z"
        fill="#FFFFFF"
      />
      <path
        d="M8.5 11h7M8.5 8.5h7M8.5 13.5h5"
        stroke="#F59E0B"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

function MediatekMark({ size }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M3 18V6l4.5 8L12 6v12"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 6h6M18 6v12"
        stroke="#FFFFFF"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function StabilityAIMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4.5 12c1.9-5.2 5.3-7.4 10.2-6.4 2.8.6 4.7 2.2 5.8 4.7"
        fill="none"
        stroke={color}
        strokeWidth={2.3}
        strokeLinecap="round"
      />
      <path
        d="M4.5 15.7c3.1 2.6 6.4 3.2 10 1.8 2.3-.9 4-2.5 5-4.8"
        fill="none"
        stroke="#A7F3D0"
        strokeWidth={1.9}
        strokeLinecap="round"
      />
      <circle cx={14.8} cy={10.7} r={2} fill={color} />
    </svg>
  );
}

function AceStepMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 17.5h3.2v-3.7h3.3v-3.6h3.3V6.5H19"
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 7.2c1.5 1.6 3 1.6 4.5 0s3-1.6 4.5 0 3 1.6 4.5 0"
        fill="none"
        stroke="#FDE68A"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  );
}

function AudioLdmMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 16.5c1.9-4.4 4.2-4.4 6.9 0s5 4.4 7.1 0"
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="M5.5 11.8c1.6-3.3 3.6-3.3 5.8 0s4 3.3 5.9 0"
        fill="none"
        stroke="#BAE6FD"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <circle cx={8.2} cy={7.5} r={2} fill={color} />
      <circle cx={15.8} cy={7.5} r={2} fill="#BAE6FD" />
    </svg>
  );
}

function YueMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.7;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M9 6v10.2a2.8 2.8 0 1 1-1.8-2.6V8l9-2v8.2a2.8 2.8 0 1 1-1.8-2.6V4.5L9 6Z"
        fill={color}
      />
      <path
        d="M5 19h8.5M5 21h6"
        stroke="#BFDBFE"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function DiffRhythmMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <circle
        cx={12}
        cy={12}
        r={7}
        fill="none"
        stroke={color}
        strokeWidth={2.1}
      />
      <circle
        cx={12}
        cy={12}
        r={3.8}
        fill="none"
        stroke="#C4B5FD"
        strokeWidth={1.8}
      />
      <path
        d="M4 12h3.2M16.8 12H20M12 4v3.2M12 16.8V20"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function MagentaMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.68;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <rect x={4} y={5} width={4} height={14} rx={1.4} fill={color} />
      <rect x={10} y={9} width={4} height={10} rx={1.4} fill="#FBCFE8" />
      <rect x={16} y={3} width={4} height={16} rx={1.4} fill={color} />
    </svg>
  );
}

function FigaroMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 18V6h12.5M5 12h9"
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 6c1.9 1.4 2.9 3.3 2.9 5.8s-1 4.4-2.9 5.8"
        fill="none"
        stroke="#C7D2FE"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function RuleGuidedMusicMark({ size, color }: { size: number; color: string }) {
  const s = size * 0.72;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M5 7h14M5 12h14M5 17h14"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <circle cx={8} cy={7} r={2} fill="#A7F3D0" />
      <circle cx={15} cy={12} r={2} fill={color} />
      <circle cx={10.5} cy={17} r={2} fill="#A7F3D0" />
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
  vox_jot: {
    bg: "var(--accent)",
    fg: "var(--inverse-text)",
    letter: "VJ",
    mark: VoxJotMark,
  },
  openai: { bg: "#000000", fg: "#FFFFFF", letter: "O", mark: OpenAIMark },
  rnnoise: { bg: "#0E9F6E", fg: "#FFFFFF", letter: "R", mark: RnnoiseMark },
  spectral: { bg: "#6366F1", fg: "#FFFFFF", letter: "S", mark: SpectralMark },
  deepfilternet: {
    bg: "#1D4ED8",
    fg: "#FFFFFF",
    letter: "DF",
    mark: DeepFilterNetMark,
  },
  nvidia: { bg: "#76B900", fg: "#FFFFFF", letter: "N", mark: NvidiaMark },
  apple: { bg: "#F5F5F7", fg: "#111827", letter: "", mark: AppleMark },
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
  mediatek: { bg: "#E60012", fg: "#FFFFFF", letter: "MT", mark: MediatekMark },
  stability_ai: {
    bg: "#111827",
    fg: "#FFFFFF",
    letter: "SA",
    mark: StabilityAIMark,
  },
  ace_step: {
    bg: "#7C3AED",
    fg: "#FFFFFF",
    letter: "AS",
    mark: AceStepMark,
  },
  audioldm2: {
    bg: "#0F766E",
    fg: "#FFFFFF",
    letter: "AL",
    mark: AudioLdmMark,
  },
  yue: { bg: "#2563EB", fg: "#FFFFFF", letter: "Y", mark: YueMark },
  diffrhythm: {
    bg: "#4338CA",
    fg: "#FFFFFF",
    letter: "D",
    mark: DiffRhythmMark,
  },
  magenta: {
    bg: "#BE185D",
    fg: "#FFFFFF",
    letter: "M",
    mark: MagentaMark,
  },
  figaro: { bg: "#4F46E5", fg: "#FFFFFF", letter: "F", mark: FigaroMark },
  rule_guided_music: {
    bg: "#047857",
    fg: "#FFFFFF",
    letter: "R",
    mark: RuleGuidedMusicMark,
  },
  liquid_ai: {
    bg: "#00A7A7",
    fg: "#FFFFFF",
    letter: "L",
    mark: LiquidAIMark,
  },
  tencent: { bg: "#2563EB", fg: "#FFFFFF", letter: "T", mark: TencentMark },
  groq: { bg: "#F55036", fg: "#FFFFFF", letter: "G", mark: GroqMark },
  cerebras: { bg: "#0F172A", fg: "#FFFFFF", letter: "C", mark: CerebrasMark },
  modelscope: { bg: "#5B4FE0", fg: "#FFFFFF", letter: "MS" },
  falcon: { bg: "#6D28D9", fg: "#FFFFFF", letter: "F", mark: FalconMark },
  ibm: { bg: "#0F62FE", fg: "#FFFFFF", letter: "IBM", mark: IbmMark },
  openrouter: {
    bg: "#111827",
    fg: "#FFFFFF",
    letter: "OR",
    mark: OpenRouterMark,
  },
  zai: { bg: "#2563EB", fg: "#FFFFFF", letter: "Z", mark: ZhipuMark },
  lmstudio: {
    bg: "#0EA5A4",
    fg: "#FFFFFF",
    letter: "LM",
    mark: LmStudioMark,
  },
  qwen: { bg: "#FFFFFF", fg: "#6F42C1", letter: "Q", mark: QwenMark },
  useful_sensors: {
    bg: "#4F46E5",
    fg: "#FFFFFF",
    letter: "U",
    mark: UsefulSensorsMark,
  },
  funaudillm: {
    bg: "#FF6A00",
    fg: "#FFFFFF",
    letter: "F",
    mark: FunAudioMark,
  },
  sber: { bg: "#21A038", fg: "#FFFFFF", letter: "G", mark: SberMark },
  ai2: { bg: "#0F766E", fg: "#FFFFFF", letter: "A2", mark: Ai2Mark },
  paddlepaddle: {
    bg: "#2563EB",
    fg: "#FFFFFF",
    letter: "P",
    mark: PaddlePaddleMark,
  },
  lighton: { bg: "#111827", fg: "#FFFFFF", letter: "L", mark: LightOnMark },
  datalab: { bg: "#7C3AED", fg: "#FFFFFF", letter: "D", mark: DatalabMark },
  dots: { bg: "#111827", fg: "#FFFFFF", letter: "D", mark: DotsMark },
  nanonets: { bg: "#1D4ED8", fg: "#FFFFFF", letter: "N", mark: NanonetsMark },
  tesseract: {
    bg: "#4B5563",
    fg: "#FFFFFF",
    letter: "T",
    mark: TesseractMark,
  },
  huggingface: {
    bg: "#FFD21E",
    fg: "#1F2937",
    letter: "HF",
    mark: HuggingFaceMark,
  },
  hume: { bg: "#F43F5E", fg: "#FFFFFF", letter: "H", mark: HumeMark },
  system: {
    bg: "var(--text-subtle)",
    fg: "var(--inverse-text)",
    letter: "OS",
    mark: SystemMark,
  },
  polyvoice: {
    bg: "#2563EB",
    fg: "#FFFFFF",
    letter: "PV",
    mark: PolyvoiceMark,
  },
  sherpa: { bg: "#2563EB", fg: "#FFFFFF", letter: "S", mark: SherpaMark },
  myshell: { bg: "#3B82F6", fg: "#FFFFFF", letter: "M", mark: MyShellMark },
  resemble: { bg: "#7C3AED", fg: "#FFFFFF", letter: "R", mark: ResembleMark },
  supertonic: {
    bg: "#B33C7A",
    fg: "#FFFFFF",
    letter: "S3",
    mark: SupertonicMark,
  },
  hexgrad: { bg: "#F59E0B", fg: "#111827", letter: "K", mark: KokoroMark },
  kokoro: { bg: "#F59E0B", fg: "#111827", letter: "K", mark: KokoroMark },
  coqui: { bg: "#00C853", fg: "#FFFFFF", letter: "C", mark: CoquiMark },
  fish_audio: {
    bg: "#0EA5E9",
    fg: "#FFFFFF",
    letter: "F",
    mark: FishAudioMark,
  },
  nari: { bg: "#2563EB", fg: "#FFFFFF", letter: "N", mark: NariMark },
  sesame: { bg: "#F97316", fg: "#FFFFFF", letter: "S", mark: SesameMark },
  sparkaudio: {
    bg: "#DC2626",
    fg: "#FFFFFF",
    letter: "S",
    mark: SparkAudioMark,
  },
  outetts: { bg: "#14B8A6", fg: "#FFFFFF", letter: "O", mark: OuteTTSMark },
  orpheus: { bg: "#B45309", fg: "#FFFFFF", letter: "O", mark: OrpheusMark },
  zonos: { bg: "#4F46E5", fg: "#FFFFFF", letter: "Z", mark: ZonosMark },
  inclusion_ai: {
    bg: "#0F172A",
    fg: "#FFFFFF",
    letter: "IA",
    mark: InclusionAIMark,
  },
  ming: { bg: "#0F172A", fg: "#FFFFFF", letter: "IA", mark: InclusionAIMark },
  kugelaudio: {
    bg: "#1F2937",
    fg: "#FFFFFF",
    letter: "K",
    mark: KugelAudioMark,
  },
  kyutai: { bg: "#FF4F8B", fg: "#FFFFFF", letter: "K", mark: KyutaiMark },
  openbmb: { bg: "#2563EB", fg: "#FFFFFF", letter: "B", mark: OpenBmbMark },
  suno: { bg: "#7C3AED", fg: "#FFFFFF", letter: "S", mark: SunoMark },
  meituan: { bg: "#FFD100", fg: "#111827", letter: "M", mark: LongCatMark },
  soprano: { bg: "#A855F7", fg: "#FFFFFF", letter: "S", mark: SopranoMark },
  melotts: { bg: "#3B82F6", fg: "#FFFFFF", letter: "M", mark: MeloTtsMark },
  openmoss: { bg: "#059669", fg: "#FFFFFF", letter: "M", mark: OpenMossMark },
  irodori: { bg: "#EC4899", fg: "#FFFFFF", letter: "I", mark: IrodoriMark },
  kitten: { bg: "#F472B6", fg: "#FFFFFF", letter: "K", mark: KittenMark },
  miso: { bg: "#D97706", fg: "#FFFFFF", letter: "M", mark: MisoMark },
  indextts: {
    bg: "#F97316",
    fg: "#FFFFFF",
    letter: "I",
    mark: IndexTtsMark,
  },
  k2fsa: { bg: "#2563EB", fg: "#FFFFFF", letter: "K2", mark: K2FsaMark },
  firered: {
    bg: "#DC2626",
    fg: "#FFFFFF",
    letter: "FR",
    mark: FireRedMark,
  },
  ollama: { bg: "#1A1A2E", fg: "#FFFFFF", letter: "O", mark: OllamaMark },
  boson: { bg: "#0EA5E9", fg: "#FFFFFF", letter: "B", mark: BosonMark },
  cohere: { bg: "#FF7759", fg: "#FFFFFF", letter: "C", mark: CohereMark },
  piper: { bg: "#5B21B6", fg: "#FFFFFF", letter: "P", mark: PiperMark },
  rhasspy: { bg: "#5B21B6", fg: "#FFFFFF", letter: "P", mark: PiperMark },
  f5tts: { bg: "#1E1B4B", fg: "#FFFFFF", letter: "F5", mark: F5TtsMark },
  swivid: { bg: "#1E1B4B", fg: "#FFFFFF", letter: "F5", mark: F5TtsMark },
  parler: {
    bg: "#FCC419",
    fg: "#1F2937",
    letter: "Pa",
    mark: ParlerMark,
  },
  pyannote: {
    bg: "#7C3AED",
    fg: "#FFFFFF",
    letter: "PY",
    mark: PyAnnoteMark,
  },
  revai: { bg: "#0F172A", fg: "#FFFFFF", letter: "R", mark: RevaiMark },
  whisperx: {
    bg: "#1E3A8A",
    fg: "#FFFFFF",
    letter: "WX",
    mark: WhisperXMark,
  },
  xiaohongshu: {
    bg: "#FF2442",
    fg: "#FFFFFF",
    letter: "XHS",
    mark: FireRedMark,
  },
  cohere_labs: {
    bg: "#FF7759",
    fg: "#FFFFFF",
    letter: "CL",
    mark: CohereMark,
  },
  custom: { bg: "var(--accent-2)", fg: "var(--inverse-text)", letter: "C" },
  generic: { bg: "var(--muted)", fg: "var(--inverse-text)", letter: "?" },
};

// ---------- Provider ID → Brand Key Mapping ----------

const PROVIDER_BRAND: Record<string, string> = {
  // STT providers
  vox_jot: "vox_jot",
  current_dictation: "vox_jot",
  stt_whisper: "openai",
  rnnoise: "rnnoise",
  spectral: "spectral",
  deepfilternet: "deepfilternet",
  stt_parakeet: "nvidia",
  stt_moonshine: "useful_sensors",
  stt_moonshine_streaming: "useful_sensors",
  stt_sensevoice: "funaudillm",
  stt_gigaam: "sber",
  stt_qwen: "qwen",
  apple: "apple",
  qwen: "qwen",
  stability_ai: "stability_ai",
  stable_audio: "stability_ai",
  musicgen: "meta",
  audioldm2: "audioldm2",
  audioldm2_music: "audioldm2",
  ace_step: "ace_step",
  yue: "yue",
  diffrhythm: "diffrhythm",
  magenta: "magenta",
  figaro: "figaro",
  rule_guided_music: "rule_guided_music",
  stt_mlx_audio: "apple",
  stt_gemma_audio: "google",
  stt_apple_speech: "apple",
  stt_hf_verified: "huggingface",
  polyvoice: "polyvoice",
  wespeaker: "polyvoice",
  silero: "polyvoice",
  nvidia: "nvidia",
  useful_sensors: "useful_sensors",
  funaudillm: "funaudillm",
  sber: "sber",
  mediatek: "mediatek",
  paddlepaddle: "paddlepaddle",
  lighton: "lighton",
  datalab: "datalab",
  dots: "dots",
  nanonets: "nanonets",
  allen_ai: "ai2",
  ai2: "ai2",
  tesseract: "tesseract",
  // TTS builtin providers
  system_builtin: "system",
  system_tts: "system",
  sherpa: "sherpa",
  sherpa_pack: "sherpa",
  sherpa_onnx: "sherpa",
  qwen3_native: "qwen",
  local_sidecar_api: "generic",
  // TTS managed runtime providers
  openvoice: "myshell",
  chatterbox: "resemble",
  supertonic: "supertonic",
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
  mlx_ming_omni: "inclusion_ai",
  mlx_kugel: "kugelaudio",
  mlx_bark: "suno",
  mlx_fish_audio: "fish_audio",
  mlx_lfm_audio: "liquid_ai",
  mlx_longcat_audiodit: "meituan",
  mlx_soprano: "soprano",
  mlx_melotts: "melotts",
  mlx_higgs_audio: "boson",
  mlx_moss_tts: "openmoss",
  mlx_irodori_tts: "irodori",
  mlx_indextts: "indextts",
  mlx_omnivoice: "k2fsa",
  mlx_kitten_tts: "kitten",
  mlx_miso_tts: "miso",
  mlx_vibevoice: "microsoft",
  mlx_pocket_tts: "kyutai",
  mlx_voxcpm: "openbmb",
  mlx_voxtral_tts: "mistral",
  mlx_orpheus: "orpheus",
  mlx_zonos2: "zonos",
  lfm_audio_gguf: "liquid_ai",
  vibevoice: "microsoft",
  // LLM providers
  ollama: "ollama",
  apple_intelligence: "apple",
  openai: "openai",
  zai: "zai",
  openrouter: "openrouter",
  anthropic: "anthropic",
  groq: "groq",
  cerebras: "cerebras",
  modelscope: "modelscope",
  lmstudio: "lmstudio",
  custom: "custom",
  huggingface: "huggingface",
  // Model family aliases (used by inferModelBrand below)
  meta: "meta",
  microsoft: "microsoft",
  google: "google",
  deepseek: "deepseek",
  liquid: "liquid_ai",
  liquid_ai: "liquid_ai",
  tencent: "tencent",
  hunyuan: "tencent",
  falcon: "falcon",
  tii: "falcon",
  ibm: "ibm",
  granite: "ibm",
  meituan: "meituan",
  boson: "boson",
  soprano: "soprano",
  melotts: "melotts",
  openmoss: "openmoss",
  irodori: "irodori",
  indextts: "indextts",
  kitten: "kitten",
  miso: "miso",
  k2fsa: "k2fsa",
  firered: "firered",
  // Speech-analysis / file-ASR providers
  cohere: "cohere",
  cohere_labs: "cohere",
  coherelabs: "cohere",
  pyannote: "pyannote",
  revai: "revai",
  reverb: "revai",
  whisperx: "whisperx",
  xiaohongshu: "firered",
  sortformer: "nvidia",
  // HF TTS Verified families
  piper: "piper",
  rhasspy: "piper",
  f5tts: "f5tts",
  swivid: "f5tts",
  parler: "parler",
  speecht5: "microsoft",
  // Model family aliases for LLMs
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
  MlxAudioStt: "stt_mlx_audio",
  GemmaAudioStt: "stt_gemma_audio",
  AppleSpeech: "stt_apple_speech",
  AppleSpeechStreaming: "stt_apple_speech",
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
  "openrouter",
  "groq",
  "cerebras",
  "stt_hf_verified",
  "stt_whisper",
  "stt_parakeet",
  "stt_moonshine",
  "stt_moonshine_streaming",
  "stt_sensevoice",
  "stt_gigaam",
  "stt_qwen",
  "stt_mlx_audio",
  "stt_gemma_audio",
  "stt_apple_speech",
  "local_sidecar_api",
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
  { keyword: "vox jot", providerId: "vox_jot" },
  { keyword: "current dictation", providerId: "vox_jot" },
  { keyword: "apple intelligence", providerId: "apple" },
  { keyword: "apple speech", providerId: "apple" },
  { keyword: "polyvoice", providerId: "polyvoice" },
  { keyword: "wespeaker", providerId: "wespeaker" },
  { keyword: "we speaker", providerId: "wespeaker" },
  { keyword: "silero", providerId: "silero" },
  { keyword: "distil-whisper", providerId: "huggingface" },
  { keyword: "breeze-asr", providerId: "mediatek" },
  { keyword: "breeze asr", providerId: "mediatek" },
  { keyword: "whisper diarization", providerId: "whisperx" },
  { keyword: "whisperx", providerId: "whisperx" },
  { keyword: "faster-whisper", providerId: "huggingface" },
  { keyword: "whisper", providerId: "stt_whisper" },
  { keyword: "parakeet", providerId: "stt_parakeet" },
  { keyword: "moonshine", providerId: "stt_moonshine" },
  { keyword: "sensevoice", providerId: "stt_sensevoice" },
  { keyword: "sense voice", providerId: "stt_sensevoice" },
  { keyword: "gigaam", providerId: "stt_gigaam" },
  { keyword: "qwen3-asr", providerId: "stt_qwen" },
  { keyword: "qwen3_asr", providerId: "stt_qwen" },
  { keyword: "qwen3 asr", providerId: "stt_qwen" },
  // Mega-ASR is a robustness-merged Qwen3-ASR-1.7B variant (mlx-community/Mega-ASR-8bit).
  { keyword: "mega-asr", providerId: "stt_qwen" },
  { keyword: "mega asr", providerId: "stt_qwen" },
  { keyword: "fireredasr", providerId: "firered" },
  { keyword: "firered", providerId: "firered" },
  { keyword: "xiaohongshu", providerId: "firered" },
  { keyword: "cohere transcribe", providerId: "cohere" },
  { keyword: "coherelabs", providerId: "cohere" },
  { keyword: "cohere labs", providerId: "cohere" },
  { keyword: "cohere", providerId: "cohere" },
  { keyword: "pyannote", providerId: "pyannote" },
  { keyword: "reverb diarization", providerId: "revai" },
  { keyword: "reverb", providerId: "revai" },
  { keyword: "revai", providerId: "revai" },
  { keyword: "sortformer", providerId: "nvidia" },
  // HF TTS Verified collection labels
  { keyword: "piper-voices", providerId: "piper" },
  { keyword: "piper voices", providerId: "piper" },
  { keyword: "rhasspy/piper", providerId: "piper" },
  { keyword: "rhasspy", providerId: "piper" },
  { keyword: "piper", providerId: "piper" },
  { keyword: "speecht5", providerId: "microsoft" },
  { keyword: "speech t5", providerId: "microsoft" },
  { keyword: "parler-tts", providerId: "parler" },
  { keyword: "parler tts", providerId: "parler" },
  { keyword: "parler", providerId: "parler" },
  { keyword: "f5-tts", providerId: "f5tts" },
  { keyword: "f5 tts", providerId: "f5tts" },
  { keyword: "swivid", providerId: "f5tts" },
  { keyword: "tada-", providerId: "huggingface" },
  { keyword: "tada ", providerId: "huggingface" },
  { keyword: "voxtral", providerId: "mistral" },
  { keyword: "lfm2", providerId: "liquid_ai" },
  { keyword: "lfm audio", providerId: "liquid_ai" },
  { keyword: "liquid", providerId: "liquid_ai" },
  { keyword: "hunyuan", providerId: "tencent" },
  { keyword: "tencent", providerId: "tencent" },
  { keyword: "granite", providerId: "ibm" },
  { keyword: "falcon", providerId: "falcon" },
  { keyword: "tii", providerId: "tii" },
  { keyword: "smollm", providerId: "huggingface" },
  { keyword: "smol lm", providerId: "huggingface" },
  { keyword: "vibevoice", providerId: "microsoft" },
  { keyword: "musicgen", providerId: "musicgen" },
  { keyword: "music gen", providerId: "musicgen" },
  { keyword: "audioldm2", providerId: "audioldm2" },
  { keyword: "audioldm 2", providerId: "audioldm2" },
  { keyword: "openvoice", providerId: "openvoice" },
  { keyword: "chatterbox", providerId: "chatterbox" },
  { keyword: "supertonic", providerId: "supertonic" },
  { keyword: "supertone", providerId: "supertonic" },
  { keyword: "kokoro", providerId: "kokoro" },
  { keyword: "xtts", providerId: "xtts" },
  { keyword: "nvidia", providerId: "nvidia" },
  { keyword: "nemotron", providerId: "nvidia" },
  { keyword: "dia ", providerId: "mlx_dia" },
  { keyword: "dia-", providerId: "mlx_dia" },
  { keyword: "csm", providerId: "mlx_csm" },
  { keyword: "spark tts", providerId: "mlx_spark" },
  { keyword: "outetts", providerId: "mlx_oute" },
  { keyword: "oute tts", providerId: "mlx_oute" },
  { keyword: "ming omni", providerId: "mlx_ming_omni" },
  { keyword: "ming-omni", providerId: "mlx_ming_omni" },
  { keyword: "kugelaudio", providerId: "mlx_kugel" },
  { keyword: "bark", providerId: "mlx_bark" },
  { keyword: "fish audio", providerId: "mlx_fish_audio" },
  { keyword: "fish-audio", providerId: "mlx_fish_audio" },
  { keyword: "s2-pro", providerId: "mlx_fish_audio" },
  { keyword: "longcat", providerId: "mlx_longcat_audiodit" },
  { keyword: "audiodit", providerId: "mlx_longcat_audiodit" },
  { keyword: "soprano", providerId: "mlx_soprano" },
  { keyword: "melotts", providerId: "mlx_melotts" },
  { keyword: "melo tts", providerId: "mlx_melotts" },
  { keyword: "higgs", providerId: "mlx_higgs_audio" },
  { keyword: "moss-tts", providerId: "mlx_moss_tts" },
  { keyword: "moss tts", providerId: "mlx_moss_tts" },
  { keyword: "irodori", providerId: "mlx_irodori_tts" },
  { keyword: "indextts", providerId: "mlx_indextts" },
  { keyword: "index tts", providerId: "mlx_indextts" },
  { keyword: "omnivoice", providerId: "mlx_omnivoice" },
  { keyword: "kittentts", providerId: "mlx_kitten_tts" },
  { keyword: "kitten tts", providerId: "mlx_kitten_tts" },
  { keyword: "kitten", providerId: "mlx_kitten_tts" },
  { keyword: "misolabs", providerId: "mlx_miso_tts" },
  { keyword: "misotts", providerId: "mlx_miso_tts" },
  { keyword: "miso tts", providerId: "mlx_miso_tts" },
  { keyword: "pocket tts", providerId: "mlx_pocket_tts" },
  { keyword: "pocket-tts", providerId: "mlx_pocket_tts" },
  { keyword: "voxcpm", providerId: "mlx_voxcpm" },
  { keyword: "orpheus", providerId: "mlx_orpheus" },
  { keyword: "zonos", providerId: "mlx_zonos2" },
  { keyword: "zyphra", providerId: "mlx_zonos2" },
  { keyword: "paddleocr", providerId: "paddlepaddle" },
  { keyword: "paddlepaddle", providerId: "paddlepaddle" },
  { keyword: "pp-ocr", providerId: "paddlepaddle" },
  { keyword: "lightonocr", providerId: "lighton" },
  { keyword: "lighton", providerId: "lighton" },
  { keyword: "chandra", providerId: "datalab" },
  { keyword: "dots.ocr", providerId: "dots" },
  { keyword: "dots.mocr", providerId: "dots" },
  { keyword: "nanonets", providerId: "nanonets" },
  { keyword: "olmocr", providerId: "ai2" },
  { keyword: "allen ai", providerId: "ai2" },
  { keyword: "deepseek", providerId: "deepseek" },
  { keyword: "glm-ocr", providerId: "zai" },
  { keyword: "zhipu", providerId: "zai" },
  { keyword: "tesseract", providerId: "tesseract" },
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
function inferModelBrand(title: string | null | undefined): string | null {
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

const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  vox_jot: "Vox Jot",
  current_dictation: "Vox Jot",
  stt_whisper: "OpenAI Whisper",
  rnnoise: "RNNoise",
  spectral: "Spectral Subtraction",
  deepfilternet: "DeepFilterNet",
  stt_parakeet: "NVIDIA Parakeet",
  stt_moonshine: "Useful Sensors Moonshine",
  stt_moonshine_streaming: "Useful Sensors Moonshine",
  stt_sensevoice: "FunAudioLLM SenseVoice",
  stt_gigaam: "Sber GigaAM",
  stt_qwen: "Alibaba Qwen",
  stt_mlx_audio: "MLX Audio",
  stt_gemma_audio: "Google Gemma Audio",
  stt_apple_speech: "Apple Speech",
  mlx_longcat_audiodit: "Meituan LongCat",
  stability_ai: "Stability AI",
  stable_audio: "Stability AI",
  musicgen: "Meta MusicGen",
  audioldm2: "AudioLDM 2",
  audioldm2_music: "AudioLDM 2 Music",
  ace_step: "ACE-Step",
  yue: "YuE",
  diffrhythm: "DiffRhythm",
  magenta: "Magenta",
  figaro: "FIGARO",
  rule_guided_music: "Rule-Guided Music",
  mlx_soprano: "Soprano",
  mlx_melotts: "MeloTTS",
  mlx_higgs_audio: "Boson Higgs Audio",
  mlx_moss_tts: "OpenMOSS MOSS-TTS",
  mlx_irodori_tts: "Irodori TTS",
  mlx_indextts: "IndexTTS",
  mlx_omnivoice: "OmniVoice",
  mlx_kitten_tts: "KittenTTS",
  mlx_miso_tts: "MisoTTS",
  mlx_vibevoice: "Microsoft VibeVoice",
  mlx_orpheus: "Orpheus",
  mlx_zonos2: "Zyphra ZONOS2",
  nanonets: "Nanonets",
  qwen: "Alibaba Qwen",
  apple: "Apple",
  meta: "Meta Llama",
  liquid_ai: "Liquid AI",
  tencent: "Tencent Hunyuan",
  falcon: "TII Falcon",
  tii: "Technology Innovation Institute",
  ibm: "IBM Granite",
  granite: "IBM Granite",
  huggingface: "Hugging Face",
  polyvoice: "Polyvoice",
  wespeaker: "WeSpeaker",
  silero: "Silero",
  microsoft: "Microsoft",
  google: "Google",
  mistral: "Mistral AI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  nvidia: "NVIDIA",
  meituan: "Meituan LongCat",
  boson: "Boson AI",
  soprano: "Soprano",
  melotts: "MeloTTS",
  openmoss: "OpenMOSS",
  irodori: "Irodori",
  indextts: "IndexTTS",
  kitten: "KittenTTS",
  miso: "MisoTTS",
  k2fsa: "k2-fsa",
  firered: "FireRedASR",
  supertonic: "Supertonic",
  ollama: "Ollama",
  modelscope: "ModelScope",
};

export function providerDisplayName(providerId: string): string {
  return PROVIDER_DISPLAY_NAME[providerId] ?? providerId.replace(/_/g, " ");
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
            letterSpacing: 0,
          }}
        >
          {brand.letter}
        </span>
      )}
    </div>
  );
};
