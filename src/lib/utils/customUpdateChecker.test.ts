import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrlMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

import {
  checkForCustomUpdate,
  openUpdateDownloadUrl,
} from "@/lib/utils/customUpdateChecker";

describe("custom update checker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    openUrlMock.mockReset();
  });

  it("checks a custom feed url and returns update details", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "v1.2.0",
        body: "Bug fixes",
        html_url: "https://example.com/releases/1.2.0",
      }),
    });
    vi.stubEnv("VITE_UPDATE_FEED_URL", "https://example.com/latest.json");
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkForCustomUpdate("1.1.0");

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/latest.json", {
      method: "GET",
      cache: "no-store",
    });
    expect(result).toEqual({
      available: true,
      currentVersion: "1.1.0",
      latestVersion: "v1.2.0",
      notes: "Bug fixes",
      downloadUrl: "https://example.com/releases/1.2.0",
    });
  });

  it("uses the default feed and reports when no update is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "1.2.0",
        notes: "Current release",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkForCustomUpdate("1.2.0");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/KimaniDJ11/Vox-Jot/releases/latest/download/latest.json",
      {
        method: "GET",
        cache: "no-store",
      },
    );
    expect(result.available).toBe(false);
    expect(result.downloadUrl).toBe(
      "https://github.com/KimaniDJ11/Vox-Jot/releases/latest",
    );
  });

  it("throws when the feed request fails or omits the version", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ notes: "Missing version" }),
        }),
    );

    await expect(checkForCustomUpdate("1.0.0")).rejects.toThrow(
      "Update feed request failed: 503",
    );
    await expect(checkForCustomUpdate("1.0.0")).rejects.toThrow(
      "Update feed is missing a version field",
    );
  });

  it("opens either a provided download url or the default releases page", async () => {
    await openUpdateDownloadUrl("https://example.com/download");
    await openUpdateDownloadUrl();

    expect(openUrlMock).toHaveBeenNthCalledWith(
      1,
      "https://example.com/download",
    );
    expect(openUrlMock).toHaveBeenNthCalledWith(
      2,
      "https://github.com/KimaniDJ11/Vox-Jot/releases/latest",
    );
  });
});
