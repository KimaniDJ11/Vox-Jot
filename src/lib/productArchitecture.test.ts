import { describe, expect, it } from "vitest";
import {
  PRODUCT_MODULES,
  isProductSectionVisible,
  productModuleForSection,
} from "./productArchitecture";

describe("productArchitecture", () => {
  it("keeps lab sections behind the experimental toggle", () => {
    expect(isProductSectionVisible("model-testing", false)).toBe(false);
    expect(isProductSectionVisible("automation-agents", false)).toBe(false);
    expect(isProductSectionVisible("model-testing", true)).toBe(true);
  });

  it("keeps core dictation visible without experiments", () => {
    expect(isProductSectionVisible("history", false)).toBe(true);
    expect(productModuleForSection("history")?.id).toBe("dictation");
  });

  it("marks only dictation as the hot path module", () => {
    const hotPathModules = PRODUCT_MODULES.filter((module) => module.hotPath);
    expect(hotPathModules.map((module) => module.id)).toEqual(["dictation"]);
  });
});
