import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechPlaybackStatus } from "./SpeechPlaybackStatus";
import type { TtsPlaybackStatusEvent } from "@/lib/types/events";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

describe("SpeechPlaybackStatus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders preparing phase with spinner and stop button", async () => {
    const onStop = vi.fn();
    const status: TtsPlaybackStatusEvent = {
      requestId: 101,
      phase: "preparing",
    };

    await act(async () => {
      root.render(<SpeechPlaybackStatus status={status} onStop={onStop} />);
    });

    const aside = container.querySelector('[data-testid="tts-playback-status"]');
    expect(aside).not.toBeNull();
    expect(aside?.getAttribute("data-phase")).toBe("preparing");
    expect(container.textContent).toContain("Text to Speech");
    expect(container.textContent).toContain("Preparing speech…");

    const stopButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop"]',
    );
    expect(stopButton).not.toBeNull();
    await act(async () => {
      stopButton?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("renders speaking phase with volume icon and stop button", async () => {
    const onStop = vi.fn();
    const status: TtsPlaybackStatusEvent = {
      requestId: 102,
      phase: "speaking",
    };

    await act(async () => {
      root.render(<SpeechPlaybackStatus status={status} onStop={onStop} />);
    });

    const aside = container.querySelector('[data-testid="tts-playback-status"]');
    expect(aside?.getAttribute("data-phase")).toBe("speaking");
    expect(container.textContent).toContain("Speaking…");

    const stopButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop"]',
    );
    expect(stopButton).not.toBeNull();
    await act(async () => {
      stopButton?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("renders failed phase without stop button", async () => {
    const onStop = vi.fn();
    const status: TtsPlaybackStatusEvent = {
      requestId: 103,
      phase: "failed",
    };

    await act(async () => {
      root.render(<SpeechPlaybackStatus status={status} onStop={onStop} />);
    });

    const aside = container.querySelector('[data-testid="tts-playback-status"]');
    expect(aside?.getAttribute("data-phase")).toBe("failed");
    expect(container.textContent).toContain("Speech failed");

    const stopButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stop"]',
    );
    expect(stopButton).toBeNull();
  });
});
