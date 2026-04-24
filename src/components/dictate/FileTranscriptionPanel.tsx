import React, { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useTranslation } from "react-i18next";
import { AlertCircle, FileAudio, Upload } from "lucide-react";
import { commands } from "@/bindings";
import { Button } from "@/components/ui/Button";
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

export const FileTranscriptionPanel: React.FC = () => {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [transcription, setTranscription] = useState<string>("");
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
      try {
        const result = await commands.transcribeFile(filePath);
        if (result.status === "ok") {
          setTranscription(result.data);
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
            defaultValue:
              "Transcript appears here after processing.",
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
          <Button
            variant="secondary"
            onClick={copyResult}
            disabled={!transcription.trim() || isRunning}
          >
            {t("dictate.fileTranscription.copy", { defaultValue: "Copy" })}
          </Button>
        </div>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 rounded-2xl border border-[var(--danger)] bg-[var(--input)] px-4 py-3 text-xs text-[var(--danger)]"
          role="alert"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">
              {t("dictate.fileTranscription.errors.heading", {
                defaultValue: "Transcription failed",
              })}
            </div>
            <div className="mt-1 break-words text-[var(--text)] opacity-80">
              {error}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
