import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkForCustomUpdateMock, getVersionMock } = vi.hoisted(() => ({
  checkForCustomUpdateMock: vi.fn(),
  getVersionMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: getVersionMock,
}));

vi.mock("@/lib/utils/customUpdateChecker", () => ({
  checkForCustomUpdate: checkForCustomUpdateMock,
}));

let module: typeof import("@/stores/updateStore");

beforeEach(async () => {
  vi.resetModules();
  getVersionMock.mockReset();
  checkForCustomUpdateMock.mockReset();
  module = await import("@/stores/updateStore");
});

describe("update store", () => {
  it("stores available update details for every subscriber", async () => {
    getVersionMock.mockResolvedValue("1.0.5");
    checkForCustomUpdateMock.mockResolvedValue({
      available: true,
      currentVersion: "1.0.5",
      latestVersion: "1.0.6",
      downloadUrl: "https://example.com/update",
      update: { version: "1.0.6" },
    });

    const result = await module.useUpdateStore.getState().checkForUpdates();

    expect(result.available).toBe(true);
    expect(module.useUpdateStore.getState().updateInfo?.latestVersion).toBe(
      "1.0.6",
    );
    expect(module.useUpdateStore.getState().isChecking).toBe(false);
  });

  it("deduplicates concurrent checks from the toolbar and About screen", async () => {
    let resolveCheck:
      | ((result: Awaited<ReturnType<typeof checkForCustomUpdateMock>>) => void)
      | undefined;

    getVersionMock.mockResolvedValue("1.0.5");
    checkForCustomUpdateMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );

    const first = module.useUpdateStore.getState().checkForUpdates();
    const second = module.useUpdateStore.getState().checkForUpdates();

    expect(getVersionMock).toHaveBeenCalledTimes(1);
    expect(checkForCustomUpdateMock).toHaveBeenCalledTimes(0);

    await Promise.resolve();

    expect(checkForCustomUpdateMock).toHaveBeenCalledTimes(1);

    resolveCheck?.({
      available: true,
      currentVersion: "1.0.5",
      latestVersion: "1.0.6",
      update: { version: "1.0.6" },
    });

    await expect(first).resolves.toMatchObject({ latestVersion: "1.0.6" });
    await expect(second).resolves.toMatchObject({ latestVersion: "1.0.6" });
    expect(checkForCustomUpdateMock).toHaveBeenCalledTimes(1);
  });
});
