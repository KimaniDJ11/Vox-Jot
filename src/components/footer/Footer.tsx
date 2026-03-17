import React, { useState, useEffect, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useSettings } from "@/hooks/useSettings";
import ModelStatusButton from "../model-selector/ModelStatusButton";

import ModelSelector from "../model-selector";
import UpdateChecker from "../update-checker";

const Footer: React.FC = () => {
  const [version, setVersion] = useState("");
  const [showLlmDropdown, setShowLlmDropdown] = useState(false);
  const {
    getSetting,
    postProcessModelOptions,
    fetchPostProcessModels,
    updatePostProcessModel,
    isUpdating,
  } = useSettings();
  const llmDropdownRef = useRef<HTMLDivElement>(null);

  const selectedProviderId = getSetting("post_process_provider_id") || "";
  const selectedProvider =
    getSetting("post_process_providers")?.find(
      (provider) => provider.id === selectedProviderId,
    ) || null;
  const selectedLlmModel =
    getSetting("post_process_models")?.[selectedProviderId] || "";

  const modelOptionsFromCache =
    postProcessModelOptions[selectedProviderId] || [];
  const llmOptions = selectedLlmModel
    ? Array.from(new Set([...modelOptionsFromCache, selectedLlmModel]))
    : modelOptionsFromCache;

  const llmDisplayText = selectedProvider
    ? selectedProvider.id === "apple_intelligence"
      ? "Apple Intelligence"
      : selectedLlmModel || "Model not set"
    : "LLM not set";

  const llmStatus = selectedProvider
    ? selectedProvider.id === "apple_intelligence" || !!selectedLlmModel
      ? "ready"
      : "unloaded"
    : "none";

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("0.7.10");
      }
    };

    fetchVersion();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        llmDropdownRef.current &&
        !llmDropdownRef.current.contains(event.target as Node)
      ) {
        setShowLlmDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative z-10 w-full px-2 pb-2 md:px-4 md:pb-4">
      <div className="flat-panel flex flex-col items-start justify-between gap-2 rounded-lg px-3 py-2 text-xs text-[var(--muted)] sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <ModelSelector />
          {selectedProvider && selectedProvider.id !== "apple_intelligence" ? (
            <div className="relative" ref={llmDropdownRef}>
              <ModelStatusButton
                status={llmStatus}
                displayText={`LLM: ${llmDisplayText}`}
                isDropdownOpen={showLlmDropdown}
                onClick={() => {
                  if (!showLlmDropdown) {
                    void fetchPostProcessModels(selectedProvider.id);
                  }
                  setShowLlmDropdown(!showLlmDropdown);
                }}
              />

              {showLlmDropdown && (
                <div className="absolute bottom-full start-0 mb-2 w-64 max-h-[60vh] overflow-y-auto bg-[var(--card)] border border-mid-gray/20 rounded-lg shadow-lg py-2 z-50">
                  {llmOptions.length > 0 ? (
                    llmOptions.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className={`w-full px-3 py-2 text-start hover:bg-[var(--input)] transition-colors ${
                          selectedLlmModel === model
                            ? "bg-logo-primary text-white"
                            : ""
                        }`}
                        onClick={() => {
                          void updatePostProcessModel(
                            selectedProvider.id,
                            model,
                          );
                          setShowLlmDropdown(false);
                        }}
                        disabled={isUpdating(
                          `post_process_model:${selectedProvider.id}`,
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate pe-4">{model}</span>
                          {selectedLlmModel === model && (
                            <span className="text-xs text-white">Active</span>
                          )}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-text/60">
                      No models available
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="relative" ref={llmDropdownRef}>
              <ModelStatusButton
                status={llmStatus}
                displayText={`LLM: ${llmDisplayText}`}
                isDropdownOpen={false}
                onClick={() => {}}
              />
            </div>
          )}
        </div>

        {/* Update Status */}
        <div className="flex items-center gap-1">
          <UpdateChecker />
          <span>•</span>
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <span>v{version}</span>
        </div>
      </div>
    </div>
  );
};

export default Footer;
