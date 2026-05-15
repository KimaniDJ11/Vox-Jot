import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Activity, Gauge } from "lucide-react";
import type { ModelCardStatus } from "@/components/onboarding";
import { ModelCard } from "@/components/onboarding";
import { useModelStore } from "@/stores/modelStore";
import { LANGUAGES } from "@/lib/constants/languages.ts";
import type { ModelInfo } from "@/bindings";
import {
  getModelPlatformOverview,
  type ModelPlatformOverview,
} from "@/lib/modelPlatform";
import {
  providerDisplayName,
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import Badge from "@/components/ui/Badge";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import {
  getSttEvaluationResult,
  STT_EVALUATION_RESULTS,
  STT_EVALUATION_RUN,
  type SttEvaluationResult,
} from "@/lib/sttEvaluationResults";
import ModelListControls from "@/components/model-hub/ModelListControls";
import type { ModelHubControlState } from "@/components/model-hub/modelHubControls";
import {
  DEFAULT_MODEL_SORT_OPTIONS,
  orderModelList,
  splitInstalledModels,
  TEST_SCORE_MODEL_SORT_OPTION,
  type ModelSortMode,
} from "@/lib/modelListOrdering";

// check if model supports a language based on its supported_languages list
const modelSupportsLanguage = (model: ModelInfo, langCode: string): boolean => {
  return model.supported_languages.includes(langCode);
};

interface ModelsSettingsProps {
  titleActionTargetId?: string;
  /** When false, hides the "Active speech model" summary card at the top (e.g. model hub). */
  showActiveModelBanner?: boolean;
  /** Optional text filter from model hub search (applied with language/provider filters). */
  hubSearchQuery?: string;
  modelHubControls?: ModelHubControlState;
  /** When true, idle filter labels use "Provider" / "Language" (model hub toolbar). */
  hubFilterLabels?: boolean;
  /** When true, shows the STT benchmark split panel beside the model list. */
  showEvaluationPanel?: boolean;
}

export const ModelsSettings: React.FC<ModelsSettingsProps> = ({
  titleActionTargetId,
  showActiveModelBanner = true,
  hubSearchQuery = "",
  modelHubControls,
  hubFilterLabels = false,
  showEvaluationPanel = false,
}) => {
  const { t } = useTranslation();
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [localLanguageFilter, setLocalLanguageFilter] = useState("all");
  const [localProviderFilter, setLocalProviderFilter] = useState("all");
  const [localSortMode, setLocalSortMode] =
    useState<ModelSortMode>("best_match");
  const languageFilter =
    modelHubControls?.languageFilter ?? localLanguageFilter;
  const providerFilter =
    modelHubControls?.providerFilter ?? localProviderFilter;
  const sortMode = modelHubControls?.sortMode ?? localSortMode;
  const setLanguageFilter =
    modelHubControls?.setLanguageFilter ?? setLocalLanguageFilter;
  const setProviderFilter =
    modelHubControls?.setProviderFilter ?? setLocalProviderFilter;
  const setSortMode = modelHubControls?.setSortMode ?? setLocalSortMode;
  const portalTarget = usePortalTarget(titleActionTargetId);
  const [platformOverview, setPlatformOverview] =
    useState<ModelPlatformOverview | null>(null);
  const {
    models,
    currentModel,
    downloadingModels,
    downloadProgress,
    downloadStats,
    extractingModels,
    loading,
    downloadModel,
    cancelDownload,
    selectModel,
    deleteModel,
  } = useModelStore();

  const loadPlatformOverview = useCallback(async () => {
    try {
      const overview = await getModelPlatformOverview();
      setPlatformOverview(overview);
    } catch (error) {
      console.error("Failed to load model platform overview:", error);
    }
  }, []);

  useEffect(() => {
    void loadPlatformOverview();
  }, [loadPlatformOverview, models, currentModel]);

  const languageOptions = useMemo(
    () => [
      { value: "all", label: hubFilterLabels ? "Language" : "All Languages" },
      ...LANGUAGES.filter((lang) => lang.value !== "auto").map((lang) => ({
        value: lang.value,
        label: lang.label,
      })),
    ],
    [hubFilterLabels],
  );

  // Get selected language label
  const idleLanguageFilterLabel = hubFilterLabels
    ? "Language"
    : t("settings.models.filters.allLanguages");

  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return idleLanguageFilterLabel;
    }
    return (
      LANGUAGES.find((lang) => lang.value === languageFilter)?.label ||
      languageFilter
    );
  }, [languageFilter, idleLanguageFilterLabel]);
  const hasActiveFilter = languageFilter !== "all";

  const sttProviderOptions = useMemo(() => {
    const providers = platformOverview?.stt.providers ?? [];
    const idle = hubFilterLabels ? "Provider" : "All providers";
    return [
      { value: "all", label: idle },
      ...providers.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ];
  }, [hubFilterLabels, platformOverview]);

  const selectedProviderLabel = useMemo(() => {
    const idle = hubFilterLabels ? "Provider" : "All providers";
    if (providerFilter === "all") {
      return idle;
    }
    return (
      sttProviderOptions.find((provider) => provider.value === providerFilter)
        ?.label ||
      providerFilter ||
      idle
    );
  }, [hubFilterLabels, providerFilter, sttProviderOptions]);

  useEffect(() => {
    if (modelHubControls) return;
    if (
      providerFilter !== "all" &&
      !sttProviderOptions.some((provider) => provider.value === providerFilter)
    ) {
      setProviderFilter("all");
    }
  }, [modelHubControls, providerFilter, setProviderFilter, sttProviderOptions]);

  useEffect(() => {
    if (modelHubControls) return;
    if (
      languageFilter !== "all" &&
      !languageOptions.some((language) => language.value === languageFilter)
    ) {
      setLanguageFilter("all");
    }
  }, [languageFilter, languageOptions, modelHubControls, setLanguageFilter]);
  const sttCatalogById = useMemo(() => {
    return new Map(
      (platformOverview?.stt.models ?? []).map((model) => [model.id, model]),
    );
  }, [platformOverview]);

  const providerRankById = useMemo(
    () =>
      new Map(
        sttProviderOptions.map((provider, index) => [provider.value, index]),
      ),
    [sttProviderOptions],
  );

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

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in extractingModels) {
      return "extracting";
    }
    if (modelId in downloadingModels) {
      return "downloading";
    }
    if (switchingModelId === modelId) {
      return "switching";
    }
    if (modelId === currentModel) {
      return "active";
    }
    const model = models.find((m: ModelInfo) => m.id === modelId);
    if (model?.is_downloaded) {
      return "available";
    }
    return "downloadable";
  };

  const getDownloadProgress = (modelId: string): number | undefined => {
    const progress = downloadProgress[modelId];
    return progress?.percentage;
  };

  const getDownloadSpeed = (modelId: string): number | undefined => {
    const stats = downloadStats[modelId];
    return stats?.speed;
  };

  const handleModelSelect = async (modelId: string) => {
    setSwitchingModelId(modelId);
    try {
      await selectModel(modelId);
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleModelDownload = async (modelId: string) => {
    await downloadModel(modelId);
  };

  const handleModelDelete = async (modelId: string) => {
    // Confirmation is handled inline by the model card itself — the OS-level
    // `ask()` dialog used to open behind the floating Model Hub window, so the
    // user never saw it and the click looked like a no-op.
    try {
      await deleteModel(modelId);
    } catch (err) {
      console.error("Failed to delete model:", { modelId, err });
    }
  };

  const handleModelCancel = async (modelId: string) => {
    try {
      await cancelDownload(modelId);
    } catch (err) {
      console.error("Failed to cancel model download:", { modelId, err });
    }
  };

  // Filter models based on language filter
  const filteredModels = useMemo(() => {
    const q = hubSearchQuery.trim().toLowerCase();
    return models.filter((model: ModelInfo) => {
      const modelCatalog = sttCatalogById.get(model.id);
      if (
        providerFilter !== "all" &&
        modelCatalog?.provider_id !== providerFilter
      ) {
        return false;
      }
      if (languageFilter !== "all") {
        if (!modelSupportsLanguage(model, languageFilter)) return false;
      }
      if (q) {
        const haystack = [
          model.name,
          model.id,
          model.description ?? "",
          modelCatalog?.provider_id ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [models, languageFilter, providerFilter, sttCatalogById, hubSearchQuery]);

  const { downloadedModels, availableModels } = useMemo(() => {
    const split = splitInstalledModels(filteredModels, (model) => {
      return (
        model.is_custom ||
        model.is_downloaded ||
        model.id in downloadingModels ||
        model.id in extractingModels
      );
    });

    const accessors = {
      label: (model: ModelInfo) => model.name,
      active: (model: ModelInfo) => model.id === currentModel,
      installed: (model: ModelInfo) => model.is_downloaded || model.is_custom,
      runnable: (model: ModelInfo) => model.is_downloaded || model.is_custom,
      inProgress: (model: ModelInfo) =>
        model.id in downloadingModels || model.id in extractingModels,
      recommended: (model: ModelInfo) => model.is_recommended,
      rank: (model: ModelInfo) => getSttEvaluationResult(model.id)?.rank,
      latencyMs: (model: ModelInfo) =>
        getSttEvaluationResult(model.id)?.latencyP50Ms,
      sizeMb: (model: ModelInfo) => Number(model.size_mb) || undefined,
      providerRank: (model: ModelInfo) => {
        const providerId = sttCatalogById.get(model.id)?.provider_id;
        return providerId ? providerRankById.get(providerId) : undefined;
      },
    };

    return {
      downloadedModels: orderModelList(
        split.downloadedModels,
        "downloaded",
        sortMode,
        accessors,
      ),
      availableModels: orderModelList(
        split.availableModels,
        "available",
        sortMode,
        accessors,
      ),
    };
  }, [
    filteredModels,
    downloadingModels,
    extractingModels,
    currentModel,
    providerRankById,
    sortMode,
    sttCatalogById,
  ]);

  const currentModelInfo =
    models.find((model) => model.id === currentModel) || null;
  const currentModelCatalog = currentModelInfo
    ? (sttCatalogById.get(currentModelInfo.id) ?? null)
    : null;
  const currentModelProviderId =
    currentModelInfo && currentModelCatalog
      ? resolveModelProviderId(
          `${currentModelInfo.name} ${currentModelInfo.id}`,
          currentModelCatalog.provider_id,
        )
      : null;

  const evaluatedModels = useMemo(
    () =>
      models
        .map((model) => ({
          model,
          result: getSttEvaluationResult(model.id),
        }))
        .filter(
          (entry): entry is { model: ModelInfo; result: SttEvaluationResult } =>
            Boolean(entry.result),
        )
        .sort((a, b) => {
          const ar = a.result.rank ?? Number.MAX_SAFE_INTEGER;
          const br = b.result.rank ?? Number.MAX_SAFE_INTEGER;
          if (ar !== br) return ar - br;
          return a.model.name.localeCompare(b.model.name);
        }),
    [models],
  );

  const activeEvaluation =
    currentModelInfo && getSttEvaluationResult(currentModelInfo.id);

  const filterAction = (
    <ModelListControls
      provider={{
        value: providerFilter,
        options: sttProviderOptions,
        onChange: setProviderFilter,
        label: selectedProviderLabel,
        show: sttProviderOptions.length > 2,
      }}
      language={{
        value: languageFilter,
        options: languageOptions,
        onChange: setLanguageFilter,
        label: selectedLanguageLabel,
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

  if (loading) {
    return (
      <div className="w-full space-y-4">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-logo-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const evaluationPanel = showEvaluationPanel ? (
    <aside className="min-w-0 lg:sticky lg:top-[5.75rem] lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
      <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              {t("settings.models.evaluation.title", {
                defaultValue: "STT test results",
              })}
            </p>
            <h2 className="mt-1 text-base font-semibold leading-tight text-[var(--text)]">
              {t("settings.models.evaluation.heading", {
                defaultValue: "Real-world benchmark",
              })}
            </h2>
          </div>
          <Activity className="h-4 w-4 shrink-0 text-[var(--accent)]" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <MetricTile
            label={t("settings.models.evaluation.tested", {
              defaultValue: "Tested",
            })}
            value={`${STT_EVALUATION_RESULTS.filter((r) => r.status === "tested").length}`}
          />
          <MetricTile
            label={t("settings.models.evaluation.bestWer", {
              defaultValue: "Best WER",
            })}
            value={formatWer(
              STT_EVALUATION_RESULTS.filter(
                (r) => r.status === "tested" && r.averageWer !== undefined,
              ).sort((a, b) => (a.averageWer ?? 1) - (b.averageWer ?? 1))[0]
                ?.averageWer,
            )}
          />
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
          <p className="text-xs font-semibold text-[var(--text)]">
            {STT_EVALUATION_RUN.suite}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {STT_EVALUATION_RUN.corpus}
          </p>
        </div>

        {activeEvaluation ? (
          <EvaluationResultBlock
            title={t("settings.models.evaluation.activeModel")}
            modelName={currentModelInfo?.name ?? activeEvaluation.label}
            result={activeEvaluation}
          />
        ) : null}

        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            {t("settings.models.evaluation.ranking", {
              defaultValue: "Ranking",
            })}
          </p>
          {evaluatedModels.length > 0 ? (
            evaluatedModels
              .slice(0, 8)
              .map(({ model, result }) => (
                <EvaluationResultBlock
                  key={model.id}
                  modelName={model.name}
                  result={result}
                  compact
                />
              ))
          ) : (
            <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-3 py-3 text-sm text-[var(--muted)]">
              {t("settings.models.evaluation.empty", {
                defaultValue:
                  "Results will appear after the local benchmark finishes.",
              })}
            </p>
          )}
        </div>
      </div>
    </aside>
  ) : null;

  const modelList = (
    <div className="min-w-0 space-y-6">
      {portalTarget ? createPortal(filterAction, portalTarget) : null}

      {showActiveModelBanner && currentModelInfo ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            {t("settings.models.activeSpeechModel")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {currentModelCatalog ? (
              <ProviderIcon
                providerId={
                  currentModelProviderId ?? currentModelCatalog.provider_id
                }
                size="md"
              />
            ) : null}
            <p className="text-lg font-bold text-[var(--text)]">
              {currentModelInfo.name}
            </p>
            {currentModelCatalog ? (
              <Badge
                variant="secondary"
                className="bg-[var(--accent-soft)] px-2.5 py-1 font-semibold text-[var(--accent)]"
              >
                {providerDisplayName(
                  currentModelProviderId ?? currentModelCatalog.provider_id,
                )}
              </Badge>
            ) : null}
            {hasActiveFilter ? (
              <Badge
                variant="secondary"
                className="bg-[var(--accent-soft)] px-2.5 py-1 font-semibold text-[var(--accent)]"
              >
                {selectedLanguageLabel}
              </Badge>
            ) : null}
            {providerFilter !== "all" ? (
              <Badge
                variant="secondary"
                className="bg-[var(--panel-bg)] px-2.5 py-1 font-semibold"
              >
                {selectedProviderLabel}
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {currentModelInfo.description}
          </p>
          {currentModelCatalog ? (
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
              {currentModelCatalog.runtime.label}
            </p>
          ) : null}
        </div>
      ) : null}

      {filteredModels.length > 0 ? (
        <div className="space-y-6">
          {/* Downloaded Models Section — filters inline when not portaled to model hub */}
          <div className="space-y-3">
            {!portalTarget ? (
              <div className="flex justify-end px-5">{filterAction}</div>
            ) : null}
            {downloadedModels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-5 py-5 text-sm text-[var(--muted)]">
                <p className="font-semibold text-[var(--text)]">
                  {hasActiveFilter
                    ? "No downloaded models match this language filter."
                    : "No downloaded speech models yet."}
                </p>
                <p className="mt-1 leading-6">
                  {hasActiveFilter
                    ? "Try showing all languages or download a compatible model below."
                    : "Download one from Available Models to start dictating offline."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {downloadedModels.map((model: ModelInfo) => {
                  const catalog = sttCatalogById.get(model.id);
                  const resolvedProviderId = resolveModelProviderId(
                    `${model.name} ${model.id}`,
                    catalog?.provider_id,
                  );
                  const rawProviderLabel = platformOverview?.stt.providers.find(
                    (provider) => provider.id === catalog?.provider_id,
                  )?.label;
                  const providerLabel =
                    rawProviderLabel &&
                    !rawProviderLabel.toLowerCase().includes("runtime")
                      ? rawProviderLabel
                      : resolvedProviderId !== "generic"
                        ? providerDisplayName(resolvedProviderId)
                        : rawProviderLabel;
                  return (
                    <ModelCard
                      key={model.id}
                      model={model}
                      status={getModelStatus(model.id)}
                      onSelect={handleModelSelect}
                      onDownload={handleModelDownload}
                      onDelete={handleModelDelete}
                      onCancel={handleModelCancel}
                      downloadProgress={getDownloadProgress(model.id)}
                      downloadSpeed={getDownloadSpeed(model.id)}
                      showRecommended={false}
                      providerId={resolvedProviderId}
                      providerLabel={providerLabel}
                      runtimeLabel={catalog?.runtime.label}
                      licenseLabel={catalog?.license_label}
                      sourceLabel={catalog?.source_label}
                      sourceUrl={catalog?.source_url}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Available Models Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-5">
              <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text)]">
                {t("settings.models.availableModels")}
              </h2>
              <Badge
                variant="secondary"
                className="min-w-7 justify-center border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 font-semibold"
              >
                {availableModels.length}
              </Badge>
            </div>
            {availableModels.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-5 py-5 text-sm text-[var(--muted)]">
                <p className="font-semibold text-[var(--text)]">
                  {hasActiveFilter
                    ? "No available models match this language filter."
                    : "All listed speech models are already downloaded."}
                </p>
                <p className="mt-1 leading-6">
                  {hasActiveFilter
                    ? "Try a different language or clear the filter to browse the full catalog."
                    : "You already have every currently listed speech model on this device."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {availableModels.map((model: ModelInfo) => {
                  const catalog = sttCatalogById.get(model.id);
                  const resolvedProviderId = resolveModelProviderId(
                    `${model.name} ${model.id}`,
                    catalog?.provider_id,
                  );
                  const rawProviderLabel = platformOverview?.stt.providers.find(
                    (provider) => provider.id === catalog?.provider_id,
                  )?.label;
                  const providerLabel =
                    rawProviderLabel &&
                    !rawProviderLabel.toLowerCase().includes("runtime")
                      ? rawProviderLabel
                      : resolvedProviderId !== "generic"
                        ? providerDisplayName(resolvedProviderId)
                        : rawProviderLabel;
                  return (
                    <ModelCard
                      key={model.id}
                      model={model}
                      status={getModelStatus(model.id)}
                      onSelect={handleModelSelect}
                      onDownload={handleModelDownload}
                      onDelete={handleModelDelete}
                      onCancel={handleModelCancel}
                      downloadProgress={getDownloadProgress(model.id)}
                      downloadSpeed={getDownloadSpeed(model.id)}
                      showRecommended={false}
                      providerId={resolvedProviderId}
                      providerLabel={providerLabel}
                      runtimeLabel={catalog?.runtime.label}
                      licenseLabel={catalog?.license_label}
                      sourceLabel={catalog?.source_label}
                      sourceUrl={catalog?.source_url}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-5 py-8 text-center text-[var(--muted)]">
          <p className="text-sm font-semibold text-[var(--text)]">
            {t("settings.models.noModelsMatch")}
          </p>
          <p className="mt-1 text-sm leading-6">
            {t("settings.models.clearFilterHint")}
          </p>
        </div>
      )}
    </div>
  );

  if (showEvaluationPanel) {
    return (
      <div className="grid w-full min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {modelList}
        {evaluationPanel}
      </div>
    );
  }

  return <div className="w-full">{modelList}</div>;
};

const MetricTile: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
      {label}
    </p>
    <p className="mt-1 text-sm font-semibold text-[var(--text)]">{value}</p>
  </div>
);

const EvaluationResultBlock: React.FC<{
  modelName: string;
  result: SttEvaluationResult;
  title?: string;
  compact?: boolean;
}> = ({ modelName, result, title, compact = false }) => {
  const { t } = useTranslation();
  const statusLabel =
    result.status === "tested"
      ? result.rank
        ? `#${result.rank}`
        : t("settings.models.evaluation.tested")
      : result.status === "blocked"
        ? t("settings.models.evaluation.blocked")
        : t("settings.models.evaluation.pending");

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-3">
      {title ? (
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
          {title}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">
          {modelName}
        </p>
        <Badge
          variant="secondary"
          className="shrink-0 border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-xs font-semibold"
        >
          {statusLabel}
        </Badge>
      </div>
      {result.status === "tested" ? (
        <div
          className={`mt-2 grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}
        >
          <MiniMetric
            icon={<Gauge className="h-3.5 w-3.5" />}
            label={t("settings.models.evaluation.wer")}
            value={formatWer(result.averageWer)}
          />
          <MiniMetric
            icon={<Activity className="h-3.5 w-3.5" />}
            label={t("settings.models.evaluation.match")}
            value={`${result.normalizedMatches ?? 0}/${result.totalCases ?? 0}`}
          />
          {!compact ? (
            <MiniMetric
              label="p50"
              value={
                result.latencyP50Ms !== undefined
                  ? `${result.latencyP50Ms} ms`
                  : "n/a"
              }
            />
          ) : null}
        </div>
      ) : result.notes ? (
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {result.notes}
        </p>
      ) : null}
      {!compact && result.notes && result.status === "tested" ? (
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {result.notes}
        </p>
      ) : null}
    </div>
  );
};

const MiniMetric: React.FC<{
  label: string;
  value: string;
  icon?: React.ReactNode;
}> = ({ label, value, icon }) => (
  <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5">
    <div className="flex min-w-0 items-center gap-1 text-[var(--muted)]">
      {icon}
      <span className="truncate text-[10px] font-bold uppercase tracking-[0.1em]">
        {label}
      </span>
    </div>
    <p className="mt-0.5 truncate text-xs font-semibold text-[var(--text)]">
      {value}
    </p>
  </div>
);

function formatWer(value?: number): string {
  if (value === undefined) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}
