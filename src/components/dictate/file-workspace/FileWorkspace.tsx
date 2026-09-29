import { useMediaTranscription } from "./useMediaTranscription";
import React, { useState, useRef, useEffect } from "react";
import type {
  FileTranscriptionPanelKind,
  FileTranscriptionView,
  FileProcessingMode,
  ReaderLibrarySort,
  ReaderSplitView,
} from "./types";
import { useTranslation } from "react-i18next";
import { useSelectedSpeechAnalysisAsrModel } from "./useSelectedSpeechAnalysisAsrModel";
import { isReaderDocumentPath, basename } from "./filePaths";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { SettingsGroup, SegmentedControl } from "@/components/ui";
import { FileWorkspaceToolbar } from "./FileWorkspaceToolbar";
import { subtleCardClassName } from "@/components/ui/subtleCard";
import { FileTranscriptionStatusHeader } from "./FileTranscriptionStatusHeader";
import {
  Upload,
  Pause,
  Volume2,
  Check,
  ClipboardCopy,
  AlertCircle,
} from "lucide-react";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { ReaderDocumentsPanel } from "../reader/ReaderDocumentsPanel";
import { WatchedFoldersGroup } from "../watch-folders/WatchedFoldersGroup";

export const FileWorkspace: React.FC<{
  kind: FileTranscriptionPanelKind;
  initialView: FileTranscriptionView;
  availableViews: FileTranscriptionView[];
}> = ({ kind, initialView, availableViews }) => {
  const { t } = useTranslation();
  const {
    selectedPath,
    cleanedPath,
    transcription,
    segments,
    emotion,
    error,
    setError,
    isRunning,
    isTranscriptSpeaking,
    processingMode,
    setProcessingMode,
    isRunningRef,
    runMediaAction,
    exportSubtitles,
    pickFile,
    copyFeedback,
    handleCopy,
    handleReadTranscript,
  } = useMediaTranscription();

  const [isDragOver, setIsDragOver] = useState(false);

  const [view, setView] = useState<FileTranscriptionView>(initialView);
  const viewRef = useRef<FileTranscriptionView>(view);
  const availableViewsRef = useRef<FileTranscriptionView[]>(availableViews);
  const [readerQuery, setReaderQuery] = useState("");
  const [readerSort, setReaderSort] = useState<ReaderLibrarySort>("recent");
  const [readerSplitView, setReaderSplitView] =
    useState<ReaderSplitView>("library");
  const [readerSectionsOpen, setReaderSectionsOpen] = useState(false);
  const [readerTransformOpen, setReaderTransformOpen] = useState(false);
  const [readerHasDocument, setReaderHasDocument] = useState(false);
  const [readerViewMode, setReaderViewMode] = useState<"text" | "page">("text");
  const [readerCanUsePageView, setReaderCanUsePageView] = useState(false);
  const selectedAsrModel = useSelectedSpeechAnalysisAsrModel();

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    availableViewsRef.current = availableViews;
    if (!availableViews.includes(viewRef.current)) {
      setView(initialView);
    }
  }, [availableViews, initialView]);

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
          if (isReaderDocumentPath(first)) {
            if (availableViewsRef.current.includes("documents")) {
              setView("documents");
              window.setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent<string>("reader-document-drop", {
                    detail: first,
                  }),
                );
              }, 0);
            } else {
              setError(
                t("dictate.fileTranscription.errors.documentInMedia", {
                  defaultValue: "Open Reader to add documents.",
                }),
              );
            }
            return;
          }
          if (!availableViewsRef.current.includes("file")) {
            setError(
              t("dictate.fileTranscription.errors.mediaInReader", {
                defaultValue: "Open File Transcription for audio or video.",
              }),
            );
            return;
          }
          if (viewRef.current === "documents") {
            setView("file");
          }
          void runMediaAction(first);
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
  }, [runMediaAction, t]);

  return (
    <div className="space-y-7" aria-busy={isRunning}>
      <SettingsGroup
        noCard
        title={
          kind === "reader"
            ? t("dictate.reader.title", { defaultValue: "Reader" })
            : t("dictate.fileTranscription.title", {
                defaultValue: "File Transcription",
              })
        }
        description={
          kind === "reader"
            ? t("dictate.reader.description", {
                defaultValue:
                  "Import documents, read them aloud, and keep a local reading library.",
              })
            : t("dictate.fileTranscription.description", {
                defaultValue:
                  "Drop audio or video to transcribe, clean noise, or both.",
              })
        }
        showTitle={false}
      >
        {null}
      </SettingsGroup>

      {/* Toolbar sticks to the top of the scroll area so the view toggle and
          Transform/Sections stay reachable while reading a long document. It
          must be a direct child of this tall root (not nested in SettingsGroup,
          whose short box would give `sticky` no room to hold). */}
      <div className="sticky top-0 z-30 -mt-3 py-3 backdrop-blur-md">
        <FileWorkspaceToolbar
          kind={kind}
          view={view}
          onViewChange={setView}
          availableViews={availableViews}
          searchQuery={readerQuery}
          onSearchQueryChange={setReaderQuery}
          readerSort={readerSort}
          onReaderSortChange={setReaderSort}
          readerSplitView={readerSplitView}
          onReaderSplitViewChange={setReaderSplitView}
          readerSectionsOpen={readerSectionsOpen}
          onReaderSectionsOpenChange={setReaderSectionsOpen}
          readerTransformOpen={readerTransformOpen}
          onReaderTransformOpenChange={setReaderTransformOpen}
          readerHasDocument={readerHasDocument}
          readerViewMode={readerViewMode}
          onReaderViewModeChange={setReaderViewMode}
          canUseReaderPageView={readerCanUsePageView}
        />
      </div>

      {view === "file" ? (
        <>
          <div
            className={[
              subtleCardClassName,
              "space-y-0 overflow-hidden transition-[border-color,background-color,box-shadow] duration-150",
            ].join(" ")}
          >
            <FileTranscriptionStatusHeader
              error={error}
              isRunning={isRunning}
              selectedPath={selectedPath}
              cleanedPath={cleanedPath}
              transcription={transcription}
              processingMode={processingMode}
              selectedAsrModel={selectedAsrModel}
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  {t("dictate.fileTranscription.actionLabel", {
                    defaultValue: "Action",
                  })}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  {processingMode === "clean_transcribe"
                    ? t(
                        "dictate.fileTranscription.actionDescriptions.cleanTranscribe",
                        {
                          defaultValue:
                            "Clean the recording first, then transcribe the cleaned audio.",
                        },
                      )
                    : t(
                        "dictate.fileTranscription.actionDescriptions.transcribe",
                        {
                          defaultValue:
                            "Transcribe the original imported audio or video.",
                        },
                      )}
                </div>
              </div>
              <SegmentedControl<FileProcessingMode>
                value={processingMode}
                onChange={setProcessingMode}
                layoutId="file-processing-mode-toggle"
                ariaLabel={t("dictate.fileTranscription.actionAriaLabel", {
                  defaultValue: "File action",
                })}
                items={[
                  {
                    value: "transcribe",
                    label: t("dictate.fileTranscription.actions.transcribe", {
                      defaultValue: "Transcribe",
                    }),
                  },
                  {
                    value: "clean_transcribe",
                    label: t(
                      "dictate.fileTranscription.actions.cleanTranscribe",
                      {
                        defaultValue: "Clean + Transcribe",
                      },
                    ),
                  },
                ]}
              />
            </div>

            <div
              className={[
                "mt-4 flex flex-col items-center justify-center gap-1.5 rounded-xl py-8 text-center transition-all duration-200",
                isDragOver
                  ? "bg-[var(--accent-soft)] shadow-[inset_0_0_0_2px_var(--accent)]"
                  : "bg-[var(--surface-muted,var(--bg))]",
              ].join(" ")}
            >
              {isDragOver ? (
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
                  <Upload size={16} aria-hidden="true" />
                  {t("dictate.fileTranscription.dropRelease", {
                    defaultValue: "Release to transcribe",
                  })}
                </div>
              ) : (
                <>
                  <div className="text-sm text-[var(--muted)]">
                    {processingMode === "clean_transcribe"
                      ? t("dictate.fileTranscription.dropHintCleanTranscribe", {
                          defaultValue:
                            "Drop audio or video to clean and transcribe",
                        })
                      : t("dictate.fileTranscription.dropHint", {
                          defaultValue: "Drop audio or video to transcribe",
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
                    className="cursor-pointer text-xs font-medium text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-2 transition-colors hover:text-[var(--accent-hover)] hover:decoration-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
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
              <div className="space-y-1 px-1 pt-3 text-xs text-[var(--muted)]">
                <div
                  className="truncate"
                  title={selectedPath}
                  aria-label={selectedPath}
                >
                  {basename(selectedPath)}
                </div>
                {cleanedPath ? (
                  <div
                    className="truncate text-[var(--text)]"
                    title={cleanedPath}
                    aria-label={cleanedPath}
                  >
                    {t("dictate.fileTranscription.cleanedPathLabel", {
                      defaultValue: "Cleaned:",
                    })}{" "}
                    {basename(cleanedPath)}
                  </div>
                ) : null}
              </div>
            )}

            <div className="space-y-2 pt-5">
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
                placeholder={
                  cleanedPath && !transcription.trim()
                    ? t("dictate.fileTranscription.cleanedPlaceholder", {
                        defaultValue:
                          "Cleaned audio saved. Switch to Clean + Transcribe if you also need a transcript.",
                      })
                    : t("dictate.fileTranscription.placeholder", {
                        defaultValue:
                          "Transcript appears here after processing.",
                      })
                }
                aria-live="polite"
                className="min-h-[110px] resize-none rounded-none border-none bg-transparent px-0 py-0 text-sm font-normal shadow-none placeholder:italic placeholder:text-[var(--muted)] hover:bg-transparent focus:ring-0"
              />
            </div>

            {emotion ? (
              <div className="space-y-2 pt-5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                    {t("dictate.fileTranscription.emotionLabel", {
                      defaultValue: "Emotion",
                    })}
                  </span>
                  <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-semibold capitalize text-[var(--text)]">
                    {emotion.top_label}
                  </span>
                  <span className="text-xs tabular-nums text-[var(--muted)]">
                    {Math.round((emotion.top_score ?? 0) * 100)}%
                  </span>
                </div>
                <div className="space-y-1">
                  {[...emotion.scores]
                    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                    .slice(0, 5)
                    .map((entry) => (
                      <div
                        key={entry.label}
                        className="flex items-center gap-2"
                      >
                        <span className="w-20 shrink-0 text-[11px] capitalize text-[var(--muted)]">
                          {entry.label}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                          <div
                            className="h-full rounded-full bg-[var(--accent)]"
                            style={{
                              width: `${Math.max(2, Math.round((entry.score ?? 0) * 100))}%`,
                            }}
                          />
                        </div>
                        <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted)]">
                          {Math.round((entry.score ?? 0) * 100)}%
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

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
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleReadTranscript}
                  disabled={!transcription.trim() || isRunning}
                  className="gap-1.5 px-3.5 text-xs"
                >
                  {isTranscriptSpeaking ? (
                    <>
                      <Pause size={12} aria-hidden="true" />
                      {t("dictate.reader.stop", { defaultValue: "Stop" })}
                    </>
                  ) : (
                    <>
                      <Volume2 size={12} aria-hidden="true" />
                      {t("dictate.reader.readTranscript", {
                        defaultValue: "Read",
                      })}
                    </>
                  )}
                </Button>
                <Button
                  variant="primary"
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
          </div>
        </>
      ) : view === "documents" ? (
        <ReaderDocumentsPanel
          query={readerQuery}
          sort={readerSort}
          splitView={readerSplitView}
          onSplitViewChange={setReaderSplitView}
          sectionsOpen={readerSectionsOpen}
          onSectionsOpenChange={setReaderSectionsOpen}
          transformOpen={readerTransformOpen}
          onTransformOpenChange={setReaderTransformOpen}
          onHasDocumentChange={setReaderHasDocument}
          viewMode={readerViewMode}
          onViewModeChange={setReaderViewMode}
          onCanUsePageViewChange={setReaderCanUsePageView}
        />
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
                defaultValue: "Processing failed",
              })}
            </div>
            <div className="mt-0.5 break-words text-[var(--text)]">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
};
