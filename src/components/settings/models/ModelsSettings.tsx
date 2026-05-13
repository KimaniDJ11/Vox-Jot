import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ChevronDown,
  Gauge,
  Globe,
  SlidersHorizontal,
} from "lucide-react";
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
  /** When true, idle filter labels use "Provider" / "Language" (model hub toolbar). */
  hubFilterLabels?: boolean;
  /** When true, shows the STT benchmark split panel beside the model list. */
  showEvaluationPanel?: boolean;
}

export const ModelsSettings: React.FC<ModelsSettingsProps> = ({
  titleActionTargetId,
  showActiveModelBanner = true,
  hubSearchQuery = "",
  hubFilterLabels = false,
  showEvaluationPanel = false,
}) => {
  const { t } = useTranslation();
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const portalTarget = usePortalTarget(titleActionTargetId);
  const [platformOverview, setPlatformOverview] =
    useState<ModelPlatformOverview | null>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageSearchInputRef = useRef<HTMLInputElement>(null);
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

  // click outside handler for language dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        languageDropdownRef.current &&
        !languageDropdownRef.current.contains(event.target as Node)
      ) {
        setLanguageDropdownOpen(false);
        setLanguageSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // focus search input when dropdown opens
  useEffect(() => {
    if (languageDropdownOpen && languageSearchInputRef.current) {
      languageSearchInputRef.current.focus();
    }
  }, [languageDropdownOpen]);

  useEffect(() => {
    void loadPlatformOverview();
  }, [loadPlatformOverview, models, currentModel]);

  // filtered languages for dropdown (exclude "auto")
  const filteredLanguages = useMemo(() => {
    return LANGUAGES.filter(
      (lang) =>
        lang.value !== "auto" &&
        lang.label.toLowerCase().includes(languageSearch.toLowerCase()),
    );
  }, [languageSearch]);

  // Get selected language label
  const idleLanguageFilterLabel = hubFilterLabels
    ? "Language"
    : t("settings.models.filters.allLanguages");

  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return idleLanguageFilterLabel;
    }
    return LANGUAGES.find((lang) => lang.value === languageFilter)?.label || "";
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
        ?.label || idle
    );
  }, [hubFilterLabels, providerFilter, sttProviderOptions]);
  const hasActiveProviderFilter = providerFilter !== "all";

  const sttCatalogById = useMemo(() => {
    return new Map(
      (platformOverview?.stt.models ?? []).map((model) => [model.id, model]),
    );
  }, [platformOverview]);

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

  // Split filtered models into downloaded (including custom) and available sections
  const { downloadedModels, availableModels } = useMemo(() => {
    const downloaded: ModelInfo[] = [];
    const available: ModelInfo[] = [];

    for (const model of filteredModels) {
      if (
        model.is_custom ||
        model.is_downloaded ||
        model.id in downloadingModels ||
        model.id in extractingModels
      ) {
        downloaded.push(model);
      } else {
        available.push(model);
      }
    }

    // Sort: active model first, then non-custom, then custom at the bottom
    downloaded.sort((a, b) => {
      if (a.id === currentModel) return -1;
      if (b.id === currentModel) return 1;
      if (a.is_custom !== b.is_custom) return a.is_custom ? 1 : -1;
      return 0;
    });

    return {
      downloadedModels: downloaded,
      availableModels: available,
    };
  }, [filteredModels, downloadingModels, extractingModels, currentModel]);

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
    <div className="flex items-center gap-2">
      <div
        className={`relative inline-flex ${hubFilterLabels ? "h-10 w-10 shrink-0" : "w-36"}`}
      >
        <select
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          className={`${hubFilterLabels ? "h-full" : "min-h-9"} w-full appearance-none rounded-full border py-1.5 text-xs font-semibold shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
            hubFilterLabels
              ? hasActiveProviderFilter
                ? "border-[var(--accent)] bg-[var(--accent-soft)] px-0 text-transparent"
                : "border-[var(--border)] bg-[var(--card)] px-0 text-transparent"
              : "border-[var(--border)] bg-[var(--card)] pe-9 ps-3 text-[var(--text)]"
          }`}
          aria-label={`Filter speech models by provider: ${selectedProviderLabel}`}
          title={`Provider: ${selectedProviderLabel}`}
        >
          {sttProviderOptions.map((provider) => (
            <option
              key={provider.value}
              value={provider.value}
              style={{ color: "var(--text)", backgroundColor: "var(--card)" }}
            >
              {provider.label}
            </option>
          ))}
        </select>
        {hubFilterLabels ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {hasActiveProviderFilter ? (
              <ProviderIcon providerId={providerFilter} size="sm" />
            ) : (
              <SlidersHorizontal className="h-4 w-4 text-[var(--text)]" />
            )}
          </div>
        ) : (
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
        )}
      </div>
      <div className="relative" ref={languageDropdownRef}>
        <button
          type="button"
          onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
          className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold transition-colors shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
            hasActiveFilter
              ? "rounded-full bg-logo-primary text-[var(--inverse-text)]"
              : "rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--card),var(--panel-bg)_12%)]"
          } ${hubFilterLabels ? "h-10 w-10 px-0" : "min-h-9 w-36 px-3"}`}
          aria-haspopup="listbox"
          aria-expanded={languageDropdownOpen}
          aria-label={`Filter speech models by language: ${selectedLanguageLabel}`}
          title={`Language: ${selectedLanguageLabel}`}
        >
          <Globe className={hubFilterLabels ? "h-4 w-4" : "h-3 w-3"} />
          {hubFilterLabels ? null : (
            <>
              <span className="min-w-0 flex-1 truncate text-left">
                {selectedLanguageLabel}
              </span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${
                  languageDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </>
          )}
        </button>

        {languageDropdownOpen && (
          <div className="absolute top-full right-0 z-50 mt-1 w-56 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-lg)]">
            <div className="border-b border-mid-gray/40 p-2">
              <input
                ref={languageSearchInputRef}
                type="text"
                value={languageSearch}
                onChange={(e) => setLanguageSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filteredLanguages.length > 0) {
                    setLanguageFilter(filteredLanguages[0].value);
                    setLanguageDropdownOpen(false);
                    setLanguageSearch("");
                  } else if (e.key === "Escape") {
                    setLanguageDropdownOpen(false);
                    setLanguageSearch("");
                  }
                }}
                placeholder={t("settings.general.language.searchPlaceholder")}
                className="w-full rounded-md border border-mid-gray/40 bg-mid-gray/10 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-logo-primary"
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setLanguageFilter("all");
                  setLanguageDropdownOpen(false);
                  setLanguageSearch("");
                }}
                className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                  languageFilter === "all"
                    ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                    : "hover:bg-mid-gray/10"
                }`}
              >
                {idleLanguageFilterLabel}
              </button>
              {filteredLanguages.map((lang) => (
                <button
                  key={lang.value}
                  type="button"
                  onClick={() => {
                    setLanguageFilter(lang.value);
                    setLanguageDropdownOpen(false);
                    setLanguageSearch("");
                  }}
                  className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                    languageFilter === lang.value
                      ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                      : "hover:bg-mid-gray/10"
                  }`}
                >
                  {lang.label}
                </button>
              ))}
              {filteredLanguages.length === 0 && (
                <div className="px-3 py-2 text-center text-sm text-[var(--muted)]">
                  {t("settings.general.language.noResults")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
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
            title="Active model"
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
  const statusLabel =
    result.status === "tested"
      ? result.rank
        ? `#${result.rank}`
        : "Tested"
      : result.status === "blocked"
        ? "Blocked"
        : "Pending";

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
            label="WER"
            value={formatWer(result.averageWer)}
          />
          <MiniMetric
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Match"
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
