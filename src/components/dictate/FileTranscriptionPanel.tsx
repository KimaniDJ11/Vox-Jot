import React, { useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  FileAudio,
  FolderPlus,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  TimedSegment,
  WatchFolderConfig,
  WatchFolderOutputFormat,
} from "@/bindings";
import { commands } from "@/bindings";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Textarea } from "@/components/ui/Textarea";
import { subtleCardClassName } from "@/components/ui/subtleCard";

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
    <div className="space-y-4" aria-busy={isRunning}>
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
          <span className="text-[var(--text)]">{basename(selectedPath)}</span>
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
              {t("dictate.fileTranscription.copy", { defaultValue: "Copy" })}
            </Button>
          </div>
        </div>
      </div>

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

      <WatchedFoldersGroup />
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

  const addFolder = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false });
    if (!picked || Array.isArray(picked)) return;
    setBusy(true);
    try {
      const r = await commands.addWatchFolder(picked, "text", false);
      if (r.status === "ok") {
        await refresh();
      } else {
        console.error("addWatchFolder failed:", r.error);
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const removeFolder = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const r = await commands.removeWatchFolder(id);
        if (r.status === "ok") await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const toggleFolder = useCallback(
    async (id: string, enabled: boolean) => {
      const r = await commands.setWatchFolderEnabled(id, enabled);
      if (r.status === "ok") await refresh();
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

  return (
    <div className={subtleCardClassName + " space-y-3"}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-[var(--text)]">
            {t("dictate.watchFolders.title", {
              defaultValue: "Watched folders",
            })}
          </div>
          <div className="mt-0.5 text-sm text-[var(--text)]">
            {t("dictate.watchFolders.description", {
              defaultValue:
                "Drop an audio file into one of these folders and Vox Jot transcribes it automatically.",
            })}
          </div>
        </div>
        <Button variant="secondary" onClick={addFolder} disabled={busy}>
          <FolderPlus size={14} className="mr-1.5" />
          {t("dictate.watchFolders.add", { defaultValue: "Add folder" })}
        </Button>
      </div>

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
          className="py-5"
        />
      ) : (
        <ul className="space-y-2">
          {folders.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            >
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => void toggleFolder(f.id, e.target.checked)}
                aria-label={t("dictate.watchFolders.toggleAria", {
                  defaultValue: "Enable or disable this watched folder",
                })}
              />
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-xs font-medium text-[var(--text)]"
                  title={f.path}
                >
                  {f.path}
                </div>
              </div>
              <select
                value={f.output_format}
                onChange={(e) =>
                  void updateFormat(
                    f.id,
                    e.target.value as WatchFolderOutputFormat,
                  )
                }
                className="rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-xs text-[var(--text)]"
                aria-label={t("dictate.watchFolders.formatAria", {
                  defaultValue: "Output format",
                })}
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
              <button
                type="button"
                onClick={() => void removeFolder(f.id)}
                className="rounded p-1 text-[var(--muted)] hover:text-[var(--danger)]"
                aria-label={t("dictate.watchFolders.remove", {
                  defaultValue: "Remove folder",
                })}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {activity.length > 0 && (
        <div className="border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
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
