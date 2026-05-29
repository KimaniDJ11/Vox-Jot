import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  KeyRound,
  Loader2,
  Server,
  Trash2,
} from "lucide-react";
import HubModelCard, {
  type HubDownloadState,
  type HubTrailing,
} from "@/components/model-hub/HubModelCard";
import {
  buildModelIdentityChips,
  inferArchitectureLabel,
  inferParameterClass,
  inferRuntimeFormat,
  mergeSizeWithIdentityChips,
} from "@/components/model-hub/modelIdentityChips";
import GatedHuggingFaceAccessDialog from "@/components/model-hub/GatedHuggingFaceAccessDialog";
import LicenseAcknowledgementDialog, {
  type LicenseAcknowledgementGate,
} from "@/components/model-hub/LicenseAcknowledgementDialog";
import { downloadingModelFilesLabel } from "@/components/model-hub/downloadStatusLabels";
import {
  commands,
  type HuggingFaceTokenStatus,
  type SpeechAnalysisCatalog,
  type SpeechAnalysisModelDescriptor,
  type SpeechAnalysisSelection,
  type SpeechAnalysisTask,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import type { CompactBadgeItem } from "@/components/ui/CompactOverflow";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { resolveModelProviderId } from "@/components/ui/ProviderIcon";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
import ModelListControls from "@/components/model-hub/ModelListControls";
import type { ModelHubControlState } from "@/components/model-hub/modelHubControls";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import {
  DEFAULT_MODEL_SORT_OPTIONS,
  orderModelList,
  TEST_SCORE_MODEL_SORT_OPTION,
  type ModelSortMode,
} from "@/lib/modelListOrdering";
import { getFileAsrEvaluationResult } from "@/lib/fileAsrEvaluationResults";
import { getSpeakerIsolationEvaluationResult } from "@/lib/speakerIsolationEvaluationResults";

interface SpeechAnalysisEnginesSectionProps {
  titleActionTargetId?: string;
  titleContentTargetId?: string;
  hubSearchQuery?: string;
  modelHubControls?: ModelHubControlState;
  onHeaderTitleChange?: (title: string | null) => void;
}

type AnalysisGroup = "asr" | "diarization";
type AnalysisSourceFilter = "all" | "built_in" | "hugging_face";

const SPEECH_ANALYSIS_LICENSE_GATES: Record<
  string,
  LicenseAcknowledgementGate
> = {
  "nemo-sortformer-4spk-v1": {
    kind: "non_commercial",
    licenseLabel: "CC-BY-NC-4.0",
    termsUrl: "https://huggingface.co/nvidia/diar_sortformer_4spk-v1",
  },
  "mlx-sortformer-4spk-v1": {
    kind: "non_commercial",
    licenseLabel: "CC-BY-NC-4.0",
    termsUrl:
      "https://huggingface.co/mlx-community/diar_sortformer_4spk-v1-fp16",
  },
  "reverb-diarization-v2": {
    kind: "custom_review",
    licenseLabel: "Custom / gated",
    termsUrl: "https://huggingface.co/Revai/reverb-diarization-v2",
    note: "This gated model should only be downloaded after accepting publisher terms and confirming your intended use is allowed.",
  },
};

const speechAnalysisLicenseGate = (
  model: SpeechAnalysisModelDescriptor,
): LicenseAcknowledgementGate | null =>
  SPEECH_ANALYSIS_LICENSE_GATES[model.id] ?? null;

interface SpeechAnalysisDownloadProgress {
  model_id: string;
  phase: string;
  downloaded_bytes: number;
  total_bytes: number;
  file?: string | null;
  file_index?: number | null;
  file_count?: number | null;
  error?: string | null;
}

interface SttDownloadProgress {
  model_id: string;
  downloaded: number;
  total: number;
  percentage: number;
}

const SHARED_MLX_ASR_MODEL_IDS = new Set([
  "mlx-qwen3-asr-0.6b",
  "mlx-qwen3-asr",
  "mlx-qwen3-asr-1.7b",
  "mlx-fireredasr2-aed",
  "mlx-vibevoice-asr-bf16",
]);

const taskMatchesGroup = (
  task: SpeechAnalysisTask,
  group: AnalysisGroup,
): boolean => {
  if (group === "asr") return task === "asr" || task === "asr_diarization";
  return task === "diarization" || task === "asr_diarization";
};

const runtimeLabel = (model: SpeechAnalysisModelDescriptor): string =>
  model.runtime.replace(/_/g, " ");

const engineLabel = (model: SpeechAnalysisModelDescriptor): string =>
  model.engine.replace(/_/g, " ");

const readinessLabel = (model: SpeechAnalysisModelDescriptor): string =>
  model.readiness.replace(/_/g, " ");

const sourceKindLabel = (model: SpeechAnalysisModelDescriptor): string =>
  model.source_kind.replace(/_/g, " ");

const speechAnalysisProgressCanCancel = (phase?: string): boolean =>
  ![
    "installing-model",
    "installing-runtime",
    "verifying-runtime",
    "complete",
    "failed",
    "cancelled",
    "cancelling",
  ].includes(phase ?? "");

const providerIconId = (model: SpeechAnalysisModelDescriptor): string => {
  if (model.provider.trim().toLowerCase() === "vox jot") {
    return "vox_jot";
  }

  return resolveModelProviderId(
    `${model.provider} ${model.label} ${model.repo_id ?? ""}`,
    model.source_kind === "hugging_face" ? "huggingface" : "generic",
  );
};

const modelMatchesQuery = (
  model: SpeechAnalysisModelDescriptor,
  query: string,
): boolean => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    model.label,
    model.provider,
    model.repo_id ?? "",
    model.description,
    model.engine,
    model.runtime,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
};

const SpeechAnalysisEnginesSection: React.FC<
  SpeechAnalysisEnginesSectionProps
> = ({
  titleActionTargetId,
  titleContentTargetId,
  hubSearchQuery = "",
  modelHubControls,
  onHeaderTitleChange,
}) => {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<SpeechAnalysisCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, SpeechAnalysisDownloadProgress>
  >({});
  const [activeDownloads, setActiveDownloads] = useState<Set<string>>(
    () => new Set(),
  );
  const [cancellingDownloads, setCancellingDownloads] = useState<Set<string>>(
    () => new Set(),
  );
  const [hfTokenStatus, setHfTokenStatus] =
    useState<HuggingFaceTokenStatus | null>(null);
  const [gatedDownloadModel, setGatedDownloadModel] =
    useState<SpeechAnalysisModelDescriptor | null>(null);
  const [licenseGateDownloadModel, setLicenseGateDownloadModel] =
    useState<SpeechAnalysisModelDescriptor | null>(null);
  const [hfTokenDraft, setHfTokenDraft] = useState("");
  const [hfTokenError, setHfTokenError] = useState<string | null>(null);
  const [savingHfToken, setSavingHfToken] = useState(false);
  const [deleteConfirmModelId, setDeleteConfirmModelId] = useState<
    string | null
  >(null);
  const [activeGroup, setActiveGroup] = useState<AnalysisGroup>("asr");
  const [localSourceFilter, setLocalSourceFilter] =
    useState<AnalysisSourceFilter>("all");
  const [localSortMode, setLocalSortMode] =
    useState<ModelSortMode>("best_match");
  const sourceFilter = (modelHubControls?.providerFilter ??
    localSourceFilter) as AnalysisSourceFilter;
  const sortMode = modelHubControls?.sortMode ?? localSortMode;
  const setSourceFilter = useCallback(
    (value: AnalysisSourceFilter) => {
      if (modelHubControls) {
        modelHubControls.setProviderFilter(value);
        return;
      }
      setLocalSourceFilter(value);
    },
    [modelHubControls],
  );
  const setSortMode = modelHubControls?.setSortMode ?? setLocalSortMode;
  const viewSwitcherRef = useRef<HTMLDivElement>(null);
  const catalogRef = useRef<SpeechAnalysisCatalog | null>(null);
  const headerActionPortal = usePortalTarget(titleActionTargetId ?? null);
  const headerTitlePortal = usePortalTarget(titleContentTargetId ?? null);

  const loadCatalog = useCallback(async () => {
    const result = await commands.getSpeechAnalysisCatalog();
    if (result.status === "ok") {
      catalogRef.current = result.data;
      setCatalog(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  const loadHfTokenStatus = useCallback(async () => {
    const result = await commands.getHuggingFaceTokenStatus();
    if (result.status === "ok") {
      setHfTokenStatus(result.data);
    } else {
      setHfTokenStatus({ configured: false, source: null });
      setHfTokenError(result.error);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    void loadHfTokenStatus();
  }, [loadCatalog, loadHfTokenStatus]);

  useEffect(() => {
    let cancelled = false;
    void commands.getActiveSpeechAnalysisDownloads().then((downloads) => {
      if (cancelled) return;
      setActiveDownloads(new Set(downloads));
    });

    const isSpeechAnalysisModel = (modelId: string): boolean =>
      SHARED_MLX_ASR_MODEL_IDS.has(modelId) ||
      Boolean(catalogRef.current?.models.some((model) => model.id === modelId));

    const unlisteners = Promise.all([
      listen<SpeechAnalysisDownloadProgress>(
        "speech-analysis-download-progress",
        (event) => {
          const progress = event.payload;
          setDownloadProgress((current) => ({
            ...current,
            [progress.model_id]: progress,
          }));
          setActiveDownloads((current) => {
            const next = new Set(current);
            if (
              progress.phase === "complete" ||
              progress.phase === "failed" ||
              progress.phase === "cancelled"
            ) {
              next.delete(progress.model_id);
            } else {
              next.add(progress.model_id);
            }
            return next;
          });
          setCancellingDownloads((current) => {
            const next = new Set(current);
            if (progress.phase === "cancelling") {
              next.add(progress.model_id);
            }
            if (
              progress.phase === "complete" ||
              progress.phase === "failed" ||
              progress.phase === "cancelled"
            ) {
              next.delete(progress.model_id);
            }
            return next;
          });
          if (progress.phase === "complete") {
            void loadCatalog();
          }
          if (progress.phase === "cancelled") {
            setDownloadProgress((current) => {
              const next = { ...current };
              delete next[progress.model_id];
              return next;
            });
            void loadCatalog();
          }
          if (progress.phase === "failed" && progress.error) {
            setError(progress.error);
          }
        },
      ),
      listen<SttDownloadProgress>("model-download-progress", (event) => {
        const progress = event.payload;
        if (!isSpeechAnalysisModel(progress.model_id)) return;

        setDownloadProgress((current) => ({
          ...current,
          [progress.model_id]: {
            model_id: progress.model_id,
            phase: "downloading",
            downloaded_bytes: progress.downloaded,
            total_bytes: progress.total,
          },
        }));
        setActiveDownloads((current) =>
          new Set(current).add(progress.model_id),
        );
      }),
      listen<string>("model-download-complete", (event) => {
        const modelId = event.payload;
        if (!isSpeechAnalysisModel(modelId)) return;

        setActiveDownloads((current) => {
          const next = new Set(current);
          next.delete(modelId);
          return next;
        });
        setCancellingDownloads((current) => {
          const next = new Set(current);
          next.delete(modelId);
          return next;
        });
        setDownloadProgress((current) => {
          const next = { ...current };
          delete next[modelId];
          return next;
        });
        void loadCatalog();
      }),
      listen<string>("model-download-cancelled", (event) => {
        const modelId = event.payload;
        if (!isSpeechAnalysisModel(modelId)) return;

        setActiveDownloads((current) => {
          const next = new Set(current);
          next.delete(modelId);
          return next;
        });
        setCancellingDownloads((current) => {
          const next = new Set(current);
          next.delete(modelId);
          return next;
        });
        setDownloadProgress((current) => {
          const next = { ...current };
          delete next[modelId];
          return next;
        });
        void loadCatalog();
      }),
      listen<string>("model-deleted", (event) => {
        const modelId = event.payload;
        if (!isSpeechAnalysisModel(modelId)) return;

        setActiveDownloads((current) => {
          const next = new Set(current);
          next.delete(modelId);
          return next;
        });
        setCancellingDownloads((current) => {
          const next = new Set(current);
          next.delete(modelId);
          return next;
        });
        setDownloadProgress((current) => {
          const next = { ...current };
          delete next[modelId];
          return next;
        });
        void loadCatalog();
      }),
    ]);

    return () => {
      cancelled = true;
      void unlisteners.then((fns) => {
        fns.forEach((fn) => fn());
      });
    };
  }, [loadCatalog]);

  const selectModel = useCallback(
    async (group: AnalysisGroup, modelId: string) => {
      if (!catalog || busyModelId) return;
      const nextSelection: SpeechAnalysisSelection =
        group === "asr"
          ? {
              ...catalog.selection,
              asr_model_id: modelId,
            }
          : {
              ...catalog.selection,
              diarization_model_id: modelId,
            };

      setBusyModelId(modelId);
      setError(null);
      const result = await commands.setSpeechAnalysisSelection(
        nextSelection.asr_model_id,
        nextSelection.diarization_model_id,
      );
      if (result.status === "ok") {
        setCatalog({ ...catalog, selection: result.data });
      } else {
        setError(result.error);
      }
      setBusyModelId(null);
    },
    [busyModelId, catalog],
  );

  const startDownload = useCallback(
    async (modelId: string): Promise<boolean> => {
      if (busyModelId || activeDownloads.has(modelId)) return false;
      setBusyModelId(modelId);
      setError(null);
      setActiveDownloads((current) => new Set(current).add(modelId));
      setDownloadProgress((current) => ({
        ...current,
        [modelId]: {
          model_id: modelId,
          phase: "preparing",
          downloaded_bytes: 0,
          total_bytes: 0,
        },
      }));
      const result = await commands.downloadSpeechAnalysisModel(modelId);
      if (result.status === "ok") {
        await loadCatalog();
        setBusyModelId(null);
        return true;
      } else {
        if (result.error !== "Download cancelled.") {
          setError(result.error);
          setDownloadProgress((current) => ({
            ...current,
            [modelId]: {
              model_id: modelId,
              phase: "failed",
              downloaded_bytes: 0,
              total_bytes: 0,
              error: result.error,
            },
          }));
        } else {
          setDownloadProgress((current) => {
            const next = { ...current };
            delete next[modelId];
            return next;
          });
        }
        setActiveDownloads((current) => {
          const next = new Set(current);
          next.delete(modelId);
          return next;
        });
        setCancellingDownloads((current) => {
          const next = new Set(current);
          next.delete(modelId);
          return next;
        });
        setBusyModelId(null);
        return false;
      }
    },
    [activeDownloads, busyModelId, loadCatalog],
  );

  const requestDownload = useCallback(
    (model: SpeechAnalysisModelDescriptor) => {
      setDeleteConfirmModelId(null);
      if (model.gated && !model.installed) {
        setGatedDownloadModel(model);
        setHfTokenDraft("");
        setHfTokenError(null);
        void loadHfTokenStatus();
        return;
      }
      if (speechAnalysisLicenseGate(model) && !model.installed) {
        setLicenseGateDownloadModel(model);
        return;
      }
      void startDownload(model.id);
    },
    [loadHfTokenStatus, startDownload],
  );

  const cancelDownload = useCallback(
    async (model: SpeechAnalysisModelDescriptor) => {
      if (!activeDownloads.has(model.id)) return;
      setError(null);
      setCancellingDownloads((current) => new Set(current).add(model.id));
      const result = await commands.cancelSpeechAnalysisDownload(model.id);
      if (result.status === "error") {
        setCancellingDownloads((current) => {
          const next = new Set(current);
          next.delete(model.id);
          return next;
        });
        setError(result.error);
      }
    },
    [activeDownloads],
  );

  const dismissDownload = useCallback((modelId: string) => {
    setDownloadProgress((current) => {
      const next = { ...current };
      delete next[modelId];
      return next;
    });
    setActiveDownloads((current) => {
      const next = new Set(current);
      next.delete(modelId);
      return next;
    });
  }, []);

  const closeGatedDownload = useCallback(() => {
    if (savingHfToken) return;
    setGatedDownloadModel(null);
    setHfTokenDraft("");
    setHfTokenError(null);
  }, [savingHfToken]);

  const closeLicenseGateDownload = useCallback(() => {
    if (savingHfToken) return;
    setLicenseGateDownloadModel(null);
  }, [savingHfToken]);

  const confirmGatedDownload = useCallback(async () => {
    if (!gatedDownloadModel || savingHfToken) return;
    const token = hfTokenDraft.trim();
    if (!token && !hfTokenStatus?.configured) {
      setHfTokenError(
        t("modelHub.analysis.hfAccess.tokenRequired", {
          defaultValue:
            "Paste a Hugging Face read token, or save one with the HF CLI first.",
        }),
      );
      return;
    }

    setSavingHfToken(true);
    setHfTokenError(null);
    if (token) {
      const result = await commands.setHuggingFaceToken(token);
      if (result.status === "ok") {
        setHfTokenStatus(result.data);
        setHfTokenDraft("");
      } else {
        setHfTokenError(result.error);
        setSavingHfToken(false);
        return;
      }
    }

    const modelId = gatedDownloadModel.id;
    setSavingHfToken(false);
    setGatedDownloadModel(null);
    setHfTokenDraft("");
    setHfTokenError(null);
    if (speechAnalysisLicenseGate(gatedDownloadModel)) {
      setLicenseGateDownloadModel(gatedDownloadModel);
      return;
    }
    void startDownload(modelId);
  }, [
    gatedDownloadModel,
    hfTokenDraft,
    hfTokenStatus?.configured,
    savingHfToken,
    startDownload,
    t,
  ]);

  const clearHfToken = useCallback(async () => {
    if (savingHfToken) return;
    if (
      !(await confirmDestructiveAction(
        t("modelHub.analysis.hfAccess.clearTokenConfirm", {
          defaultValue:
            "Clear the saved Hugging Face token from Vox Jot? Gated model downloads will need a token again.",
        }),
        { okLabel: t("common.clear", { defaultValue: "Clear" }) },
      ))
    ) {
      return;
    }

    setSavingHfToken(true);
    setHfTokenError(null);
    const result = await commands.clearHuggingFaceToken();
    if (result.status === "ok") {
      setHfTokenStatus(result.data);
      setHfTokenDraft("");
    } else {
      setHfTokenError(result.error);
    }
    setSavingHfToken(false);
  }, [savingHfToken, t]);

  const confirmLicenseGateDownload = useCallback(() => {
    if (!licenseGateDownloadModel || savingHfToken) return;
    const modelId = licenseGateDownloadModel.id;
    setLicenseGateDownloadModel(null);
    void startDownload(modelId);
  }, [licenseGateDownloadModel, savingHfToken, startDownload]);

  const deleteModel = useCallback(
    async (model: SpeechAnalysisModelDescriptor) => {
      if (busyModelId || activeDownloads.has(model.id)) return;
      setBusyModelId(model.id);
      setError(null);
      const result = await commands.deleteSpeechAnalysisModel(model.id);
      if (result.status === "ok") {
        setDeleteConfirmModelId(null);
        await loadCatalog();
      } else {
        setError(result.error);
      }
      setBusyModelId(null);
    },
    [activeDownloads, busyModelId, loadCatalog],
  );

  const asrModels = useMemo(
    () =>
      catalog?.models
        .filter((model) => taskMatchesGroup(model.task, "asr"))
        .filter(
          (model) =>
            sourceFilter === "all" || model.source_kind === sourceFilter,
        )
        .filter((model) => modelMatchesQuery(model, hubSearchQuery)) ?? [],
    [catalog, hubSearchQuery, sourceFilter],
  );

  const diarizationModels = useMemo(
    () =>
      catalog?.models
        .filter((model) => taskMatchesGroup(model.task, "diarization"))
        .filter(
          (model) =>
            sourceFilter === "all" || model.source_kind === sourceFilter,
        )
        .filter((model) => modelMatchesQuery(model, hubSearchQuery)) ?? [],
    [catalog, hubSearchQuery, sourceFilter],
  );
  const sourceOptions = useMemo(
    () => [
      { value: "all", label: "Source" },
      { value: "built_in", label: "Built-in" },
      { value: "hugging_face", label: "Hugging Face" },
    ],
    [],
  );
  const selectedSourceLabel = useMemo(
    () =>
      sourceOptions.find((option) => option.value === sourceFilter)?.label ??
      sourceFilter ??
      "Source",
    [sourceFilter, sourceOptions],
  );

  useEffect(() => {
    if (modelHubControls) return;
    if (
      sourceFilter !== "all" &&
      !sourceOptions.some((option) => option.value === sourceFilter)
    ) {
      setSourceFilter("all");
    }
  }, [modelHubControls, sourceFilter, sourceOptions, setSourceFilter]);

  const sortOptions = useMemo(
    () => [...DEFAULT_MODEL_SORT_OPTIONS, TEST_SCORE_MODEL_SORT_OPTION],
    [],
  );
  const selectedSortLabel = useMemo(
    () =>
      sortOptions.find((option) => option.value === sortMode)?.label ??
      "Best Match",
    [sortMode, sortOptions],
  );
  const filterAction = (
    <ModelListControls
      provider={{
        value: sourceFilter,
        options: sourceOptions,
        onChange: (value) => setSourceFilter(value as AnalysisSourceFilter),
        label: selectedSourceLabel,
        show: true,
      }}
      sort={{
        value: sortMode,
        options: sortOptions,
        onChange: setSortMode,
        label: selectedSortLabel,
      }}
    />
  );
  const analysisViews = useMemo(
    () => [
      {
        group: "asr" as const,
        label: t("modelHub.analysis.asr.title", {
          defaultValue: "File ASR",
        }),
        description: t("modelHub.analysis.asr.description", {
          defaultValue:
            "Optional file-transcription ASR engines. These are for long audio and model experiments, not the live dictation hot path.",
        }),
        models: asrModels,
        selectedModelId: catalog?.selection.asr_model_id ?? "",
      },
      {
        group: "diarization" as const,
        label: t("modelHub.analysis.diarization.title", {
          defaultValue: "Speaker Isolation",
        }),
        description: t("modelHub.analysis.diarization.description", {
          defaultValue:
            "Speaker diarization engines that assign who-spoke-when labels for file transcripts.",
        }),
        models: diarizationModels,
        selectedModelId: catalog?.selection.diarization_model_id ?? "",
      },
    ],
    [
      asrModels,
      catalog?.selection.asr_model_id,
      catalog?.selection.diarization_model_id,
      diarizationModels,
      t,
    ],
  );
  const activeView =
    analysisViews.find((view) => view.group === activeGroup) ??
    analysisViews[0];

  useEffect(() => {
    if (!onHeaderTitleChange) return;
    if (titleContentTargetId) {
      onHeaderTitleChange(null);
      return () => onHeaderTitleChange(null);
    }
    const switcher = viewSwitcherRef.current;
    if (!switcher) return;

    const scrollParent =
      switcher.closest(".overflow-y-auto") ??
      switcher.ownerDocument.scrollingElement ??
      window;

    const updateTitle = () => {
      const stickyHeader = switcher.ownerDocument.querySelector(
        "[data-model-hub-sticky-header]",
      );
      const headerBottom =
        stickyHeader instanceof HTMLElement
          ? stickyHeader.getBoundingClientRect().bottom
          : 0;
      const switcherRect = switcher.getBoundingClientRect();
      onHeaderTitleChange(
        switcherRect.bottom <= headerBottom ? activeView.label : null,
      );
    };

    updateTitle();
    window.addEventListener("resize", updateTitle);
    scrollParent.addEventListener("scroll", updateTitle, { passive: true });
    return () => {
      window.removeEventListener("resize", updateTitle);
      scrollParent.removeEventListener("scroll", updateTitle);
      onHeaderTitleChange(null);
    };
  }, [activeView.label, onHeaderTitleChange, titleContentTargetId]);

  if (!catalog) {
    return (
      <EmptyState
        title={t("modelHub.analysis.loading", {
          defaultValue: "Loading speech analysis engines…",
        })}
        description={error ?? ""}
      />
    );
  }

  const viewSwitcherControl = (
    <SegmentedControl<AnalysisGroup>
      value={activeGroup}
      onChange={setActiveGroup}
      layoutId="speech-analysis-view-toggle"
      ariaLabel={t("modelHub.analysis.viewSwitcherLabel", {
        defaultValue: "Speech analysis view",
      })}
      items={analysisViews.map((view) => ({
        value: view.group,
        label: view.label,
      }))}
    />
  );

  return (
    <div className="space-y-5">
      {headerActionPortal
        ? createPortal(filterAction, headerActionPortal)
        : null}
      {headerTitlePortal
        ? createPortal(viewSwitcherControl, headerTitlePortal)
        : null}
      {!titleContentTargetId ? (
        <div ref={viewSwitcherRef}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {viewSwitcherControl}
            {!headerActionPortal ? filterAction : null}
          </div>
        </div>
      ) : !headerActionPortal ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {filterAction}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_65%)] bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <EngineGroup
        title={activeView.label}
        description={activeView.description}
        group={activeView.group}
        models={activeView.models}
        selectedModelId={activeView.selectedModelId}
        sortMode={sortMode}
        showIntro={false}
        busyModelId={busyModelId}
        activeDownloads={activeDownloads}
        cancellingDownloads={cancellingDownloads}
        downloadProgress={downloadProgress}
        deleteConfirmModelId={deleteConfirmModelId}
        onSelect={selectModel}
        onDownload={requestDownload}
        onCancelDownload={cancelDownload}
        onDismissDownload={dismissDownload}
        onRequestDelete={(modelId) => setDeleteConfirmModelId(modelId)}
        onCancelDelete={() => setDeleteConfirmModelId(null)}
        onDelete={deleteModel}
      />

      <GatedHuggingFaceAccessDialog
        open={Boolean(gatedDownloadModel)}
        modelName={gatedDownloadModel?.label ?? ""}
        titleId="speech-analysis-hf-access-title"
        tokenStatus={hfTokenStatus}
        tokenDraft={hfTokenDraft}
        error={hfTokenError}
        busy={savingHfToken || Boolean(busyModelId)}
        onTokenDraftChange={setHfTokenDraft}
        onOpenAccessPage={async () => {
          if (!gatedDownloadModel) return;
          setHfTokenError(null);
          const result = await commands.openSpeechAnalysisModelAccessPage(
            gatedDownloadModel.id,
          );
          if (result.status === "error") {
            setHfTokenError(result.error);
          }
        }}
        onClearToken={clearHfToken}
        onCancel={closeGatedDownload}
        onConfirm={confirmGatedDownload}
      />
      <LicenseAcknowledgementDialog
        open={Boolean(licenseGateDownloadModel)}
        modelName={licenseGateDownloadModel?.label ?? ""}
        acknowledgementId={
          licenseGateDownloadModel
            ? `speech-analysis.${licenseGateDownloadModel.id}`
            : "speech-analysis.unknown"
        }
        gate={
          licenseGateDownloadModel
            ? speechAnalysisLicenseGate(licenseGateDownloadModel)
            : null
        }
        busy={Boolean(busyModelId)}
        onOpenTerms={async () => {
          if (!licenseGateDownloadModel) return;
          const gate = speechAnalysisLicenseGate(licenseGateDownloadModel);
          if (!gate) return;
          await openUrl(gate.termsUrl);
        }}
        onCancel={closeLicenseGateDownload}
        onConfirm={confirmLicenseGateDownload}
      />
    </div>
  );
};

interface EngineGroupProps {
  title: string;
  description: string;
  group: AnalysisGroup;
  models: SpeechAnalysisModelDescriptor[];
  selectedModelId: string;
  sortMode: ModelSortMode;
  showIntro?: boolean;
  busyModelId: string | null;
  activeDownloads: Set<string>;
  cancellingDownloads: Set<string>;
  downloadProgress: Record<string, SpeechAnalysisDownloadProgress>;
  deleteConfirmModelId: string | null;
  onSelect: (group: AnalysisGroup, modelId: string) => void;
  onDownload: (model: SpeechAnalysisModelDescriptor) => void;
  onCancelDownload: (model: SpeechAnalysisModelDescriptor) => void;
  onDismissDownload: (modelId: string) => void;
  onRequestDelete: (modelId: string) => void;
  onCancelDelete: () => void;
  onDelete: (model: SpeechAnalysisModelDescriptor) => void;
}

const EngineGroup: React.FC<EngineGroupProps> = ({
  title,
  description,
  group,
  models,
  selectedModelId,
  sortMode,
  showIntro = true,
  busyModelId,
  activeDownloads,
  cancellingDownloads,
  downloadProgress,
  deleteConfirmModelId,
  onSelect,
  onDownload,
  onCancelDownload,
  onDismissDownload,
  onRequestDelete,
  onCancelDelete,
  onDelete,
}) => {
  const { t } = useTranslation();
  const accessors = useMemo(
    () => ({
      label: (model: SpeechAnalysisModelDescriptor) => model.label,
      active: (model: SpeechAnalysisModelDescriptor) =>
        model.id === selectedModelId,
      installed: (model: SpeechAnalysisModelDescriptor) => model.installed,
      runnable: (model: SpeechAnalysisModelDescriptor) =>
        model.installed &&
        (model.readiness === "ready" || model.readiness === "built_in"),
      inProgress: (model: SpeechAnalysisModelDescriptor) =>
        activeDownloads.has(model.id),
      gated: (model: SpeechAnalysisModelDescriptor) => model.gated,
      blocked: () => false,
      rank: (model: SpeechAnalysisModelDescriptor) =>
        group === "asr"
          ? getFileAsrEvaluationResult(model.id)?.rank
          : getSpeakerIsolationEvaluationResult(model.id)?.rank,
      latencyMs: (model: SpeechAnalysisModelDescriptor) =>
        group === "asr"
          ? getFileAsrEvaluationResult(model.id)?.latencyMs
          : getSpeakerIsolationEvaluationResult(model.id)?.latencyMs,
      providerRank: (model: SpeechAnalysisModelDescriptor) =>
        model.source_kind === "built_in" ? 0 : 1,
    }),
    [activeDownloads, group, selectedModelId],
  );
  const orderedDownloadedModels = useMemo(
    () =>
      orderModelList(
        models.filter(
          (model) => model.installed || activeDownloads.has(model.id),
        ),
        "downloaded",
        sortMode,
        accessors,
      ),
    [accessors, activeDownloads, models, sortMode],
  );
  const orderedAvailableModels = useMemo(
    () =>
      orderModelList(
        models.filter(
          (model) => !model.installed && !activeDownloads.has(model.id),
        ),
        "available",
        sortMode,
        accessors,
      ),
    [accessors, activeDownloads, models, sortMode],
  );
  const modelSections = [
    {
      title: "Downloaded Models",
      models: orderedDownloadedModels,
      showHeader: false,
    },
    {
      title: "Available to Download",
      models: orderedAvailableModels,
      showHeader: true,
    },
  ].filter((section) => section.models.length > 0);

  return (
    <section className="space-y-3">
      {showIntro ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
            {description}
          </p>
        </div>
      ) : null}

      {modelSections.length > 0 ? (
        <div className="space-y-5">
          {modelSections.map((section) => (
            <div key={section.title} className="space-y-3">
              {section.showHeader ? (
                <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text)]">
                  {section.title}
                </h3>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-2">
                {section.models.map((model) => {
                  const selected = model.id === selectedModelId;
                  const isBusy = busyModelId === model.id;
                  const isDownloading = activeDownloads.has(model.id);
                  const isCancelling = cancellingDownloads.has(model.id);
                  const deleteConfirmOpen = deleteConfirmModelId === model.id;
                  const progress = downloadProgress[model.id];
                  const isFailed = progress?.phase === "failed";
                  const hasKnownTotal = Boolean(
                    progress && progress.total_bytes > 0,
                  );
                  const progressPct =
                    progress && hasKnownTotal
                      ? Math.min(
                          100,
                          Math.round(
                            (progress.downloaded_bytes / progress.total_bytes) *
                              100,
                          ),
                        )
                      : null;
                  const progressLabel = (() => {
                    if (isFailed) {
                      return t("modelHub.analysis.downloadProgress.failed", {
                        defaultValue: "Setup failed",
                      });
                    }
                    if (isCancelling) {
                      return t(
                        "modelHub.analysis.downloadProgress.cancelling",
                        {
                          defaultValue: "Cancelling download...",
                        },
                      );
                    }
                    if (progress?.phase === "preparing") {
                      return downloadingModelFilesLabel(t);
                    }
                    if (progress?.phase === "recovering") {
                      return t(
                        "modelHub.analysis.downloadProgress.recovering",
                        {
                          defaultValue: "Resuming model download...",
                        },
                      );
                    }
                    if (progress?.phase === "downloading-related-assets") {
                      return t(
                        "modelHub.analysis.downloadProgress.relatedAssets",
                        {
                          defaultValue: "Downloading required extra files...",
                        },
                      );
                    }
                    if (progress?.phase === "installing-model") {
                      return t(
                        "modelHub.analysis.downloadProgress.installingModel",
                        {
                          defaultValue: "Installing model files...",
                        },
                      );
                    }
                    if (progress?.phase === "installing-runtime") {
                      return t(
                        "modelHub.analysis.downloadProgress.installingRuntime",
                        {
                          defaultValue: "Installing required runtime...",
                        },
                      );
                    }
                    if (progress?.phase === "complete") {
                      return t("modelHub.analysis.downloadProgress.ready", {
                        defaultValue: "Ready to use",
                      });
                    }
                    return downloadingModelFilesLabel(t);
                  })();

                  const downloadState: HubDownloadState | undefined =
                    isDownloading || isFailed
                      ? {
                          label: progressLabel,
                          detail: null,
                          error: progress?.error ?? null,
                          progress:
                            progress?.phase === "installing-model"
                              ? 100
                              : progressPct,
                          indeterminate:
                            progressPct === null &&
                            progress?.phase !== "installing-model",
                          cancelling: isCancelling,
                          onCancel:
                            isFailed ||
                            !speechAnalysisProgressCanCancel(progress?.phase)
                              ? undefined
                              : () => onCancelDownload(model),
                          cancelLabel: t(
                            "modelHub.analysis.actions.cancelDownload",
                            {
                              defaultValue: "Cancel {{modelName}} download",
                              modelName: model.label,
                            },
                          ),
                          onRetry: isFailed
                            ? () => onDownload(model)
                            : undefined,
                          onDismiss: isFailed
                            ? () => onDismissDownload(model.id)
                            : undefined,
                          retryLabel: t("modelHub.download.retry", {
                            defaultValue: "Try again",
                          }),
                          dismissLabel: t("modelHub.download.dismiss", {
                            defaultValue: "Dismiss",
                          }),
                        }
                      : undefined;

                  const headerBadges: CompactBadgeItem[] = [
                    selected
                      ? {
                          id: "active",
                          label: t("common.active", { defaultValue: "Active" }),
                          variant: "primary",
                          icon: (
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          ),
                          detail: t("modelHub.analysis.badges.activeDetail", {
                            defaultValue:
                              group === "asr"
                                ? "Currently selected for file transcription ASR."
                                : "Currently selected for speaker isolation.",
                          }),
                        }
                      : null,
                  ].filter(Boolean) as CompactBadgeItem[];
                  const titleBadges: CompactBadgeItem[] = [
                    speechAnalysisLicenseGate(model)
                      ? {
                          id: "license-gate",
                          label: t("modelHub.licenseGate.badge", {
                            defaultValue: "Restricted license",
                          }),
                          variant: "secondary",
                          icon: (
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                          ),
                          detail: t("modelHub.licenseGate.badgeDetail", {
                            defaultValue:
                              "Requires acknowledging publisher license restrictions before download.",
                          }),
                        }
                      : null,
                  ].filter(Boolean) as CompactBadgeItem[];

                  const identityChips = buildModelIdentityChips({
                    params: inferParameterClass([
                      model.label,
                      model.id,
                      model.provider,
                      model.repo_id,
                    ]),
                    arch: inferArchitectureLabel(
                      [model.label, model.id, model.provider, model.repo_id],
                      model.provider,
                    ),
                    format: inferRuntimeFormat(
                      [
                        runtimeLabel(model),
                        engineLabel(model),
                        model.source_kind,
                        model.repo_id,
                      ],
                      runtimeLabel(model),
                    ),
                  });
                  const sizeChip: CompactBadgeItem | null =
                    model.size_hint_label
                      ? {
                          id: "capability-size",
                          label: model.size_hint_label,
                          variant: "secondary",
                          icon: <HardDrive className="h-3 w-3" aria-hidden />,
                          detail: t("modelSelector.sizeDetail", {
                            defaultValue:
                              "Approximate disk size after download.",
                          }),
                        }
                      : null;
                  const capabilityChips: CompactBadgeItem[] = [
                    ...mergeSizeWithIdentityChips(identityChips, sizeChip),
                    model.gated
                      ? {
                          id: "capability-gated",
                          label: t("modelHub.analysis.meta.gated", {
                            defaultValue: "HF token",
                          }),
                          variant: "secondary",
                          icon: <KeyRound className="h-3 w-3" aria-hidden />,
                          detail: t("modelHub.analysis.meta.gatedDetail", {
                            defaultValue:
                              "Requires accepted Hugging Face terms and a local HF token.",
                          }),
                        }
                      : null,
                    {
                      id: "capability-engine",
                      label: engineLabel(model),
                      variant: "secondary",
                      icon: <Cpu className="h-3 w-3" aria-hidden />,
                      detail: t("modelHub.analysis.meta.engineDetail", {
                        defaultValue: "Runtime family used by this engine.",
                      }),
                    },
                  ].filter(Boolean) as CompactBadgeItem[];

                  const footerMetaItems = [
                    model.provider,
                    runtimeLabel(model),
                    sourceKindLabel(model),
                    model.downloadable && !model.installed
                      ? t("modelHub.analysis.meta.weightsNeeded", {
                          defaultValue: "weights not downloaded",
                        })
                      : readinessLabel(model),
                    model.license_label,
                    model.repo_id,
                  ].filter(Boolean) as string[];
                  let trailing: HubTrailing = null;
                  const actionDisabled = Boolean(busyModelId) || isDownloading;
                  trailing = {
                    kind: "custom",
                    node: (
                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {model.downloadable &&
                        !model.installed &&
                        !isDownloading ? (
                          <ActionIconButton
                            disabled={actionDisabled}
                            aria-label={t(
                              "modelHub.analysis.actions.download",
                              {
                                defaultValue: "Download {{modelName}}",
                                modelName: model.label,
                              },
                            )}
                            title={t("modelHub.analysis.actions.download", {
                              defaultValue: "Download {{modelName}}",
                              modelName: model.label,
                            })}
                            onClick={() => onDownload(model)}
                          >
                            {isDownloading ? (
                              <Loader2 className="animate-spin" aria-hidden />
                            ) : (
                              <Download aria-hidden />
                            )}
                          </ActionIconButton>
                        ) : null}
                        {model.downloadable && model.installed ? (
                          <ActionIconButton
                            tone="danger"
                            disabled={Boolean(busyModelId) && !isBusy}
                            onClick={() => onRequestDelete(model.id)}
                            aria-label={t("modelHub.analysis.actions.delete", {
                              defaultValue: "Delete {{modelName}}",
                              modelName: model.label,
                            })}
                            title={t("modelHub.analysis.actions.delete", {
                              defaultValue: "Delete {{modelName}}",
                              modelName: model.label,
                            })}
                          >
                            {isBusy ? (
                              <Loader2 className="animate-spin" aria-hidden />
                            ) : (
                              <Trash2 aria-hidden />
                            )}
                          </ActionIconButton>
                        ) : null}
                      </div>
                    ),
                  };

                  const footerExtra = deleteConfirmOpen ? (
                    <div
                      className="w-full rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_58%)] bg-[var(--danger-soft)] p-3"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--text)]">
                            {t("modelHub.analysis.actions.deleteConfirmTitle", {
                              defaultValue: "Delete downloaded weights?",
                            })}
                          </p>
                          <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                            {t(
                              "modelHub.analysis.actions.deleteConfirmDetail",
                              {
                                defaultValue:
                                  "{{modelName}} will be removed from Vox Jot's local model store. You can download it again later.",
                                modelName: model.label,
                              },
                            )}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={Boolean(busyModelId)}
                            onClick={onCancelDelete}
                          >
                            {t("common.cancel", { defaultValue: "Cancel" })}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            disabled={Boolean(busyModelId)}
                            onClick={() => onDelete(model)}
                          >
                            {isBusy ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            )}
                            {t("modelHub.analysis.actions.confirmDelete", {
                              defaultValue: "Delete",
                            })}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null;

                  const handleClick = () => {
                    if (actionDisabled) return;
                    if (deleteConfirmOpen) return;
                    if (model.downloadable && !model.installed) {
                      onDownload(model);
                      return;
                    }
                    onSelect(group, model.id);
                  };

                  return (
                    <HubModelCard
                      key={`${group}-${model.id}`}
                      title={model.label}
                      providerId={providerIconId(model)}
                      subline={model.provider}
                      titleBadges={titleBadges}
                      headerBadges={headerBadges}
                      description={model.description}
                      capabilityChips={capabilityChips}
                      footerMetaItems={footerMetaItems}
                      footerMetaLinks={
                        model.source_url
                          ? [
                              {
                                label: t("modelHub.sourceLink", {
                                  defaultValue: "Open model source",
                                }),
                                url: model.source_url,
                              },
                            ]
                          : undefined
                      }
                      footerMetaIcon={
                        <Server className="h-3.5 w-3.5" aria-hidden />
                      }
                      footerMetaMaxVisible={4}
                      footerOverflowLabel={`${model.label} details`}
                      active={selected}
                      trailing={trailing}
                      downloadState={downloadState}
                      footerExtra={footerExtra}
                      onClick={handleClick}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title={t("modelHub.analysis.empty.title", {
            defaultValue: "No speech analysis engines match the search.",
          })}
          description={t("modelHub.analysis.empty.description", {
            defaultValue:
              "Clear the search field to show all available engines.",
          })}
        />
      )}
    </section>
  );
};

export default SpeechAnalysisEnginesSection;
