import React, { useEffect, useState } from "react";
import { useOllamaStore } from "../../stores/ollamaStore";
import { useSettingsStore } from "../../stores/settingsStore";

interface OllamaSetupProps {
  onComplete: () => void;
  onSkip: () => void;
}

const OllamaSetup: React.FC<OllamaSetupProps> = ({ onComplete, onSkip }) => {
  const {
    status,
    isChecking,
    isInstalling,
    installProgress,
    recommendedModels,
    pullProgress,
    pullingModels,
    checkStatus,
    installOllama,
    pullModel,
    loadRecommendedModels,
    startServe,
  } = useOllamaStore();

  const { settings, setPostProcessProvider } = useSettingsStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkStatus().then(() => loadRecommendedModels());
  }, []);

  const handleInstall = async () => {
    setError(null);
    const ok = await installOllama();
    if (!ok) {
      setError(
        "Installation failed. Please visit https://ollama.com to install manually."
      );
    } else {
      await loadRecommendedModels();
    }
  };

  const handleStartServe = async () => {
    setError(null);
    const ok = await startServe();
    if (!ok) {
      setError("Could not start Ollama. Try restarting it manually.");
    } else {
      await loadRecommendedModels();
    }
  };

  const handlePullModel = async (modelId: string) => {
    setError(null);
    await pullModel(modelId);
    // Auto-select this model as the Ollama post-process model
    await setPostProcessProvider("ollama");
  };

  const handleSelectModel = async (modelId: string) => {
    await setPostProcessProvider("ollama");
    // Save selected LLM model in settings
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("change_post_process_model_setting", {
      providerId: "ollama",
      model: modelId,
    });
    onComplete();
  };

  const installedModels = status?.models ?? [];

  // Render: not installed
  if (status && !status.installed) {
    return (
      <div className="flex flex-col items-center gap-6 p-6 max-w-lg mx-auto text-center">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-bold text-text">
            Enable Local LLM Post-Processing
          </h2>
          <p className="text-text/70 text-sm">
            Vox Jot can use tiny AI models running locally on your machine to
            clean up and improve your transcriptions — no internet or API key
            required. This requires{" "}
            <span className="font-semibold">Ollama</span>, a free one-click
            install.
          </p>
        </div>

        {error && (
          <p className="text-red-500 text-sm bg-red-500/10 px-4 py-2 rounded-lg">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 w-full">
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            className="w-full bg-primary text-white font-semibold py-3 px-6 rounded-xl
                       hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {isInstalling ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                {installProgress || "Installing..."}
              </span>
            ) : (
              "Install Ollama (Free, One-Click)"
            )}
          </button>

          <button
            onClick={onSkip}
            className="text-text/50 text-sm hover:text-text/80 transition-colors"
          >
            Skip for now (use cloud LLM providers instead)
          </button>
        </div>
      </div>
    );
  }

  // Render: installed but not running
  if (status && status.installed && !status.running) {
    return (
      <div className="flex flex-col items-center gap-6 p-6 max-w-lg mx-auto text-center">
        <h2 className="text-xl font-bold text-text">Ollama Is Installed</h2>
        <p className="text-text/70 text-sm">
          Ollama is installed but not currently running. Click below to start
          it.
        </p>

        {error && (
          <p className="text-red-500 text-sm bg-red-500/10 px-4 py-2 rounded-lg">
            {error}
          </p>
        )}

        <button
          onClick={handleStartServe}
          disabled={isChecking}
          className="w-full bg-primary text-white font-semibold py-3 px-6 rounded-xl
                     hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          Start Ollama
        </button>

        <button
          onClick={onSkip}
          className="text-text/50 text-sm hover:text-text/80 transition-colors"
        >
          Skip
        </button>
      </div>
    );
  }

  // Render: running — show model picker
  return (
    <div className="flex flex-col gap-4 p-6 max-w-2xl mx-auto w-full">
      <div className="text-center">
        <h2 className="text-xl font-bold text-text">Choose a Local LLM</h2>
        <p className="text-text/70 text-sm mt-1">
          Pick a tiny model to run post-processing on your transcriptions. Each
          model runs 100% locally.
        </p>
      </div>

      {error && (
        <p className="text-red-500 text-sm bg-red-500/10 px-4 py-2 rounded-lg text-center">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {recommendedModels.map((model) => {
          const isPulled = installedModels.some((m) =>
            m.startsWith(model.id.split(":")[0])
          );
          const isPulling = pullingModels.has(model.id);
          const progress = pullProgress[model.id] ?? 0;
          const isSelected =
            settings?.post_process_models?.["ollama"] === model.id ||
            installedModels.some(
              (m) =>
                m === model.id &&
                settings?.post_process_provider_id === "ollama"
            );

          return (
            <div
              key={model.id}
              className={`flex items-center justify-between p-4 rounded-xl border transition-all
                ${
                  isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-surface hover:bg-surface/80"
                }`}
            >
              <div className="flex flex-col">
                <span className="font-semibold text-text">{model.label}</span>
                <span className="text-text/60 text-xs">{model.description}</span>
                {model.id === "llama3.2:1b" && (
                  <span className="text-xs text-primary mt-0.5 font-medium">
                    Recommended
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-4">
                {isPulling ? (
                  <div className="flex items-center gap-2">
                    <div className="w-20 bg-border rounded-full h-1.5">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-text/60">{progress}%</span>
                  </div>
                ) : isPulled ? (
                  <button
                    onClick={() => handleSelectModel(model.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                      ${
                        isSelected
                          ? "bg-primary text-white"
                          : "bg-primary/20 text-primary hover:bg-primary/30"
                      }`}
                  >
                    {isSelected ? "Selected" : "Use This"}
                  </button>
                ) : (
                  <button
                    onClick={() => handlePullModel(model.id)}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface
                               border border-border text-text/80 hover:bg-border/30
                               transition-colors"
                  >
                    Download
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-2">
        <button
          onClick={onSkip}
          className="text-text/50 text-sm hover:text-text/80 transition-colors"
        >
          Skip (configure later in Settings)
        </button>
        {installedModels.length > 0 && (
          <button
            onClick={onComplete}
            className="text-primary text-sm font-medium hover:text-primary/80 transition-colors"
          >
            Continue →
          </button>
        )}
      </div>
    </div>
  );
};

export default OllamaSetup;
