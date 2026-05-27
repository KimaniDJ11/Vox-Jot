import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Captions,
  Check,
  ChevronDown,
  ClipboardCopy,
  FileAudio,
  FileText,
  Folder,
  FolderPlus,
  Layers,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  SpeechAnalysisModelDescriptor,
  TimedSegment,
  WatchFolderConfig,
  WatchFolderOutputFormat,
} from "@/bindings";
import { commands } from "@/bindings";
import {
  ActionIconButton,
  SegmentedControl,
  SettingsGroup,
} from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { subtleCardClassName } from "@/components/ui/subtleCard";
import { openModelHub } from "@/components/model-hub/modelHubTabs";
import { voiceAvatarGradient } from "@/components/settings/general/listen/createVoiceVoiceHub";
import { useSettingsSlice } from "@/hooks/useSettings";

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

function useSelectedSpeechAnalysisAsrModel() {
  const { file_transcription_asr_model_id: fileTranscriptionAsrModelIdValue } =
    useSettingsSlice(["file_transcription_asr_model_id"] as const);
  const [selectedAsrModel, setSelectedAsrModel] =
    useState<SpeechAnalysisModelDescriptor | null>(null);
  const fileTranscriptionAsrModelId = fileTranscriptionAsrModelIdValue ?? "";

  useEffect(() => {
    let isCurrent = true;

    void commands
      .getSpeechAnalysisCatalog()
      .then((result) => {
        if (!isCurrent) return;
        if (result.status !== "ok") {
          setSelectedAsrModel(null);
          return;
        }
        const selectedModel =
          result.data.models.find(
            (model) => model.id === result.data.selection.asr_model_id,
          ) ?? null;
        setSelectedAsrModel(selectedModel);
      })
      .catch(() => {
        if (isCurrent) setSelectedAsrModel(null);
      });

    return () => {
      isCurrent = false;
    };
  }, [fileTranscriptionAsrModelId]);

  return selectedAsrModel;
}

const SelectedAsrModelInline: React.FC<{
  model: SpeechAnalysisModelDescriptor | null;
}> = ({ model }) => {
  const { t } = useTranslation();
  if (!model) return null;

  const label = t("dictate.fileTranscription.selectedModelTitle", {
    model: model.label,
    defaultValue: "Selected model: {{model}}",
  });

  return (
    <div
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-[var(--muted)]"
      aria-label={label}
      title={label}
    >
      <span
        className="h-5 w-5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.42)]"
        style={{
          background: voiceAvatarGradient(`file-transcription::${model.id}`),
        }}
        aria-hidden="true"
      />
      <span className="truncate font-medium">{model.label}</span>
    </div>
  );
};

const FileTranscriptionStatusHeader: React.FC<{
  error: string;
  isRunning: boolean;
  selectedPath: string;
  transcription: string;
  selectedAsrModel: SpeechAnalysisModelDescriptor | null;
}> = ({ error, isRunning, selectedPath, transcription, selectedAsrModel }) => {
  const { t } = useTranslation();
  const fileName = selectedPath ? basename(selectedPath) : "";
  const hasTranscript = transcription.trim().length > 0;
  const status = (() => {
    if (isRunning) {
      return {
        label: t("dictate.fileTranscription.status.transcribing", {
          count: 1,
          defaultValue: "Transcribing {{count}} file",
        }),
        detail: t("dictate.fileTranscription.status.remaining", {
          count: 0,
          defaultValue: "{{count}} remaining",
        }),
        icon: <Loader2 size={12} className="animate-spin" aria-hidden="true" />,
      };
    }
    if (error) {
      return {
        label: t("dictate.fileTranscription.status.needsAttention", {
          defaultValue: "Needs attention",
        }),
        detail: t("dictate.fileTranscription.status.failedDetail", {
          count: 1,
          defaultValue: "{{count}} file stopped",
        }),
        icon: <AlertCircle size={12} aria-hidden="true" />,
      };
    }
    if (hasTranscript) {
      return {
        label: t("dictate.fileTranscription.status.transcriptReady", {
          defaultValue: "Transcript ready",
        }),
        detail: t("dictate.fileTranscription.status.completeDetail", {
          count: 1,
          defaultValue: "{{count}} file complete",
        }),
        icon: <Check size={12} aria-hidden="true" />,
      };
    }
    return {
      label: t("dictate.fileTranscription.status.ready", {
        defaultValue: "Ready",
      }),
      detail: t("dictate.fileTranscription.status.idleDetail", {
        defaultValue: "No files transcribing",
      }),
      icon: null,
    };
  })();

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div
          className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]"
          role="status"
          aria-live="polite"
          title={fileName || undefined}
        >
          {status.icon && <span className="shrink-0">{status.icon}</span>}
          <span className="min-w-0 truncate">
            <span className="font-medium text-[var(--text)]">
              {status.label}
            </span>
            <span className="mx-1.5 text-[var(--border-strong)]">·</span>
            <span>{status.detail}</span>
          </span>
          {isRunning && fileName ? (
            <span className="sr-only">
              {t("dictate.fileTranscription.status.currentFile", {
                fileName,
                defaultValue: "Current file: {{fileName}}",
              })}
            </span>
          ) : null}
        </div>
        <SelectedAsrModelInline model={selectedAsrModel} />
      </div>
      <div className="border-t border-[var(--border)]" aria-hidden="true" />
    </div>
  );
};

export const FileTranscriptionPanel: React.FC = () => {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [transcription, setTranscription] = useState<string>("");
  const [segments, setSegments] = useState<TimedSegment[]>([]);
  const [error, setError] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [view, setView] = useState<FileTranscriptionView>("file");
  const selectedAsrModel = useSelectedSpeechAnalysisAsrModel();
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

  const [copyFeedback, setCopyFeedback] = useState(false);

  const handleCopy = useCallback(async () => {
    await copyResult();
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1800);
  }, [copyResult]);

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
              "space-y-4 transition-[border-color,background-color,box-shadow] duration-150",
            ].join(" ")}
          >
            <FileTranscriptionStatusHeader
              error={error}
              isRunning={isRunning}
              selectedPath={selectedPath}
              transcription={transcription}
              selectedAsrModel={selectedAsrModel}
            />

            <div
              className={[
                "flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-5 py-6 text-center transition-[border-color,background-color,box-shadow] duration-150",
                isDragOver
                  ? "border-[var(--accent)] bg-[var(--accent-soft,var(--panel-bg))] shadow-[inset_0_0_0_1px_var(--accent)]"
                  : "border-[var(--border)] bg-[var(--bg)]",
              ].join(" ")}
            >
              <div
                className="flex size-11 items-center justify-center rounded-full bg-[var(--input)] text-[var(--muted)]"
                aria-hidden="true"
              >
                {isDragOver ? <Upload size={20} /> : <FileAudio size={20} />}
              </div>
              {isDragOver ? (
                <div className="text-sm font-semibold text-[var(--accent)]">
                  {t("dictate.fileTranscription.dropRelease", {
                    defaultValue: "Release to transcribe",
                  })}
                </div>
              ) : (
                <>
                  <div className="text-sm font-semibold text-[var(--text)]">
                    {t("dictate.fileTranscription.dropHint", {
                      defaultValue: "Drag & drop an audio or video file here",
                    })}
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {t("dictate.fileTranscription.orLabel", {
                      defaultValue: "or",
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={pickFile}
                    disabled={isRunning}
                    className="cursor-pointer rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isRunning
                      ? t("dictate.fileTranscription.transcribing", {
                          defaultValue: "Transcribing…",
                        })
                      : t("dictate.fileTranscription.pickFile", {
                          defaultValue: "Pick file",
                        })}
                  </button>
                </>
              )}
            </div>

            {selectedPath && (
              <div
                className="truncate px-1 pt-3 text-xs text-[var(--muted)]"
                title={selectedPath}
                aria-label={selectedPath}
              >
                {basename(selectedPath)}
              </div>
            )}

            <div className="space-y-2">
              <label
                className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"
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
                className="min-h-[170px] resize-none rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-3 text-sm font-normal shadow-none placeholder:italic placeholder:text-[var(--muted)] hover:border-[var(--accent)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-glow)]"
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
              <div className="flex items-center gap-0 text-xs">
                <button
                  type="button"
                  onClick={() => exportSubtitles("srt")}
                  disabled={segments.length === 0 || isRunning}
                  className="cursor-pointer px-1 py-0.5 font-medium text-[var(--muted)] transition-colors hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-30"
                  title={
                    segments.length === 0
                      ? t("dictate.fileTranscription.exportSrtUnavailable", {
                          defaultValue:
                            "This engine does not provide timestamps. Switch to Whisper or Parakeet for SRT/VTT export.",
                        })
                      : undefined
                  }
                >
                  SRT
                </button>
                <span
                  className="text-[var(--border-strong)]"
                  aria-hidden="true"
                >
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => exportSubtitles("vtt")}
                  disabled={segments.length === 0 || isRunning}
                  className="cursor-pointer px-1 py-0.5 font-medium text-[var(--muted)] transition-colors hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-30"
                  title={
                    segments.length === 0
                      ? t("dictate.fileTranscription.exportSrtUnavailable", {
                          defaultValue:
                            "This engine does not provide timestamps. Switch to Whisper or Parakeet for SRT/VTT export.",
                        })
                      : undefined
                  }
                >
                  VTT
                </button>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopy}
                disabled={!transcription.trim() || isRunning}
                className="gap-1.5 px-3.5 text-xs"
              >
                {copyFeedback ? (
                  <>
                    <Check size={12} aria-hidden="true" />
                    {t("dictate.fileTranscription.copied", {
                      defaultValue: "Copied",
                    })}
                  </>
                ) : (
                  <>
                    <ClipboardCopy size={12} aria-hidden="true" />
                    {t("dictate.fileTranscription.copy", {
                      defaultValue: "Copy",
                    })}
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <WatchedFoldersGroup selectedAsrModel={selectedAsrModel} />
      )}

      {error && (
        <div
          className="flex items-start gap-2.5 rounded-xl bg-[color-mix(in_srgb,var(--danger),transparent_94%)] px-4 py-3 text-xs"
          role="alert"
        >
          <AlertCircle
            size={14}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[var(--danger)]"
          />
          <div className="min-w-0">
            <div className="font-medium text-[var(--danger)]">
              {t("dictate.fileTranscription.errors.heading", {
                defaultValue: "Transcription failed",
              })}
            </div>
            <div className="mt-0.5 break-words text-[var(--text)]">{error}</div>
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

const WatchedFoldersStatusHeader: React.FC<{
  folders: WatchFolderConfig[];
  activity: WatchProgressPayload[];
  selectedAsrModel: SpeechAnalysisModelDescriptor | null;
}> = ({ folders, activity, selectedAsrModel }) => {
  const { t } = useTranslation();
  const active = activity.find((event) => event.stage === "started");
  const latest = activity[0];
  const isFolderCountSummary =
    folders.length > 0 && !active && latest?.stage !== "failed";
  const status = (() => {
    if (active) {
      return {
        label: t("dictate.watchFolders.status.processing", {
          defaultValue: "Processing",
        }),
        detail: basename(active.source_path),
        icon: <Loader2 size={12} className="animate-spin" aria-hidden="true" />,
      };
    }
    if (latest?.stage === "failed") {
      return {
        label: t("dictate.watchFolders.status.needsAttention", {
          defaultValue: "Needs attention",
        }),
        detail: basename(latest.source_path),
        icon: <AlertCircle size={12} aria-hidden="true" />,
      };
    }
    if (folders.length > 0) {
      return {
        label: t("dictate.watchFolders.status.countLabel", {
          defaultValue: "WATCHED FOLDERS",
        }),
        detail: String(folders.length),
        icon: null,
      };
    }
    return {
      label: t("dictate.fileTranscription.status.ready", {
        defaultValue: "Ready",
      }),
      detail: t("dictate.watchFolders.status.emptyDetail", {
        defaultValue: "No watched folders",
      }),
      icon: null,
    };
  })();

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div
          className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]"
          role="status"
          aria-live="polite"
          title={active || latest ? status.detail : undefined}
        >
          {status.icon && <span className="shrink-0">{status.icon}</span>}
          <span
            className={[
              "min-w-0 truncate",
              isFolderCountSummary
                ? "text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]"
                : "",
            ].join(" ")}
          >
            <span
              className={
                isFolderCountSummary
                  ? ""
                  : "font-medium text-[var(--text)]"
              }
            >
              {status.label}
            </span>
            <span className="mx-1.5 text-[var(--border-strong)]">·</span>
            <span>{status.detail}</span>
          </span>
        </div>
        <SelectedAsrModelInline model={selectedAsrModel} />
      </div>
      <div className="border-t border-[var(--border)]" aria-hidden="true" />
    </div>
  );
};

const FOLDER_ICON_CACHE = new Map<string, string | null>();
let latestAddedWatchFolderId: string | null = null;

const watchFolderFormatTone = (format?: WatchFolderOutputFormat): string => {
  switch (format) {
    case "srt":
      return "text-[var(--accent)] bg-[var(--accent-soft)]";
    case "vtt":
      return "text-[var(--info)] bg-[color-mix(in_srgb,var(--info),transparent_88%)]";
    case "text":
    default:
      return "text-[var(--muted)] bg-[var(--input)]";
  }
};

const WatchFolderFormatIcon: React.FC<{
  format?: WatchFolderOutputFormat;
  size?: number;
}> = ({ format, size = 18 }) => {
  if (format === "srt" || format === "vtt") {
    return <Captions size={size} aria-hidden="true" />;
  }
  return <FileText size={size} aria-hidden="true" />;
};

const WatchFolderFormatPicker: React.FC<{
  value?: WatchFolderOutputFormat;
  onChange: (format: WatchFolderOutputFormat) => void;
}> = ({ value = "text", onChange }) => {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerId = useId();
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [popupRect, setPopupRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const options: Array<{
    value: WatchFolderOutputFormat;
    label: string;
  }> = useMemo(
    () => [
      {
        value: "text",
        label: t("dictate.watchFolders.formatText", {
          defaultValue: "Text",
        }),
      },
      {
        value: "srt",
        label: t("dictate.watchFolders.formatSrt", {
          defaultValue: "SRT",
        }),
      },
      {
        value: "vtt",
        label: t("dictate.watchFolders.formatVtt", {
          defaultValue: "VTT",
        }),
      },
    ],
    [t],
  );

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex] ?? options[0];
  const ariaLabel = t("dictate.watchFolders.formatAria", {
    defaultValue: "Output format",
  });
  const triggerLabel = `${ariaLabel}: ${selectedOption.label}`;

  const updatePopupRect = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPopupRect({
      top: rect.bottom + 6,
      left: rect.left,
      width: 144,
    });
  }, []);

  const openPopup = useCallback(() => {
    updatePopupRect();
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  }, [selectedIndex, updatePopupRect]);

  const closePopup = useCallback(() => {
    setIsOpen(false);
    setPopupRect(null);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePopupRect();
    const handleLayoutChange = () => updatePopupRect();
    window.addEventListener("resize", handleLayoutChange);
    document.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      document.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [isOpen, updatePopupRect]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      closePopup();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [closePopup, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      optionRefs.current[activeIndex]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, isOpen]);

  const selectFormat = (nextValue: WatchFolderOutputFormat) => {
    onChange(nextValue);
    closePopup();
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const handleTriggerKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (
    event,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openPopup();
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closePopup();
    }
  };

  const handleMenuKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePopup();
      requestAnimationFrame(() => buttonRef.current?.focus());
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectFormat(options[activeIndex]?.value ?? value);
    }
  };

  const popup =
    isOpen && popupRect ? (
      <div
        ref={popupRef}
        id={listboxId}
        role="listbox"
        aria-labelledby={triggerId}
        className="fixed z-[200] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-[var(--shadow-lg)]"
        style={{
          top: popupRect.top,
          left: popupRect.left,
          width: popupRect.width,
        }}
        onKeyDown={handleMenuKeyDown}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={index === activeIndex ? 0 : -1}
              className={[
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
                selected
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--text)] hover:bg-[var(--input)]",
              ].join(" ")}
              onClick={() => selectFormat(option.value)}
            >
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  watchFolderFormatTone(option.value),
                ].join(" ")}
                aria-hidden="true"
              >
                <WatchFolderFormatIcon format={option.value} size={16} />
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={triggerId}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={triggerLabel}
        title={triggerLabel}
        className={[
          "inline-flex h-9 min-w-12 items-center justify-center gap-1 rounded-full border border-[var(--border)] px-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
          "hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]",
          watchFolderFormatTone(value),
        ].join(" ")}
        onClick={() => {
          if (isOpen) closePopup();
          else openPopup();
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <WatchFolderFormatIcon format={value} />
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={isOpen ? "rotate-180 transition-transform" : "transition-transform"}
        />
      </button>
      {typeof document !== "undefined" && popup
        ? createPortal(popup, document.body)
        : null}
    </>
  );
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

const addWatchFolder = async (): Promise<WatchFolderConfig | null> => {
  const picked = await open({ directory: true, multiple: false });
  if (!picked || Array.isArray(picked)) return null;

  const result = await commands.addWatchFolder(picked, "text", false);
  if (result.status === "ok") {
    latestAddedWatchFolderId = result.data.id;
    window.dispatchEvent(
      new CustomEvent<WatchFolderConfig>("watch-folders-changed", {
        detail: result.data,
      }),
    );
    return result.data;
  }
  console.error("addWatchFolder failed:", result.error);
  return null;
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
      const folder = await addWatchFolder();
      if (folder) onViewChange("folders");
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

const WatchedFoldersGroup: React.FC<{
  selectedAsrModel: SpeechAnalysisModelDescriptor | null;
}> = ({ selectedAsrModel }) => {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<WatchFolderConfig[]>([]);
  const [activity, setActivity] = useState<WatchProgressPayload[]>([]);
  const [busy, setBusy] = useState(false);
  const [newlyAddedFolderId, setNewlyAddedFolderId] = useState<string | null>(
    () => latestAddedWatchFolderId,
  );
  const [confirmingDeleteFolderId, setConfirmingDeleteFolderId] = useState<
    string | null
  >(null);

  const refresh = useCallback(async () => {
    const r = await commands.listWatchFolders();
    if (r.status === "ok") setFolders(r.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleWatchFoldersChanged = (event: Event) => {
      const folder = (event as CustomEvent<WatchFolderConfig>).detail;
      if (folder?.id) setNewlyAddedFolderId(folder.id);
      void refresh();
    };
    window.addEventListener("watch-folders-changed", handleWatchFoldersChanged);
    return () =>
      window.removeEventListener(
        "watch-folders-changed",
        handleWatchFoldersChanged,
      );
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
          <p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">
            {t("dictate.watchFolders.emptyDescription", {
              defaultValue:
                "Add a folder to transcribe audio files automatically when you drop them in.",
            })}
          </p>
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
              variant="secondary"
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
              {t("dictate.watchFolders.add", { defaultValue: "Add folder" })}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <ul className="flex flex-wrap gap-2">
            {folders.map((f) => {
              const latest = latestActivityByFolder.get(f.id);
              const showActions = newlyAddedFolderId === f.id;
              const statusLabel = latest
                ? `${latest.stage}: ${basename(latest.source_path)}`
                : f.enabled
                  ? null
                  : "Paused";
              return (
                <li
                  key={f.id}
                  className="group flex min-h-[136px] w-36 flex-col items-center justify-center rounded-xl px-2 py-2 transition-colors hover:bg-[var(--input)] focus-within:bg-[var(--input)]"
                >
                  <NativeFolderIcon path={f.path} name={basename(f.path)} />
                  <h3
                    className="mt-2 max-w-full truncate px-1 text-center text-sm font-medium text-[var(--text)]"
                    title={basename(f.path)}
                  >
                    {basename(f.path)}
                  </h3>
                  {statusLabel ? (
                    <p
                      className="mt-1 max-w-full truncate text-center text-[11px] text-[var(--muted)]"
                      role="status"
                      aria-live="polite"
                      title={statusLabel}
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
                        <WatchFolderFormatPicker
                          value={f.output_format}
                          onChange={(format) =>
                            void updateFormat(f.id, format)
                          }
                        />
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
