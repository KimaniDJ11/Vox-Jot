import { describe, expect, it } from "vitest";

import { getTtsExternalBenchmarkContext } from "@/lib/ttsExternalBenchmarkContext";

describe("TTS external benchmark context", () => {
  it("maps exact upstream families while retaining source and retrieval metadata", () => {
    const context = getTtsExternalBenchmarkContext("kokoro-82m-v1.0");
    expect(context).toMatchObject({
      source: "Artificial Analysis",
      leaderboard: "provider-voice",
      modelName: "Kokoro 82M v1.0",
      elo: 1060.12,
      retrievedAt: "2026-08-27",
    });
    expect(context?.sourceUrl).toContain("artificialanalysis.ai");
    expect(context?.caveat).toContain("local runtime");
  });

  it("does not invent context for an unmatched local model", () => {
    expect(getTtsExternalBenchmarkContext("system-default")).toBeUndefined();
  });
});
