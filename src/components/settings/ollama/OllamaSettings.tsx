import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useOllamaStore } from "../../../stores/ollamaStore";

const RECOMMENDED_MODELS = [
  { id: "llama3.2:1b", name: "Llama 3.2 1B", size: "~800MB", description: "Ultra-fast, great for simple corrections" },
  { id: "llama3.2:3b", name: "Llama 3.2 3B", size: "~2GB", description: "Balanced speed and quality" },
  { id: "qwen2.5:1.5b", name: "Qwen 2.5 1.5B", size: "~1GB", description: "Strong multilingual support" },
  { id: "phi3.5:mini", name: "Phi 3.5 Mini", size: "~2.2GB", description: "Microsoft's efficient small model" },
];

const OllamaSettings: React.FC = () => {
  const { t } = useTranslation();
  const {
    isInstalled,
    isLoading,
    installedModels,
    activeModel,
    pullingModel,
    pullProgress,
    checkInstallation,
    installOllama,
    pullModel,
    setActiveModel,
  } = useOllamaStore();

  useEffect(() => {
    checkInstallation();
  }, [checkInstallation]);

  return (
    <div className="flex flex-col gap-6">
      {/* Ollama Status */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-text">
          Ollama — Local LLM Engine
        </h3>
        <p className="text-xs text-text/60">
          Ollama runs tiny AI models locally on your device for post-processing transcripts.
          No internet required after setup.
        </p>

        {!isInstalled ? (
          <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-surface">
            <p className="text-sm text-text/80">
              Ollama is not installed. Click below to install it automatically.
            </p>
            <button
              onClick={installOllama}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {isLoading ? "Installing..." : "Install Ollama"}
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
      {isInstalled && (
        <div className="flex flex-col gap-4">
          <h4 className="text-sm font-semibold text-text">LLM Models for Post-Processing</h4>

          {/* Active model selector */}
          {installedModels.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-text/60">Active LLM Model</label>
              <select
                value={activeModel ?? ""}
                onChange={(e) => setActiveModel(e.target.value || null)}
                className="px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text"
              >
                <option value="">None (disable LLM post-processing)</option>
                {installedModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="text-xs text-text/50">
                The selected model will be used to improve transcripts after recording.
              </p>
            </div>
          )}

          {/* Download models */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-text/60">Download Models</label>
            <div className="flex flex-col gap-2">
              {RECOMMENDED_MODELS.map((model) => {
                const isInstalled = installedModels.includes(model.id);
                const isPulling = pullingModel === model.id;
                const progress = pullProgress[model.id];
                return (
                  <div
                    key={model.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-text">{model.name}</span>
                      <span className="text-xs text-text/50">{model.description} &bull; {model.size}</span>
                      {isPulling && progress !== undefined && (
                        <div className="mt-1 w-48 h-1 bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <div>
                      {isInstalled ? (
                        <span className="text-xs text-green-500 font-medium">Installed</span>
                      ) : isPulling ? (
                        <span className="text-xs text-text/50">{progress !== undefined ? `${Math.round(progress)}%` : "Pulling..."}</span>
                      ) : (
                        <button
                          onClick={() => pullModel(model.id)}
                          disabled={pullingModel !== null}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-border text-text/80 hover:bg-border/30 disabled:opacity-50 transition-colors"
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OllamaSettings;
