import { describe, expect, it } from "vitest";
import { formatModelSize } from "@/lib/utils/format";

describe("formatModelSize", () => {
  it("returns an unknown label for empty or invalid sizes", () => {
    expect(formatModelSize(undefined)).toBe("Unknown size");
    expect(formatModelSize(null)).toBe("Unknown size");
    expect(formatModelSize(0)).toBe("Unknown size");
    expect(formatModelSize(-1)).toBe("Unknown size");
    expect(formatModelSize(Number.NaN)).toBe("Unknown size");
  });

  it("formats megabyte sizes with a single decimal below 100 MB", () => {
    expect(formatModelSize(54.4)).toBe("54.4 MB");
  });

  it("formats large megabyte sizes without decimals", () => {
    expect(formatModelSize(540)).toBe("540 MB");
  });

  it("formats gigabyte sizes with locale-aware rounding", () => {
    expect(formatModelSize(1536)).toBe("1.5 GB");
    expect(formatModelSize(11264)).toBe("11 GB");
  });
});
