import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  type SpeechAnalysisModelDescriptor,
  type WatchFolderConfig,
  type WatchFolderExistingFile,
  commands,
  type WatchFolderOutputFormat,
} from "@/bindings";
import { useTranslation } from "react-i18next";
import {
  type WatchProgressPayload,
  WatchedFoldersStatusHeader,
} from "./WatchedFoldersStatusHeader";
import {
  getLatestAddedWatchFolderId,
  takePendingWatchFolderScan,
  addWatchFolder,
} from "./watchFolderEvents";
import { listen } from "@/lib/tauriEvents";
import { subtleCardClassName } from "@/components/ui/subtleCard";
import { FolderPlus, Trash2, X, FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { basename } from "../file-workspace/filePaths";
import { NativeFolderIcon } from "./NativeFolderIcon";
import { ActionIconButton } from "@/components/ui";
import { WatchFolderFormatPicker } from "./WatchFolderFormatPicker";
import { createPortal } from "react-dom";
import { WatchFolderExistingFilesDialog } from "./WatchFolderExistingFilesDialog";

export const WatchedFoldersGroup: React.FC<{
  selectedAsrModel: SpeechAnalysisModelDescriptor | null;
}> = ({ selectedAsrModel }) => {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<WatchFolderConfig[]>([]);
  const [activity, setActivity] = useState<WatchProgressPayload[]>([]);
  const [busy, setBusy] = useState(false);
  const [newlyAddedFolderId, setNewlyAddedFolderId] = useState<string | null>(
    getLatestAddedWatchFolderId,
  );
  const [confirmingDeleteFolderId, setConfirmingDeleteFolderId] = useState<
    string | null
  >(null);
  const [scanTarget, setScanTarget] = useState<{
    folder: WatchFolderConfig;
    files: WatchFolderExistingFile[];
  } | null>(null);

  const refresh = useCallback(async () => {
    const r = await commands.listWatchFolders();
    if (r.status === "ok") setFolders(r.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Offer to transcribe files that were already in the folder. `always`
  // controls the just-added auto-popup (skip when the folder is empty)
  // vs. the explicit per-card button (always show, even if empty).
  const offerExistingFiles = useCallback(
    async (folder: WatchFolderConfig, always: boolean) => {
      const r = await commands.listWatchFolderFiles(folder.id);
      if (r.status !== "ok") {
        console.error("listWatchFolderFiles failed:", r.error);
        return;
      }
      if (always || r.data.length > 0) {
        setScanTarget({ folder, files: r.data });
      }
    },
    [],
  );

  const consumePendingScan = useCallback(() => {
    const folder = takePendingWatchFolderScan();
    if (!folder) return;
    void offerExistingFiles(folder, false);
  }, [offerExistingFiles]);

  useEffect(() => {
    // The toolbar's add button fires before this group mounts, so check
    // for a pending hand-off on mount as well as on the change event.
    consumePendingScan();
  }, [consumePendingScan]);

  useEffect(() => {
    const handleWatchFoldersChanged = (event: Event) => {
      const folder = (event as CustomEvent<WatchFolderConfig>).detail;
      if (folder?.id) setNewlyAddedFolderId(folder.id);
      void refresh();
      consumePendingScan();
    };
    window.addEventListener("watch-folders-changed", handleWatchFoldersChanged);
    return () =>
      window.removeEventListener(
        "watch-folders-changed",
        handleWatchFoldersChanged,
      );
  }, [refresh, consumePendingScan]);

  // Live activity feed: backend emits one event per stage change. We
  // only keep the latest 5 so the UI stays compact.
  useEffect(() => {
    const unlistenPromise = listen<WatchProgressPayload>(
      "watch-folder-progress",
      (event) => {
        setActivity((prev) => [event.payload, ...prev].slice(0, 5));
        if (event.payload.stage === "missing") {
          void refresh();
        }
      },
    );
    return () => {
      void unlistenPromise.then((fn) => fn());
    };
  }, [refresh]);

  const removeFolder = useCallback(
    async (folder: WatchFolderConfig) => {
      setBusy(true);
      try {
        const r = await commands.removeWatchFolder(folder.id);
        if (r.status === "ok") {
          setConfirmingDeleteFolderId(null);
          await refresh();
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const updateFormat = useCallback(
    async (id: string, format: WatchFolderOutputFormat) => {
      const r = await commands.updateWatchFolderFormat(id, format);
      if (r.status === "ok") await refresh();
    },
    [refresh],
  );
  const latestActivityByFolder = useMemo(() => {
    const map = new Map<string, WatchProgressPayload>();
    for (const event of activity) {
      if (!map.has(event.folder_id)) {
        map.set(event.folder_id, event);
      }
    }
    return map;
  }, [activity]);

  return (
    <div
      className={[subtleCardClassName, "space-y-4"].join(" ")}
      data-testid="watch-folders-panel"
    >
      <WatchedFoldersStatusHeader
        folders={folders}
        activity={activity}
        selectedAsrModel={selectedAsrModel}
      />

      {folders.length === 0 ? (
        <div
          className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg)] px-5 py-8 text-center"
          data-testid="watch-folders-empty-surface"
        >
          <div
            className="flex size-11 items-center justify-center rounded-full bg-[var(--input)] text-[var(--muted)]"
            aria-hidden="true"
          >
            <FolderPlus size={20} />
          </div>
          <div className="mt-6 text-sm font-semibold text-[var(--text)]">
            {t("dictate.watchFolders.empty", {
              defaultValue: "No watched folders yet.",
            })}
          </div>
          <p className="mt-3 max-w-md text-xs leading-5 text-[var(--muted)]">
            {t("dictate.watchFolders.emptyExample", {
              defaultValue:
                "For example, watch an Interviews folder and save each new recording as text, SRT, or VTT.",
            })}
          </p>
          <div className="mt-5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                setBusy(true);
                try {
                  const folder = await addWatchFolder();
                  if (folder) {
                    setNewlyAddedFolderId(folder.id);
                    await refresh();
                  }
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              <span
                className="inline-flex h-4 w-4 items-center justify-center text-[1.15em] font-bold leading-none text-[var(--accent-hover)]"
                aria-hidden
              >
                +
              </span>
              {t("dictate.watchFolders.add", { defaultValue: "Add folder" })}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <ul className="flex flex-wrap gap-2">
            {folders.map((f) => {
              const latest = latestActivityByFolder.get(f.id);
              const isMissing = f.missing || latest?.stage === "missing";
              const showActions = newlyAddedFolderId === f.id || isMissing;
              const statusLabel = isMissing
                ? t("dictate.watchFolders.status.missing", {
                    defaultValue: "Folder missing",
                  })
                : latest
                  ? `${latest.stage}: ${basename(latest.source_path)}`
                  : f.enabled
                    ? null
                    : t("dictate.watchFolders.status.paused", {
                        defaultValue: "Paused",
                      });
              return (
                <li
                  key={f.id}
                  className={[
                    "group flex min-h-[136px] w-36 flex-col items-center justify-center rounded-xl px-2 py-2 transition-colors hover:bg-[var(--input)] focus-within:bg-[var(--input)]",
                    isMissing
                      ? "bg-[color-mix(in_srgb,var(--danger),transparent_94%)]"
                      : "",
                  ].join(" ")}
                >
                  <NativeFolderIcon
                    path={f.path}
                    name={basename(f.path)}
                    missing={isMissing}
                  />
                  <h3
                    className="mt-2 max-w-full truncate px-1 text-center text-sm font-medium text-[var(--text)]"
                    title={basename(f.path)}
                  >
                    {basename(f.path)}
                  </h3>
                  {statusLabel ? (
                    <p
                      role="status"
                      aria-live="polite"
                      title={statusLabel}
                      className={
                        isMissing
                          ? "mt-1 max-w-full truncate text-center text-[11px] font-medium text-[var(--danger)]"
                          : "mt-1 max-w-full truncate text-center text-[11px] text-[var(--muted)]"
                      }
                    >
                      {statusLabel}
                    </p>
                  ) : null}
                  <div
                    className={[
                      "mt-2 flex items-center justify-center gap-1 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                      showActions || confirmingDeleteFolderId === f.id
                        ? "pointer-events-auto opacity-100"
                        : "pointer-events-none opacity-0",
                    ].join(" ")}
                  >
                    {confirmingDeleteFolderId === f.id ? (
                      <>
                        <ActionIconButton
                          type="button"
                          tone="confirm"
                          onClick={() => void removeFolder(f)}
                          disabled={busy}
                          title={t("dictate.watchFolders.confirmRemove", {
                            defaultValue: "Confirm remove folder",
                          })}
                          aria-label={t("dictate.watchFolders.confirmRemove", {
                            defaultValue: "Confirm remove folder",
                          })}
                        >
                          <Trash2 aria-hidden />
                        </ActionIconButton>
                        <ActionIconButton
                          type="button"
                          onClick={() => setConfirmingDeleteFolderId(null)}
                          disabled={busy}
                          title={t("dictate.watchFolders.cancelRemove", {
                            defaultValue: "Cancel remove folder",
                          })}
                          aria-label={t("dictate.watchFolders.cancelRemove", {
                            defaultValue: "Cancel remove folder",
                          })}
                        >
                          <X aria-hidden />
                        </ActionIconButton>
                      </>
                    ) : (
                      <>
                        {!isMissing ? (
                          <WatchFolderFormatPicker
                            value={f.output_format}
                            onChange={(format) =>
                              void updateFormat(f.id, format)
                            }
                          />
                        ) : null}
                        {!isMissing ? (
                          <ActionIconButton
                            type="button"
                            onClick={() => void offerExistingFiles(f, true)}
                            title={t("dictate.watchFolders.scan.action", {
                              defaultValue: "Transcribe existing files",
                            })}
                            aria-label={t("dictate.watchFolders.scan.action", {
                              defaultValue: "Transcribe existing files",
                            })}
                          >
                            <FolderSearch aria-hidden />
                          </ActionIconButton>
                        ) : null}
                        <ActionIconButton
                          type="button"
                          tone="danger"
                          onClick={() => setConfirmingDeleteFolderId(f.id)}
                          aria-label={t("dictate.watchFolders.remove", {
                            defaultValue: "Remove folder",
                          })}
                        >
                          <Trash2 aria-hidden />
                        </ActionIconButton>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {activity.length > 0 && (
        <div
          className="border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]"
          role="status"
          aria-live="polite"
        >
          <div className="mb-1 font-medium text-[var(--text)]">
            {t("dictate.watchFolders.recentActivity", {
              defaultValue: "Recent activity",
            })}
          </div>
          <ul className="space-y-0.5">
            {activity.map((a, idx) => (
              <li key={`${a.source_path}-${idx}`} className="truncate">
                <span
                  className={
                    a.stage === "completed"
                      ? "text-[var(--accent)]"
                      : a.stage === "failed" || a.stage === "missing"
                        ? "text-[var(--danger)]"
                        : ""
                  }
                >
                  [{a.stage}]
                </span>{" "}
                {basename(a.source_path)}
                {a.message ? (
                  <span className="text-[var(--muted)]"> — {a.message}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {scanTarget
        ? createPortal(
            <WatchFolderExistingFilesDialog
              folder={scanTarget.folder}
              files={scanTarget.files}
              onClose={() => setScanTarget(null)}
            />,
            document.body,
          )
        : null}
    </div>
  );
};
