import { describe, expect, it } from "vitest";

import { postProcessProviderNeedsCredentials } from "./useDictationReadiness";

describe("postProcessProviderNeedsCredentials", () => {
  const providers = [
    { id: "openai", base_url: "https://api.openai.com/v1" },
    { id: "apple_intelligence", base_url: "apple-intelligence://local" },
    { id: "ollama", base_url: "http://127.0.0.1:11434/v1" },
    { id: "lmstudio", base_url: "http://localhost:1234/v1" },
  ];

  it("does not require credentials for Apple Intelligence", () => {
    expect(
      postProcessProviderNeedsCredentials("apple_intelligence", providers),
    ).toBe(false);
  });

  it("does not require credentials for localhost providers", () => {
    expect(postProcessProviderNeedsCredentials("ollama", providers)).toBe(
      false,
    );
    expect(postProcessProviderNeedsCredentials("lmstudio", providers)).toBe(
      false,
    );
  });

  it("requires credentials for remote API providers", () => {
    expect(postProcessProviderNeedsCredentials("openai", providers)).toBe(true);
  });
});
