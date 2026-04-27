// A tiny circular avatar for an app, used in the rule list and chips.
// Falls back from "real icon" → "monogram of the app name" → "?". We
// don't have access to the actual `.app` bundle's icon from the
// webview without a backend round-trip, so today this is just the
// first 1-2 letters of the localized name. Later, if we add an
// `app_icon_for_bundle_id` Tauri command, this is the only place to
// swap in the real PNG.
//
// Heuristic note (Nielsen #6 — Recognition over recall): even a
// letter-mark gives users much more scanability than a wall of text
// rules in the list view.

import React from "react";

interface AppMonogramProps {
  /** Localized app name; falls back to bundle id. */
  name?: string | null;
  /** Bundle id used as a stable hash for the background tint. */
  bundleId: string;
  size?: "xs" | "sm";
  className?: string;
}

const SIZE_PX: Record<NonNullable<AppMonogramProps["size"]>, number> = {
  xs: 18,
  sm: 24,
};

/**
 * Hash the bundle id into one of a handful of preset tints so two
 * different apps get visually distinct chips, but the same app is
 * stable across renders.
 */
const TINTS = [
  "rgba(99,102,241,0.18)", // indigo
  "rgba(16,185,129,0.18)", // emerald
  "rgba(244,114,182,0.18)", // pink
  "rgba(245,158,11,0.18)", // amber
  "rgba(56,189,248,0.18)", // sky
  "rgba(167,139,250,0.18)", // violet
];
function pickTint(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return TINTS[hash % TINTS.length]!;
}

export const AppMonogram: React.FC<AppMonogramProps> = ({
  name,
  bundleId,
  size = "sm",
  className = "",
}) => {
  const display = (name ?? bundleId).trim();
  const initials = display
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "?";
  const px = SIZE_PX[size];
  return (
    <span
      className={
        "inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-[var(--text)] " +
        className
      }
      style={{
        width: px,
        height: px,
        backgroundColor: pickTint(bundleId),
        fontSize: size === "xs" ? 9 : 11,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
};
