import React, { useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  FileAudio,
  Folder,
  FolderPlus,
  Layers,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  TimedSegment,
  WatchFolderConfig,
  WatchFolderOutputFormat,
} from "@/bindings";
import { commands } from "@/bindings";
import { SegmentedControl, SettingsGroup } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Textarea } from "@/components/ui/Textarea";
import { subtleCardClassName } from "@/components/ui/subtleCard";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
import { openModelHub } from "@/components/model-hub/modelHubTabs";

type FileTranscriptionView = "file" | "folders";

const AUDIO_VIDEO_EXTENSIONS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "oga",
  "opus",
  "wma",
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
  "3gp",
];

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function stripExtension(p: string): string {
  const base = basename(p);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export const FileTranscriptionPanel: React.FC = () => {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [transcription, setTranscription] = useState<string>("");
  const [segments, setSegments] = useState<TimedSegment[]>([]);
  const [error, setError] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [view, setView] = useState<FileTranscriptionView>("file");
  const isRunningRef = useRef(false);

  const runTranscription = useCallback(
    async (filePath: string) => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;
      setIsRunning(true);
      setError("");
      setSelectedPath(filePath);
      setSegments([]);
      try {
        const result = await commands.transcribeFile(filePath);
        if (result.status === "ok") {
          setTranscription(result.data.text);
          setSegments(result.data.segments);
        } else {
          setError(
            result.error ||
              t("dictate.fileTranscription.errors.failed", {
                defaultValue: "Failed to transcribe file.",
              }),
          );
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : t("dictate.fileTranscription.errors.failed", {
                defaultValue: "Failed to transcribe file.",
              }),
        );
      } finally {
        isRunningRef.current = false;
        setIsRunning(false);
      }
    },
    [t],
  );

  const exportSubtitles = useCallback(
    async (format: "srt" | "vtt") => {
      if (segments.length === 0) return;
      const suggestedBase = selectedPath
        ? stripExtension(selectedPath)
        : "transcript";
      const target = await save({
        defaultPath: `${suggestedBase}.${format}`,
        filters: [
          {
            name: format.toUpperCase(),
            extensions: [format],
          },
        ],
      });
      if (!target) return;
      try {
        const result =
          format === "srt"
            ? await commands.exportSubtitlesSrt(segments, target)
            : await commands.exportSubtitlesVtt(segments, target);
        if (result.status === "error") {
          setError(result.error);
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : t("dictate.fileTranscription.errors.exportFailed", {
                defaultValue: "Failed to export subtitles.",
              }),
        );
      }
    },
    [segments, selectedPath, t],
  );

  const pickFile = useCallback(async () => {
    if (isRunningRef.current) return;
    const filePath = await open({
      multiple: false,
      filters: [
        {
          name: t("dictate.fileTranscription.fileDialogLabel", {
            defaultValue: "Audio / Video",
          }),
          extensions: AUDIO_VIDEO_EXTENSIONS,
        },
      ],
    });
    if (!filePath || Array.isArray(filePath)) return;
    await runTranscription(filePath);
  }, [runTranscription, t]);

  const copyResult = useCallback(async () => {
    if (!transcription.trim()) return;
    try {
      await navigator.clipboard.writeText(transcription);
    } catch {
      setError(
        t("dictate.fileTranscription.errors.copyFailed", {
          defaultValue: "Failed to copy transcription.",
        }),
      );
    }
  }, [transcription, t]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const fn = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragOver(true);
        } else if (payload.type === "leave") {
          setIsDragOver(false);
        } else if (payload.type === "drop") {
          setIsDragOver(false);
          if (isRunningRef.current) return;
          const first = payload.paths?.[0];
          if (!first) return;
          void runTranscription(first);
        }
      });
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [runTranscription]);

  return (
    <div className="space-y-7" aria-busy={isRunning}>
      <SettingsGroup
        noCard
        title={t("dictate.fileTranscription.title", {
          defaultValue: "File Transcription",
        })}
        description={t("dictate.fileTranscription.description", {
          defaultValue:
            "Transcribe one audio or video file, or watch folders and save transcripts automatically.",
        })}
        showTitle={false}
        descriptionOnlyGap="controls"
      >
        <WatchedFoldersToolbar view={view} onViewChange={setView} />
      </SettingsGroup>

      {view === "file" ? (
        <>
          <div
            className={[
              subtleCardClassName,
              "flex flex-col items-center justify-center gap-3 border-dashed text-center transition-[border-color,background-color,box-shadow] duration-150",
              isDragOver
                ? "border-[var(--accent)] bg-[var(--accent-soft,var(--panel-bg))] shadow-[var(--shadow-md,var(--shadow-sm))]"
                : "",
            ].join(" ")}
            style={{ minHeight: 180 }}
          >
            <div
              className="flex size-12 items-center justify-center rounded-full bg-[var(--input)] text-[var(--muted)]"
              aria-hidden="true"
            >
              {isDragOver ? <Upload size={22} /> : <FileAudio size={22} />}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-[var(--text)]">
                {t("dictate.fileTranscription.dropHint", {
                  defaultValue: "Drag & drop an audio or video file here",
                })}
              </div>
              <div className="text-xs text-[var(--muted)]">
                {t("dictate.fileTranscription.orLabel", { defaultValue: "or" })}
              </div>
            </div>
            <Button variant="secondary" onClick={pickFile} disabled={isRunning}>
              {isRunning
                ? t("dictate.fileTranscription.transcribing", {
                    defaultValue: "Transcribing…",
                  })
                : t("dictate.fileTranscription.pickFile", {
                    defaultValue: "Pick File",
                  })}
            </Button>
          </div>

          {selectedPath && (
            <div
              className="truncate text-xs text-[var(--muted)]"
              title={selectedPath}
              aria-label={selectedPath}
            >
              {t("dictate.fileTranscription.selectedLabel", {
                defaultValue: "Selected:",
              })}{" "}
              <span className="text-[var(--text)]">
                {basename(selectedPath)}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <label
              className="text-xs font-medium text-[var(--muted)]"
              htmlFor="file-transcription-output"
            >
              {t("dictate.fileTranscription.outputLabel", {
                defaultValue: "Transcript",
              })}
            </label>
            <Textarea
              id="file-transcription-output"
              value={transcription}
              readOnly
              placeholder={t("dictate.fileTranscription.placeholder", {
                defaultValue: "Transcript appears here after processing.",
              })}
              aria-live="polite"
              className="min-h-[140px]"
            />
            <div className="flex items-center justify-between gap-2">
              {isRunning ? (
                <span
                  className="inline-flex items-center gap-2 text-xs text-[var(--muted)]"
                  role="status"
                >
                  <span
                    className="inline-block size-3 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]"
                    aria-hidden="true"
                  />
                  {t("dictate.fileTranscription.transcribing", {
                    defaultValue: "Transcribing…",
                  })}
                </span>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => exportSubtitles("srt")}
                  disabled={segments.length === 0 || isRunning}
                  title={
                    segments.length === 0
                      ? t("dictate.fileTranscription.exportSrtUnavailable", {
                          defaultValue:
                            "This engine does not provide timestamps. Switch to Whisper or Parakeet for SRT/VTT export.",
                        })
                      : undefined
                  }
                >
                  {t("dictate.fileTranscription.exportSrt", {
                    defaultValue: "Save .srt",
                  })}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => exportSubtitles("vtt")}
                  disabled={segments.length === 0 || isRunning}
                  title={
                    segments.length === 0
                      ? t("dictate.fileTranscription.exportSrtUnavailable", {
                          defaultValue:
                            "This engine does not provide timestamps. Switch to Whisper or Parakeet for SRT/VTT export.",
                        })
                      : undefined
                  }
                >
                  {t("dictate.fileTranscription.exportVtt", {
                    defaultValue: "Save .vtt",
                  })}
                </Button>
                <Button
                  variant="secondary"
                  onClick={copyResult}
                  disabled={!transcription.trim() || isRunning}
                >
                  {t("dictate.fileTranscription.copy", {
                    defaultValue: "Copy",
                  })}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <WatchedFoldersGroup />
      )}

      {error && (
        <div
          className="flex items-start gap-2 rounded-2xl border border-[var(--danger)] bg-[var(--input)] px-4 py-3 text-xs text-[var(--danger)]"
          role="alert"
        >
          <AlertCircle
            size={16}
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          <div>
            <div className="font-medium">
              {t("dictate.fileTranscription.errors.heading", {
                defaultValue: "Transcription failed",
              })}
            </div>
            <div className="mt-1 break-words text-[var(--text)]">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────── Watched folders ──────────────────────────────────
//
// User flow:
//   1. Click "Add folder" → folder picker.
//   2. Pick output format (Text / SRT / VTT) per row.
//   3. Drop audio files into the folder in Finder; Vox Jot transcribes
//      in the background and writes the result next to the file.
//
// State stays in Rust (`AppSettings.watch_folders`); we just call the
// command APIs and refresh from the backend after each mutation.

type WatchProgressPayload = {
  folder_id: string;
  source_path: string;
  stage: "started" | "completed" | "failed";
  message: string | null;
};

const FOLDER_ICON_CACHE = new Map<string, string | null>();

const formatLabel = (format?: WatchFolderOutputFormat): string => {
  switch (format) {
    case "srt":
      return "SRT";
    case "vtt":
      return "VTT";
    case "text":
    default:
      return "Text";
  }
};

const NativeFolderIcon: React.FC<{ path: string; name: string }> = ({
  path,
  name,
}) => {
  const [icon, setIcon] = useState<string | null>(() => {
    return FOLDER_ICON_CACHE.has(path) ? FOLDER_ICON_CACHE.get(path)! : null;
  });

  useEffect(() => {
    let cancelled = false;
    if (FOLDER_ICON_CACHE.has(path)) {
      setIcon(FOLDER_ICON_CACHE.get(path)!);
      return;
    }

    void commands
      .getFileIcon(path)
      .then((result) => {
        const dataUrl = result.status === "ok" ? result.data : null;
        FOLDER_ICON_CACHE.set(path, dataUrl);
        if (!cancelled) setIcon(dataUrl);
      })
      .catch(() => {
        FOLDER_ICON_CACHE.set(path, null);
        if (!cancelled) setIcon(null);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        width={44}
        height={44}
        className="inline-block h-11 w-11 shrink-0 rounded-md"
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  return (
    <span
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_14%,var(--card))] text-[var(--accent)]"
      aria-hidden="true"
      title={name}
    >
      <Folder className="h-6 w-6" />
    </span>
  );
};

const addWatchFolder = async (): Promise<boolean> => {
  const picked = await open({ directory: true, multiple: false });
  if (!picked || Array.isArray(picked)) return false;

  const result = await commands.addWatchFolder(picked, "text", false);
  if (result.status === "ok") {
    window.dispatchEvent(new CustomEvent("watch-folders-changed"));
    return true;
  }
  console.error("addWatchFolder failed:", result.error);
  return false;
};

const WatchedFoldersToolbar: React.FC<{
  view: FileTranscriptionView;
  onViewChange: (view: FileTranscriptionView) => void;
}> = ({ view, onViewChange }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const handleAddFolder = useCallback(async () => {
    setBusy(true);
    try {
      const added = await addWatchFolder();
      if (added) onViewChange("folders");
    } finally {
      setBusy(false);
    }
  }, [onViewChange]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="primary-soft"
        onClick={handleAddFolder}
        disabled={busy}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("dictate.watchFolders.add", { defaultValue: "Add folder" })}
      </Button>
      <SegmentedControl<FileTranscriptionView>
        value={view}
        onChange={onViewChange}
        layoutId="file-transcription-view-toggle"
        ariaLabel={t("dictate.fileTranscription.view.ariaLabel", {
          defaultValue: "File transcription view",
        })}
        items={[
          {
            value: "file",
            label: t("dictate.fileTranscription.view.file", {
              defaultValue: "File",
            }),
          },
          {
            value: "folders",
            label: t("dictate.fileTranscription.view.folders", {
              defaultValue: "Folders",
            }),
          },
        ]}
      />
      <div className="ml-auto">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void openModelHub("analysis", { scope: "analysis" })}
        >
          <Layers className="h-3.5 w-3.5" />
          {t("listen.createVoices.models", { defaultValue: "Models" })}
        </Button>
      </div>
    </div>
  );
};

const WatchedFoldersGroup: React.FC = () => {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<WatchFolderConfig[]>([]);
  const [activity, setActivity] = useState<WatchProgressPayload[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await commands.listWatchFolders();
    if (r.status === "ok") setFolders(r.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    window.addEventListener("watch-folders-changed", refresh);
    return () => window.removeEventListener("watch-folders-changed", refresh);
  }, [refresh]);

  // Live activity feed: backend emits one event per stage change. We
  // only keep the latest 5 so the UI stays compact.
  useEffect(() => {
    const unlistenPromise = listen<WatchProgressPayload>(
      "watch-folder-progress",
      (event) => {
        setActivity((prev) => [event.payload, ...prev].slice(0, 5));
      },
    );
    return () => {
      void unlistenPromise.then((fn) => fn());
    };
  }, []);

  const removeFolder = useCallback(
    async (folder: WatchFolderConfig) => {
      const folderName = basename(folder.path);
      if (
        !confirmDestructiveAction(
          t("dictate.watchFolders.removeConfirm", {
            folderName,
            defaultValue:
              "Remove {{folderName}} from watched folders? The folder and its files will stay on disk.",
          }),
        )
      ) {
        return;
      }

      setBusy(true);
      try {
        const r = await commands.removeWatchFolder(folder.id);
        if (r.status === "ok") await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  const updateFormat = useCallback(
    async (id: string, format: WatchFolderOutputFormat) => {
      const r = await commands.updateWatchFolderFormat(id, format);
      if (r.status === "ok") await refresh();
    },
    [refresh],
  );

  return (
    <div className="space-y-4">
      {folders.length === 0 ? (
        <EmptyState
          framed={false}
          icon={<FolderPlus className="h-5 w-5" aria-hidden />}
          title={t("dictate.watchFolders.empty", {
            defaultValue: "No watched folders yet.",
          })}
          description={t("dictate.watchFolders.emptyDescription", {
            defaultValue:
              "Add a folder to transcribe audio files automatically when you drop them in.",
          })}
          example={t("dictate.watchFolders.emptyExample", {
            defaultValue:
              "For example, watch an Interviews folder and save each new recording as text, SRT, or VTT.",
          })}
          action={
            <Button
              type="button"
              size="sm"
              variant="primary-soft"
              onClick={async () => {
                setBusy(true);
                try {
                  if (await addWatchFolder()) await refresh();
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("dictate.watchFolders.add", { defaultValue: "Add folder" })}
            </Button>
          }
          className="py-5"
        />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {folders.map((f) => (
            <li
              key={f.id}
              className="group flex min-h-[104px] w-32 flex-col items-center justify-center rounded-xl px-2 py-2 transition-colors hover:bg-[var(--input)] focus-within:bg-[var(--input)]"
            >
              <NativeFolderIcon path={f.path} name={basename(f.path)} />
              <div className="relative mt-2 flex h-8 w-full min-w-0 items-center justify-center">
                <h3
                  className="max-w-full truncate px-1 text-center text-sm font-medium text-[var(--text)] transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
                  title={basename(f.path)}
                >
                  {basename(f.path)}
                </h3>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                  <select
                    value={f.output_format}
                    onChange={(e) =>
                      void updateFormat(
                        f.id,
                        e.target.value as WatchFolderOutputFormat,
                      )
                    }
                    className="h-7 max-w-[5.5rem] rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-xs font-medium text-[var(--text)]"
                    aria-label={t("dictate.watchFolders.formatAria", {
                      defaultValue: "Output format",
                    })}
                    title={`${t("dictate.watchFolders.formatAria", {
                      defaultValue: "Output format",
                    })}: ${formatLabel(f.output_format)}`}
                  >
                    <option value="text">
                      {t("dictate.watchFolders.formatText", {
                        defaultValue: "Text",
                      })}
                    </option>
                    <option value="srt">
                      {t("dictate.watchFolders.formatSrt", {
                        defaultValue: "SRT",
                      })}
                    </option>
                    <option value="vtt">
                      {t("dictate.watchFolders.formatVtt", {
                        defaultValue: "VTT",
                      })}
                    </option>
                  </select>
                  <Button
                    type="button"
                    variant="danger-ghost"
                    size="icon-xs"
                    onClick={() => void removeFolder(f)}
                    aria-label={t("dictate.watchFolders.remove", {
                      defaultValue: "Remove folder",
                    })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {activity.length > 0 && (
        <div className={subtleCardClassName + " text-xs text-[var(--muted)]"}>
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
                      : a.stage === "failed"
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
    </div>
  );
};
