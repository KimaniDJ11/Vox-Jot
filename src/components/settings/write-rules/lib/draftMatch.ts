// Frontend port of the Rust matcher in `src-tauri/src/write_rules.rs`.
// Used to tell the user, while they're editing a profile, whether the
// *draft* would actually fire on the app they have in front right now.
// Calling the existing `testResolveWriteRule` command would only check
// against saved rules, not the unsaved draft — so we duplicate the
// (very small) matching logic here. Keep it in sync with that file.
//
// Tested via the same fixtures as the Rust version: empty bundle_ids
// matches any app; non-empty matches case-insensitive on bundle_id;
// empty url_patterns means no URL constraint; non-empty requires at
// least one wildcard match against the host (or host+path if the
// pattern includes `/`).

import type { WriteRuleMatchers } from "@/bindings";

export interface DraftMatchInput {
  bundleId: string | null;
  appName: string | null;
  url: string | null;
}

export type DraftMatchResult =
  | { kind: "matchesEverything" }
  | { kind: "matches"; appName: string | null }
  | { kind: "noFrontmost" }
  | { kind: "noMatch"; appName: string | null };

export const evaluateDraftMatch = (
  matchers: WriteRuleMatchers,
  input: DraftMatchInput,
): DraftMatchResult => {
  const bundleIds = matchers.bundle_ids ?? [];
  const urlPatterns = matchers.url_patterns ?? [];

  if (bundleIds.length === 0 && urlPatterns.length === 0) {
    return { kind: "matchesEverything" };
  }

  if (!input.bundleId) {
    return { kind: "noFrontmost" };
  }

  const appMatches =
    bundleIds.length === 0 ||
    bundleIds.some(
      (id) => id.toLowerCase() === (input.bundleId ?? "").toLowerCase(),
    );

  const urlMatches =
    urlPatterns.length === 0 ||
    (input.url
      ? urlPatterns.some((pattern) => urlMatchesPattern(pattern, input.url!))
      : false);

  if (appMatches && urlMatches) {
    return { kind: "matches", appName: input.appName };
  }
  return { kind: "noMatch", appName: input.appName };
};

const normalizePattern = (pattern: string) =>
  pattern
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();

const normalizeUrlTarget = (
  url: string,
): { host: string; hostPath: string } | null => {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withoutScheme = trimmed.replace(/^https?:\/\//, "");
  const withoutAuth = withoutScheme.includes("@")
    ? withoutScheme.slice(withoutScheme.lastIndexOf("@") + 1)
    : withoutScheme;
  const withoutFragment = withoutAuth.split("#")[0];
  const withoutQuery = withoutFragment.split("?")[0];
  const slash = withoutQuery.indexOf("/");
  const hostPart = slash === -1 ? withoutQuery : withoutQuery.slice(0, slash);
  const host = hostPart.replace(/:$/, "").trim().toLowerCase();
  if (!host) return null;
  const path =
    slash === -1 ? "" : withoutQuery.slice(slash).replace(/\/+$/, "");
  const hostPath = (path ? host + path : host).toLowerCase();
  return { host, hostPath };
};

const wildcardMatch = (pattern: string, value: string): boolean => {
  // Faithful port of the Rust two-pointer wildcard matcher: `*` is any
  // sequence, `?` is any single character, everything else is literal.
  let p = 0;
  let v = 0;
  let star: number | null = null;
  let starValue = 0;
  while (v < value.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === value[v])) {
      p += 1;
      v += 1;
    } else if (p < pattern.length && pattern[p] === "*") {
      star = p;
      p += 1;
      starValue = v;
    } else if (star !== null) {
      p = star + 1;
      starValue += 1;
      v = starValue;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p += 1;
  return p === pattern.length;
};

const urlMatchesPattern = (pattern: string, url: string): boolean => {
  const normalized = normalizePattern(pattern);
  if (!normalized) return false;
  const target = normalizeUrlTarget(url);
  if (!target) return false;
  return normalized.includes("/")
    ? wildcardMatch(normalized, target.hostPath)
    : wildcardMatch(normalized, target.host);
};
