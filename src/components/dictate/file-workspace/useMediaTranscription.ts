import { useState, useRef, useCallback } from "react";
import type { FileProcessingMode } from "./types";
import { useTranslation } from "react-i18next";
import { type TimedSegment, type EmotionResult, commands } from "@/bindings";
import { stripExtension, AUDIO_VIDEO_EXTENSIONS } from "./filePaths";
import { save, open } from "@tauri-apps/plugin-dialog";
import { speakReaderTextWithPreset } from "../reader/readerCommands";
import { readerErrorMessage } from "./errors";

export function useMediaTranscription() {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [cleanedPath, setCleanedPath] = useState<string>("");
  const [transcription, setTranscription] = useState<string>("");
  const [segments, setSegments] = useState<TimedSegment[]>([]);
  const [emotion, setEmotion] = useState<EmotionResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isTranscriptSpeaking, setIsTranscriptSpeaking] = useState(false);
  const [processingMode, setProcessingMode] =
    useState<FileProcessingMode>("transcribe");
  const isRunningRef = useRef(false);
  const runMediaAction = useCallback(
    async (filePath: string) => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;
      setIsRunning(true);
      setError("");
      setSelectedPath(filePath);
      setCleanedPath("");
      setTranscription("");
      setSegments([]);
      setEmotion(null);
      try {
        let transcriptionPath = filePath;
        if (processingMode === "clean_transcribe") {
          const cleanResult = await commands.cleanAudioFile(filePath, null);
          if (cleanResult.status === "error") {
            setError(
              cleanResult.error ||
                t("dictate.fileTranscription.errors.cleanFailed", {
                  defaultValue: "Failed to clean audio.",
                }),
            );
            return;
          }
          transcriptionPath = cleanResult.data.output_path;
          setCleanedPath(cleanResult.data.output_path);
        }

        const result = await commands.transcribeFile(transcriptionPath);
        if (result.status === "error") {
          setError(
            result.error ||
              t("dictate.fileTranscription.errors.failed", {
                defaultValue: "Failed to transcribe file.",
              }),
          );
          return;
        }

        setTranscription(result.data.text);
        setSegments(result.data.segments);
        setEmotion(result.data.emotion);
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
    [processingMode, t],
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
    await runMediaAction(filePath);
  }, [runMediaAction, t]);
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
  const [copyFeedback, setCopyFeedback] = useState(false);
  const handleCopy = useCallback(async () => {
    await copyResult();
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1800);
  }, [copyResult]);
  const handleReadTranscript = useCallback(async () => {
    if (!transcription.trim()) return;
    if (isTranscriptSpeaking) {
      const result = await commands.ttsStop();
      if (result.status === "error") setError(result.error);
      setIsTranscriptSpeaking(false);
      return;
    }
    setError("");
    setIsTranscriptSpeaking(true);
    try {
      await speakReaderTextWithPreset(transcription, null);
    } catch (err) {
      setError(
        readerErrorMessage(
          err,
          t("dictate.reader.errors.playbackFailed", {
            defaultValue: "Reader playback failed.",
          }),
        ),
      );
    } finally {
      setIsTranscriptSpeaking(false);
    }
  }, [isTranscriptSpeaking, t, transcription]);
  return {
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
  };
}
