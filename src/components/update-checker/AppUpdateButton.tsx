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
import { Download, LoaderCircle, RotateCcw } from "lucide-react";
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

// Release manifests often set the body to nothing more than the version
// (e.g. "Vox Jot 1.0.8"), which the dialog title already states. Strip that
// redundant header so we only show real "What's new" copy — and nothing at all
// when there is none.
const cleanReleaseNotes = (notes?: string, version?: string) => {
  const raw = notes?.replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const redundantForms = new Set(
    [version, version && `vox jot ${version}`, version && `v${version}`]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase()),
  );

  const lines = raw.split("\n");
  while (lines.length > 0 && redundantForms.has(lines[0].trim().toLowerCase())) {
    lines.shift();
  }
  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift();
  }

  return lines.join("\n").trim();
};

interface AppUpdateButtonProps {
  className?: string;
  showLabel?: boolean;
}

const AppUpdateButton: React.FC<AppUpdateButtonProps> = ({
  className = "",
  showLabel = false,
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

  const releaseNotes = useMemo(
    () => cleanReleaseNotes(updateInfo?.notes, updateInfo?.latestVersion),
    [updateInfo?.notes, updateInfo?.latestVersion],
  );
  const hasNotes = releaseNotes.length > 0;

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

  const shouldShowLabel = showLabel && !isInstalling;
  const buttonClassName = shouldShowLabel
    ? "h-8 min-h-8 w-auto min-w-[5.5rem] px-4 text-sm font-bold"
    : "h-8 min-h-8 w-8 px-0";

  return (
    <>
      {updateInfo?.available ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={`app-no-drag app-update-button ${buttonClassName} border-transparent bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_4px_14px_color-mix(in_srgb,var(--accent),transparent_72%)] hover:bg-[var(--accent-hover)] hover:text-[var(--accent-foreground)] ${titleBarOverlayButtonFocusClass} ${className}`}
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
          ) : shouldShowLabel ? (
            <span>{t("common.update", { defaultValue: "Update" })}</span>
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
                className="app-no-drag w-full max-w-[380px] rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] p-5 text-[var(--text)] shadow-[var(--floating-panel-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_6px_16px_color-mix(in_srgb,var(--accent),transparent_70%)]">
                    {phase === "error" ? (
                      <RotateCcw className="h-[18px] w-[18px]" aria-hidden />
                    ) : isInstalling ? (
                      <LoaderCircle
                        className="h-[18px] w-[18px] animate-spin"
                        aria-hidden
                      />
                    ) : (
                      <Download className="h-[18px] w-[18px]" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2
                      id="app-update-title"
                      className="truncate text-sm font-semibold"
                    >
                      {updateTitle}
                    </h2>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {statusLabel}
                    </p>
                  </div>
                </div>

                {phase === "error" ? (
                  <>
                    {installError ? (
                      <p className="mt-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs leading-5 text-[var(--text)]">
                        {installError}
                      </p>
                    ) : null}
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
                  </>
                ) : isInstalling ? (
                  <div className="mt-4">
                    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--input)]">
                      {percent === undefined ? (
                        <div className="absolute inset-y-0 left-0 w-1/3 animate-[hub-progress-sweep_1.35s_ease-in-out_infinite] rounded-full bg-[var(--accent)]" />
                      ) : (
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
                          style={{ width: `${percent}%` }}
                        />
                      )}
                    </div>
                    {phase === "downloading" ? (
                      <div className="mt-2 flex items-center justify-between text-xs tabular-nums text-[var(--muted)]">
                        <span>
                          {percent === undefined
                            ? t("updates.preparing", {
                                defaultValue: "Preparing…",
                              })
                            : `${percent}%`}
                        </span>
                        {progress.total ? (
                          <span>
                            {formatBytes(progress.downloaded)} /{" "}
                            {formatBytes(progress.total)}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                        {t("updates.restartNotice", {
                          defaultValue:
                            "Vox Jot will restart automatically when the update is ready.",
                        })}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {hasNotes ? (
                      <div className="mt-4 border-t border-[var(--ring-hairline)] pt-3">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                          {t("updates.whatsNew", { defaultValue: "What's new" })}
                        </p>
                        <div className="max-h-28 overflow-auto whitespace-pre-line text-xs leading-5 text-[var(--text)]">
                          {releaseNotes}
                        </div>
                      </div>
                    ) : null}
                    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                      {t("updates.installPrompt", {
                        defaultValue:
                          "Vox Jot will close, install the update, and restart automatically.",
                      })}
                    </p>
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
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};

export default AppUpdateButton;
