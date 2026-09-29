import { describe, expect, it, vi } from "vitest";
import { ReaderAudioCache } from "./ReaderAudioCache";
import type { ReaderUnitAudio } from "./useReaderPlayback";

const audio = (src: string): ReaderUnitAudio => ({
  src,
  durationMs: 1000,
  words: [],
});
function deferred() {
  let resolve!: (value: ReaderUnitAudio) => void;
  const promise = new Promise<ReaderUnitAudio>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Reader audio ownership", () => {
  it("shares a pending synthesis between prefetch and playback", async () => {
    const cache = new ReaderAudioCache(16, vi.fn());
    const request = deferred();
    const render = vi.fn(() => request.promise);
    const prefetch = cache.load("unit", render);
    const playback = cache.load("unit", render);
    expect(playback).toBe(prefetch);
    expect(render).toHaveBeenCalledTimes(1);
    request.resolve(audio("blob:one"));
    const result = await playback;
    expect(await cache.load("unit", render)).toBe(result);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("revokes each completed URL once on eviction and document cleanup", async () => {
    const revoke = vi.fn();
    const cache = new ReaderAudioCache(2, revoke);
    await cache.load("1", async () => audio("blob:1"));
    await cache.load("2", async () => audio("blob:2"));
    await cache.load("3", async () => audio("blob:3"));
    expect(revoke.mock.calls).toEqual([["blob:1"]]);
    cache.clear();
    cache.clear();
    expect(revoke.mock.calls).toEqual([["blob:1"], ["blob:2"], ["blob:3"]]);
  });

  it("revokes late audio from a closed document without replacing or clearing the new load", async () => {
    const revoke = vi.fn();
    const cache = new ReaderAudioCache(16, revoke);
    const old = deferred(),
      current = deferred();
    const oldRequest = cache.load("unit", () => old.promise);
    const oldFailure = expect(oldRequest).rejects.toThrow(
      "Reader document changed",
    );
    cache.clear();
    const currentRequest = cache.load("unit", () => current.promise);
    old.resolve(audio("blob:old"));
    await oldFailure;
    expect(cache.load("unit", vi.fn())).toBe(currentRequest);
    current.resolve(audio("blob:current"));
    expect((await currentRequest).src).toBe("blob:current");
    expect(revoke.mock.calls).toEqual([["blob:old"]]);
    cache.clear();
    expect(revoke.mock.calls).toEqual([["blob:old"], ["blob:current"]]);
  });

  it.each([true, false])(
    "retries a failed synthesis (synchronous failure: %s)",
    async (synchronous) => {
      const cache = new ReaderAudioCache(16, vi.fn());
      const fail = () => {
        if (synchronous) throw new Error("Synthesis failed");
        return Promise.reject(new Error("Synthesis failed"));
      };
      await expect(cache.load("unit", fail)).rejects.toThrow(
        "Synthesis failed",
      );
      expect(
        (await cache.load("unit", async () => audio("blob:retry"))).src,
      ).toBe("blob:retry");
    },
  );
});
