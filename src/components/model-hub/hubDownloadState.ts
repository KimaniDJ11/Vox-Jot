import type { TFunction } from "i18next";
import type { HubDownloadState } from "./HubModelCard";

export type HubDownloadProgressLike = {
  stage?: string | null;
  phase?: string | null;
  error?: string | null;
  percentage?: number | null;
};

function progressState(
  progress?: HubDownloadProgressLike | null,
): string | null {
  return progress?.stage ?? progress?.phase ?? null;
}

function isCancelledText(value?: string | null): boolean {
  return value?.toLowerCase().includes("cancel") ?? false;
}

export function isDownloadCancelled(
  progress?: HubDownloadProgressLike | null,
  localError?: string | null,
): boolean {
  const state = progressState(progress);
  return (
    state === "cancelled" ||
    isCancelledText(progress?.error) ||
    isCancelledText(localError)
  );
}

export function isDownloadFailed(
  progress?: HubDownloadProgressLike | null,
  localError?: string | null,
): boolean {
  if (isDownloadCancelled(progress, localError)) return false;
  return Boolean(
    progress?.error || localError || progressState(progress) === "failed",
  );
}

export function isDownloadActive(
  progress?: HubDownloadProgressLike | null,
  localBusy?: boolean,
): boolean {
  if (!progress) return Boolean(localBusy);
  if (isDownloadCancelled(progress)) return false;
  if (isDownloadFailed(progress)) return false;
  const state = progressState(progress);
  if (state === "complete") return false;
  if (localBusy) return true;
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
  cancelledLabel?: string;
  cancelledDetail?: string;
  resumeLabel?: string;
}): HubDownloadState | undefined {
  const cancelled = isDownloadCancelled(args.progress, args.localError);
  const failed = isDownloadFailed(args.progress, args.localError);
  const active = isDownloadActive(args.progress, args.localBusy);
  if (!active && !failed && !cancelled) return undefined;

  const error = failed
    ? (args.progress?.error ?? args.localError ?? null)
    : null;
  return {
    label: cancelled
      ? (args.cancelledLabel ??
        args.t("modelHub.download.cancelled", {
          defaultValue: "Download cancelled",
        }))
      : failed
        ? (args.failedLabel ??
          args.t("modelHub.download.failed", {
            defaultValue: "Download failed",
          }))
        : args.activeLabel,
    detail: cancelled
      ? (args.cancelledDetail ??
        args.t("modelHub.download.cancelledDetail", {
          defaultValue: "Download stopped. Start it again from this card.",
        }))
      : failed
        ? error
        : args.detail,
    error,
    cancelled,
    progress: failed || cancelled ? null : args.progressPct,
    indeterminate: failed || cancelled ? false : args.indeterminate,
    cancelling: args.cancelling,
    onCancel: !failed && !cancelled && active ? args.onCancel : undefined,
    onRetry: failed || cancelled ? args.onRetry : undefined,
    onDismiss: failed || cancelled ? args.onDismiss : undefined,
    cancelLabel:
      args.cancelLabel ??
      args.t("modelHub.download.cancel", { defaultValue: "Cancel download" }),
    retryLabel: cancelled
      ? (args.resumeLabel ??
        args.t("modelHub.download.resume", { defaultValue: "Resume" }))
      : args.t("modelHub.download.retry", {
          defaultValue: "Try again",
        }),
    dismissLabel: args.t("modelHub.download.dismiss", {
      defaultValue: "Dismiss",
    }),
  };
}
