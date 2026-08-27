import { describe, expect, it } from "vitest";

import {
  buildTtsRow,
  formatSpeedFactor,
} from "@/components/app-sections/testing/suiteAdapters";
import { realtimeSpeedBadge } from "@/components/app-sections/testing/metricDisplay";

describe("formatSpeedFactor", () => {
  it("keeps the raw RTF visible next to the intuitive speed factor", () => {
    expect(formatSpeedFactor(0.02)).toBe("50.0× (RTF 0.02)");
    expect(formatSpeedFactor(0.5)).toBe("2.00× (RTF 0.50)");
    expect(formatSpeedFactor(2)).toBe("0.50× (RTF 2.00)");
  });

  it("does not invent a speed for missing or invalid RTF values", () => {
    expect(formatSpeedFactor()).toBe("n/a");
    expect(formatSpeedFactor(0)).toBe("n/a");
    expect(formatSpeedFactor(Number.NaN)).toBe("n/a");
  });
});

describe("realtimeSpeedBadge", () => {
  it("keeps the Real-time+ cue when speed is shown with an embedded RTF", () => {
    expect(realtimeSpeedBadge("Speed", formatSpeedFactor(0.92))).toBe(
      "Real-time+",
    );
    expect(realtimeSpeedBadge("Vitesse", formatSpeedFactor(0.36))).toBe(
      "Real-time+",
    );
    expect(realtimeSpeedBadge("Speed", formatSpeedFactor(3.61))).toBeNull();
  });

  it("still recognizes a dedicated RTF column", () => {
    expect(realtimeSpeedBadge("RTF", "0.48")).toBe("Real-time+");
    expect(realtimeSpeedBadge("RTF", "1.38")).toBeNull();
  });
});

describe("external TTS benchmark context", () => {
  it("keeps hosted-provider context visibly separate from the local score", () => {
    const t = ((key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key) as never;
    const row = buildTtsRow(
      {
        modelId: "kokoro-82m",
        label: "Kokoro 82M",
        status: "tested",
        notes: "Local installed-app result.",
      },
      t,
    );

    expect(row.notes).toContain("Local installed-app result.");
    expect(row.notes).toContain("External context — Artificial Analysis");
    expect(row.notes).toContain("provider-voice leaderboard");
    expect(row.notes).toContain("local runtime");
  });
});
