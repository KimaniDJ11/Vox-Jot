import { describe, expect, it } from "vitest";

import { resolveListenSectionId } from "./sectionNavigation";

describe("resolveListenSectionId", () => {
  it("maps removed Create Speech section to Voice Design", () => {
    expect(resolveListenSectionId("create-voices")).toBe("voice-design");
  });

  it("passes through other listen section ids", () => {
    expect(resolveListenSectionId("story-studio")).toBe("story-studio");
  });
});
