import type { TFunction } from "i18next";
import type { HubDownloadState } from "./HubModelCard";

export type HubDownloadProgressLike = {
  stage?: string | null;
  error?: string | null;
  percentage?: number | null;
};

export function isDownloadFailed(
  progress?: HubDownloadProgressLike | null,
  localError?: string | null,
): boolean {
  return Boolean(progress?.error || localError || progress?.stage === "failed");
}

export function isDownloadActive(
  progress?: HubDownloadProgressLike | null,
  localBusy?: boolean,
): boolean {
  if (localBusy) return true;
  if (!progress) return false;
  if (isDownloadFailed(progress)) return false;
  if (progress.stage === "complete") return false;
  return true;
}

export function buildHubDownloadState(args: {
  t: TFunction;
  progress?: HubDownloadProgressLike | null;
  localError?: string | null;
  localBusy?: boolean;
  activeLabel: string;
  failedLabel?: string;
  detail?: string | null;
  progressPct?: number | null;
  indeterminate?: boolean;
  cancelling?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  cancelLabel?: string;
}): HubDownloadState | undefined {
  const failed = isDownloadFailed(args.progress, args.localError);
  const active = isDownloadActive(args.progress, args.localBusy);
  if (!active && !failed) return undefined;

  const error = args.progress?.error ?? args.localError ?? null;
  return {
    label: failed
      ? (args.failedLabel ??
        args.t("modelHub.download.failed", { defaultValue: "Download failed" }))
      : args.activeLabel,
    detail: failed ? error : args.detail,
    error: failed ? error : null,
    progress: failed ? null : args.progressPct,
    indeterminate: failed ? false : args.indeterminate,
    cancelling: args.cancelling,
    onCancel: !failed && active ? args.onCancel : undefined,
    onRetry: failed ? args.onRetry : undefined,
    onDismiss: failed ? args.onDismiss : undefined,
    cancelLabel:
      args.cancelLabel ??
      args.t("modelHub.download.cancel", { defaultValue: "Cancel download" }),
    retryLabel: args.t("modelHub.download.retry", {
      defaultValue: "Try again",
    }),
    dismissLabel: args.t("modelHub.download.dismiss", {
      defaultValue: "Dismiss",
    }),
  };
}
