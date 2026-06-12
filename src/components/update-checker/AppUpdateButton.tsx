import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { Download, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useSettings } from "@/hooks/useSettings";
import { installUpdate } from "@/lib/utils/customUpdateChecker";
import { handleDialogKeyDown, useDialogFocusTrap } from "@/lib/ui/focusTrap";
import { isMacAppStoreBuild } from "@/lib/distribution";
import { titleBarOverlayButtonFocusClass } from "@/lib/interactiveFocus";
import { useUpdateStore } from "@/stores/updateStore";

const BACKGROUND_CHECK_DELAY_MS = 2_500;
const BACKGROUND_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

type InstallPhase =
  | "idle"
  | "downloading"
  | "installing"
  | "restarting"
  | "error";

type ProgressState = {
  downloaded: number;
  total?: number;
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
};

const progressPercent = ({ downloaded, total }: ProgressState) => {
  if (!total || total <= 0) return undefined;
  return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
};

const AppUpdateButton: React.FC<{ className?: string }> = ({
  className = "",
}) => {
  const { t } = useTranslation();
  const { settings, isLoading } = useSettings();
  const updateInfo = useUpdateStore((store) => store.updateInfo);
  const checking = useUpdateStore((store) => store.isChecking);
  const checkForUpdates = useUpdateStore((store) => store.checkForUpdates);
  const clearUpdate = useUpdateStore((store) => store.clearUpdate);
  const [modalOpen, setModalOpen] = useState(false);
  const [phase, setPhase] = useState<InstallPhase>("idle");
  const [progress, setProgress] = useState<ProgressState>({ downloaded: 0 });
  const [installError, setInstallError] = useState<string | null>(null);
  const installStartedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const updateChecksEnabled =
    !isMacAppStoreBuild &&
    !isLoading &&
    (settings?.update_checks_enabled ?? false);

  const runCheck = useCallback(
    async (manual = false) => {
      if (!updateChecksEnabled) return;

      try {
        const result = await checkForUpdates();
        if (manual && !result.available) {
          toast.success(
            t("updates.noUpdateAvailable", {
              defaultValue: "Vox Jot is up to date.",
            }),
          );
        }
      } catch (error) {
        if (manual) {
          toast.error(
            t("updates.checkFailed", {
              defaultValue: "Could not check for updates.",
            }),
            {
              description:
                error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    },
    [checkForUpdates, t, updateChecksEnabled],
  );

  useEffect(() => {
    if (!updateChecksEnabled) {
      clearUpdate();
      return;
    }

    const initialCheck = window.setTimeout(() => {
      void runCheck(false);
    }, BACKGROUND_CHECK_DELAY_MS);
    const interval = window.setInterval(() => {
      void runCheck(false);
    }, BACKGROUND_CHECK_INTERVAL_MS);

    const unlisten = listen("check-for-updates", () => {
      void runCheck(true);
    });

    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
      unlisten.then((fn) => fn());
    };
  }, [clearUpdate, runCheck, updateChecksEnabled]);

  const percent = useMemo(() => progressPercent(progress), [progress]);

  const updateTitle = updateInfo?.latestVersion
    ? t("updates.availableWithVersion", {
        defaultValue: "Update to Vox Jot {{version}}",
        version: updateInfo.latestVersion,
      })
    : t("updates.available", { defaultValue: "Update available" });

  const startInstall = useCallback(async () => {
    if (!updateInfo?.update || installStartedRef.current) return;
    installStartedRef.current = true;
    setModalOpen(true);
    setInstallError(null);
    setPhase("downloading");
    setProgress({ downloaded: 0 });

    let downloaded = 0;

    try {
      await installUpdate(updateInfo.update, (event: DownloadEvent) => {
        if (event.event === "Started") {
          downloaded = 0;
          setPhase("downloading");
          setProgress({
            downloaded: 0,
            total: event.data.contentLength,
          });
          return;
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress((current) => ({
            downloaded,
            total: current.total,
          }));
          return;
        }

        if (event.event === "Finished") {
          setPhase("installing");
        }
      });

      setPhase("restarting");
    } catch (error) {
      installStartedRef.current = false;
      setPhase("error");
      setInstallError(error instanceof Error ? error.message : String(error));
    }
  }, [updateInfo]);

  useDialogFocusTrap({
    enabled: modalOpen,
    containerRef: dialogRef,
    initialFocusSelector: "[data-update-dialog-focus]",
  });

  if (!updateInfo?.available && !modalOpen) {
    return null;
  }

  const canClose = phase === "idle" || phase === "error";
  const isInstalling =
    phase === "downloading" || phase === "installing" || phase === "restarting";
  const statusLabel =
    phase === "downloading"
      ? t("updates.downloading", { defaultValue: "Downloading update..." })
      : phase === "installing"
        ? t("updates.installing", { defaultValue: "Installing update..." })
        : phase === "restarting"
          ? t("updates.restarting", { defaultValue: "Restarting Vox Jot..." })
          : phase === "error"
            ? t("updates.failed", { defaultValue: "Update failed" })
            : t("updates.readyToInstall", {
                defaultValue: "Ready to install.",
              });

  return (
    <>
      {updateInfo?.available ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`app-no-drag app-update-button h-8 min-h-8 w-8 border-transparent bg-[var(--update-accent)] text-[var(--update-accent-foreground)] shadow-[0_4px_14px_color-mix(in_srgb,var(--update-accent),transparent_72%)] hover:bg-[var(--update-accent-hover)] hover:text-[var(--update-accent-foreground)] ${titleBarOverlayButtonFocusClass} ${className}`}
          onClick={() => {
            setModalOpen(true);
            if (phase === "idle" || phase === "error") {
              setPhase("idle");
              installStartedRef.current = false;
            }
          }}
          disabled={checking || isInstalling}
          aria-label={updateTitle}
          title={updateTitle}
        >
          {isInstalling ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Download aria-hidden />
          )}
        </Button>
      ) : null}

      {modalOpen
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-start justify-end bg-[var(--scrim-bg-subtle)] p-4 pt-12 backdrop-blur-[2px]">
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="app-update-title"
                data-update-dialog-focus
                tabIndex={0}
                className="app-no-drag w-full max-w-[360px] rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] p-4 text-[var(--text)] shadow-[var(--floating-panel-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                onKeyDown={(event) =>
                  handleDialogKeyDown(
                    event,
                    dialogRef.current,
                    () => {
                      if (canClose) setModalOpen(false);
                    },
                    { escapeDisabled: !canClose },
                  )
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--update-accent)] text-[var(--update-accent-foreground)]">
                      {phase === "error" ? (
                        <RotateCcw className="h-4 w-4" aria-hidden />
                      ) : phase === "restarting" ? (
                        <LoaderCircle
                          className="h-4 w-4 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <Download className="h-4 w-4" aria-hidden />
                      )}
                    </div>
                    <div>
                      <h2
                        id="app-update-title"
                        className="text-sm font-semibold"
                      >
                        {updateTitle}
                      </h2>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {statusLabel}
                      </p>
                    </div>
                  </div>
                  {canClose ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="h-8 min-h-8 w-8"
                      onClick={() => setModalOpen(false)}
                      aria-label={t("common.close")}
                      title={t("common.close")}
                    >
                      <X aria-hidden />
                    </Button>
                  ) : null}
                </div>

                {isInstalling ? (
                  <div className="mt-4">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--input)]">
                      <div
                        className="h-full rounded-full bg-[var(--update-accent)] transition-[width] duration-200"
                        style={{
                          width:
                            percent === undefined
                              ? phase === "installing" || phase === "restarting"
                                ? "100%"
                                : "18%"
                              : `${percent}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-[var(--muted)]">
                      <span>
                        {percent === undefined
                          ? t("updates.preparing", {
                              defaultValue: "Preparing",
                            })
                          : t("updates.percent", {
                              defaultValue: "{{percent}}%",
                              percent,
                            })}
                      </span>
                      {progress.total ? (
                        <span>
                          {formatBytes(progress.downloaded)} /{" "}
                          {formatBytes(progress.total)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {installError ? (
                  <p className="mt-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--text)]">
                    {installError}
                  </p>
                ) : phase === "idle" ? (
                  <div className="mt-3 space-y-2">
                    {updateInfo?.notes ? (
                      <p className="max-h-24 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
                        {updateInfo.notes}
                      </p>
                    ) : null}
                    <p className="text-xs leading-5 text-[var(--muted)]">
                      {t("updates.installPrompt", {
                        defaultValue:
                          "Install now to close Vox Jot, apply the update, and restart.",
                      })}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                    {t("updates.restartNotice", {
                      defaultValue:
                        "Vox Jot will close, install the update, and restart when installation finishes.",
                    })}
                  </p>
                )}

                {phase === "error" ? (
                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setModalOpen(false)}
                    >
                      {t("common.close")}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setPhase("idle");
                        installStartedRef.current = false;
                        void startInstall();
                      }}
                    >
                      {t("updates.retry", { defaultValue: "Retry" })}
                    </Button>
                  </div>
                ) : null}

                {phase === "idle" ? (
                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setModalOpen(false)}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => void startInstall()}
                    >
                      {t("updates.installUpdate", {
                        defaultValue: "Install update",
                      })}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default AppUpdateButton;
