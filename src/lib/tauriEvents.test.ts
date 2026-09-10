import { beforeEach, describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

import { listen } from "@/lib/tauriEvents";

describe("resilient Tauri events", () => {
  beforeEach(() => {
    eventMocks.listen.mockReset();
    vi.restoreAllMocks();
  });

  it("makes cleanup idempotent and consumes asynchronous teardown failures", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rawUnlisten = vi
      .fn()
      .mockReturnValue(Promise.reject(new Error("listener registry reset")));
    eventMocks.listen.mockResolvedValue(rawUnlisten);

    const unlisten = await listen("lifecycle-event", vi.fn());
    unlisten();
    unlisten();
    await Promise.resolve();

    expect(rawUnlisten).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      "Failed to unlisten for Tauri event 'lifecycle-event':",
      expect.any(Error),
    );
  });

  it("contains synchronous cleanup failures", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    eventMocks.listen.mockResolvedValue(() => {
      throw new Error("webview already destroyed");
    });

    const unlisten = await listen("window-event", vi.fn());

    expect(() => unlisten()).not.toThrow();
    expect(warning).toHaveBeenCalledWith(
      "Failed to unlisten for Tauri event 'window-event':",
      expect.any(Error),
    );
  });

  it("turns registration teardown races into a logged no-op listener", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    eventMocks.listen.mockRejectedValue(new Error("window closing"));

    const unlisten = await listen("closing-event", vi.fn());

    expect(() => unlisten()).not.toThrow();
    expect(warning).toHaveBeenCalledWith(
      "Failed to listen for Tauri event 'closing-event':",
      expect.any(Error),
    );
  });
});
