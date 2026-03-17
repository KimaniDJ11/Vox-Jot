import { openUrl } from "@tauri-apps/plugin-opener";

const DEFAULT_UPDATE_FEED_URL =
  "https://github.com/cjpais/Handy/releases/latest/download/latest.json";
const DEFAULT_RELEASES_URL = "https://github.com/cjpais/Handy/releases/latest";

type UpdateFeedShape = {
  version?: string;
  notes?: string;
  body?: string;
  url?: string;
  html_url?: string;
};

export type CustomUpdateResult = {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  downloadUrl?: string;
};

const normalizeVersion = (version: string): string => {
  return version.trim().replace(/^v/i, "");
};

const compareSemver = (left: string, right: string): number => {
  const lhs = normalizeVersion(left)
    .split(".")
    .map((part) => Number(part));
  const rhs = normalizeVersion(right)
    .split(".")
    .map((part) => Number(part));
  const max = Math.max(lhs.length, rhs.length);

  for (let i = 0; i < max; i += 1) {
    const a = Number.isFinite(lhs[i]) ? lhs[i] : 0;
    const b = Number.isFinite(rhs[i]) ? rhs[i] : 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }

  return 0;
};

const resolveFeedUrl = (): string => {
  return (
    (import.meta.env.VITE_UPDATE_FEED_URL as string | undefined)?.trim() ||
    DEFAULT_UPDATE_FEED_URL
  );
};

export const checkForCustomUpdate = async (
  currentVersion: string,
): Promise<CustomUpdateResult> => {
  const updateFeedUrl = resolveFeedUrl();

  const response = await fetch(updateFeedUrl, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Update feed request failed: ${response.status}`);
  }

  const payload = (await response.json()) as UpdateFeedShape;
  const latestVersion = payload.version?.trim();
  if (!latestVersion) {
    throw new Error("Update feed is missing a version field");
  }

  const available = compareSemver(latestVersion, currentVersion) > 0;
  return {
    available,
    currentVersion,
    latestVersion,
    notes: payload.notes || payload.body,
    downloadUrl: payload.url || payload.html_url || DEFAULT_RELEASES_URL,
  };
};

export const openUpdateDownloadUrl = async (url?: string): Promise<void> => {
  await openUrl(url || DEFAULT_RELEASES_URL);
};
