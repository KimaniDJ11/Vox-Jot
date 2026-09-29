import { describe, expect, it, vi } from "vitest";
import type { AppSettings, SettingsSnapshot } from "@/bindings";
import { AppLanguageSync } from "./AppLanguageSync";

const snapshot = (revision: number, language: string): SettingsSnapshot => ({
  revision,
  settings: { app_language: language } as AppSettings,
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const runtime = () => ({
  systemLocale: vi.fn(async () => "en"),
  supportedLanguage: (language: string | null) => language,
  load: vi.fn(async (_language: string) => {}),
  change: vi.fn(async (_language: string) => {}),
});

describe("committed app language", () => {
  it("ignores a late initial snapshot and an older language download", async () => {
    const slow = deferred();
    const native = runtime();
    native.load.mockImplementation(async (language) => {
      if (language === "fr") await slow.promise;
    });
    const sync = new AppLanguageSync(native);
    const first = sync.accept(snapshot(2, "fr"));
    await sync.accept(snapshot(3, "de"));
    await sync.accept(snapshot(1, "en"));
    slow.resolve();
    await first;
    expect(native.change.mock.calls).toEqual([["de"]]);
  });

  it("keeps a pending locale change when unrelated settings are saved", async () => {
    const slow = deferred();
    const native = runtime();
    native.load.mockReturnValue(slow.promise);
    const sync = new AppLanguageSync(native);
    const first = sync.accept(snapshot(1, "fr"));
    await sync.accept(snapshot(2, "fr"));
    slow.resolve();
    await first;
    await sync.accept(snapshot(3, "fr"));
    expect(native.change).toHaveBeenCalledExactlyOnceWith("fr");
  });

  it("applies the latest choice after an in-flight language change", async () => {
    const slow = deferred();
    const native = runtime();
    native.change.mockImplementation(async (language) => {
      if (language === "fr") await slow.promise;
    });
    const sync = new AppLanguageSync(native);
    const first = sync.accept(snapshot(1, "fr"));
    await vi.waitFor(() => expect(native.change).toHaveBeenCalledWith("fr"));
    const second = sync.accept(snapshot(2, "de"));
    slow.resolve();
    await Promise.all([first, second]);
    expect(native.change.mock.calls).toEqual([["fr"], ["de"]]);
  });

  it("uses the system locale and allows a failed load to retry", async () => {
    const native = runtime();
    native.load.mockRejectedValueOnce(new Error("load failed"));
    const sync = new AppLanguageSync(native);
    await expect(sync.accept(snapshot(1, ""))).rejects.toThrow("load failed");
    await sync.accept(snapshot(2, ""));
    expect(native.change).toHaveBeenCalledExactlyOnceWith("en");
  });
});
