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
import {
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  HardDrive,
  KeyRound,
  Loader2,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import HubModelCard, {
  type HubDownloadState,
  type HubTrailing,
} from "@/components/model-hub/HubModelCard";
import {
  commands,
  type HuggingFaceTokenStatus,
  type SpeechAnalysisCatalog,
  type SpeechAnalysisModelDescriptor,
  type SpeechAnalysisSelection,
  type SpeechAnalysisTask,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import type { CompactBadgeItem } from "@/components/ui/CompactOverflow";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { resolveModelProviderId } from "@/components/ui/ProviderIcon";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";

interface SpeechAnalysisEnginesSectionProps {
  hubSearchQuery?: string;
  onHeaderTitleChange?: (title: string | null) => void;
}

type AnalysisGroup = "asr" | "diarization";

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
> = ({ hubSearchQuery = "", onHeaderTitleChange }) => {
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
  const [hfTokenDraft, setHfTokenDraft] = useState("");
  const [hfTokenError, setHfTokenError] = useState<string | null>(null);
  const [savingHfToken, setSavingHfToken] = useState(false);
  const [deleteConfirmModelId, setDeleteConfirmModelId] = useState<
    string | null
  >(null);
  const [activeGroup, setActiveGroup] = useState<AnalysisGroup>("asr");
  const viewSwitcherRef = useRef<HTMLDivElement>(null);

  const loadCatalog = useCallback(async () => {
    const result = await commands.getSpeechAnalysisCatalog();
    if (result.status === "ok") {
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

    const unlisten = listen<SpeechAnalysisDownloadProgress>(
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
    );

    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
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

  const closeGatedDownload = useCallback(() => {
    if (savingHfToken) return;
    setGatedDownloadModel(null);
    setHfTokenDraft("");
    setHfTokenError(null);
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
      !confirmDestructiveAction(
        t("modelHub.analysis.hfAccess.clearTokenConfirm", {
          defaultValue:
            "Clear the saved Hugging Face token from Vox Jot? Gated model downloads will need a token again.",
        }),
      )
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
        .filter((model) => modelMatchesQuery(model, hubSearchQuery)) ?? [],
    [catalog, hubSearchQuery],
  );

  const diarizationModels = useMemo(
    () =>
      catalog?.models
        .filter((model) => taskMatchesGroup(model.task, "diarization"))
        .filter((model) => modelMatchesQuery(model, hubSearchQuery)) ?? [],
    [catalog, hubSearchQuery],
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
  }, [activeView.label, onHeaderTitleChange]);

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

  return (
    <div className="space-y-5">
      <div ref={viewSwitcherRef}>
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
      </div>

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
        showIntro={false}
        busyModelId={busyModelId}
        activeDownloads={activeDownloads}
        cancellingDownloads={cancellingDownloads}
        downloadProgress={downloadProgress}
        deleteConfirmModelId={deleteConfirmModelId}
        onSelect={selectModel}
        onDownload={requestDownload}
        onCancelDownload={cancelDownload}
        onRequestDelete={(modelId) => setDeleteConfirmModelId(modelId)}
        onCancelDelete={() => setDeleteConfirmModelId(null)}
        onDelete={deleteModel}
      />

      <GatedDownloadDialog
        model={gatedDownloadModel}
        tokenStatus={hfTokenStatus}
        tokenDraft={hfTokenDraft}
        error={hfTokenError}
        busy={savingHfToken || Boolean(busyModelId)}
        onTokenDraftChange={setHfTokenDraft}
        onOpenAccessPage={async (model) => {
          setHfTokenError(null);
          const result = await commands.openSpeechAnalysisModelAccessPage(
            model.id,
          );
          if (result.status === "error") {
            setHfTokenError(result.error);
          }
        }}
        onClearToken={clearHfToken}
        onCancel={closeGatedDownload}
        onConfirm={confirmGatedDownload}
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
  showIntro?: boolean;
  busyModelId: string | null;
  activeDownloads: Set<string>;
  cancellingDownloads: Set<string>;
  downloadProgress: Record<string, SpeechAnalysisDownloadProgress>;
  deleteConfirmModelId: string | null;
  onSelect: (group: AnalysisGroup, modelId: string) => void;
  onDownload: (model: SpeechAnalysisModelDescriptor) => void;
  onCancelDownload: (model: SpeechAnalysisModelDescriptor) => void;
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
  showIntro = true,
  busyModelId,
  activeDownloads,
  cancellingDownloads,
  downloadProgress,
  deleteConfirmModelId,
  onSelect,
  onDownload,
  onCancelDownload,
  onRequestDelete,
  onCancelDelete,
  onDelete,
}) => {
  const { t } = useTranslation();
  const orderedModels = useMemo(() => {
    const activeIndex = models.findIndex(
      (model) => model.id === selectedModelId,
    );
    if (activeIndex <= 0) return models;
    const next = [...models];
    const [activeModel] = next.splice(activeIndex, 1);
    return [activeModel, ...next];
  }, [models, selectedModelId]);

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

      {orderedModels.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {orderedModels.map((model) => {
            const selected = model.id === selectedModelId;
            const isBusy = busyModelId === model.id;
            const isDownloading = activeDownloads.has(model.id);
            const isCancelling = cancellingDownloads.has(model.id);
            const deleteConfirmOpen = deleteConfirmModelId === model.id;
            const progress = downloadProgress[model.id];
            const isFailed = progress?.phase === "failed";
            const hasKnownTotal = Boolean(progress && progress.total_bytes > 0);
            const progressPct =
              progress && hasKnownTotal
                ? Math.min(
                    100,
                    Math.round(
                      (progress.downloaded_bytes / progress.total_bytes) * 100,
                    ),
                  )
                : null;
            const progressFileName = progress?.file
              ? progress.file.includes("/")
                ? progress.file.slice(progress.file.lastIndexOf("/") + 1)
                : progress.file
              : null;
            const downloadState: HubDownloadState | undefined =
              isDownloading || isFailed
              ? {
                  label: isFailed
                    ? t("modelHub.analysis.downloadProgress.failed", {
                        defaultValue: "Download failed",
                      })
                    : isCancelling
                      ? t("modelHub.analysis.downloadProgress.cancelling", {
                          defaultValue: "Cancelling download...",
                        })
                      : progressPct !== null
                        ? t("modelHub.analysis.downloadProgress.percent", {
                            defaultValue: "Downloading {{percent}}%",
                            percent: progressPct,
                          })
                        : progress?.phase === "downloading"
                          ? t("modelHub.analysis.downloadProgress.downloading", {
                              defaultValue: "Downloading...",
                            })
                          : t("modelHub.analysis.downloadProgress.preparing", {
                              defaultValue: "Preparing download...",
                            }),
                  detail: progressFileName ?? model.repo_id ?? null,
                  error: progress?.error ?? null,
                  progress: progressPct,
                  indeterminate: progressPct === null,
                  cancelling: isCancelling,
                  onCancel: isFailed ? undefined : () => onCancelDownload(model),
                  cancelLabel: t("modelHub.analysis.actions.cancelDownload", {
                    defaultValue: "Cancel {{modelName}} download",
                    modelName: model.label,
                  }),
                }
              : undefined;

            const headerBadges: CompactBadgeItem[] = [
              selected
                ? {
                    id: "active",
                    label: t("common.active", { defaultValue: "Active" }),
                    variant: "primary",
                    icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
                    detail: t("modelHub.analysis.badges.activeDetail", {
                      defaultValue:
                        group === "asr"
                          ? "Currently selected for file transcription ASR."
                          : "Currently selected for speaker isolation.",
                    }),
                  }
                : null,
            ].filter(Boolean) as CompactBadgeItem[];

            const capabilityChips: CompactBadgeItem[] = [
              model.downloadable && !model.installed
                ? {
                    id: "capability-downloadable",
                    label: t("modelHub.analysis.meta.downloadable", {
                      defaultValue: "Downloadable",
                    }),
                    variant: "secondary",
                    icon: <Download className="h-3 w-3" aria-hidden />,
                    detail: t("modelHub.analysis.meta.downloadableDetail", {
                      defaultValue:
                        "Engine adapter is installed; model weights download into Vox Jot's local store.",
                    }),
                  }
                : {
                    id: "capability-local",
                    label: t("modelHub.chips.local", { defaultValue: "Local" }),
                    variant: "secondary",
                    icon: <HardDrive className="h-3 w-3" aria-hidden />,
                    detail: t("modelHub.chips.localDetail", {
                      defaultValue:
                        "Runs on this Mac or through a local runtime.",
                    }),
                  },
              model.size_hint_label
                ? {
                    id: "capability-size",
                    label: model.size_hint_label,
                    variant: "secondary",
                    icon: <HardDrive className="h-3 w-3" aria-hidden />,
                    detail: t("modelSelector.sizeDetail", {
                      defaultValue: "Approximate disk size after download.",
                    }),
                  }
                : null,
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
              model.installed
                ? {
                    id: "capability-installed",
                    label: t("modelHub.analysis.meta.installed", {
                      defaultValue: "Downloaded",
                    }),
                    variant: "success",
                    icon: <HardDrive className="h-3 w-3" aria-hidden />,
                    detail: t("modelHub.analysis.meta.installedDetail", {
                      defaultValue:
                        "Model files are present in Vox Jot's local model store.",
                    }),
                  }
                : null,
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
                  {model.downloadable && !model.installed && !isDownloading ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={actionDisabled}
                      aria-label={t("modelHub.analysis.actions.download", {
                        defaultValue: "Download {{modelName}}",
                        modelName: model.label,
                      })}
                      title={t("modelHub.analysis.actions.download", {
                        defaultValue: "Download {{modelName}}",
                        modelName: model.label,
                      })}
                      className="text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
                      onClick={() => onDownload(model)}
                    >
                      {isDownloading ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <Download className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </Button>
                  ) : null}
                  {model.downloadable && model.installed ? (
                    <Button
                      size="icon"
                      variant="ghost"
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
                      className="text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
                    >
                      {isBusy ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </Button>
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
                      {t("modelHub.analysis.actions.deleteConfirmDetail", {
                        defaultValue:
                          "{{modelName}} will be removed from Vox Jot's local model store. You can download it again later.",
                        modelName: model.label,
                      })}
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
                headerBadges={headerBadges}
                description={model.description}
                capabilityChips={capabilityChips}
                footerMetaItems={footerMetaItems}
                footerMetaIcon={<Server className="h-3.5 w-3.5" aria-hidden />}
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

interface GatedDownloadDialogProps {
  model: SpeechAnalysisModelDescriptor | null;
  tokenStatus: HuggingFaceTokenStatus | null;
  tokenDraft: string;
  error: string | null;
  busy: boolean;
  onTokenDraftChange: (value: string) => void;
  onOpenAccessPage: (
    model: SpeechAnalysisModelDescriptor,
  ) => void | Promise<void>;
  onClearToken: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const GatedDownloadDialog: React.FC<GatedDownloadDialogProps> = ({
  model,
  tokenStatus,
  tokenDraft,
  error,
  busy,
  onTokenDraftChange,
  onOpenAccessPage,
  onClearToken,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  if (!model) return null;

  const canConfirm =
    Boolean(tokenDraft.trim()) || Boolean(tokenStatus?.configured);
  const tokenSource = tokenStatus?.source?.replace(/_/g, " ");

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="speech-analysis-hf-access-title"
        className="relative w-full max-w-[680px] rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="speech-analysis-hf-access-title"
              className="text-base font-semibold text-[var(--text)]"
            >
              {t("modelHub.analysis.hfAccess.title", {
                defaultValue: "Hugging Face access required",
              })}
            </h2>
            <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
              {t("modelHub.analysis.hfAccess.description", {
                defaultValue:
                  "{{modelName}} is gated by its publisher. Accept the model terms with your Hugging Face account, then save your own read token so Vox Jot can download the weights into its local model store.",
                modelName: model.label,
              })}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            disabled={busy}
            aria-label={t("common.close", { defaultValue: "Close" })}
            title={t("common.close", { defaultValue: "Close" })}
          >
            <X />
          </Button>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <div className="flex items-start gap-2">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                aria-hidden
              />
              <div className="min-w-0 text-sm leading-5">
                <p className="font-medium text-[var(--text)]">
                  {t("modelHub.analysis.hfAccess.termsStep", {
                    defaultValue: "1. Accept the publisher terms",
                  })}
                </p>
                <p className="text-[var(--muted)]">
                  {t("modelHub.analysis.hfAccess.termsDetail", {
                    defaultValue:
                      "Hugging Face only grants gated-model access to the account that accepts the terms.",
                  })}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onOpenAccessPage(model)}
              className="mt-3"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t("modelHub.analysis.hfAccess.openAccessPage", {
                defaultValue: "Open access page",
              })}
            </Button>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <div className="flex items-start gap-2">
              <KeyRound
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                aria-hidden
              />
              <div className="min-w-0 text-sm leading-5">
                <p className="font-medium text-[var(--text)]">
                  {t("modelHub.analysis.hfAccess.tokenStep", {
                    defaultValue: "2. Create a token once",
                  })}
                </p>
                <p className="text-[var(--muted)]">
                  {t("modelHub.analysis.hfAccess.tokenSetupDetail", {
                    defaultValue:
                      "On Hugging Face, choose Fine-grained, name it Vox Jot Model Downloads, then check only Read access to contents of all public gated repos you can access. Leave Write, Inference, Billing, Jobs, and Webhooks off.",
                  })}
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  {t("modelHub.analysis.hfAccess.savedReuseDetail", {
                    defaultValue:
                      "After the token is saved here, the next gated model only needs its terms accepted; then return to Vox Jot and click Download with saved token.",
                  })}
                </p>
              </div>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {t("modelHub.analysis.hfAccess.tokenLabel", {
                defaultValue: "3. Paste token in Vox Jot",
              })}
            </span>
            <input
              type="password"
              value={tokenDraft}
              onChange={(event) => onTokenDraftChange(event.target.value)}
              placeholder={t("modelHub.analysis.hfAccess.tokenPlaceholder", {
                defaultValue: tokenStatus?.configured
                  ? "Leave blank to use the saved token"
                  : "Paste hf_... token",
              })}
              disabled={busy}
              className="min-h-11 w-full rounded-full border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm font-medium text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-[var(--muted)]">
              {tokenStatus?.configured
                ? t("modelHub.analysis.hfAccess.savedToken", {
                    defaultValue: "Saved token: {{source}}",
                    source: tokenSource ?? "configured",
                  })
                : t("modelHub.analysis.hfAccess.noSavedToken", {
                    defaultValue: "No Hugging Face token is saved in Vox Jot.",
                  })}
            </span>
            {tokenStatus?.configured ? (
              <Button
                type="button"
                variant="danger-ghost"
                size="sm"
                disabled={busy}
                onClick={onClearToken}
              >
                {t("modelHub.analysis.hfAccess.clearToken", {
                  defaultValue: "Clear token",
                })}
              </Button>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_65%)] bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger)]">
              {error}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={busy || !canConfirm}
            onClick={onConfirm}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("modelHub.analysis.hfAccess.download", {
              defaultValue: tokenDraft.trim()
                ? "Save token and download"
                : "Download with saved token",
            })}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SpeechAnalysisEnginesSection;
