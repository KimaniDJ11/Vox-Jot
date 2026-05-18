import { describe, expect, it } from "vitest";
import {
  formatFeatureHealthReport,
  summarizeFeatureHealth,
  type FeatureHealthCheck,
} from "@/lib/featureHealth";

const check = (
  id: string,
  status: FeatureHealthCheck["status"],
): FeatureHealthCheck => ({
  id,
  label: id,
  status,
  detail: `${id} detail`,
  elapsedMs: 12,
});

describe("featureHealth", () => {
  it("summarizes healthy, warning, and error states", () => {
    expect(summarizeFeatureHealth([check("settings", "ok")])).toMatchObject({
      ok: 1,
      warnings: 0,
      errors: 0,
      overall: "healthy",
    });

    expect(
      summarizeFeatureHealth([
        check("settings", "ok"),
        check("tts", "warning"),
      ]),
    ).toMatchObject({
      ok: 1,
      warnings: 1,
      errors: 0,
      overall: "warning",
    });

    expect(
      summarizeFeatureHealth([
        check("settings", "ok"),
        check("dictation", "error"),
      ]),
    ).toMatchObject({
      ok: 1,
      warnings: 0,
      errors: 1,
      overall: "error",
    });
  });

  it("formats a copyable support report with errors", () => {
    const report = formatFeatureHealthReport(
      [
        {
          ...check("dictation", "error"),
          label: "Dictation",
          error: "model missing",
        },
      ],
      new Date("2026-05-18T12:00:00.000Z"),
    );

    expect(report).toContain("Generated: 2026-05-18T12:00:00.000Z");
    expect(report).toContain("[ERROR] Dictation");
    expect(report).toContain("Error: model missing");
  });
});
