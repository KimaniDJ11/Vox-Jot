import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Download,
  Loader2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { useModelStore } from "@/stores/modelStore";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import OnboardingLayout from "./OnboardingLayout";
import ModelCard from "./ModelCard";

interface ModelStepProps {
  onModelSelected: () => void;
  onBack?: () => void;
}

const ModelStep: React.FC<ModelStepProps> = ({ onModelSelected, onBack }) => {
  const { t } = useTranslation();
  const {
    models,
    currentModel,
    downloadModel,
    selectModel,
    downloadingModels,
    extractingModels,
    downloadProgress,
    downloadStats,
    loading,
    error,
    initialize,
    loadModels,
  } = useModelStore();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isDownloading = selectedModelId !== null;

  const recommendedModels = models.filter(
    (m: ModelInfo) => !m.is_downloaded && m.is_recommended,
  );
  const otherModels = models
    .filter((m: ModelInfo) => !m.is_downloaded && !m.is_recommended)
    .sort(
      (a: ModelInfo, b: ModelInfo) => Number(a.size_mb) - Number(b.size_mb),
    );
  const downloadedModels = models.filter((m: ModelInfo) => m.is_downloaded);
  const downloadedRecommendedModel =
    downloadedModels.find((m: ModelInfo) => m.id === currentModel) ??
    downloadedModels.find((m: ModelInfo) => m.is_recommended) ??
    downloadedModels[0];
  const hasNoCatalogModels = !loading && models.length === 0;

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Watch for the selected model to finish downloading + extracting
  useEffect(() => {
    if (!selectedModelId) return;

    const model = models.find((m) => m.id === selectedModelId);
    const stillDownloading = selectedModelId in downloadingModels;
    const stillExtracting = selectedModelId in extractingModels;

    if (model?.is_downloaded && !stillDownloading && !stillExtracting) {
      selectModel(selectedModelId).then((success) => {
        if (success) {
          onModelSelected();
        } else {
          toast.error(t("onboarding.errors.selectModel"));
          setSelectedModelId(null);
        }
      });
    }
  }, [
    selectedModelId,
    models,
    downloadingModels,
    extractingModels,
    selectModel,
    onModelSelected,
    t,
  ]);

  const handleDownloadModel = async (modelId: string) => {
    setSelectedModelId(modelId);
    const success = await downloadModel(modelId);
    if (!success) {
      toast.error(t("onboarding.downloadFailed"));
      setSelectedModelId(null);
    }
  };

  const handleUseDownloadedModel = async () => {
    if (!downloadedRecommendedModel || isDownloading) return;
    setSelectedModelId(downloadedRecommendedModel.id);
    const success = await selectModel(downloadedRecommendedModel.id);
    setSelectedModelId(null);
    if (success) {
      onModelSelected();
    } else {
      toast.error(t("onboarding.errors.selectModel"));
    }
  };

  const handleRetryCatalog = async () => {
    await loadModels();
  };

  const getModelStatus = (modelId: string) => {
    if (modelId in extractingModels) return "extracting" as const;
    if (modelId in downloadingModels) return "downloading" as const;
    return "downloadable" as const;
  };

  const getModelDownloadProgress = (modelId: string): number | undefined => {
    return downloadProgress[modelId]?.percentage;
  };

  const getModelDownloadSpeed = (modelId: string): number | undefined => {
    return downloadStats[modelId]?.speed;
  };

  // Build right-side visual
  const rightVisual = loading ? (
    <div className="ob-visual-card ob-visual-center ob-visual-stack">
      <Loader2
        size={48}
        className="ob-spinner mx-auto mb-4"
        color="var(--ob-primary)"
      />
      <h3 className="ob-card-title">
        {t("onboarding.setup.loading.title", {
          defaultValue: "Loading speech models",
        })}
      </h3>
      <p className="ob-card-copy">
        {t("onboarding.setup.loading.description", {
          defaultValue: "Vox Jot is checking the local model catalog.",
        })}
      </p>
    </div>
  ) : isDownloading ? (
    <div className="ob-visual-card ob-visual-center ob-visual-stack">
      <Loader2
        size={48}
        className="ob-spinner mx-auto mb-4"
        color="var(--ob-primary)"
      />
      <h3 className="ob-card-title">
        {t("onboarding.setup.downloading.title")}
      </h3>
      <p className="ob-card-copy">
        {t("onboarding.setup.downloading.description")}
      </p>
    </div>
  ) : (
    <div className="ob-visual-card ob-visual-center ob-visual-stack">
      <div className="ob-hero-badge ob-hero-badge-sm">
        <Download size={28} color="var(--ob-primary)" />
      </div>
      <h3 className="ob-card-title">{t("onboarding.setup.cardTitle")}</h3>
      <p className="ob-card-copy">{t("onboarding.setup.cardDescription")}</p>
    </div>
  );

  return (
    <OnboardingLayout
      currentStep="setup"
      onBack={onBack}
      leftContent={
        <>
          <p className="ob-eyebrow">
            {t("onboarding.setup.eyebrow", {
              defaultValue: "Local speech model",
            })}
          </p>
          <h1 className="ob-heading">{t("onboarding.setup.title")}</h1>
          <p className="ob-subtext">{t("onboarding.setup.description")}</p>
          <div
            className="ob-setup-hint-row"
            aria-label={t("onboarding.setup.hintsLabel", {
              defaultValue: "Model setup notes",
            })}
          >
            <span>
              {t("onboarding.setup.hints.recommended", {
                defaultValue: "Recommended first",
              })}
            </span>
            <span>
              {t("onboarding.setup.hints.downloadOnce", {
                defaultValue: "One-time download",
              })}
            </span>
            <span>
              {t("onboarding.setup.hints.changeLater", {
                defaultValue: "Change later",
              })}
            </span>
          </div>

          {/* Recommended models */}
          {loading ? (
            <div className="rounded-2xl border border-[var(--ob-border)] bg-[var(--ob-card)] p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <Loader2
                  className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[var(--ob-primary)]"
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-semibold text-[var(--ob-text)]">
                    {t("onboarding.setup.loading.title", {
                      defaultValue: "Loading speech models",
                    })}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ob-text-muted)]">
                    {t("onboarding.setup.loading.description", {
                      defaultValue:
                        "Vox Jot is checking the local model catalog.",
                    })}
                  </p>
                </div>
              </div>
            </div>
          ) : recommendedModels.length > 0 ? (
            <div className="flex flex-col gap-3">
              {recommendedModels.map((model: ModelInfo) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  variant="featured"
                  status={getModelStatus(model.id)}
                  disabled={isDownloading}
                  onSelect={handleDownloadModel}
                  onDownload={handleDownloadModel}
                  downloadProgress={getModelDownloadProgress(model.id)}
                  downloadSpeed={getModelDownloadSpeed(model.id)}
                />
              ))}
            </div>
          ) : downloadedRecommendedModel ? (
            <div className="rounded-2xl border border-[var(--ob-border)] bg-[var(--ob-card)] p-4 shadow-sm">
              <p className="text-sm font-semibold text-[var(--ob-text)]">
                {t("onboarding.setup.installed.title", {
                  defaultValue: "Model ready",
                })}
              </p>
              <p className="mt-1 text-sm text-[var(--ob-text-muted)]">
                {t("onboarding.setup.installed.description", {
                  defaultValue:
                    "{{modelName}} is already installed. Continue with this model.",
                  modelName: downloadedRecommendedModel.name,
                })}
              </p>
              <button
                type="button"
                onClick={handleUseDownloadedModel}
                disabled={isDownloading}
                className={`mt-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[var(--ob-primary)] px-4 text-sm font-semibold text-[var(--accent-foreground)] transition-colors hover:bg-[var(--ob-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60 ${interactiveFocusRingClass}`}
              >
                {t("onboarding.setup.installed.continue", {
                  defaultValue: "Continue",
                })}
              </button>
            </div>
          ) : hasNoCatalogModels ? (
            <div className="rounded-2xl border border-[var(--ob-border)] bg-[var(--ob-card)] p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ob-primary)]"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--ob-text)]">
                    {t("onboarding.setup.empty.title", {
                      defaultValue: "No speech models loaded",
                    })}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ob-text-muted)]">
                    {error ??
                      t("onboarding.setup.empty.description", {
                        defaultValue:
                          "Vox Jot could not load the speech model catalog. Try again, or skip this step and install a model later from Model Hub.",
                      })}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleRetryCatalog()}
                      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-[var(--ob-primary)] px-4 text-sm font-semibold text-[var(--accent-foreground)] transition-colors hover:bg-[var(--ob-primary-hover)] ${interactiveFocusRingClass}`}
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden />
                      {t("onboarding.setup.empty.retry", {
                        defaultValue: "Try again",
                      })}
                    </button>
                    <button
                      type="button"
                      onClick={onModelSelected}
                      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--ob-border)] bg-transparent px-4 text-sm font-semibold text-[var(--ob-text)] transition-colors hover:bg-[var(--ob-chip-bg)] ${interactiveFocusRingClass}`}
                    >
                      {t("onboarding.setup.empty.skip", {
                        defaultValue: "Skip model setup",
                      })}
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--ob-text-muted)]">
                    {t("onboarding.setup.empty.skipNote", {
                      defaultValue:
                        "Dictation needs a speech model before the first recording can succeed.",
                    })}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Advanced toggle */}
          {otherModels.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className={`inline-flex items-center gap-1.5 rounded-md bg-transparent px-1 py-0.5 text-[13px] text-[var(--ob-text-muted)] transition-colors hover:text-[var(--ob-text)] ${interactiveFocusRingClass}`}
              >
                {showAdvanced ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
                {showAdvanced
                  ? t("onboarding.setup.advanced.hide")
                  : t("onboarding.setup.advanced.show")}
              </button>

              {showAdvanced && (
                <div className="mt-3 flex flex-col gap-3">
                  <p className="ob-advanced-note">
                    {t("onboarding.setup.advanced.note", {
                      defaultValue:
                        "Extra models are useful for specific languages, lower latency, or larger accuracy tradeoffs. The recommended model is the fastest path to a successful first dictation.",
                    })}
                  </p>
                  {otherModels.map((model: ModelInfo) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      status={getModelStatus(model.id)}
                      disabled={isDownloading}
                      onSelect={handleDownloadModel}
                      onDownload={handleDownloadModel}
                      downloadProgress={getModelDownloadProgress(model.id)}
                      downloadSpeed={getModelDownloadSpeed(model.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="ob-footnote">{t("onboarding.setup.footnote")}</p>
        </>
      }
      rightContent={rightVisual}
    />
  );
};

export default ModelStep;
