import React from "react";
import type { FileProcessingMode } from "./types";
import type { SpeechAnalysisModelDescriptor } from "@/bindings";
import { useTranslation } from "react-i18next";
import { basename } from "./filePaths";
import { Loader2, AlertCircle, Check } from "lucide-react";
import { SelectedAsrModelInline } from "./SelectedAsrModelInline";

export const FileTranscriptionStatusHeader: React.FC<{
  error: string;
  isRunning: boolean;
  selectedPath: string;
  cleanedPath: string;
  transcription: string;
  processingMode: FileProcessingMode;
  selectedAsrModel: SpeechAnalysisModelDescriptor | null;
}> = ({
  error,
  isRunning,
  selectedPath,
  cleanedPath,
  transcription,
  processingMode,
  selectedAsrModel,
}) => {
  const { t } = useTranslation();
  const fileName = selectedPath ? basename(selectedPath) : "";
  const cleanedFileName = cleanedPath ? basename(cleanedPath) : "";
  const hasTranscript = transcription.trim().length > 0;
  const hasCleanedAudio = cleanedPath.trim().length > 0;
  const status = (() => {
    if (isRunning) {
      const cleanAndTranscribe = processingMode === "clean_transcribe";
      return {
        label: cleanAndTranscribe
          ? t("dictate.fileTranscription.status.cleaningAndTranscribing", {
              count: 1,
              defaultValue: "Cleaning and transcribing {{count}} file",
            })
          : t("dictate.fileTranscription.status.transcribing", {
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
        label:
          processingMode === "clean_transcribe" && hasCleanedAudio
            ? t("dictate.fileTranscription.status.cleanedTranscriptReady", {
                defaultValue: "Cleaned transcript ready",
              })
            : t("dictate.fileTranscription.status.transcriptReady", {
                defaultValue: "Transcript ready",
              }),
        detail: t("dictate.fileTranscription.status.completeDetail", {
          count: 1,
          defaultValue: "{{count}} file complete",
        }),
        icon: <Check size={12} aria-hidden="true" />,
      };
    }
    if (hasCleanedAudio) {
      return {
        label: t("dictate.fileTranscription.status.cleanedReady", {
          defaultValue: "Cleaned audio ready",
        }),
        detail: cleanedFileName,
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
          title={cleanedFileName || fileName || undefined}
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
