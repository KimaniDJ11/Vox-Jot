import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/bindings";

const native = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@/lib/tauriEvents", () => native);
import {
  SETTINGS_SNAPSHOT_EVENT,
  subscribeSettingsSnapshots,
} from "./settingsEvents";

describe("settings change subscription", () => {
  it("delivers every committed snapshot and releases a late native listener", async () => {
    let connected!: (stop: () => void) => void;
    const stop = vi.fn();
    native.listen.mockReturnValue(
      new Promise<() => void>((resolve) => {
        connected = resolve;
      }),
    );
    const onSettings = vi.fn();
    const dispose = subscribeSettingsSnapshots(onSettings);
    expect(native.listen.mock.calls[0][0]).toBe(SETTINGS_SNAPSHOT_EVENT);
    const deliver = native.listen.mock.calls[0][1];

    const first = { app_theme: "dark" } as AppSettings;
    const second = { app_theme: "light" } as AppSettings;
    deliver({ payload: { revision: 1, settings: first } });
    deliver({ payload: { revision: 2, settings: second } });
    expect(onSettings.mock.calls).toEqual([
      [{ revision: 1, settings: first }],
      [{ revision: 2, settings: second }],
    ]);

    dispose();
    dispose();
    connected(stop);
    await Promise.resolve();
    deliver({ payload: { revision: 1, settings: first } });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenCalledTimes(2);
  });
});
