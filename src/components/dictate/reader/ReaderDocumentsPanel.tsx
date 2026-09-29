import { useReaderUnitAudio } from "./useReaderUnitAudio";
import {
  renderReaderPage,
  exportReaderAudiobook,
  type ReaderAudiobookFormat,
  listReaderDocuments,
  readReaderDocument,
  removeStoredReaderDocument,
  speakReaderTextWithPreset,
} from "./readerCommands";
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type {
  ReaderLibrarySort,
  ReaderSplitView,
} from "../file-workspace/types";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useSettingsSlice } from "@/hooks/useSettings";
import {
  type ReaderLibraryItem,
  loadReaderLibrary,
  saveReaderLibrary,
} from "@/lib/readerLibraryStorage";
import {
  type ReaderDocument,
  type ReaderAudioCacheStatus,
  type ReaderAudioCacheUnit,
  commands,
} from "@/bindings";
import { useTtsVoiceCatalog } from "@/hooks/useTtsVoiceCatalog";
import {
  loadReaderLastDocumentVoice,
  loadReaderDocumentState,
  saveReaderLastDocumentVoice,
  saveReaderDocumentState,
} from "./readerDocumentState";
import { type ReaderRenderedPage, ReaderPageView } from "./ReaderPageView";
import {
  clampIndex,
  normalizeReaderPlaybackRate,
  kindLabel,
  readerPresetLabel,
  splitReaderWords,
  READER_LANGUAGE_OPTIONS,
  readerLanguageLabel,
  formatBytes,
} from "./readerPresentation";
import {
  upsertReaderLibraryItem,
  readerItemFromDocument,
  sortReaderLibrary,
} from "./readerLibrary";
import { readerErrorMessage } from "../file-workspace/errors";
import {
  READER_DOCUMENT_EXTENSIONS,
  stripExtension,
} from "../file-workspace/filePaths";
import { cleanReaderText, deriveSectionTitle } from "./readerTextCleanup";
import {
  buildSectionReadingUnits,
  sectionChunks,
  readingUnitId,
} from "./readerReadingUnits";
import { useReaderPlayback } from "./useReaderPlayback";
import type { ModelListControlOption } from "@/components/model-hub/ModelListControls";
import {
  AlertCircle,
  FileText,
  Trash2,
  X,
  Check,
  LocateFixed,
  Loader2,
  BookOpen,
} from "lucide-react";
import { ActionIconButton } from "@/components/ui";
import { createPortal } from "react-dom";
import { ReaderVoicePicker } from "./ReaderVoicePicker";
import { ReaderTransformTools } from "./ReaderTransformTools";
import { ReaderSectionView } from "./ReaderSectionView";
import { ReaderPlaybackBar } from "./ReaderPlaybackBar";

export const ReaderDocumentsPanel: React.FC<{
  query: string;
  sort: ReaderLibrarySort;
  splitView: ReaderSplitView;
  onSplitViewChange: (view: ReaderSplitView) => void;
  sectionsOpen: boolean;
  onSectionsOpenChange: (open: boolean) => void;
  transformOpen: boolean;
  onTransformOpenChange: (open: boolean) => void;
  onHasDocumentChange: (hasDocument: boolean) => void;
  viewMode: "text" | "page";
  onViewModeChange: (mode: "text" | "page") => void;
  onCanUsePageViewChange: (canUse: boolean) => void;
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
  viewMode: readerViewMode,
  onViewModeChange,
  onCanUsePageViewChange,
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
  const { presets, presetVoices, ttsModels, createPresetFromVoice } =
    useTtsVoiceCatalog();
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(() =>
    loadReaderLastDocumentVoice(),
  );
  const [playbackRate, setPlaybackRate] = useState(1);
  const [documentLanguage, setDocumentLanguage] = useState<string>("auto");
  const [audioCacheStatus, setAudioCacheStatus] =
    useState<ReaderAudioCacheStatus | null>(null);
  const [isPreparingReaderAudio, setIsPreparingReaderAudio] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(
    null,
  );
  const [readerRestorePositionMs, setReaderRestorePositionMs] = useState(0);
  // Audiobook export dialog (gap: m4b/mp3 + chapters).
  const [audiobookFormat, setAudiobookFormat] =
    useState<ReaderAudiobookFormat>("m4b");
  // Rendered PDF pages for the page view (gap: in-page geometry highlighting).
  const [renderedPages, setRenderedPages] = useState<
    Map<number, ReaderRenderedPage>
  >(() => new Map());
  const renderedPagesRef = useRef<Map<number, ReaderRenderedPage>>(new Map());
  const [renderedPageErrors, setRenderedPageErrors] = useState<
    Map<number, string>
  >(() => new Map());
  const renderingPagesRef = useRef<Set<number>>(new Set());
  const [renderingPages, setRenderingPages] = useState<Set<number>>(
    () => new Set(),
  );
  const lastProgressSaveRef = useRef(0);
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
        const restoreIndex =
          typeof savedProgress?.unitIndex === "number"
            ? Math.max(0, Math.trunc(savedProgress.unitIndex))
            : 0;
        const restorePositionMs =
          typeof savedProgress?.positionMs === "number"
            ? Math.max(0, Math.trunc(savedProgress.positionMs))
            : 0;
        setActiveDocument(document);
        setActiveSectionIndex(nextSectionIndex);
        setReaderRestoreIndex(restoreIndex);
        setReaderRestorePositionMs(restorePositionMs);
        onViewModeChange("text");
        renderedPagesRef.current = new Map();
        setRenderedPages(renderedPagesRef.current);
        setRenderedPageErrors(new Map());
        renderingPagesRef.current = new Set();
        setRenderingPages(new Set());
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
        setDocumentLanguage(
          typeof documentState.language === "string" &&
            documentState.language.trim()
            ? documentState.language
            : "auto",
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
      onViewModeChange,
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
  const normalizedLanguage =
    documentLanguage && documentLanguage !== "auto" ? documentLanguage : null;

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
        normalizedLanguage,
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
  }, [activeDocument?.id, normalizedLanguage, playbackRate, readerAudioUnits]);

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
        normalizedLanguage,
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
    normalizedLanguage,
    playbackRate,
    readerAudioUnits,
    refreshReaderAudioCacheStatus,
    t,
  ]);

  const { loadUnit, prefetchUnit } = useReaderUnitAudio({
    documentId: activeDocument?.id ?? null,
    playbackRate,
    language: normalizedLanguage,
    onRendered: refreshReaderAudioCacheStatus,
  });

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

  // Persist fine-grained progress (throttled) for resume.
  const handleReaderProgress = useCallback(
    (unitIndex: number, posMs: number) => {
      const documentId = activeReaderDocumentIdRef.current;
      if (!documentId) return;
      const now = Date.now();
      if (posMs !== 0 && now - lastProgressSaveRef.current < 1500) return;
      lastProgressSaveRef.current = now;
      const unit = readingUnits[unitIndex];
      saveReaderDocumentState(documentId, {
        progress: {
          sectionIndex: unit?.sectionIndex ?? activeSectionIndex,
          unitIndex,
          positionMs: Math.round(posMs),
          updatedAt: now,
        },
      });
    },
    [readingUnits, activeSectionIndex],
  );

  const player = useReaderPlayback({
    units: readingUnits,
    initialIndex: readerRestoreIndex,
    initialPositionMs: readerRestorePositionMs,
    resetKey: activeDocument?.id ?? null,
    loadUnit,
    prefetchUnit,
    onError: handlePlaybackError,
    onProgress: handleReaderProgress,
  });

  const currentReadingUnit = readingUnits[player.index] ?? null;
  const canUseReaderPageView =
    activeDocument?.kind === "pdf" && (activeDocument.page_count ?? 0) > 0;
  // The Text/Page toggle lives in the sticky toolbar (a sibling component), so
  // report whether page view is available up to the shell that renders it.
  useEffect(() => {
    onCanUsePageViewChange(canUseReaderPageView);
  }, [canUseReaderPageView, onCanUsePageViewChange]);
  // Switching layout re-enables auto-follow so the view tracks playback again.
  useEffect(() => {
    setAutoFollow(true);
  }, [readerViewMode]);
  const activeReaderUnitWords = currentReadingUnit
    ? splitReaderWords(currentReadingUnit.text)
    : null;
  const readerPageHintFraction =
    readingUnits.length > 1
      ? player.index / Math.max(readingUnits.length - 1, 1)
      : 0;
  const readerLanguageOptions = useMemo<ModelListControlOption[]>(
    () =>
      READER_LANGUAGE_OPTIONS.map((value) => ({
        value,
        label: readerLanguageLabel(value),
      })),
    [],
  );
  const selectedReaderLanguageLabel = readerLanguageLabel(documentLanguage);
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

  // Render a PDF page (image + word bboxes) for the page view, on demand.
  const requestReaderPage = useCallback(
    (pageIndex: number) => {
      const documentId = activeDocument?.id;
      if (
        !documentId ||
        pageIndex < 0 ||
        renderedPagesRef.current.has(pageIndex) ||
        renderingPagesRef.current.has(pageIndex)
      ) {
        return;
      }
      setRenderedPageErrors((current) => {
        if (!current.has(pageIndex)) return current;
        const next = new Map(current);
        next.delete(pageIndex);
        return next;
      });
      renderingPagesRef.current.add(pageIndex);
      setRenderingPages(new Set(renderingPagesRef.current));
      void (async () => {
        try {
          const page = await renderReaderPage(documentId, pageIndex);
          if (activeReaderDocumentIdRef.current !== documentId) return;
          setRenderedPages((current) => {
            const next = new Map(current);
            next.set(pageIndex, page);
            renderedPagesRef.current = next;
            return next;
          });
          setRenderedPageErrors((current) => {
            if (!current.has(pageIndex)) return current;
            const next = new Map(current);
            next.delete(pageIndex);
            return next;
          });
        } catch (err) {
          if (activeReaderDocumentIdRef.current !== documentId) return;
          const message = readerErrorMessage(
            err,
            t("dictate.reader.errors.pageRenderFailed", {
              defaultValue: "Failed to render Reader page.",
            }),
          );
          setRenderedPageErrors((current) => {
            const next = new Map(current);
            next.set(pageIndex, message);
            return next;
          });
          setError(message);
        } finally {
          if (activeReaderDocumentIdRef.current === documentId) {
            renderingPagesRef.current.delete(pageIndex);
            setRenderingPages(new Set(renderingPagesRef.current));
          }
        }
      })();
    },
    [activeDocument?.id, t],
  );

  // Follow the narration: re-center whenever the playing unit advances. Guarded
  // to playing/paused so it never fires on initial mount (explicit seeks below
  // handle the idle case imperatively).
  useEffect(() => {
    if (player.status === "idle" || !autoFollow) return;
    if (readerViewMode !== "text") return;
    const id = currentReadingUnit?.id;
    const raf = window.requestAnimationFrame(() =>
      scrollToUnitId(id, "smooth"),
    );
    return () => window.cancelAnimationFrame(raf);
  }, [
    player.index,
    player.status,
    readerViewMode,
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
      language: documentLanguage,
    });
  }, [
    activeDocument,
    sectionVoices,
    sectionDisabled,
    selectedPresetId,
    playbackRate,
    documentLanguage,
  ]);
  // Note: reading progress (unit index + position) is persisted by the player's
  // throttled `onProgress` (handleReaderProgress), so we don't double-write it
  // here — that would clobber the saved within-unit position.

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

  // Export a chaptered audiobook (m4b/mp3) or a flat WAV. Chapters are the
  // enabled sections; reuses the per-unit audio cache so a prepared document
  // exports without re-synthesizing.
  const exportReaderAudio = useCallback(async () => {
    if (!activeDocument || readingUnits.length === 0) return;
    const format = audiobookFormat;
    const target = await save({
      defaultPath: `${stripExtension(activeDocument.name)}.${format}`,
      filters: [
        {
          name:
            format === "wav"
              ? t("dictate.reader.audioExportDialogLabel", {
                  defaultValue: "WAV audio",
                })
              : t("dictate.reader.audiobookDialogLabel", {
                  defaultValue: "Audiobook",
                }),
          extensions: [format],
        },
      ],
    });
    if (!target) return;

    // Group reading units into chapters by section (in document order).
    const chapterMap = new Map<
      number,
      { title: string; units: ReaderAudioCacheUnit[] }
    >();
    for (const unit of readingUnits) {
      const sectionIndex = unit.sectionIndex ?? 0;
      let chapter = chapterMap.get(sectionIndex);
      if (!chapter) {
        const title =
          cleanedSections.find((section) => section.index === sectionIndex)
            ?.title ??
          t("dictate.reader.sectionFallbackTitle", {
            defaultValue: "Section {{n}}",
            n: sectionIndex + 1,
          });
        chapter = { title, units: [] };
        chapterMap.set(sectionIndex, chapter);
      }
      chapter.units.push({
        id: unit.id,
        text: unit.text,
        preset_id: unit.presetId,
      });
    }
    const chapters = [...chapterMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, chapter]) => chapter);

    setIsExportingAudio(true);
    setError("");
    try {
      await exportReaderAudiobook({
        documentId: activeDocument.id,
        chapters,
        outputPath: target,
        format,
        playbackRate,
        language: normalizedLanguage,
        title: stripExtension(activeDocument.name),
        author: null,
        coverDataUrl: activeDocument.thumbnail_data_url,
      });
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
  }, [
    activeDocument,
    audiobookFormat,
    cleanedSections,
    normalizedLanguage,
    playbackRate,
    readingUnits,
    t,
  ]);

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
        renderedPagesRef.current = new Map();
        setRenderedPages(renderedPagesRef.current);
        setRenderedPageErrors(new Map());
        renderingPagesRef.current = new Set();
        setRenderingPages(new Set());
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
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5 border-b border-[var(--border)] pb-2">
                              <button
                                type="button"
                                disabled={
                                  totalSectionCount === 0 ||
                                  selectedSectionCount === totalSectionCount
                                }
                                onClick={readAllSections}
                                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--input)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:pointer-events-none disabled:opacity-40"
                              >
                                <Check size={12} aria-hidden="true" />
                                {t("dictate.reader.sections.readAll", {
                                  defaultValue: "Read all",
                                })}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  totalSectionCount === 0 ||
                                  selectedSectionCount === 0
                                }
                                onClick={skipAllSections}
                                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--input)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:pointer-events-none disabled:opacity-40"
                              >
                                <X size={12} aria-hidden="true" />
                                {t("dictate.reader.sections.skipAll", {
                                  defaultValue: "Skip all",
                                })}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  Object.keys(sectionVoices).length === 0
                                }
                                onClick={resetSectionVoices}
                                className="inline-flex items-center rounded-full border border-transparent px-2.5 py-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:pointer-events-none disabled:opacity-40"
                              >
                                {t("dictate.reader.sections.resetVoices", {
                                  defaultValue: "Reset voices",
                                })}
                              </button>
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
                                          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
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
                                        ttsModels={ttsModels}
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

                {readerViewMode === "page" && canUseReaderPageView ? (
                  <ReaderPageView
                    pageCount={activeDocument.page_count}
                    pages={renderedPages}
                    renderingPages={renderingPages}
                    pageErrors={renderedPageErrors}
                    onRequestPage={requestReaderPage}
                    activeUnitWords={activeReaderUnitWords}
                    activeWordIndex={player.activeWordIndex}
                    hintFraction={readerPageHintFraction}
                    autoFollow={autoFollow}
                    loadingLabel={t("dictate.reader.pageView.loading", {
                      defaultValue: "Rendering page",
                    })}
                    errorLabel={t("dictate.reader.pageView.error", {
                      defaultValue: "Page could not render",
                    })}
                    retryLabel={t("dictate.reader.pageView.retry", {
                      defaultValue: "Retry",
                    })}
                    renderLabel={t("dictate.reader.pageView.render", {
                      defaultValue: "Render page",
                    })}
                  />
                ) : (
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
                        activeWordIndex={
                          currentReadingUnit?.sectionIndex === section.index
                            ? player.activeWordIndex
                            : -1
                        }
                        unitIndexById={unitIndexById}
                        onSeek={seekToReadingUnit}
                      />
                    ))}
                  </div>
                )}
              </div>
              <ReaderPlaybackBar
                status={player.status}
                index={player.index}
                total={player.total}
                playbackRate={playbackRate}
                audiobookFormat={audiobookFormat}
                pageLabel={playbackPageLabel}
                onToggle={() => {
                  setError("");
                  setAutoFollow(true);
                  player.toggle();
                }}
                onStop={() => {
                  player.stop();
                }}
                onPrev={() => {
                  const target = Math.max(player.index - 1, 0);
                  setAutoFollow(true);
                  player.prev();
                  if (readerViewMode === "text") {
                    scrollToUnitId(readingUnits[target]?.id, "smooth");
                  }
                }}
                onNext={() => {
                  const target = Math.min(
                    player.index + 1,
                    Math.max(readingUnits.length - 1, 0),
                  );
                  setAutoFollow(true);
                  player.next();
                  if (readerViewMode === "text") {
                    scrollToUnitId(readingUnits[target]?.id, "smooth");
                  }
                }}
                onSeek={(target) => {
                  setAutoFollow(true);
                  player.seek(target);
                  // Instant so the view tracks the scrubber thumb as it drags.
                  if (readerViewMode === "text") {
                    scrollToUnitId(readingUnits[target]?.id, "auto");
                  }
                }}
                onPlaybackRateChange={selectPlaybackRate}
                onAudiobookFormatChange={setAudiobookFormat}
                presets={presets}
                presetVoices={presetVoices}
                ttsModels={ttsModels}
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
                documentLanguage={documentLanguage}
                readerLanguageOptions={readerLanguageOptions}
                onDocumentLanguageChange={(value) => {
                  setDocumentLanguage(value);
                  setAudioCacheStatus(null);
                }}
                selectedReaderLanguageLabel={selectedReaderLanguageLabel}
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
    </div>
  );
};
