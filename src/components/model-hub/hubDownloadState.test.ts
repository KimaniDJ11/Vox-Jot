import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";

import {
  buildHubDownloadState,
  isDownloadActive,
  isDownloadCancelled,
  isDownloadFailed,
} from "./hubDownloadState";

const t = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as unknown as TFunction;

describe("hubDownloadState", () => {
  it("treats phase cancellation as neutral and recoverable", () => {
    const progress = {
      phase: "cancelled",
      error: "Download cancelled.",
      percentage: 15,
    };

    expect(isDownloadCancelled(progress)).toBe(true);
    expect(isDownloadFailed(progress)).toBe(false);
    expect(isDownloadActive(progress, true)).toBe(false);

    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const state = buildHubDownloadState({
      t,
      progress,
      localBusy: true,
      activeLabel: "Downloading model weights...",
      onRetry,
      onDismiss,
    });

    expect(state?.cancelled).toBe(true);
    expect(state?.error).toBeNull();
    expect(state?.label).toBe("Download cancelled");
    expect(state?.retryLabel).toBe("Resume");
    expect(state?.onRetry).toBe(onRetry);
    expect(state?.onDismiss).toBe(onDismiss);
  });

  it("treats real failures as failed", () => {
    const progress = {
      stage: "failed",
      error: "HTTP 500",
    };

    expect(isDownloadCancelled(progress)).toBe(false);
    expect(isDownloadFailed(progress)).toBe(true);
    expect(isDownloadActive(progress, true)).toBe(false);
  });
});
