// Mirror of the Rust matcher tests in `src-tauri/src/write_rules.rs`.
// We duplicated the matching logic into TypeScript for the live-match
// hint, so we duplicate the relevant tests too. Keep these in lockstep
// with the Rust suite.

import { describe, expect, it } from "vitest";
import { evaluateDraftMatch } from "./draftMatch";

const app = {
  bundleId: "com.apple.Safari",
  appName: "Safari",
  url: "https://mail.google.com/inbox" as string | null,
};

describe("evaluateDraftMatch", () => {
  it("matches everything when no filters are set", () => {
    const result = evaluateDraftMatch(
      { bundle_ids: [], url_patterns: [] },
      app,
    );
    expect(result.kind).toBe("matchesEverything");
  });

  it("matches by bundle id case-insensitively", () => {
    const result = evaluateDraftMatch(
      { bundle_ids: ["COM.APPLE.SAFARI"], url_patterns: [] },
      app,
    );
    expect(result.kind).toBe("matches");
  });

  it("rejects when bundle id list excludes the frontmost app", () => {
    const result = evaluateDraftMatch(
      { bundle_ids: ["com.something.else"], url_patterns: [] },
      app,
    );
    expect(result.kind).toBe("noMatch");
  });

  it("matches a host wildcard pattern", () => {
    const result = evaluateDraftMatch(
      { bundle_ids: [], url_patterns: ["*.google.com"] },
      app,
    );
    expect(result.kind).toBe("matches");
  });

  it("matches an exact host", () => {
    const result = evaluateDraftMatch(
      { bundle_ids: [], url_patterns: ["mail.google.com"] },
      app,
    );
    expect(result.kind).toBe("matches");
  });

  it("matches host+path patterns when the pattern has a slash", () => {
    const result = evaluateDraftMatch(
      { bundle_ids: [], url_patterns: ["github.com/orgs/*"] },
      { ...app, url: "https://github.com/orgs/anthropic/projects" },
    );
    expect(result.kind).toBe("matches");
  });

  it("does not match host pattern when only path differs", () => {
    const result = evaluateDraftMatch(
      { bundle_ids: [], url_patterns: ["github.com/orgs/*"] },
      { ...app, url: "https://github.com/anthropic" },
    );
    expect(result.kind).toBe("noMatch");
  });

  it("strips the scheme so https-prefixed patterns still match", () => {
    const result = evaluateDraftMatch(
      { bundle_ids: [], url_patterns: ["https://mail.google.com"] },
      app,
    );
    expect(result.kind).toBe("matches");
  });

  it("returns noFrontmost when there is no frontmost app and a filter exists", () => {
    const result = evaluateDraftMatch(
      { bundle_ids: ["com.foo"], url_patterns: [] },
      { bundleId: null, appName: null, url: null },
    );
    expect(result.kind).toBe("noFrontmost");
  });

  it("requires both app and url to match when both filters are set", () => {
    const ok = evaluateDraftMatch(
      {
        bundle_ids: ["com.apple.Safari"],
        url_patterns: ["mail.google.com"],
      },
      app,
    );
    expect(ok.kind).toBe("matches");

    const wrongUrl = evaluateDraftMatch(
      {
        bundle_ids: ["com.apple.Safari"],
        url_patterns: ["docs.google.com"],
      },
      app,
    );
    expect(wrongUrl.kind).toBe("noMatch");
  });
});
