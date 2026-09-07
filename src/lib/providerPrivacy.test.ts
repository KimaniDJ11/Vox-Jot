import { describe, expect, it } from "vitest";
import { isLocalBaseUrl } from "./providerPrivacy";

describe("provider privacy URL classification", () => {
  it("accepts actual loopback HTTP endpoints", () => {
    for (const url of [
      "http://localhost:11434/v1",
      "https://127.0.0.1:8080",
      "http://[::1]:11434/v1",
      "http://127.2.3.4",
    ]) {
      expect(isLocalBaseUrl(url), url).toBe(true);
    }
  });
  it("rejects lookalike hosts and URL user-info tricks", () => {
    for (const url of [
      "https://localhost.attacker.example",
      "https://127.0.0.1.attacker.example",
      "http://localhost@attacker.example",
      "http://[::1]@attacker.example",
      "file://localhost/v1",
      "https://example.com",
      "",
    ]) {
      expect(isLocalBaseUrl(url), url).toBe(false);
    }
  });
});
