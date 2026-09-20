import { describe, expect, it } from "vitest";
import { formatDate, formatTime } from "./dateFormat";

describe("date formatting", () => {
  it("does not partially parse malformed Unix timestamps", () => {
    expect(formatDate("1700000000garbage", "en-US")).toBe(
      "1700000000garbage",
    );
    expect(formatTime("1700000000garbage", "en-US")).toBe(
      "1700000000garbage",
    );
  });

  it("returns blank and non-finite timestamps unchanged", () => {
    expect(formatDate("", "en-US")).toBe("");
    expect(formatTime("   ", "en-US")).toBe("   ");
    expect(formatDate("Infinity", "en-US")).toBe("Infinity");
  });

  it("still formats valid Unix timestamps", () => {
    expect(formatDate("0", "en-US")).toBe("January 1, 1970");
    expect(formatTime("0", "en-US")).not.toBe("0");
  });
});
