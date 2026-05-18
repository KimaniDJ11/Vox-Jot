import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkMock, openUrlMock, relaunchMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  openUrlMock: vi.fn(),
  relaunchMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: relaunchMock,
}));

const FALLBACK_RELEASES_URL =
  "https://huggingface.co/IrieDinamik/vox-jot-releases";

let module: typeof import("@/lib/utils/customUpdateChecker");

beforeEach(async () => {
  vi.resetModules();
  module = await import("@/lib/utils/customUpdateChecker");
});

afterEach(() => {
  checkMock.mockReset();
  openUrlMock.mockReset();
  relaunchMock.mockReset();
});

describe("update checker (plugin-backed)", () => {
  it("returns 'not available' when the updater reports no update", async () => {
    checkMock.mockResolvedValue(null);

    const result = await module.checkForCustomUpdate("1.0.0");

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ available: false, currentVersion: "1.0.0" });
  });

  it("returns 'not available' when the update manifest is unavailable", async () => {
    checkMock.mockRejectedValue(new Error("server returned 404"));

    const result = await module.checkForCustomUpdate("1.0.0");

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ available: false, currentVersion: "1.0.0" });
  });

  it("surfaces available update details from the plugin", async () => {
    const fakeUpdate = {
      version: "1.2.0",
      body: "Bug fixes",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
    checkMock.mockResolvedValue(fakeUpdate);

    const result = await module.checkForCustomUpdate("1.1.0");

    expect(result).toMatchObject({
      available: true,
      currentVersion: "1.1.0",
      latestVersion: "1.2.0",
      notes: "Bug fixes",
      downloadUrl: FALLBACK_RELEASES_URL,
    });
    expect(result.update).toBe(fakeUpdate);
  });

  it("downloads, installs, and relaunches when openUpdateDownloadUrl is called with a pending update", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({
      version: "1.2.0",
      body: "Fixes",
      downloadAndInstall,
    });

    await module.checkForCustomUpdate("1.1.0");
    await module.openUpdateDownloadUrl();

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("falls back to the browser when the in-app install fails", async () => {
    const downloadAndInstall = vi
      .fn()
      .mockRejectedValue(new Error("disk full"));
    checkMock.mockResolvedValue({
      version: "1.2.0",
      body: "Fixes",
      downloadAndInstall,
    });

    await module.checkForCustomUpdate("1.1.0");
    await module.openUpdateDownloadUrl();

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(openUrlMock).toHaveBeenCalledWith(FALLBACK_RELEASES_URL);
  });

  it("opens the releases page when called without a pending update", async () => {
    await module.openUpdateDownloadUrl();
    expect(openUrlMock).toHaveBeenCalledWith(FALLBACK_RELEASES_URL);
  });

  it("opens a custom URL when one is provided and there is no pending update", async () => {
    await module.openUpdateDownloadUrl("https://example.com/download");
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/download");
  });
});
