import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import { ChevronDown, Globe } from "lucide-react";
import type { ModelCardStatus } from "@/components/onboarding";
import { ModelCard } from "@/components/onboarding";
import { useModelStore } from "@/stores/modelStore";
import { LANGUAGES } from "@/lib/constants/languages.ts";
import type { ModelInfo } from "@/bindings";
import {
  getModelPlatformOverview,
  type ModelPlatformOverview,
} from "@/lib/modelPlatform";

// check if model supports a language based on its supported_languages list
const modelSupportsLanguage = (model: ModelInfo, langCode: string): boolean => {
  return model.supported_languages.includes(langCode);
};

interface ModelsSettingsProps {
  titleActionTargetId?: string;
}

export const ModelsSettings: React.FC<ModelsSettingsProps> = ({
  titleActionTargetId,
}) => {
  const { t } = useTranslation();
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
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
    if (!titleActionTargetId) {
      setPortalTarget(null);
      return;
    }

    setPortalTarget(document.getElementById(titleActionTargetId));
  }, [titleActionTargetId]);

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
  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return t("settings.models.filters.allLanguages");
    }
    return LANGUAGES.find((lang) => lang.value === languageFilter)?.label || "";
  }, [languageFilter, t]);
  const hasActiveFilter = languageFilter !== "all";

  const sttProviderOptions = useMemo(() => {
    const providers = platformOverview?.stt.providers ?? [];
    return [
      { value: "all", label: "All providers" },
      ...providers.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ];
  }, [platformOverview]);

  const selectedProviderLabel = useMemo(() => {
    if (providerFilter === "all") {
      return "All providers";
    }
    return (
      sttProviderOptions.find((provider) => provider.value === providerFilter)
        ?.label || "All providers"
    );
  }, [providerFilter, sttProviderOptions]);

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
    const model = models.find((m: ModelInfo) => m.id === modelId);
    const modelName = model?.name || modelId;
    const isActive = modelId === currentModel;

    const confirmed = await ask(
      isActive
        ? t("settings.models.deleteActiveConfirm", { modelName })
        : t("settings.models.deleteConfirm", { modelName }),
      {
        title: t("settings.models.deleteTitle"),
        kind: "warning",
      },
    );

    if (confirmed) {
      try {
        await deleteModel(modelId);
      } catch (err) {
        console.error(`Failed to delete model ${modelId}:`, err);
      }
    }
  };

  const handleModelCancel = async (modelId: string) => {
    try {
      await cancelDownload(modelId);
    } catch (err) {
      console.error(`Failed to cancel download for ${modelId}:`, err);
    }
  };

  // Filter models based on language filter
  const filteredModels = useMemo(() => {
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
      return true;
    });
  }, [models, languageFilter, providerFilter, sttCatalogById]);

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

  const filterAction = (
    <div className="flex items-center gap-2">
      <div className="relative inline-flex">
        <select
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          className="min-h-11 appearance-none rounded-full border border-[var(--border)] bg-[var(--card)] py-2 pe-10 ps-4 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
        >
          {sttProviderOptions.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {provider.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
      </div>
      <div className="relative" ref={languageDropdownRef}>
        <button
          type="button"
          onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
          className={`flex min-h-11 items-center gap-1.5 px-3.5 py-2 text-sm font-semibold transition-colors shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
            hasActiveFilter
              ? "rounded-full bg-logo-primary text-[var(--inverse-text)]"
              : "rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--card),var(--panel-bg)_12%)]"
          }`}
          aria-haspopup="listbox"
          aria-expanded={languageDropdownOpen}
        >
          <Globe className="h-3.5 w-3.5" />
          <span className="max-w-[140px] truncate">
            {selectedLanguageLabel}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${
              languageDropdownOpen ? "rotate-180" : ""
            }`}
          />
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
                    ? "bg-logo-primary font-semibold text-[var(--inverse-text)]"
                    : "hover:bg-mid-gray/10"
                }`}
              >
                {t("settings.models.filters.allLanguages")}
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
                      ? "bg-logo-primary font-semibold text-[var(--inverse-text)]"
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

  const countBadgeClassName =
    "inline-flex min-w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]";

  if (loading) {
    return (
      <div className="w-full space-y-4">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-logo-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      {portalTarget ? createPortal(filterAction, portalTarget) : null}

      {currentModelInfo ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            {t("settings.models.activeSpeechModel")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold text-[var(--text)]">
              {currentModelInfo.name}
            </p>
            {currentModelCatalog ? (
              <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
                {currentModelCatalog.provider_id
                  .replace(/^stt_/, "")
                  .replace(/_/g, " ")}
              </span>
            ) : null}
            {hasActiveFilter ? (
              <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
                {selectedLanguageLabel}
              </span>
            ) : null}
            {providerFilter !== "all" ? (
              <span className="rounded-full bg-[var(--panel-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                {selectedProviderLabel}
              </span>
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
          {/* Downloaded Models Section — header always visible so filter stays accessible */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text)]">
                  {t("settings.models.yourModels")}
                </h2>
                <span className={countBadgeClassName}>
                  {downloadedModels.length}
                </span>
              </div>
              {!portalTarget ? filterAction : <div className="shrink-0" />}
            </div>
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
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {downloadedModels.map((model: ModelInfo) => {
                  const catalog = sttCatalogById.get(model.id);
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
                      providerLabel={
                        platformOverview?.stt.providers.find(
                          (provider) => provider.id === catalog?.provider_id,
                        )?.label
                      }
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
              <span className={countBadgeClassName}>
                {availableModels.length}
              </span>
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
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {availableModels.map((model: ModelInfo) => {
                  const catalog = sttCatalogById.get(model.id);
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
                      providerLabel={
                        platformOverview?.stt.providers.find(
                          (provider) => provider.id === catalog?.provider_id,
                        )?.label
                      }
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
};
