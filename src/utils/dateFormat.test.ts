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

  it.each(["1e3", "0x10", "0b10", "0o10", "1.5", "+1000"])(
    "rejects non-decimal-integer timestamp syntax: %s",
    (timestamp) => {
      expect(formatDate(timestamp, "en-US")).toBe(timestamp);
      expect(formatTime(timestamp, "en-US")).toBe(timestamp);
    },
  );

  it("still formats valid Unix timestamps", () => {
    expect(formatDate("0", "en-US")).not.toBe("0");
    expect(formatDate("-1", "en-US")).not.toBe("-1");
    expect(formatTime("0", "en-US")).not.toBe("0");
  });
});
