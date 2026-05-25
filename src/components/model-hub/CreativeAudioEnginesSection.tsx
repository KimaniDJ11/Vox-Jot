import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  CheckCircle2,
  Cpu,
  Download,
  FileMusic,
  HardDrive,
  Loader2,
  Music2,
  Server,
  Sparkles,
  Trash2,
  Volume2,
} from "lucide-react";
import HubModelCard, {
  type HubTrailing,
} from "@/components/model-hub/HubModelCard";
import ModelListControls from "@/components/model-hub/ModelListControls";
import type { ModelHubControlState } from "@/components/model-hub/modelHubControls";
import { buildHubDownloadState } from "@/components/model-hub/hubDownloadState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import type { CompactBadgeItem } from "@/components/ui/CompactOverflow";
import {
  DEFAULT_MODEL_SORT_OPTIONS,
  orderModelList,
  type ModelSortMode,
} from "@/lib/modelListOrdering";
import { usePortalTarget } from "@/hooks/usePortalTarget";

type StorySoundMode = "sfx" | "ambience" | "music" | "song" | "composition";
type CreativeAudioSourceKind = "official_source";
type CreativeAudioAvailability = "ready" | "downloadable" | "blocked";
type CreativeAudioModeFilter = "all" | StorySoundMode;

interface CreativeAudioModelDescriptor {
  id: string;
  label: string;
  provider: string;
  provider_id: string;
  description: string;
  source_kind: CreativeAudioSourceKind;
  source_url: string;
  license_label: string;
  runtime_label: string;
  size_hint_label: string;
  installed: boolean;
  runnable: boolean;
  downloadable: boolean;
  recommended: boolean;
  status_label: string;
  availability: CreativeAudioAvailability;
  experimental: boolean;
  unavailable_reason?: string | null;
  modes: StorySoundMode[];
}

interface CreativeAudioModelCatalog {
  install_root: string;
  models: CreativeAudioModelDescriptor[];
}

interface CreativeAudioDownloadProgress {
  model_id: string;
  phase: string;
  percentage?: number | null;
  error?: string | null;
}

interface CreativeAudioEnginesSectionProps {
  titleActionTargetId?: string;
  hubSearchQuery?: string;
  modelHubControls?: ModelHubControlState;
  hubFilterLabels?: boolean;
}

const modeIcon = (mode: StorySoundMode) => {
  if (mode === "composition")
    return <FileMusic className="h-3 w-3" aria-hidden />;
  if (mode === "song") return <FileMusic className="h-3 w-3" aria-hidden />;
  if (mode === "music") return <Music2 className="h-3 w-3" aria-hidden />;
  if (mode === "ambience") return <Volume2 className="h-3 w-3" aria-hidden />;
  return <Sparkles className="h-3 w-3" aria-hidden />;
};

const modeLabel = (mode: StorySoundMode): string => {
  if (mode === "composition") return "Composition";
  if (mode === "song") return "Song";
  if (mode === "music") return "Music";
  if (mode === "ambience") return "Ambience";
  return "SFX";
};

const sourceKindLabel = (_sourceKind: CreativeAudioSourceKind): string => {
  return "Official source";
};

const modelMatchesQuery = (
  model: CreativeAudioModelDescriptor,
  query: string,
): boolean => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    model.label,
    model.provider,
    model.description,
    model.runtime_label,
    model.license_label,
    ...model.modes.map(modeLabel),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
};

const progressCanCancel = (phase?: string): boolean =>
  !["complete", "failed", "cancelled"].includes(phase ?? "");

const CreativeAudioEnginesSection: React.FC<
  CreativeAudioEnginesSectionProps
> = ({
  titleActionTargetId,
  hubSearchQuery = "",
  modelHubControls,
  hubFilterLabels = false,
}) => {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CreativeAudioModelCatalog | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [deleteConfirmModelId, setDeleteConfirmModelId] = useState<
    string | null
  >(null);
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, CreativeAudioDownloadProgress>
  >({});
  const [activeDownloads, setActiveDownloads] = useState<Set<string>>(
    () => new Set(),
  );
  const [cancellingDownloads, setCancellingDownloads] = useState<Set<string>>(
    () => new Set(),
  );
  const [localModeFilter, setLocalModeFilter] =
    useState<CreativeAudioModeFilter>("all");
  const [localSortMode, setLocalSortMode] =
    useState<ModelSortMode>("best_match");
  const modeFilter = (modelHubControls?.providerFilter ??
    localModeFilter) as CreativeAudioModeFilter;
  const sortMode = modelHubControls?.sortMode ?? localSortMode;
  const setModeFilter = useCallback(
    (value: CreativeAudioModeFilter) => {
      if (modelHubControls) {
        modelHubControls.setProviderFilter(value);
        return;
      }
      setLocalModeFilter(value);
    },
    [modelHubControls],
  );
  const setSortMode = modelHubControls?.setSortMode ?? setLocalSortMode;
  const headerActionPortal = usePortalTarget(titleActionTargetId ?? null);

  const refreshCatalog = useCallback(async () => {
    try {
      const result = await invoke<CreativeAudioModelCatalog>(
        "get_creative_audio_model_catalog",
      );
      setCatalog(result);
      setError(null);
    } catch (err) {
      const message = normalizeError(
        err,
        "Could not load creative audio models.",
      );
      setError(message);
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    let cancelled = false;
    void invoke<string[]>("get_active_creative_audio_downloads")
      .then((downloads) => {
        if (!cancelled) {
          setActiveDownloads(new Set(downloads));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Failed to rehydrate creative audio downloads:", err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<CreativeAudioDownloadProgress>(
        "creative-audio-download-progress",
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
            if (
              progress.phase === "complete" ||
              progress.phase === "failed" ||
              progress.phase === "cancelled"
            ) {
              next.delete(progress.model_id);
            }
            return next;
          });
          if (progress.phase === "complete" || progress.phase === "cancelled") {
            void refreshCatalog();
          }
          if (progress.phase === "failed" && progress.error) {
            setError(progress.error);
          }
        },
      );
    })();
    return () => {
      unlisten?.();
    };
  }, [refreshCatalog]);

  const startDownload = useCallback(
    async (model: CreativeAudioModelDescriptor) => {
      if (busyModelId || activeDownloads.has(model.id) || !model.downloadable) {
        return;
      }
      setError(null);
      setBusyModelId(model.id);
      setDeleteConfirmModelId(null);
      setActiveDownloads((current) => new Set(current).add(model.id));
      setDownloadProgress((current) => ({
        ...current,
        [model.id]: {
          model_id: model.id,
          phase: "preparing",
          percentage: 0,
        },
      }));
      try {
        await invoke<CreativeAudioModelDescriptor>(
          "download_creative_audio_model",
          { modelId: model.id },
        );
        await refreshCatalog();
      } catch (err) {
        const message = normalizeError(err, "Creative audio download failed.");
        if (!message.toLowerCase().includes("cancelled")) {
          setError(message);
          setDownloadProgress((current) => ({
            ...current,
            [model.id]: {
              model_id: model.id,
              phase: "failed",
              error: message,
            },
          }));
        }
      } finally {
        setBusyModelId(null);
        setActiveDownloads((current) => {
          const next = new Set(current);
          next.delete(model.id);
          return next;
        });
      }
    },
    [activeDownloads, busyModelId, refreshCatalog],
  );

  const cancelDownload = useCallback(async (modelId: string) => {
    setCancellingDownloads((current) => new Set(current).add(modelId));
    try {
      await invoke("cancel_creative_audio_model_download", { modelId });
    } catch (err) {
      setError(normalizeError(err, "Could not cancel download."));
      setCancellingDownloads((current) => {
        const next = new Set(current);
        next.delete(modelId);
        return next;
      });
    }
  }, []);

  const deleteModel = useCallback(
    async (model: CreativeAudioModelDescriptor) => {
      if (busyModelId || activeDownloads.has(model.id)) return;
      setBusyModelId(model.id);
      setError(null);
      try {
        await invoke<CreativeAudioModelDescriptor>(
          "delete_creative_audio_model",
          {
            modelId: model.id,
          },
        );
        setDeleteConfirmModelId(null);
        await refreshCatalog();
      } catch (err) {
        setError(normalizeError(err, "Could not delete creative audio model."));
      } finally {
        setBusyModelId(null);
      }
    },
    [activeDownloads, busyModelId, refreshCatalog],
  );

  const dismissDownload = useCallback((modelId: string) => {
    setDownloadProgress((current) => {
      const next = { ...current };
      delete next[modelId];
      return next;
    });
  }, []);

  const modeOptions = useMemo(
    () => [
      { value: "all", label: hubFilterLabels ? "Mode" : "All modes" },
      { value: "sfx", label: "SFX" },
      { value: "ambience", label: "Ambience" },
      { value: "music", label: "Music" },
      { value: "song", label: "Song" },
      { value: "composition", label: "Composition" },
    ],
    [hubFilterLabels],
  );
  const selectedModeLabel =
    modeOptions.find((option) => option.value === modeFilter)?.label ??
    modeFilter;
  const sortOptions = useMemo(() => DEFAULT_MODEL_SORT_OPTIONS, []);
  const selectedSortLabel =
    sortOptions.find((option) => option.value === sortMode)?.label ??
    "Best Match";

  const filteredModels = useMemo(
    () =>
      (catalog?.models ?? [])
        .filter(
          (model) => modeFilter === "all" || model.modes.includes(modeFilter),
        )
        .filter((model) => modelMatchesQuery(model, hubSearchQuery)),
    [catalog?.models, hubSearchQuery, modeFilter],
  );

  const accessors = useMemo(
    () => ({
      label: (model: CreativeAudioModelDescriptor) => model.label,
      active: () => false,
      installed: (model: CreativeAudioModelDescriptor) => model.installed,
      runnable: (model: CreativeAudioModelDescriptor) => model.runnable,
      inProgress: (model: CreativeAudioModelDescriptor) =>
        activeDownloads.has(model.id),
      gated: () => false,
      blocked: () => false,
      rank: () => undefined,
      latencyMs: () => undefined,
      providerRank: () => 0,
    }),
    [activeDownloads],
  );
  const downloadedModels = useMemo(
    () =>
      orderModelList(
        filteredModels.filter(
          (model) => model.installed || activeDownloads.has(model.id),
        ),
        "downloaded",
        sortMode,
        accessors,
      ),
    [accessors, activeDownloads, filteredModels, sortMode],
  );
  const availableModels = useMemo(
    () =>
      orderModelList(
        filteredModels.filter(
          (model) =>
            !model.installed &&
            model.downloadable &&
            !activeDownloads.has(model.id),
        ),
        "available",
        sortMode,
        accessors,
      ),
    [accessors, activeDownloads, filteredModels, sortMode],
  );

  const filterAction = (
    <ModelListControls
      provider={{
        value: modeFilter,
        options: modeOptions,
        onChange: (value) => setModeFilter(value as CreativeAudioModeFilter),
        label: selectedModeLabel,
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

  if (!catalog) {
    return (
      <EmptyState
        title={t("modelHub.creativeAudio.loading", {
          defaultValue: "Loading creative audio models...",
        })}
        description={error ?? ""}
      />
    );
  }

  const sections = [
    {
      title: t("modelHub.sections.downloaded", {
        defaultValue: "Downloaded Models",
      }),
      models: downloadedModels,
      showHeader: false,
    },
    {
      title: t("modelHub.sections.available", {
        defaultValue: "Available to Download",
      }),
      models: availableModels,
      showHeader: true,
    },
  ].filter((section) => section.models.length > 0);

  return (
    <section className="space-y-4">
      {headerActionPortal
        ? createPortal(filterAction, headerActionPortal)
        : null}
      {!headerActionPortal ? (
        <div className="flex flex-wrap justify-end gap-3">{filterAction}</div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_65%)] bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div className="space-y-5">
          {sections.map((section) => (
            <div key={section.title} className="space-y-3">
              {section.showHeader ? (
                <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text)]">
                  {section.title}
                </h3>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-2">
                {section.models.map((model) => {
                  const progress = downloadProgress[model.id];
                  const isBusy = busyModelId === model.id;
                  const isDownloading = activeDownloads.has(model.id);
                  const isCancelling = cancellingDownloads.has(model.id);
                  const deleteConfirmOpen = deleteConfirmModelId === model.id;
                  const progressLabel = labelForProgressPhase(
                    progress?.phase,
                    t,
                  );
                  const downloadState = buildHubDownloadState({
                    t,
                    progress,
                    localBusy: isDownloading,
                    activeLabel: progressLabel,
                    failedLabel: t("modelHub.download.failed", {
                      defaultValue: "Download failed",
                    }),
                    progressPct: progress?.percentage ?? null,
                    indeterminate: progress?.percentage == null,
                    cancelling: isCancelling,
                    onCancel: progressCanCancel(progress?.phase)
                      ? () => void cancelDownload(model.id)
                      : undefined,
                    onRetry: () => void startDownload(model),
                    onDismiss: () => dismissDownload(model.id),
                    cancelLabel: t("modelHub.creativeAudio.cancelDownload", {
                      defaultValue: "Cancel {{modelName}} download",
                      modelName: model.label,
                    }),
                  });

                  const headerBadges: CompactBadgeItem[] = [
                    model.runnable
                      ? {
                          id: "ready",
                          label: t("modelHub.creativeAudio.ready", {
                            defaultValue: "Ready",
                          }),
                          variant: "primary",
                          icon: (
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          ),
                          detail: t("modelHub.creativeAudio.readyDetail", {
                            defaultValue:
                              "Installed and available in Story Studio Sound Design.",
                          }),
                        }
                      : null,
                    model.recommended && !model.runnable
                      ? {
                          id: "recommended",
                          label: t("common.recommended", {
                            defaultValue: "Recommended",
                          }),
                          variant: "secondary",
                          icon: (
                            <Sparkles className="h-3.5 w-3.5" aria-hidden />
                          ),
                          detail: t(
                            "modelHub.creativeAudio.recommendedDetail",
                            {
                              defaultValue:
                                "Recommended starter model for this creative audio mode.",
                            },
                          ),
                        }
                      : null,
                  ].filter(Boolean) as CompactBadgeItem[];
                  const capabilityChips: CompactBadgeItem[] = [
                    ...model.modes.map((mode) => ({
                      id: `mode-${mode}`,
                      label: modeLabel(mode),
                      variant: "secondary" as const,
                      icon: modeIcon(mode),
                      detail: t("modelHub.creativeAudio.modeDetail", {
                        defaultValue:
                          "Story Studio sound type supported by this model.",
                      }),
                    })),
                    {
                      id: "runtime",
                      label: model.runtime_label,
                      variant: "secondary",
                      icon: <Cpu className="h-3 w-3" aria-hidden />,
                      detail: t("modelHub.creativeAudio.runtimeDetail", {
                        defaultValue: "Runtime used to generate audio locally.",
                      }),
                    },
                    {
                      id: "size",
                      label: model.size_hint_label,
                      variant: "secondary",
                      icon: <HardDrive className="h-3 w-3" aria-hidden />,
                      detail: t("modelSelector.sizeDetail", {
                        defaultValue: "Approximate disk size after download.",
                      }),
                    },
                  ];
                  const footerMetaItems = [
                    model.provider,
                    sourceKindLabel(model.source_kind),
                    model.license_label,
                    model.runnable
                      ? t("modelHub.creativeAudio.installed", {
                          defaultValue: "installed",
                        })
                      : model.status_label ||
                        t("modelHub.creativeAudio.weightsNeeded", {
                          defaultValue: "weights not downloaded",
                        }),
                  ];
                  const actionDisabled =
                    Boolean(busyModelId) ||
                    isDownloading ||
                    isCancelling ||
                    (!model.installed && !model.downloadable);
                  const trailing: HubTrailing = {
                    kind: "custom",
                    node: (
                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {!model.installed && model.downloadable ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={actionDisabled}
                            aria-label={t(
                              "modelHub.creativeAudio.downloadModel",
                              {
                                defaultValue: "Download {{modelName}}",
                                modelName: model.label,
                              },
                            )}
                            title={t("modelHub.creativeAudio.downloadModel", {
                              defaultValue: "Download {{modelName}}",
                              modelName: model.label,
                            })}
                            className="text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
                            onClick={() => void startDownload(model)}
                          >
                            {isBusy || isDownloading ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <Download className="h-3.5 w-3.5" aria-hidden />
                            )}
                          </Button>
                        ) : !model.installed ? (
                          <span
                            className="inline-flex min-h-8 items-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 text-[11px] font-semibold text-[var(--muted)]"
                            title={
                              model.unavailable_reason ?? model.status_label
                            }
                          >
                            {model.status_label ||
                              t("modelHub.creativeAudio.notRunnable", {
                                defaultValue: "Blocked",
                              })}
                          </span>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={actionDisabled && !isBusy}
                            aria-label={t(
                              "modelHub.creativeAudio.deleteModel",
                              {
                                defaultValue: "Delete {{modelName}}",
                                modelName: model.label,
                              },
                            )}
                            title={t("modelHub.creativeAudio.deleteModel", {
                              defaultValue: "Delete {{modelName}}",
                              modelName: model.label,
                            })}
                            className="text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
                            onClick={() => setDeleteConfirmModelId(model.id)}
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
                        )}
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
                            {t("modelHub.creativeAudio.deleteConfirmTitle", {
                              defaultValue: "Delete downloaded weights?",
                            })}
                          </p>
                          <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                            {t("modelHub.creativeAudio.deleteConfirmDetail", {
                              defaultValue:
                                "{{modelName}} will be removed from Vox Jot's local creative audio model store. You can download it again later.",
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
                            onClick={() => setDeleteConfirmModelId(null)}
                          >
                            {t("common.cancel", { defaultValue: "Cancel" })}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            disabled={Boolean(busyModelId)}
                            onClick={() => void deleteModel(model)}
                          >
                            {isBusy ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            )}
                            {t("modelHub.creativeAudio.confirmDelete", {
                              defaultValue: "Delete",
                            })}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null;

                  return (
                    <HubModelCard
                      key={model.id}
                      title={model.label}
                      providerId={model.provider_id || "generic"}
                      subline={model.provider}
                      headerBadges={headerBadges}
                      description={model.description}
                      capabilityChips={capabilityChips}
                      footerMetaItems={footerMetaItems}
                      footerMetaLinks={[
                        {
                          label: t("modelHub.sourceLink", {
                            defaultValue: "Open model source",
                          }),
                          url: model.source_url,
                        },
                      ]}
                      footerMetaIcon={
                        <Server className="h-3.5 w-3.5" aria-hidden />
                      }
                      active={model.runnable}
                      trailing={trailing}
                      downloadState={downloadState}
                      footerExtra={footerExtra}
                      onClick={() => {
                        if (deleteConfirmOpen || actionDisabled) return;
                        if (!model.installed && model.downloadable) {
                          void startDownload(model);
                        }
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title={t("modelHub.creativeAudio.empty.title", {
            defaultValue: "No creative audio models match the search.",
          })}
          description={t("modelHub.creativeAudio.empty.description", {
            defaultValue:
              "Clear the search field or mode filter to show all available creative audio models.",
          })}
        />
      )}
    </section>
  );
};

function labelForProgressPhase(
  phase: string | undefined,
  t: TFunction,
): string {
  if (phase === "downloading-runtime") {
    return t("modelHub.creativeAudio.progress.downloadingRuntime", {
      defaultValue: "Downloading required runtime...",
    });
  }
  if (phase === "installing-runtime") {
    return t("modelHub.creativeAudio.progress.installingRuntime", {
      defaultValue: "Installing MLX runtime...",
    });
  }
  if (phase === "downloading-weights") {
    return t("modelHub.creativeAudio.progress.downloadingWeights", {
      defaultValue: "Downloading model weights...",
    });
  }
  if (phase === "complete") {
    return t("modelHub.creativeAudio.progress.ready", {
      defaultValue: "Ready to use",
    });
  }
  if (phase === "cancelled") {
    return t("modelHub.creativeAudio.progress.cancelled", {
      defaultValue: "Download cancelled",
    });
  }
  return t("modelHub.creativeAudio.progress.preparing", {
    defaultValue: "Preparing download...",
  });
}

function normalizeError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export default CreativeAudioEnginesSection;
