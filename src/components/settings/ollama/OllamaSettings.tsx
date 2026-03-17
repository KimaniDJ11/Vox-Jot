import React, { useEffect, useState } from "react";
import { Check, Download, Trash2 } from "lucide-react";
import { useOllamaStore } from "../../../stores/ollamaStore";
import { useSettings } from "@/hooks/useSettings";

const splitDescription = (
  description: string,
): { summary: string; size: string } => {
  const parts = description.split("—").map((part) => part.trim());
  if (parts.length < 2) {
    return { summary: description, size: "" };
  }
  return {
    size: parts[0],
    summary: parts.slice(1).join(" — "),
  };
};

const baseModelId = (id: string) => id.split(":")[0];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const parseParamsB = (modelId: string, label: string): number | null => {
  const combined = `${modelId} ${label}`.toLowerCase();
  const match = combined.match(/(\d+(?:\.\d+)?)\s*([bm])/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return unit === "m" ? value / 1000 : value;
};

const estimateScores = (modelId: string, label: string) => {
  const paramsB = parseParamsB(modelId, label);
  if (!paramsB) {
    return { quality: 0.55, speed: 0.55 };
  }

  // Heuristic only: larger tiny models trend higher quality, smaller trend faster.
  const normalized = clamp(paramsB / 6, 0, 1);
  const quality = clamp(0.28 + normalized * 0.68, 0.22, 0.96);
  const speed = clamp(0.94 - normalized * 0.7, 0.2, 0.96);
  return { quality, speed };
};

const OllamaSettings: React.FC = () => {
  const [actionError, setActionError] = useState<string | null>(null);
  const { getSetting, setPostProcessProvider, updatePostProcessModel } =
    useSettings();
  const {
    status,
    isChecking,
    isInstalling,
    recommendedModels,
    installedModels,
    pullProgress,
    pullingModels,
    checkStatus,
    installOllama,
    pullModel,
    deleteModel,
    loadRecommendedModels,
    startServe,
  } = useOllamaStore();

  useEffect(() => {
    checkStatus().then(() => loadRecommendedModels());
  }, [checkStatus, loadRecommendedModels]);

  const isInstalled = status?.installed ?? false;
  const isRunning = status?.running ?? false;
  const selectedProviderId = getSetting("post_process_provider_id") || "";
  const selectedOllamaModel =
    getSetting("post_process_models")?.["ollama"] || "";

  const downloadedModels = recommendedModels.filter((model) =>
    installedModels.some((installed) =>
      installed.startsWith(baseModelId(model.id)),
    ),
  );

  const availableModels = recommendedModels.filter(
    (model) =>
      !installedModels.some((installed) =>
        installed.startsWith(baseModelId(model.id)),
      ),
  );

  const handlePullModel = async (modelId: string) => {
    setActionError(null);
    const ok = await pullModel(modelId);
    if (!ok) {
      setActionError(
        "Could not start model download. Ensure Ollama is running and try again.",
      );
    }
  };

  const isModelActive = (modelId: string) => {
    if (selectedProviderId !== "ollama") {
      return false;
    }

    const selectedBase = baseModelId(selectedOllamaModel);
    const candidateBase = baseModelId(modelId);
    return selectedOllamaModel === modelId || selectedBase === candidateBase;
  };

  const handleActivateModel = async (modelId: string) => {
    setActionError(null);
    try {
      await setPostProcessProvider("ollama");
      await updatePostProcessModel("ollama", modelId);
    } catch (error) {
      console.error("Failed to activate Ollama model:", error);
      setActionError("Could not activate this model. Please try again.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Ollama Status */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-text">
          Ollama — Local LLM Engine
        </h3>
        <p className="text-xs text-text/60">
          Ollama runs tiny AI models locally on your device for post-processing
          transcripts. No internet required after setup.
        </p>

        {!isInstalled ? (
          <div className="flex flex-col gap-3 p-4 rounded-lg border border-mid-gray/20 bg-background">
            <p className="text-sm text-text/80">
              Ollama is not installed. Click below to install it automatically.
            </p>
            <button
              onClick={installOllama}
              disabled={isInstalling}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-logo-primary text-white hover:bg-logo-primary/90 disabled:opacity-50 transition-colors"
            >
              {isInstalling ? "Installing..." : "Install Ollama"}
            </button>
          </div>
        ) : !isRunning ? (
          <div className="flex flex-col gap-3 p-4 rounded-lg border border-mid-gray/20 bg-background">
            <p className="text-sm text-text/80">
              Ollama is installed but not running.
            </p>
            <button
              onClick={startServe}
              disabled={isChecking}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-logo-primary text-white hover:bg-logo-primary/90 disabled:opacity-50 transition-colors"
            >
              {isChecking ? "Checking..." : "Start Ollama"}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-green-500">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            Ollama is installed and ready
          </div>
        )}
      </div>

      {/* Model Management */}
      {isInstalled && isRunning && (
        <div className="max-w-3xl w-full mx-auto space-y-6">
          {actionError && (
            <div className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </div>
          )}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-text/60">
              Downloaded LLM Models
            </h4>
            {downloadedModels.length === 0 ? (
              <div className="rounded-xl border-2 border-mid-gray/20 px-4 py-3 text-sm text-text/60">
                No local LLM models downloaded yet.
              </div>
            ) : (
              downloadedModels.map((model) => {
                const progress = pullProgress[model.id] ?? 0;
                const isPulling = pullingModels.has(model.id);
                const details = splitDescription(model.description);
                const score = estimateScores(model.id, model.label);
                const isActive = isModelActive(model.id);

                return (
                  <div
                    key={model.id}
                    className={`group flex flex-col rounded-xl border-2 px-4 py-3 gap-2 transition-all duration-200 hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] ${
                      isActive
                        ? "border-logo-primary/70 bg-logo-primary/5"
                        : "border-mid-gray/25"
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <div className="flex flex-col items-start flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="text-base font-semibold text-text transition-colors group-hover:text-logo-primary">
                            {model.label}
                          </h3>
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${
                              isActive
                                ? "bg-logo-primary text-white"
                                : "bg-mid-gray/15 text-text/75"
                            }`}
                          >
                            <Check className="w-3 h-3 mr-1" />
                            {isActive ? "Active" : "Downloaded"}
                          </span>
                        </div>
                        <p className="text-text/60 text-sm leading-relaxed">
                          {details.summary}
                        </p>
                      </div>
                      <div className="hidden sm:flex items-center ml-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-text/60 w-16 text-right">
                              quality est
                            </p>
                            <div className="w-16 h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-logo-primary rounded-full"
                                style={{ width: `${score.quality * 100}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-text/60 w-16 text-right">
                              speed est
                            </p>
                            <div className="w-16 h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-logo-primary rounded-full"
                                style={{ width: `${score.speed * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <hr className="w-full border-mid-gray/20" />

                    <div className="flex items-center gap-3 w-full -mb-0.5 mt-0.5 h-5">
                      <span className="text-xs text-text/50">
                        Local Ollama model
                      </span>
                      {!isActive && (
                        <button
                          onClick={() => handleActivateModel(model.id)}
                          className="flex items-center gap-1.5 text-text/80 hover:text-logo-primary hover:bg-logo-primary/10 rounded-md px-2 py-0.5 transition-colors"
                        >
                          <span>Set Active</span>
                        </button>
                      )}
                      <button
                        onClick={() => deleteModel(model.id)}
                        className="flex items-center gap-1.5 ml-auto text-logo-primary/85 hover:text-logo-primary hover:bg-logo-primary/10 rounded-md px-2 py-0.5 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>

                    {isPulling && (
                      <div className="w-full mt-2">
                        <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-logo-primary rounded-full transition-all duration-300"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <p className="text-xs text-text/50 mt-1">
                          Pulling {Math.round(progress)}%
                        </p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-text/60">
              Available to Download
            </h4>
            {availableModels.map((model) => {
              const isPulling = pullingModels.has(model.id);
              const progress = pullProgress[model.id] ?? 0;
              const details = splitDescription(model.description);
              const score = estimateScores(model.id, model.label);

              return (
                <div
                  key={model.id}
                  className="group flex flex-col rounded-xl border-2 border-mid-gray/25 px-4 py-3 gap-2 transition-all duration-200 hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]"
                >
                  <div className="flex justify-between items-center w-full">
                    <div className="flex flex-col items-start flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-text transition-colors group-hover:text-logo-primary">
                        {model.label}
                      </h3>
                      <p className="text-text/60 text-sm leading-relaxed">
                        {details.summary}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center ml-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-text/60 w-16 text-right">
                            quality est
                          </p>
                          <div className="w-16 h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-logo-primary rounded-full"
                              style={{ width: `${score.quality * 100}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-text/60 w-16 text-right">
                            speed est
                          </p>
                          <div className="w-16 h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-logo-primary rounded-full"
                              style={{ width: `${score.speed * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <hr className="w-full border-mid-gray/20" />

                  <div className="flex items-center gap-3 w-full -mb-0.5 mt-0.5 h-5">
                    <span className="text-xs text-text/50">
                      {details.size || "Model"}
                    </span>
                    {isPulling ? (
                      <span className="ml-auto text-xs text-text/50">
                        Pulling {Math.round(progress)}%
                      </span>
                    ) : (
                      <button
                        onClick={() => handlePullModel(model.id)}
                        disabled={pullingModels.size > 0}
                        className="flex items-center gap-1.5 ml-auto text-text/80 hover:text-logo-primary hover:bg-logo-primary/10 rounded-md px-2 py-0.5 disabled:opacity-50 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    )}
                  </div>

                  {isPulling && (
                    <div className="w-full mt-2">
                      <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-logo-primary rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default OllamaSettings;
