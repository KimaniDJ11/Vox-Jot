import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { useModelStore } from "@/stores/modelStore";
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
    downloadModel,
    selectModel,
    downloadingModels,
    extractingModels,
    downloadProgress,
    downloadStats,
  } = useModelStore();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isDownloading = selectedModelId !== null;

  const recommendedModels = models
    .filter((m: ModelInfo) => !m.is_downloaded && m.is_recommended);
  const otherModels = models
    .filter((m: ModelInfo) => !m.is_downloaded && !m.is_recommended)
    .sort((a: ModelInfo, b: ModelInfo) => Number(a.size_mb) - Number(b.size_mb));

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
  const rightVisual = isDownloading ? (
    <div className="ob-visual-card ob-visual-stack" style={{ textAlign: "center" }}>
      <Loader2
        size={48}
        className="ob-spinner"
        color="var(--ob-primary)"
        style={{ margin: "0 auto 16px" }}
      />
      <h3 className="ob-card-title">{t("onboarding.setup.downloading.title")}</h3>
      <p className="ob-card-copy">
        {t("onboarding.setup.downloading.description")}
      </p>
    </div>
  ) : (
    <div className="ob-visual-card ob-visual-stack" style={{ textAlign: "center" }}>
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
          <h1 className="ob-heading">{t("onboarding.setup.title")}</h1>
          <p className="ob-subtext">{t("onboarding.setup.description")}</p>

          {/* Recommended models */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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

          {/* Advanced toggle */}
          {otherModels.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "none",
                  border: "none",
                  color: "var(--ob-text-muted)",
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showAdvanced
                  ? t("onboarding.setup.advanced.hide")
                  : t("onboarding.setup.advanced.show")}
              </button>

              {showAdvanced && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
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
