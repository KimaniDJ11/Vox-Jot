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
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  BookOpen,
  Captions,
  Check,
  ChevronDown,
  ClipboardCopy,
  Download,
  FileText,
  Folder,
  FolderPlus,
  Layers,
  List,
  Loader2,
  LocateFixed,
  Pause,
  SlidersHorizontal,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import type {
  ReaderAudioCacheStatus,
  ReaderAudioCacheUnit,
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
import {
  SelectControl,
  type ModelListControlOption,
} from "@/components/model-hub/ModelListControls";
import { voiceAvatarGradient } from "@/components/settings/general/listen/createVoiceVoiceHub";
import { useSettingsSlice } from "@/hooks/useSettings";
import { useTtsVoiceCatalog } from "@/hooks/useTtsVoiceCatalog";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import { ReaderPlaybackBar } from "./reader/ReaderPlaybackBar";
import { ReaderVoicePicker } from "./reader/ReaderVoicePicker";
import { ReaderSearchControl } from "./reader/ReaderSearchControl";
import { ReaderTransformTools } from "./reader/ReaderTransformTools";
import {
  buildSectionReadingUnits,
  readingUnitId,
  sectionChunks,
  type ReadingUnit,
} from "./reader/readerReadingUnits";
import {
  cleanReaderText,
  deriveSectionTitle,
} from "./reader/readerTextCleanup";
import { useReaderPlayback } from "./reader/useReaderPlayback";

type FileTranscriptionView = "file" | "documents" | "folders";
type ReaderSplitView = "library" | "viewer";
type ReaderLibrarySort =
  | "recent"
  | "oldest"
  | "name_asc"
  | "name_desc"
  | "largest"
  | "smallest";
type FileProcessingMode = "transcribe" | "clean_transcribe";
type FileTranscriptionPanelKind = "media" | "reader";

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

const READER_DOCUMENT_EXTENSIONS = [
  "pdf",
  "docx",
  "epub",
  "txt",
  "text",
  "md",
  "markdown",
];

const readerLibraryStorageKey = "voxjot:reader-document-library:v1";
const readerDocumentStateStorageKey = "voxjot:reader-document-state:v1";
const readerLastDocumentVoiceStorageKey =
  "voxjot:reader-last-document-voice:v1";
const readerPlaybackRateOptions = [0.75, 1, 1.25, 1.5, 1.75, 2];

type ReaderDocumentKind = "pdf" | "docx" | "epub" | "markdown" | "text";

type ReaderDocumentSection = {
  index: number;
  title: string;
  text: string;
};

type ReaderDocumentBbox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type ReaderDocumentBlock = {
  index: number;
  text: string;
  kind: string;
  bbox: ReaderDocumentBbox | null;
};

type ReaderDocumentPage = {
  index: number;
  width: number | null;
  height: number | null;
  blocks: ReaderDocumentBlock[];
};

type ReaderDocument = {
  id: string;
  path: string;
  name: string;
  kind: ReaderDocumentKind;
  size_bytes: number;
  source_modified_ms: number | null;
  word_count: number;
  page_count: number;
  extraction_engine: string;
  thumbnail_data_url: string | null;
  text: string;
  pages: ReaderDocumentPage[];
  sections: ReaderDocumentSection[];
};

type ReaderStoredDocument = {
  id: string;
  path: string;
  name: string;
  kind: ReaderDocumentKind;
  size_bytes: number;
  source_modified_ms: number | null;
  word_count: number;
  page_count: number;
  section_count: number;
  extraction_engine: string;
  thumbnail_data_url: string | null;
  imported_at_ms: number;
  updated_at_ms: number;
};

type ReaderLibraryItem = {
  id: string;
  path: string;
  name: string;
  kind: ReaderDocumentKind;
  sizeBytes: number;
  sourceModifiedMs: number | null;
  wordCount: number;
  pageCount: number;
  sectionCount: number;
  extractionEngine: string;
  thumbnailDataUrl: string | null;
  openedAt: number;
};

type ReaderDocumentProgress = {
  sectionIndex: number;
  unitIndex: number;
  updatedAt: number;
};

type ReaderDocumentState = {
  sectionVoices?: Record<number, string | null>;
  sectionDisabled?: Record<number, boolean>;
  selectedPresetId?: string | null;
  playbackRate?: number;
  progress?: ReaderDocumentProgress;
  updatedAt?: number;
};

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function stripExtension(p: string): string {
  const base = basename(p);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function extensionOf(p: string): string {
  const base = basename(p);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function isReaderDocumentPath(p: string): boolean {
  const ext = extensionOf(p);
  return READER_DOCUMENT_EXTENSIONS.includes(ext);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function kindLabel(kind: ReaderDocumentKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "docx":
      return "DOCX";
    case "epub":
      return "EPUB";
    case "markdown":
      return "MD";
    case "text":
      return "TXT";
  }
}

function estimateReadingMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 170));
}

function readerErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof err.message === "string" &&
    err.message.trim()
  ) {
    return err.message;
  }
  return fallback;
}

function loadReaderLibrary(): ReaderLibraryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(readerLibraryStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): ReaderLibraryItem | null => {
        if (
          !item ||
          typeof item !== "object" ||
          typeof item.path !== "string" ||
          typeof item.name !== "string" ||
          typeof item.kind !== "string" ||
          typeof item.sizeBytes !== "number" ||
          typeof item.wordCount !== "number" ||
          typeof item.openedAt !== "number"
        ) {
          return null;
        }
        const sectionCount =
          typeof item.sectionCount === "number" ? item.sectionCount : 1;
        return {
          id: typeof item.id === "string" ? item.id : item.path,
          path: item.path,
          name: item.name,
          kind: item.kind,
          sizeBytes: item.sizeBytes,
          sourceModifiedMs:
            typeof item.sourceModifiedMs === "number"
              ? item.sourceModifiedMs
              : null,
          wordCount: item.wordCount,
          pageCount: typeof item.pageCount === "number" ? item.pageCount : 1,
          sectionCount,
          extractionEngine:
            typeof item.extractionEngine === "string"
              ? item.extractionEngine
              : "unknown",
          thumbnailDataUrl:
            typeof item.thumbnailDataUrl === "string"
              ? item.thumbnailDataUrl
              : null,
          openedAt: item.openedAt,
        };
      })
      .filter((item): item is ReaderLibraryItem => item !== null)
      .slice(0, 48);
  } catch {
    return [];
  }
}

function saveReaderLibrary(items: ReaderLibraryItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    readerLibraryStorageKey,
    JSON.stringify(items.slice(0, 48)),
  );
}

function loadReaderLastDocumentVoice(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(
      readerLastDocumentVoiceStorageKey,
    );
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function saveReaderLastDocumentVoice(presetId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (presetId && presetId.trim()) {
      window.localStorage.setItem(readerLastDocumentVoiceStorageKey, presetId);
    } else {
      window.localStorage.removeItem(readerLastDocumentVoiceStorageKey);
    }
  } catch {
    // Ignore local preference failures; document state still persists.
  }
}

function readerPresetLabel(preset: TtsVoicePreset | null): string {
  return (
    preset?.label?.trim() ||
    preset?.voice_label_snapshot?.trim() ||
    preset?.model_id ||
    preset?.id ||
    ""
  );
}

function clampIndex(value: number | null | undefined, maxExclusive: number) {
  if (!Number.isFinite(value) || maxExclusive <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(value ?? 0), maxExclusive - 1));
}

function normalizeReaderPlaybackRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return readerPlaybackRateOptions.includes(value) ? value : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function loadAllReaderDocumentStates(): Record<string, ReaderDocumentState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(readerDocumentStateStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return parsed as Record<string, ReaderDocumentState>;
  } catch {
    return {};
  }
}

function loadReaderDocumentState(documentId: string): ReaderDocumentState {
  return loadAllReaderDocumentStates()[documentId] ?? {};
}

function saveReaderDocumentState(
  documentId: string,
  patch: Partial<ReaderDocumentState>,
) {
  if (typeof window === "undefined" || !documentId) return;
  try {
    const states = loadAllReaderDocumentStates();
    states[documentId] = {
      ...(states[documentId] ?? {}),
      ...patch,
      updatedAt: Date.now(),
    };
    const entries = Object.entries(states)
      .sort(
        ([, left], [, right]) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
      )
      .slice(0, 96);
    window.localStorage.setItem(
      readerDocumentStateStorageKey,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // Ignore local persistence failures; the Reader remains usable.
  }
}

function readerItemFromDocument(document: ReaderDocument): ReaderLibraryItem {
  return {
    id: document.id,
    path: document.path,
    name: document.name,
    kind: document.kind,
    sizeBytes: document.size_bytes,
    sourceModifiedMs: document.source_modified_ms,
    wordCount: document.word_count,
    pageCount: document.page_count,
    sectionCount: document.sections.length,
    extractionEngine: document.extraction_engine,
    thumbnailDataUrl: document.thumbnail_data_url,
    openedAt: Date.now(),
  };
}

function readerItemFromStoredDocument(
  document: ReaderStoredDocument,
): ReaderLibraryItem {
  return {
    id: document.id,
    path: document.path,
    name: document.name,
    kind: document.kind,
    sizeBytes: document.size_bytes,
    sourceModifiedMs: document.source_modified_ms,
    wordCount: document.word_count,
    pageCount: document.page_count,
    sectionCount: document.section_count,
    extractionEngine: document.extraction_engine,
    thumbnailDataUrl: document.thumbnail_data_url,
    openedAt: document.updated_at_ms,
  };
}

function upsertReaderLibraryItem(
  items: ReaderLibraryItem[],
  item: ReaderLibraryItem,
): ReaderLibraryItem[] {
  return [
    item,
    ...items.filter(
      (existing) => existing.id !== item.id && existing.path !== item.path,
    ),
  ].slice(0, 48);
}

function sortReaderLibrary(
  items: ReaderLibraryItem[],
  sort: ReaderLibrarySort,
): ReaderLibraryItem[] {
  const sorted = [...items];
  switch (sort) {
    case "name_asc":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "name_desc":
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case "oldest":
      return sorted.sort((a, b) => a.openedAt - b.openedAt);
    case "largest":
      return sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
    case "smallest":
      return sorted.sort((a, b) => a.sizeBytes - b.sizeBytes);
    case "recent":
    default:
      return sorted.sort((a, b) => b.openedAt - a.openedAt);
  }
}

async function readReaderDocument(path: string): Promise<ReaderDocument> {
  return invoke<ReaderDocument>("read_reader_document", { sourcePath: path });
}

async function listReaderDocuments(): Promise<ReaderLibraryItem[]> {
  const documents = await invoke<ReaderStoredDocument[]>(
    "list_reader_documents",
  );
  return documents.map(readerItemFromStoredDocument);
}

async function removeStoredReaderDocument(id: string): Promise<void> {
  await invoke("remove_reader_document", { id });
}

async function speakReaderTextWithPreset(
  text: string,
  presetId: string | null,
  playbackRate = 1,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const fallback = "Reader playback failed.";
  const result = await commands.ttsSpeakReader(
    trimmed,
    null,
    presetId,
    playbackRate,
    "reader_document",
    false,
  );
  if (result.status === "error") {
    throw new Error(readerErrorMessage(result.error, fallback));
  }
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
        className="h-5 w-5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--avatar-ring)]"
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

const FileTranscriptionPanelShell: React.FC<{
  kind: FileTranscriptionPanelKind;
  initialView: FileTranscriptionView;
  availableViews: FileTranscriptionView[];
}> = ({ kind, initialView, availableViews }) => {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [cleanedPath, setCleanedPath] = useState<string>("");
  const [transcription, setTranscription] = useState<string>("");
  const [segments, setSegments] = useState<TimedSegment[]>([]);
  const [error, setError] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isTranscriptSpeaking, setIsTranscriptSpeaking] = useState(false);
  const [processingMode, setProcessingMode] =
    useState<FileProcessingMode>("transcribe");
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
  const selectedAsrModel = useSelectedSpeechAnalysisAsrModel();
  const isRunningRef = useRef(false);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    availableViewsRef.current = availableViews;
    if (!availableViews.includes(viewRef.current)) {
      setView(initialView);
    }
  }, [availableViews, initialView]);

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
      <div className="sticky top-0 z-30 -mt-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg),transparent_8%)] py-3 backdrop-blur-md">
        <WatchedFoldersToolbar
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

export const FileTranscriptionPanel: React.FC = () => (
  <FileTranscriptionPanelShell
    kind="media"
    initialView="file"
    availableViews={["file", "folders"]}
  />
);

export const ReaderPanel: React.FC = () => (
  <FileTranscriptionPanelShell
    kind="reader"
    initialView="documents"
    availableViews={["documents"]}
  />
);

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
  stage: "started" | "completed" | "failed" | "missing";
  message: string | null;
};

const WatchedFoldersStatusHeader: React.FC<{
  folders: WatchFolderConfig[];
  activity: WatchProgressPayload[];
  selectedAsrModel: SpeechAnalysisModelDescriptor | null;
}> = ({ folders, activity, selectedAsrModel }) => {
  const { t } = useTranslation();
  const latest = activity[0];
  const active = latest?.stage === "started" ? latest : undefined;
  const missingCount = folders.filter((folder) => folder.missing).length;
  const needsAttention =
    latest?.stage === "failed" ||
    latest?.stage === "missing" ||
    missingCount > 0;
  const isFolderCountSummary = folders.length > 0 && !active && !needsAttention;
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
    if (latest?.stage === "failed" || latest?.stage === "missing") {
      return {
        label: t("dictate.watchFolders.status.needsAttention", {
          defaultValue: "Needs attention",
        }),
        detail: basename(latest.source_path),
        icon: <AlertCircle size={12} aria-hidden="true" />,
      };
    }
    if (missingCount > 0) {
      return {
        label: t("dictate.watchFolders.status.needsAttention", {
          defaultValue: "Needs attention",
        }),
        detail: t("dictate.watchFolders.status.missingCount", {
          count: missingCount,
          defaultValue:
            missingCount === 1
              ? "1 missing folder"
              : "{{count}} missing folders",
        }),
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
                isFolderCountSummary ? "" : "font-medium text-[var(--text)]"
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
          className={
            isOpen ? "rotate-180 transition-transform" : "transition-transform"
          }
        />
      </button>
      {typeof document !== "undefined" && popup
        ? createPortal(popup, document.body)
        : null}
    </>
  );
};

const NativeFolderIcon: React.FC<{
  path: string;
  name: string;
  missing?: boolean;
}> = ({ path, name, missing = false }) => {
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

  if (missing) {
    return (
      <span
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--danger),transparent_90%)] text-[var(--danger)]"
        aria-hidden="true"
        title={name}
      >
        <AlertCircle className="h-6 w-6" />
      </span>
    );
  }

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
  kind: FileTranscriptionPanelKind;
  view: FileTranscriptionView;
  onViewChange: (view: FileTranscriptionView) => void;
  availableViews: FileTranscriptionView[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  readerSort: ReaderLibrarySort;
  onReaderSortChange: (sort: ReaderLibrarySort) => void;
  readerSplitView: ReaderSplitView;
  onReaderSplitViewChange: (view: ReaderSplitView) => void;
  readerSectionsOpen: boolean;
  onReaderSectionsOpenChange: (open: boolean) => void;
  readerTransformOpen: boolean;
  onReaderTransformOpenChange: (open: boolean) => void;
  readerHasDocument: boolean;
}> = ({
  kind,
  view,
  onViewChange,
  availableViews,
  searchQuery,
  onSearchQueryChange,
  readerSort,
  onReaderSortChange,
  readerSplitView,
  onReaderSplitViewChange,
  readerSectionsOpen,
  onReaderSectionsOpenChange,
  readerTransformOpen,
  onReaderTransformOpenChange,
  readerHasDocument,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const segmentedItems = useMemo(
    () =>
      [
        {
          value: "file" as const,
          label: t("dictate.fileTranscription.view.file", {
            defaultValue: "Transcribe",
          }),
        },
        {
          value: "documents" as const,
          label: t("dictate.fileTranscription.view.documents", {
            defaultValue: "Documents",
          }),
        },
        {
          value: "folders" as const,
          label: t("dictate.fileTranscription.view.folders", {
            defaultValue: "Folders",
          }),
        },
      ].filter((item) => availableViews.includes(item.value)),
    [availableViews, t],
  );

  const readerSortOptions = useMemo<ModelListControlOption[]>(
    () => [
      {
        value: "recent",
        label: t("dictate.reader.sort.recent", {
          defaultValue: "Recently added",
        }),
      },
      {
        value: "oldest",
        label: t("dictate.reader.sort.oldest", {
          defaultValue: "Oldest added",
        }),
      },
      {
        value: "name_asc",
        label: t("dictate.reader.sort.nameAsc", {
          defaultValue: "Name (A-Z)",
        }),
      },
      {
        value: "name_desc",
        label: t("dictate.reader.sort.nameDesc", {
          defaultValue: "Name (Z-A)",
        }),
      },
      {
        value: "largest",
        label: t("dictate.reader.sort.largest", { defaultValue: "Largest" }),
      },
      {
        value: "smallest",
        label: t("dictate.reader.sort.smallest", { defaultValue: "Smallest" }),
      },
    ],
    [t],
  );
  const selectedReaderSortLabel =
    readerSortOptions.find((option) => option.value === readerSort)?.label ??
    "";

  const handlePrimaryAction = useCallback(async () => {
    if (view === "documents") {
      window.dispatchEvent(new Event("reader-open-document-picker"));
      return;
    }

    setBusy(true);
    try {
      const folder = await addWatchFolder();
      if (folder) onViewChange("folders");
    } finally {
      setBusy(false);
    }
  }, [onViewChange, view]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="primary-soft"
        onClick={handlePrimaryAction}
        disabled={busy}
      >
        {view === "documents"
          ? t("dictate.reader.addDocument", { defaultValue: "Add document" })
          : t("dictate.watchFolders.add", { defaultValue: "Add folder" })}
      </Button>
      {kind === "reader" ? (
        <SegmentedControl<ReaderSplitView>
          value={readerSplitView}
          onChange={onReaderSplitViewChange}
          layoutId="reader-split-view-toggle"
          ariaLabel={t("dictate.reader.splitView.ariaLabel", {
            defaultValue: "Reader view",
          })}
          items={[
            {
              value: "library",
              label: t("dictate.reader.splitView.document", {
                defaultValue: "Document",
              }),
            },
            {
              value: "viewer",
              label: t("dictate.reader.splitView.viewer", {
                defaultValue: "Viewer",
              }),
            },
          ]}
        />
      ) : null}
      {segmentedItems.length > 1 ? (
        <SegmentedControl<FileTranscriptionView>
          value={view}
          onChange={onViewChange}
          layoutId={`file-transcription-view-toggle-${kind}`}
          ariaLabel={
            kind === "reader"
              ? t("dictate.reader.viewAriaLabel", {
                  defaultValue: "Reader view",
                })
              : t("dictate.fileTranscription.view.ariaLabel", {
                  defaultValue: "File transcription view",
                })
          }
          items={segmentedItems}
        />
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {kind === "reader" && readerSplitView === "viewer" ? (
          readerHasDocument ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={readerTransformOpen}
                onClick={() => {
                  onReaderSectionsOpenChange(false);
                  onReaderTransformOpenChange(!readerTransformOpen);
                }}
              >
                <Wand2 className="h-3.5 w-3.5" />
                {t("dictate.reader.transform.title", {
                  defaultValue: "Transform",
                })}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={readerSectionsOpen}
                onClick={() => {
                  onReaderTransformOpenChange(false);
                  onReaderSectionsOpenChange(!readerSectionsOpen);
                }}
              >
                <List className="h-3.5 w-3.5" />
                {t("dictate.reader.sections.title", {
                  defaultValue: "Sections",
                })}
              </Button>
            </>
          ) : null
        ) : (
          <>
            {view === "documents" ? (
              <ReaderSearchControl
                query={searchQuery}
                onQueryChange={onSearchQueryChange}
              />
            ) : null}
            {view === "documents" ? (
              <SelectControl
                value={readerSort}
                options={readerSortOptions}
                onChange={(value) =>
                  onReaderSortChange(value as ReaderLibrarySort)
                }
                ariaLabel={t("dictate.reader.sort.ariaLabel", {
                  defaultValue: "Filter documents",
                })}
                title={t("dictate.reader.sort.title", {
                  defaultValue: "Filter",
                })}
                selectedLabel={selectedReaderSortLabel}
                active={readerSort !== "recent"}
              >
                <SlidersHorizontal className="h-4 w-4 text-[var(--text)]" />
              </SelectControl>
            ) : null}
            {kind !== "reader" ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (view === "documents") {
                    void openModelHub("tts");
                    return;
                  }
                  void openModelHub("analysis", { scope: "analysis" });
                }}
              >
                <Layers className="h-3.5 w-3.5" />
                {t("listen.createVoices.models", { defaultValue: "Models" })}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

type ReaderDisplaySection = {
  index: number;
  title: string;
  enabled: boolean;
  paragraphs: Array<{
    paragraphIndex: number;
    chunks: Array<{ id: string; text: string }>;
  }>;
};

/**
 * One section on the continuous reading surface. Memoized so that during
 * playback only the section holding the active sentence re-renders — the
 * `activeUnitId` prop is non-null for exactly that section, so every other
 * section's props are referentially stable and React skips them.
 */
const ReaderSectionView = React.memo(function ReaderSectionView({
  section,
  totalSections,
  activeUnitId,
  unitIndexById,
  onSeek,
}: {
  section: ReaderDisplaySection;
  totalSections: number;
  activeUnitId: string | null;
  unitIndexById: Map<string, number>;
  onSeek: (unitIndex: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      data-section-index={section.index}
      className="scroll-mt-24 space-y-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--border)] pb-2">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
          {t("dictate.reader.sectionLabel", {
            defaultValue: "Section {{current}} of {{total}}",
            current: section.index + 1,
            total: totalSections,
          })}
        </div>
        <div
          className={[
            "min-w-0 flex-1 truncate text-right text-sm font-semibold",
            section.enabled
              ? "text-[var(--text)]"
              : "text-[var(--muted)] line-through",
          ].join(" ")}
        >
          {section.title}
          {!section.enabled ? (
            <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] no-underline">
              {t("dictate.reader.skipped", { defaultValue: "Skipped" })}
            </span>
          ) : null}
        </div>
      </div>
      <div
        className={[
          "space-y-3 text-[15px] leading-8",
          section.enabled ? "text-[var(--text)]" : "text-[var(--muted)]",
        ].join(" ")}
      >
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph.paragraphIndex} className="break-words">
            {paragraph.chunks.map((chunk) => {
              const unitIndex = unitIndexById.get(chunk.id);
              const interactive = unitIndex !== undefined;
              const isActive = chunk.id === activeUnitId;
              const activate = () => {
                if (unitIndex !== undefined) onSeek(unitIndex);
              };
              return (
                <span
                  key={chunk.id}
                  data-unit-id={chunk.id}
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  onClick={interactive ? activate : undefined}
                  onKeyDown={
                    interactive
                      ? (event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          event.preventDefault();
                          activate();
                        }
                      : undefined
                  }
                  className={[
                    "rounded-[3px] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]",
                    interactive
                      ? "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
                      : "",
                    isActive
                      ? "bg-[var(--accent-soft)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--accent-soft)]"
                      : interactive
                        ? "hover:bg-[var(--input)]"
                        : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {chunk.text}{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </section>
  );
});

const ReaderDocumentsPanel: React.FC<{
  query: string;
  sort: ReaderLibrarySort;
  splitView: ReaderSplitView;
  onSplitViewChange: (view: ReaderSplitView) => void;
  sectionsOpen: boolean;
  onSectionsOpenChange: (open: boolean) => void;
  transformOpen: boolean;
  onTransformOpenChange: (open: boolean) => void;
  onHasDocumentChange: (hasDocument: boolean) => void;
}> = ({
  query,
  sort,
  splitView,
  onSplitViewChange,
  sectionsOpen,
  onSectionsOpenChange,
  transformOpen,
  onTransformOpenChange,
  onHasDocumentChange,
}) => {
  const { t } = useTranslation();
  const { tts_active_preset_id: activeTtsPresetId } = useSettingsSlice([
    "tts_active_preset_id",
  ] as const);
  const [library, setLibrary] = useState<ReaderLibraryItem[]>(() =>
    loadReaderLibrary(),
  );
  const [activeDocument, setActiveDocument] = useState<ReaderDocument | null>(
    null,
  );
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [readerRestoreIndex, setReaderRestoreIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isExportingAudio, setIsExportingAudio] = useState(false);
  const [error, setError] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);
  // Per-section voice profiles: sectionIndex -> preset id (null = default voice),
  // and sectionIndex -> true when the user turned that section off.
  const [sectionVoices, setSectionVoices] = useState<
    Record<number, string | null>
  >({});
  const [sectionDisabled, setSectionDisabled] = useState<
    Record<number, boolean>
  >({});
  const { presets, presetVoices, createPresetFromVoice } = useTtsVoiceCatalog();
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(() =>
    loadReaderLastDocumentVoice(),
  );
  const [playbackRate, setPlaybackRate] = useState(1);
  const [audioCacheStatus, setAudioCacheStatus] =
    useState<ReaderAudioCacheStatus | null>(null);
  const [isPreparingReaderAudio, setIsPreparingReaderAudio] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(
    null,
  );
  const activeReaderDocumentIdRef = useRef<string | null>(null);
  // Continuous-scroll reading surface: the whole document renders at once and
  // the player auto-scrolls to keep the spoken sentence in view. `autoFollow`
  // turns off when the reader scrolls away by hand (so we stop yanking them
  // back) and a "Jump to playing" pill re-engages it.
  const readerScrollRef = useRef<HTMLDivElement | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  useEffect(() => {
    activeReaderDocumentIdRef.current = activeDocument?.id ?? null;
  }, [activeDocument?.id]);

  // A freshly opened document should follow playback again.
  useEffect(() => {
    setAutoFollow(true);
  }, [activeDocument?.id]);

  useEffect(
    () => () => {
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }
    },
    [],
  );

  const resolveDocumentVoicePresetId = useCallback(
    (preferredPresetId: string | null | undefined) => {
      const validPresetId = (
        presetId: string | null | undefined,
      ): presetId is string =>
        typeof presetId === "string" &&
        presetId.trim().length > 0 &&
        presets.some((preset) => preset.id === presetId);

      if (validPresetId(preferredPresetId)) return preferredPresetId;

      const savedReaderPresetId = loadReaderLastDocumentVoice();
      if (validPresetId(savedReaderPresetId)) return savedReaderPresetId;

      const normalizedActivePresetId =
        typeof activeTtsPresetId === "string" && activeTtsPresetId.trim()
          ? activeTtsPresetId
          : null;
      if (validPresetId(normalizedActivePresetId)) {
        return normalizedActivePresetId;
      }

      return presets[0]?.id ?? null;
    },
    [activeTtsPresetId, presets],
  );

  const persistLibrary = useCallback((items: ReaderLibraryItem[]) => {
    setLibrary(items);
    saveReaderLibrary(items);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listReaderDocuments()
      .then((items) => {
        if (!cancelled && items.length > 0) {
          persistLibrary(items);
        }
      })
      .catch((err) => {
        console.warn("Failed to load Reader document library:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [persistLibrary]);

  // Initialize the reader's document voice from the last Reader voice, then the
  // active Listen preset / first preset.
  useEffect(() => {
    setSelectedPresetId((current) => resolveDocumentVoicePresetId(current));
  }, [resolveDocumentVoicePresetId]);

  useEffect(() => {
    if (presets.length === 0) return;
    const validPresetIds = new Set(presets.map((preset) => preset.id));
    setSelectedPresetId((current) =>
      current && !validPresetIds.has(current)
        ? (presets[0]?.id ?? null)
        : current,
    );
    setSectionVoices((current) => {
      let changed = false;
      const next: Record<number, string | null> = {};
      for (const [sectionIndex, presetId] of Object.entries(current)) {
        if (presetId && !validPresetIds.has(presetId)) {
          changed = true;
          continue;
        }
        next[Number(sectionIndex)] = presetId;
      }
      return changed ? next : current;
    });
  }, [presets]);

  const loadDocument = useCallback(
    async (path: string) => {
      onSplitViewChange("viewer");
      setIsLoading(true);
      setError("");
      try {
        const document = await readReaderDocument(path);
        const documentState = loadReaderDocumentState(document.id);
        const savedProgress = documentState.progress;
        const nextSectionIndex = clampIndex(
          savedProgress?.sectionIndex,
          document.sections.length,
        );
        setActiveDocument(document);
        setActiveSectionIndex(nextSectionIndex);
        setReaderRestoreIndex(
          typeof savedProgress?.unitIndex === "number"
            ? Math.max(0, Math.trunc(savedProgress.unitIndex))
            : 0,
        );
        setSectionVoices(documentState.sectionVoices ?? {});
        setSectionDisabled(documentState.sectionDisabled ?? {});
        setSelectedPresetId(
          resolveDocumentVoicePresetId(
            "selectedPresetId" in documentState
              ? documentState.selectedPresetId
              : undefined,
          ),
        );
        setPlaybackRate(
          normalizeReaderPlaybackRate(documentState.playbackRate),
        );
        setAudioCacheStatus(null);
        persistLibrary(
          upsertReaderLibraryItem(library, readerItemFromDocument(document)),
        );
      } catch (err) {
        setError(
          readerErrorMessage(
            err,
            t("dictate.reader.errors.openFailed", {
              defaultValue: "Failed to open document.",
            }),
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [
      library,
      onSplitViewChange,
      persistLibrary,
      resolveDocumentVoicePresetId,
      t,
    ],
  );

  const pickDocument = useCallback(async () => {
    const filePath = await open({
      multiple: false,
      filters: [
        {
          name: t("dictate.reader.documentDialogLabel", {
            defaultValue: "Documents",
          }),
          extensions: READER_DOCUMENT_EXTENSIONS,
        },
      ],
    });
    if (!filePath || Array.isArray(filePath)) return;
    await loadDocument(filePath);
  }, [loadDocument, t]);

  useEffect(() => {
    const handleDrop = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (path) void loadDocument(path);
    };
    const handlePicker = () => {
      void pickDocument();
    };
    window.addEventListener("reader-document-drop", handleDrop);
    window.addEventListener("reader-open-document-picker", handlePicker);
    return () => {
      window.removeEventListener("reader-document-drop", handleDrop);
      window.removeEventListener("reader-open-document-picker", handlePicker);
    };
  }, [loadDocument, pickDocument]);

  const filteredLibrary = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matched = normalized
      ? library.filter((item) =>
          `${item.name} ${kindLabel(item.kind)} ${item.path}`
            .toLowerCase()
            .includes(normalized),
        )
      : library;
    return sortReaderLibrary(matched, sort);
  }, [library, query, sort]);

  // Tidy the extracted text (reflow hard-wrapped lines, strip OCR "x" markers)
  // and derive real titles, so both the display and the narration are clean.
  const cleanedSections = useMemo(
    () =>
      (activeDocument?.sections ?? []).map((section) => {
        const text = cleanReaderText(section.text);
        return {
          index: section.index,
          title: deriveSectionTitle(
            text,
            t("dictate.reader.sectionFallbackTitle", {
              defaultValue: "Section {{n}}",
              n: section.index + 1,
            }),
          ),
          text,
        };
      }),
    [activeDocument, t],
  );

  const currentSection =
    cleanedSections[activeSectionIndex] ?? cleanedSections[0] ?? null;
  const readingUnits = useMemo(
    () =>
      buildSectionReadingUnits(cleanedSections, {
        voiceForSection: (sectionIndex) =>
          sectionVoices[sectionIndex] ?? selectedPresetId,
        isSectionEnabled: (sectionIndex) =>
          sectionDisabled[sectionIndex] !== true,
      }),
    [cleanedSections, sectionVoices, sectionDisabled, selectedPresetId],
  );
  // The on-screen text and the playback queue share unit ids, so the active
  // sentence can highlight while spoken and seek when clicked. Skipped sections
  // produce no units, so their chunks simply won't be in this map.
  const unitIndexById = useMemo(() => {
    const map = new Map<string, number>();
    readingUnits.forEach((unit, index) => map.set(unit.id, index));
    return map;
  }, [readingUnits]);
  // Display model for the continuous reading surface: every section (including
  // skipped ones, rendered muted) split into paragraphs of chunks whose ids
  // match the queue. Built from the same `sectionChunks` as the units so the
  // two never drift.
  const displaySections = useMemo(
    () =>
      cleanedSections.map((section) => {
        const paragraphs: Array<{
          paragraphIndex: number;
          chunks: Array<{ id: string; text: string }>;
        }> = [];
        for (const chunk of sectionChunks(section.text)) {
          const id = readingUnitId(
            section.index,
            chunk.paragraphIndex,
            chunk.chunkIndex,
          );
          let paragraph = paragraphs[paragraphs.length - 1];
          if (!paragraph || paragraph.paragraphIndex !== chunk.paragraphIndex) {
            paragraph = { paragraphIndex: chunk.paragraphIndex, chunks: [] };
            paragraphs.push(paragraph);
          }
          paragraph.chunks.push({ id, text: chunk.text });
        }
        return {
          index: section.index,
          title: section.title,
          enabled: sectionDisabled[section.index] !== true,
          paragraphs,
        };
      }),
    [cleanedSections, sectionDisabled],
  );
  const readerAudioUnits = useMemo<ReaderAudioCacheUnit[]>(
    () =>
      readingUnits.map((unit) => ({
        id: unit.id,
        text: unit.text,
        preset_id: unit.presetId,
      })),
    [readingUnits],
  );
  const documentVoicePreset =
    presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const documentVoiceLabel =
    readerPresetLabel(documentVoicePreset) ||
    t("dictate.reader.player.appVoice", {
      defaultValue: "App voice",
    });
  const sectionDefaultVoiceLabel = t(
    "dictate.reader.sections.useDocumentVoice",
    {
      defaultValue: "Use document voice: {{voice}}",
      voice: documentVoiceLabel,
    },
  );
  const selectedSectionCount = cleanedSections.filter(
    (section) => sectionDisabled[section.index] !== true,
  ).length;
  const totalSectionCount = cleanedSections.length;

  const refreshReaderAudioCacheStatus = useCallback(async () => {
    const documentId = activeDocument?.id ?? null;
    if (!documentId) {
      setAudioCacheStatus(null);
      return null;
    }
    try {
      const result = await commands.getReaderAudioCacheStatus(
        documentId,
        readerAudioUnits,
        playbackRate,
      );
      if (result.status === "error") {
        console.warn("Failed to read Reader audio cache status:", result.error);
        return null;
      }
      if (activeReaderDocumentIdRef.current === documentId) {
        setAudioCacheStatus(result.data);
      }
      return result.data;
    } catch (err) {
      console.warn("Failed to read Reader audio cache status:", err);
      return null;
    }
  }, [activeDocument?.id, playbackRate, readerAudioUnits]);

  useEffect(() => {
    void refreshReaderAudioCacheStatus();
  }, [refreshReaderAudioCacheStatus]);

  const selectDocumentVoice = useCallback((presetId: string | null) => {
    setSelectedPresetId(presetId);
    saveReaderLastDocumentVoice(presetId);
  }, []);

  const readAllSections = useCallback(() => {
    setSectionDisabled({});
  }, []);

  const skipAllSections = useCallback(() => {
    setSectionDisabled(
      Object.fromEntries(
        cleanedSections.map((section) => [section.index, true]),
      ),
    );
  }, [cleanedSections]);

  const resetSectionVoices = useCallback(() => {
    setSectionVoices({});
  }, []);

  const selectPlaybackRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
  }, []);

  const prepareReaderAudio = useCallback(async () => {
    if (
      !activeDocument ||
      readerAudioUnits.length === 0 ||
      isPreparingReaderAudio
    ) {
      return;
    }
    void commands.ttsStop();
    setIsPreparingReaderAudio(true);
    setError("");
    try {
      const result = await commands.prepareReaderAudioCache(
        activeDocument.id,
        readerAudioUnits,
        playbackRate,
      );
      if (result.status === "error") {
        throw new Error(
          readerErrorMessage(
            result.error,
            t("dictate.reader.errors.audioPrepareFailed", {
              defaultValue: "Failed to prepare Reader audio.",
            }),
          ),
        );
      }
      await refreshReaderAudioCacheStatus();
    } catch (err) {
      setError(
        readerErrorMessage(
          err,
          t("dictate.reader.errors.audioPrepareFailed", {
            defaultValue: "Failed to prepare Reader audio.",
          }),
        ),
      );
    } finally {
      setIsPreparingReaderAudio(false);
    }
  }, [
    activeDocument,
    isPreparingReaderAudio,
    playbackRate,
    readerAudioUnits,
    refreshReaderAudioCacheStatus,
    t,
  ]);

  const speakUnit = useCallback(
    async (unit: ReadingUnit) => {
      if (!activeDocument) {
        return speakReaderTextWithPreset(
          unit.text,
          unit.presetId,
          playbackRate,
        );
      }
      const result = await commands.playReaderAudioUnit(
        activeDocument.id,
        {
          id: unit.id,
          text: unit.text,
          preset_id: unit.presetId,
        },
        playbackRate,
      );
      if (result.status === "error") {
        throw new Error(
          readerErrorMessage(
            result.error,
            t("dictate.reader.errors.playbackFailed", {
              defaultValue: "Reader playback failed.",
            }),
          ),
        );
      }
      if (!result.data.cache_hit) {
        void refreshReaderAudioCacheStatus();
      }
    },
    [activeDocument, playbackRate, refreshReaderAudioCacheStatus, t],
  );
  const stopReaderAudio = useCallback(async () => {
    await commands.ttsStop();
  }, []);
  const handlePlaybackError = useCallback(
    (err: unknown) => {
      setError(
        readerErrorMessage(
          err,
          t("dictate.reader.errors.playbackFailed", {
            defaultValue: "Reader playback failed.",
          }),
        ),
      );
    },
    [t],
  );

  const player = useReaderPlayback({
    units: readingUnits,
    initialIndex: readerRestoreIndex,
    resetKey: activeDocument?.id ?? null,
    speak: speakUnit,
    stopAudio: stopReaderAudio,
    onError: handlePlaybackError,
  });

  const currentReadingUnit = readingUnits[player.index] ?? null;
  // Stable handle to the player so the per-section memo's `onSeek` prop never
  // changes identity (the controller object is recreated every render).
  const playerRef = useRef(player);
  playerRef.current = player;

  // Center a unit by id. Works regardless of play state (so scrubbing/seeking
  // moves the view too), and marks the scroll as programmatic so the hand-scroll
  // listener below doesn't mistake it for the reader scrolling.
  const scrollToUnitId = useCallback(
    (
      unitId: string | null | undefined,
      behavior: ScrollBehavior = "smooth",
    ) => {
      if (!unitId) return;
      const el = readerScrollRef.current?.querySelector<HTMLElement>(
        `[data-unit-id="${unitId}"]`,
      );
      if (!el) return;
      programmaticScrollRef.current = true;
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }
      el.scrollIntoView({ block: "center", behavior });
      programmaticScrollTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false;
        programmaticScrollTimerRef.current = null;
      }, 800);
    },
    [],
  );

  const scrollToSection = useCallback((sectionIndex: number) => {
    const el = readerScrollRef.current?.querySelector<HTMLElement>(
      `[data-section-index="${sectionIndex}"]`,
    );
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  // Clicking a sentence reads from there (Speechify-style), in any state.
  const seekToReadingUnit = useCallback((unitIndex: number) => {
    setError("");
    setAutoFollow(true);
    playerRef.current.playAt(unitIndex);
  }, []);

  // Follow the narration: re-center whenever the playing unit advances. Guarded
  // to playing/paused so it never fires on initial mount (explicit seeks below
  // handle the idle case imperatively).
  useEffect(() => {
    if (player.status === "idle" || !autoFollow) return;
    const id = currentReadingUnit?.id;
    const raf = window.requestAnimationFrame(() =>
      scrollToUnitId(id, "smooth"),
    );
    return () => window.cancelAnimationFrame(raf);
  }, [
    player.index,
    player.status,
    autoFollow,
    currentReadingUnit?.id,
    scrollToUnitId,
  ]);

  // Stop following the instant the reader scrolls by hand (capture catches
  // scrolls from whichever ancestor actually owns the scrollbar).
  useEffect(() => {
    if (splitView !== "viewer") return;
    const onScroll = () => {
      if (programmaticScrollRef.current || player.status === "idle") return;
      setAutoFollow((current) => (current ? false : current));
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [splitView, player.status]);

  useEffect(() => {
    if (!activeDocument || currentReadingUnit?.sectionIndex === null) return;
    if (typeof currentReadingUnit?.sectionIndex !== "number") return;
    if (currentReadingUnit.sectionIndex !== activeSectionIndex) {
      setActiveSectionIndex(currentReadingUnit.sectionIndex);
    }
  }, [activeDocument, activeSectionIndex, currentReadingUnit?.sectionIndex]);

  useEffect(() => {
    if (!activeDocument) return;
    saveReaderDocumentState(activeDocument.id, {
      sectionVoices,
      sectionDisabled,
      selectedPresetId,
      playbackRate,
    });
  }, [
    activeDocument,
    sectionVoices,
    sectionDisabled,
    selectedPresetId,
    playbackRate,
  ]);

  useEffect(() => {
    if (!activeDocument || !currentReadingUnit) return;
    saveReaderDocumentState(activeDocument.id, {
      progress: {
        sectionIndex: currentReadingUnit.sectionIndex ?? activeSectionIndex,
        unitIndex: player.index,
        updatedAt: Date.now(),
      },
    });
  }, [activeDocument, activeSectionIndex, currentReadingUnit, player.index]);

  const playbackPageLabel =
    currentReadingUnit && currentReadingUnit.sectionIndex !== null
      ? t("dictate.reader.player.sectionPosition", {
          defaultValue: "Section {{current}} of {{total}}",
          current: currentReadingUnit.sectionIndex + 1,
          total: activeDocument?.sections.length ?? 0,
        })
      : null;

  const copyDocumentText = useCallback(async () => {
    const text = currentSection?.text ?? activeDocument?.text ?? "";
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(true);
      window.setTimeout(() => setCopyFeedback(false), 1600);
    } catch {
      setError(
        t("dictate.reader.errors.copyFailed", {
          defaultValue: "Failed to copy document text.",
        }),
      );
    }
  }, [activeDocument?.text, currentSection?.text, t]);

  const exportReaderAudio = useCallback(async () => {
    if (!activeDocument || readingUnits.length === 0) return;
    const target = await save({
      defaultPath: `${stripExtension(activeDocument.name)}.wav`,
      filters: [
        {
          name: t("dictate.reader.audioExportDialogLabel", {
            defaultValue: "WAV audio",
          }),
          extensions: ["wav"],
        },
      ],
    });
    if (!target) return;

    setIsExportingAudio(true);
    setError("");
    try {
      const result = await commands.exportReaderAudio(
        readingUnits.map((unit) => ({
          text: unit.text,
          preset_id: unit.presetId,
        })),
        target,
        playbackRate,
      );
      if (result.status === "error") {
        throw new Error(
          readerErrorMessage(
            result.error,
            t("dictate.reader.errors.audioExportFailed", {
              defaultValue: "Failed to export Reader audio.",
            }),
          ),
        );
      }
    } catch (err) {
      setError(
        readerErrorMessage(
          err,
          t("dictate.reader.errors.audioExportFailed", {
            defaultValue: "Failed to export Reader audio.",
          }),
        ),
      );
    } finally {
      setIsExportingAudio(false);
    }
  }, [activeDocument, playbackRate, readingUnits, t]);

  const removeLibraryItem = useCallback(
    async (item: ReaderLibraryItem) => {
      try {
        await removeStoredReaderDocument(item.id);
      } catch (err) {
        console.warn("Failed to remove Reader document from app cache:", err);
      }
      const next = library.filter(
        (existing) => existing.id !== item.id && existing.path !== item.path,
      );
      persistLibrary(next);
      setConfirmingRemoveId(null);
      if (
        activeDocument?.id === item.id ||
        activeDocument?.path === item.path
      ) {
        setActiveDocument(null);
        setActiveSectionIndex(0);
        setReaderRestoreIndex(0);
        setSectionVoices({});
        setSectionDisabled({});
        setAudioCacheStatus(null);
      }
    },
    [activeDocument?.id, activeDocument?.path, library, persistLibrary],
  );

  // The viewer is a split-view pane, not a modal: going back keeps the
  // document loaded (and playback running) so the toggle is non-destructive.
  const backToLibrary = useCallback(() => {
    onSplitViewChange("library");
  }, [onSplitViewChange]);

  // Report whether the viewer has a document loaded so the toolbar only shows
  // the Sections button when it's meaningful.
  const hasViewerDocument = !!(activeDocument && currentSection);
  useEffect(() => {
    onHasDocumentChange(hasViewerDocument);
  }, [hasViewerDocument, onHasDocumentChange]);

  // The viewer popups only belong to the viewer with a document open.
  useEffect(() => {
    if (splitView !== "viewer" || !hasViewerDocument) {
      onSectionsOpenChange(false);
      onTransformOpenChange(false);
    }
  }, [
    splitView,
    hasViewerDocument,
    onSectionsOpenChange,
    onTransformOpenChange,
  ]);

  useEffect(() => {
    if (splitView !== "viewer" || !activeDocument) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (sectionsOpen) {
        onSectionsOpenChange(false);
      } else if (transformOpen) {
        onTransformOpenChange(false);
      } else {
        backToLibrary();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [
    activeDocument,
    backToLibrary,
    splitView,
    sectionsOpen,
    onSectionsOpenChange,
    transformOpen,
    onTransformOpenChange,
  ]);

  return (
    <div className="space-y-5">
      {splitView === "library" ? (
        <section
          className="min-w-0 space-y-3"
          aria-label={t("dictate.reader.libraryAriaLabel", {
            defaultValue: "Reader library",
          })}
        >
          <div className="max-h-[560px] overflow-y-auto pr-1">
            {filteredLibrary.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--muted)]">
                {library.length === 0
                  ? t("dictate.reader.empty", {
                      defaultValue: "No documents yet.",
                    })
                  : t("dictate.reader.noMatches", {
                      defaultValue: "No matching documents.",
                    })}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {filteredLibrary.map((item) => {
                  const selected =
                    activeDocument?.id === item.id ||
                    activeDocument?.path === item.path;
                  return (
                    <div
                      key={item.id}
                      className={[
                        "group relative flex min-w-0 flex-col gap-2",
                        selected
                          ? "text-[var(--accent)]"
                          : "text-[var(--text)]",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        onClick={() => void loadDocument(item.path)}
                        title={item.name}
                        className={[
                          "relative block aspect-[3/4] w-full overflow-hidden rounded-xl border bg-[var(--card)] transition-[border-color,box-shadow]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
                          selected
                            ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                            : "border-[var(--border)] group-hover:border-[var(--accent)]",
                        ].join(" ")}
                      >
                        {item.thumbnailDataUrl ? (
                          <img
                            src={item.thumbnailDataUrl}
                            alt=""
                            className="h-full w-full object-cover object-top"
                            draggable={false}
                          />
                        ) : (
                          <span
                            className="flex h-full w-full items-center justify-center text-lg font-bold text-[var(--accent)]"
                            aria-hidden="true"
                          >
                            {kindLabel(item.kind)}
                          </span>
                        )}
                        <span className="absolute bottom-2 left-2 rounded-md bg-[var(--media-badge-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--media-badge-text)] backdrop-blur-sm">
                          {t("dictate.reader.libraryCardBadge", {
                            defaultValue: "{{kind}} · {{size}}",
                            kind: kindLabel(item.kind),
                            size: formatBytes(item.sizeBytes),
                          })}
                        </span>
                      </button>
                      <div className="flex min-h-9 items-center gap-1.5 px-1">
                        <FileText
                          size={14}
                          className="shrink-0 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          onClick={() => void loadDocument(item.path)}
                          title={item.name}
                          className={[
                            "min-w-0 flex-1 truncate text-left text-xs font-medium",
                            selected
                              ? "text-[var(--accent)]"
                              : "text-[var(--text)]",
                          ].join(" ")}
                        >
                          {item.name}
                        </button>
                        {confirmingRemoveId === item.id ? (
                          <span className="flex shrink-0 items-center gap-0.5">
                            <ActionIconButton
                              type="button"
                              tone="confirm"
                              title={t("dictate.reader.confirmRemoveDocument", {
                                defaultValue: "Confirm remove document",
                              })}
                              aria-label={t(
                                "dictate.reader.confirmRemoveDocument",
                                {
                                  defaultValue: "Confirm remove document",
                                },
                              )}
                              onClick={() => void removeLibraryItem(item)}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </ActionIconButton>
                            <ActionIconButton
                              type="button"
                              title={t("dictate.reader.cancelRemoveDocument", {
                                defaultValue: "Cancel remove document",
                              })}
                              aria-label={t(
                                "dictate.reader.cancelRemoveDocument",
                                {
                                  defaultValue: "Cancel remove document",
                                },
                              )}
                              onClick={() => setConfirmingRemoveId(null)}
                            >
                              <X size={13} aria-hidden="true" />
                            </ActionIconButton>
                          </span>
                        ) : (
                          <ActionIconButton
                            type="button"
                            tone="danger"
                            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                            title={t("dictate.reader.removeDocument", {
                              defaultValue: "Remove document",
                            })}
                            aria-label={t("dictate.reader.removeDocument", {
                              defaultValue: "Remove document",
                            })}
                            onClick={() => setConfirmingRemoveId(item.id)}
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </ActionIconButton>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section
          className="min-w-0 space-y-4 pb-48"
          aria-label={t("dictate.reader.previewAriaLabel", {
            defaultValue: "Reader preview",
          })}
        >
          {activeDocument && currentSection ? (
            <>
              <div className="space-y-4 px-1">
                {sectionsOpen
                  ? createPortal(
                      <div
                        className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:p-6"
                        role="presentation"
                        onClick={() => onSectionsOpenChange(false)}
                      >
                        <div
                          className="absolute inset-0 bg-[var(--scrim-bg-strong)] backdrop-blur-sm"
                          aria-hidden="true"
                        />
                        <div
                          role="dialog"
                          aria-modal="true"
                          aria-label={t("dictate.reader.sections.title", {
                            defaultValue: "Sections",
                          })}
                          className="relative mt-[6vh] flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg,var(--bg))] shadow-[var(--modal-shadow-strong)]"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[var(--text)]">
                                {t("dictate.reader.sections.title", {
                                  defaultValue: "Sections",
                                })}
                              </div>
                              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                                {t("dictate.reader.sections.selectedCount", {
                                  defaultValue:
                                    "{{selected}} of {{total}} selected",
                                  selected: selectedSectionCount,
                                  total: totalSectionCount,
                                })}
                              </div>
                            </div>
                            <ActionIconButton
                              type="button"
                              onClick={() => onSectionsOpenChange(false)}
                              aria-label={t("common.close", {
                                defaultValue: "Close",
                              })}
                              title={t("common.close", {
                                defaultValue: "Close",
                              })}
                            >
                              <X size={16} aria-hidden="true" />
                            </ActionIconButton>
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5 border-b border-[var(--border)] pb-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={
                                  totalSectionCount === 0 ||
                                  selectedSectionCount === totalSectionCount
                                }
                                onClick={readAllSections}
                                className="gap-1 text-[11px]"
                              >
                                <Check size={12} aria-hidden="true" />
                                {t("dictate.reader.sections.readAll", {
                                  defaultValue: "Read all",
                                })}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={
                                  totalSectionCount === 0 ||
                                  selectedSectionCount === 0
                                }
                                onClick={skipAllSections}
                                className="gap-1 text-[11px]"
                              >
                                <X size={12} aria-hidden="true" />
                                {t("dictate.reader.sections.skipAll", {
                                  defaultValue: "Skip all",
                                })}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={
                                  Object.keys(sectionVoices).length === 0
                                }
                                onClick={resetSectionVoices}
                                className="text-[11px]"
                              >
                                {t("dictate.reader.sections.resetVoices", {
                                  defaultValue: "Reset voices",
                                })}
                              </Button>
                            </div>
                            <div className="space-y-1">
                              {cleanedSections.map((section) => {
                                const selected =
                                  section.index === activeSectionIndex;
                                const enabled =
                                  sectionDisabled[section.index] !== true;
                                return (
                                  <div
                                    key={section.index}
                                    className={[
                                      "rounded-lg px-2 py-1.5 transition-colors",
                                      selected
                                        ? "bg-[var(--accent-soft)]"
                                        : "hover:bg-[var(--input)]",
                                    ].join(" ")}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSectionDisabled((prev) => ({
                                            ...prev,
                                            [section.index]:
                                              prev[section.index] !== true,
                                          }));
                                        }}
                                        aria-pressed={enabled}
                                        title={
                                          enabled
                                            ? t(
                                                "dictate.reader.sections.read",
                                                {
                                                  defaultValue:
                                                    "Read this section",
                                                },
                                              )
                                            : t(
                                                "dictate.reader.sections.skip",
                                                {
                                                  defaultValue:
                                                    "Skip this section",
                                                },
                                              )
                                        }
                                        className={[
                                          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
                                          enabled
                                            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]"
                                            : "border-[var(--border)] text-transparent",
                                        ].join(" ")}
                                      >
                                        <Check size={14} aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveSectionIndex(section.index);
                                          onSectionsOpenChange(false);
                                          scrollToSection(section.index);
                                        }}
                                        className={[
                                          "min-w-0 flex-1 truncate text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
                                          selected
                                            ? "font-semibold text-[var(--accent)]"
                                            : enabled
                                              ? "text-[var(--text)]"
                                              : "text-[var(--muted)] line-through",
                                        ].join(" ")}
                                      >
                                        {section.title}
                                      </button>
                                    </div>
                                    <div className="mt-1">
                                      <ReaderVoicePicker
                                        value={
                                          sectionVoices[section.index] ?? null
                                        }
                                        presets={presets}
                                        presetVoices={presetVoices}
                                        defaultLabel={sectionDefaultVoiceLabel}
                                        defaultPresetId={selectedPresetId}
                                        onSelectPreset={(presetId) => {
                                          setSectionVoices((prev) => ({
                                            ...prev,
                                            [section.index]: presetId,
                                          }));
                                        }}
                                        onSelectDefault={() => {
                                          setSectionVoices((prev) => ({
                                            ...prev,
                                            [section.index]: null,
                                          }));
                                        }}
                                        onCreatePresetFromVoice={
                                          createPresetFromVoice
                                        }
                                        disabled={!enabled}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body,
                    )
                  : null}

                {transformOpen
                  ? createPortal(
                      <div
                        className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:p-6"
                        role="presentation"
                        onClick={() => onTransformOpenChange(false)}
                      >
                        <div
                          className="absolute inset-0 bg-[var(--scrim-bg-strong)] backdrop-blur-sm"
                          aria-hidden="true"
                        />
                        <div
                          role="dialog"
                          aria-modal="true"
                          aria-label={t("dictate.reader.transform.title", {
                            defaultValue: "Transform",
                          })}
                          className="relative mt-[6vh] flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg,var(--bg))] shadow-[var(--modal-shadow-strong)]"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                            <div className="text-sm font-semibold text-[var(--text)]">
                              {t("dictate.reader.transform.title", {
                                defaultValue: "Transform",
                              })}
                            </div>
                            <ActionIconButton
                              type="button"
                              onClick={() => onTransformOpenChange(false)}
                              aria-label={t("common.close", {
                                defaultValue: "Close",
                              })}
                              title={t("common.close", {
                                defaultValue: "Close",
                              })}
                            >
                              <X size={16} aria-hidden="true" />
                            </ActionIconButton>
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto p-4">
                            <ReaderTransformTools
                              embedded
                              documentText={activeDocument.text}
                              onListen={(text) => {
                                setError("");
                                player.stop();
                                void speakReaderTextWithPreset(
                                  text,
                                  selectedPresetId,
                                  playbackRate,
                                ).catch(handlePlaybackError);
                              }}
                            />
                          </div>
                        </div>
                      </div>,
                      document.body,
                    )
                  : null}

                <div ref={readerScrollRef} className="space-y-9">
                  {displaySections.map((section) => (
                    <ReaderSectionView
                      key={section.index}
                      section={section}
                      totalSections={activeDocument.sections.length}
                      activeUnitId={
                        currentReadingUnit?.sectionIndex === section.index
                          ? currentReadingUnit.id
                          : null
                      }
                      unitIndexById={unitIndexById}
                      onSeek={seekToReadingUnit}
                    />
                  ))}
                </div>
              </div>
              <ReaderPlaybackBar
                status={player.status}
                index={player.index}
                total={player.total}
                playbackRate={playbackRate}
                pageLabel={playbackPageLabel}
                onToggle={() => {
                  setError("");
                  setAutoFollow(true);
                  player.toggle();
                }}
                onStop={player.stop}
                onPrev={() => {
                  const target = Math.max(player.index - 1, 0);
                  setAutoFollow(true);
                  player.prev();
                  scrollToUnitId(readingUnits[target]?.id, "smooth");
                }}
                onNext={() => {
                  const target = Math.min(
                    player.index + 1,
                    Math.max(readingUnits.length - 1, 0),
                  );
                  setAutoFollow(true);
                  player.next();
                  scrollToUnitId(readingUnits[target]?.id, "smooth");
                }}
                onSeek={(target) => {
                  setAutoFollow(true);
                  player.seek(target);
                  // Instant so the view tracks the scrubber thumb as it drags.
                  scrollToUnitId(readingUnits[target]?.id, "auto");
                }}
                onPlaybackRateChange={selectPlaybackRate}
                presets={presets}
                presetVoices={presetVoices}
                selectedPresetId={selectedPresetId}
                onSelectPreset={selectDocumentVoice}
                onCreatePresetFromVoice={createPresetFromVoice}
                audioCacheStatus={audioCacheStatus}
                isPreparingAudio={isPreparingReaderAudio}
                onPrepareAudio={prepareReaderAudio}
                onExportAudio={exportReaderAudio}
                isExportingAudio={isExportingAudio}
                exportDisabled={readingUnits.length === 0}
                onCopySection={copyDocumentText}
                copyFeedback={copyFeedback}
              />
              {player.status !== "idle" && !autoFollow ? (
                <button
                  type="button"
                  onClick={() => {
                    setAutoFollow(true);
                    scrollToUnitId(currentReadingUnit?.id, "smooth");
                  }}
                  className="reader-jump-to-playing fixed bottom-[8.75rem] left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-[var(--on-accent)] shadow-[0_10px_30px_-12px_color-mix(in_srgb,var(--accent),transparent_30%)] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
                >
                  <LocateFixed size={14} aria-hidden="true" />
                  {t("dictate.reader.jumpToPlaying", {
                    defaultValue: "Jump to playing",
                  })}
                </button>
              ) : null}
            </>
          ) : isLoading ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted,var(--bg))] px-6 text-center">
              <Loader2
                size={24}
                className="animate-spin text-[var(--accent)]"
                aria-hidden="true"
              />
              <div className="mt-3 text-sm font-semibold text-[var(--text)]">
                {t("dictate.reader.loading", {
                  defaultValue: "Opening document",
                })}
              </div>
            </div>
          ) : library.length === 0 ? (
            <button
              type="button"
              onClick={pickDocument}
              className="flex min-h-[360px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted,var(--bg))] px-6 text-center transition-colors hover:border-[var(--accent)]"
            >
              <BookOpen
                size={28}
                className="text-[var(--muted)]"
                aria-hidden="true"
              />
              <div className="mt-3 text-sm font-semibold text-[var(--text)]">
                {t("dictate.reader.emptyPreviewTitle", {
                  defaultValue: "Add a document to start reading",
                })}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {t("dictate.reader.emptyPreviewHint", {
                  defaultValue: "PDF, DOCX, EPUB, TXT, or Markdown",
                })}
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSplitViewChange("library")}
              className="flex min-h-[360px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted,var(--bg))] px-6 text-center transition-colors hover:border-[var(--accent)]"
            >
              <BookOpen
                size={28}
                className="text-[var(--muted)]"
                aria-hidden="true"
              />
              <div className="mt-3 text-sm font-semibold text-[var(--text)]">
                {t("dictate.reader.viewerEmptyTitle", {
                  defaultValue: "No document open",
                })}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {t("dictate.reader.viewerEmptyHint", {
                  defaultValue: "Choose a document from your library",
                })}
              </div>
            </button>
          )}
        </section>
      )}

      {error ? (
        <div
          className="flex items-start gap-2.5 rounded-xl bg-[color-mix(in_srgb,var(--danger),transparent_94%)] px-4 py-3 text-xs"
          role="alert"
        >
          <AlertCircle
            size={14}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[var(--danger)]"
          />
          <div className="min-w-0 break-words text-[var(--text)]">{error}</div>
        </div>
      ) : null}
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
    </div>
  );
};
