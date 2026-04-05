import { describe, expect, it } from "vitest";
import {
  getLanguageDirection,
  initializeRTL,
  isRTLLanguage,
  updateDocumentDirection,
  updateDocumentLanguage,
} from "@/lib/utils/rtl";

describe("rtl utilities", () => {
  it("detects rtl languages including regional variants", () => {
    expect(isRTLLanguage("ar")).toBe(true);
    expect(isRTLLanguage("ar-EG")).toBe(true);
    expect(isRTLLanguage("en-US")).toBe(false);
    expect(isRTLLanguage("")).toBe(false);
  });

  it("derives the correct document direction", () => {
    expect(getLanguageDirection("ar")).toBe("rtl");
    expect(getLanguageDirection("fr")).toBe("ltr");
  });

  it("updates document attributes directly", () => {
    updateDocumentDirection("rtl");
    updateDocumentLanguage("ar");

    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
  });

  it("initializes both direction and language in one call", () => {
    initializeRTL("en-US");

    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(document.documentElement.getAttribute("lang")).toBe("en-US");
  });
});
