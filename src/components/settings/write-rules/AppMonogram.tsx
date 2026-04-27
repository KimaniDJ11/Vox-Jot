// A tiny circular avatar for an app, used in the rule list and chips.
//
// Resolution order:
//   1. Real `.app` icon resolved from the macOS app bundle (cached).
//   2. Two-letter monogram from the localized name.
//   3. "?".
//
// The icon is fetched lazily through the `useAppIcon` hook and cached at
// module scope, so the *same* bundle id is only fetched once per session
// and concurrent renders dedupe onto a single in-flight Promise. While the
// icon is loading we show the monogram so there is never a blank chip.
//
// Heuristic note (Nielsen #6 — Recognition over recall): an actual app icon
// gives users a much faster scan than a letter mark.

import React from "react";
import { commands } from "@/bindings";

interface AppMonogramProps {
  /** Localized app name; falls back to bundle id. */
  name?: string | null;
  /** Bundle id used as a stable hash for the background tint. */
  bundleId: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZE_PX: Record<NonNullable<AppMonogramProps["size"]>, number> = {
  xs: 18,
  sm: 24,
  md: 32,
  lg: 40,
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

// ─── Icon cache ────────────────────────────────────────────────────────
// Resolved data URLs (or null when the OS could not produce one). Keyed
// by bundle id. Lives for the lifetime of the page.
const ICON_CACHE = new Map<string, string | null>();
// In-flight promises so simultaneous mounts don't fire duplicate IPC calls.
const ICON_INFLIGHT = new Map<string, Promise<string | null>>();
// Subscribers that should re-render once a fetch lands.
const ICON_LISTENERS = new Map<string, Set<() => void>>();

function notifyListeners(bundleId: string): void {
  const listeners = ICON_LISTENERS.get(bundleId);
  if (!listeners) return;
  for (const listener of listeners) listener();
}

async function fetchIcon(bundleId: string): Promise<string | null> {
  const existing = ICON_INFLIGHT.get(bundleId);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const result = await commands.getAppIcon(bundleId);
      const value = result.status === "ok" ? result.data : null;
      ICON_CACHE.set(bundleId, value);
      return value;
    } catch {
      ICON_CACHE.set(bundleId, null);
      return null;
    } finally {
      ICON_INFLIGHT.delete(bundleId);
      notifyListeners(bundleId);
    }
  })();
  ICON_INFLIGHT.set(bundleId, promise);
  return promise;
}

function useAppIcon(bundleId: string): string | null {
  const [icon, setIcon] = React.useState<string | null>(
    () => ICON_CACHE.get(bundleId) ?? null,
  );

  React.useEffect(() => {
    if (!bundleId) return;

    if (ICON_CACHE.has(bundleId)) {
      setIcon(ICON_CACHE.get(bundleId) ?? null);
    } else {
      void fetchIcon(bundleId);
    }

    const listener = () => setIcon(ICON_CACHE.get(bundleId) ?? null);
    let listeners = ICON_LISTENERS.get(bundleId);
    if (!listeners) {
      listeners = new Set();
      ICON_LISTENERS.set(bundleId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners && listeners.size === 0) {
        ICON_LISTENERS.delete(bundleId);
      }
    };
  }, [bundleId]);

  return icon;
}

export const AppMonogram: React.FC<AppMonogramProps> = ({
  name,
  bundleId,
  size = "sm",
  className = "",
}) => {
  const display = (name ?? bundleId).trim();
  const initials =
    display
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "?";
  const px = SIZE_PX[size];
  const iconDataUrl = useAppIcon(bundleId);

  if (iconDataUrl) {
    return (
      <img
        src={iconDataUrl}
        alt=""
        width={px}
        height={px}
        className={"inline-block shrink-0 rounded-md " + className}
        style={{ width: px, height: px }}
        aria-hidden="true"
        draggable={false}
      />
    );
  }

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
        fontSize:
          size === "xs"
            ? 9
            : size === "md"
              ? 13
              : size === "lg"
                ? 16
                : 11,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
};
