import { describe, expect, it } from "vitest";
import {
  formatKeyCombination,
  getKeyName,
  normalizeKey,
} from "@/lib/utils/keyboard";

describe("keyboard utilities", () => {
  it("derives key names from keyboard codes", () => {
    expect(getKeyName({ code: "KeyA" } as KeyboardEvent, "macos")).toBe("a");
    expect(getKeyName({ code: "Digit5" } as KeyboardEvent, "macos")).toBe("5");
    expect(getKeyName({ code: "Numpad7" } as KeyboardEvent, "windows")).toBe(
      "numpad 7",
    );
    expect(getKeyName({ code: "Slash" } as KeyboardEvent, "linux")).toBe("/");
  });

  it("uses OS-specific modifier names", () => {
    expect(getKeyName({ code: "MetaLeft" } as KeyboardEvent, "macos")).toBe(
      "command",
    );
    expect(getKeyName({ code: "MetaLeft" } as KeyboardEvent, "windows")).toBe(
      "super",
    );
    expect(getKeyName({ key: "Meta" } as KeyboardEvent, "windows")).toBe("win");
    expect(getKeyName({ key: "Alt" } as KeyboardEvent, "macos")).toBe("option");
  });

  it("falls back to an unknown token when no key data is present", () => {
    expect(
      getKeyName({ keyCode: 27, which: 27 } as KeyboardEvent, "unknown"),
    ).toBe("unknown-27");
  });

  it("formats key combinations for display", () => {
    expect(formatKeyCombination("option_left+shift+space", "macos")).toBe(
      "Left Option + Shift + Space",
    );
    expect(formatKeyCombination("fn+f12", "macos")).toBe("fn + F12");
    expect(formatKeyCombination("", "linux")).toBe("");
  });

  it("normalizes left and right modifier labels", () => {
    expect(normalizeKey("left shift")).toBe("shift");
    expect(normalizeKey("right option")).toBe("option");
    expect(normalizeKey("space")).toBe("space");
  });
});
