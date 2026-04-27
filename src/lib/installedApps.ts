// Shared cache + helpers for the installed-apps list.
//
// `commands.listInstalledApps` shells out to Spotlight on macOS, which
// can take 1–3 seconds on first call. Without caching, the Write Rules
// list (and every other place that resolves bundle ids → app names)
// flashes raw bundle ids until that resolves.
//
// This module:
//   1. Persists the resolved list in `localStorage` so subsequent mounts
//      hydrate synchronously.
//   2. Dedupes concurrent fetches across components that mount at the
//      same time (settings page, app picker, etc).
//   3. Falls back to a humanized version of the bundle id when the list
//      hasn't resolved yet — so the very first cold start shows
//      "Codex" instead of "com.openai…".
//
// This is purely a UI-resolution helper. It doesn't change the data
// model, and the dictation hot path never reads from it.
//
// Latency: synchronous read from localStorage on first paint, with a
// background refresh that does not block rendering.

import { commands, type InstalledApp } from "@/bindings";

const CACHE_KEY = "vox_jot.installed_apps.v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEnvelope {
  ts: number;
  apps: InstalledApp[];
}

let memoryCache: InstalledApp[] | null = null;
let inflight: Promise<InstalledApp[]> | null = null;
const subscribers = new Set<(apps: InstalledApp[]) => void>();

function readLocalStorage(): InstalledApp[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope;
    if (
      !parsed ||
      typeof parsed.ts !== "number" ||
      !Array.isArray(parsed.apps) ||
      Date.now() - parsed.ts > CACHE_TTL_MS
    ) {
      return null;
    }
    return parsed.apps;
  } catch {
    return null;
  }
}

function writeLocalStorage(apps: InstalledApp[]): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: CacheEnvelope = { ts: Date.now(), apps };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Swallow quota / serialization errors silently — this is just a cache.
  }
}

function notify(apps: InstalledApp[]): void {
  for (const subscriber of subscribers) subscriber(apps);
}

/**
 * Synchronously read whatever installed-apps data we already have.
 * Returns `null` if nothing has been resolved yet (caller should show a
 * fallback while the async fetch runs).
 */
export function readCachedInstalledApps(): InstalledApp[] | null {
  if (memoryCache) return memoryCache;
  const fromDisk = readLocalStorage();
  if (fromDisk) {
    memoryCache = fromDisk;
    return fromDisk;
  }
  return null;
}

/**
 * Refresh the installed-apps list from the backend. Concurrent calls
 * dedupe onto the same in-flight Promise.
 */
export async function refreshInstalledApps(): Promise<InstalledApp[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await commands.listInstalledApps();
      const apps = result.status === "ok" ? result.data : [];
      memoryCache = apps;
      writeLocalStorage(apps);
      notify(apps);
      return apps;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Subscribe to fresh installed-apps results. Returns an unsubscribe fn.
 */
export function subscribeInstalledApps(
  listener: (apps: InstalledApp[]) => void,
): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/**
 * Cheap, deterministic fallback for bundle ids that haven't resolved
 * to a real app name yet. Strips reverse-DNS prefixes and de-camelcases
 * the result so `com.openai.codex` → `Codex`,
 * `dev.warp.Warp-Stable` → `Warp Stable`,
 * `com.microsoft.VSCode` → `VS Code`.
 */
export function humanizeBundleId(bundleId: string): string {
  if (!bundleId) return "";
  const trimmed = bundleId.trim();
  const parts = trimmed.split(".").filter(Boolean);
  // Drop common reverse-DNS prefixes (com, dev, org, io, …) but only if
  // there's something more specific later — single-part identifiers are
  // returned as-is.
  const KNOWN_PREFIXES = new Set([
    "com",
    "dev",
    "org",
    "io",
    "net",
    "app",
    "co",
    "us",
    "uk",
    "ai",
    "me",
  ]);
  let segments = parts;
  if (segments.length > 1 && KNOWN_PREFIXES.has(segments[0]!.toLowerCase())) {
    segments = segments.slice(1);
  }
  // Drop a vendor segment if there's a clear product segment after it.
  const VENDOR_SEGMENTS = new Set([
    "apple",
    "microsoft",
    "google",
    "openai",
    "anthropic",
    "todesktop",
    "warp",
  ]);
  if (
    segments.length > 1 &&
    VENDOR_SEGMENTS.has(segments[0]!.toLowerCase())
  ) {
    segments = segments.slice(1);
  }
  const last = segments[segments.length - 1] ?? trimmed;
  return last
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}
