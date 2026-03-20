import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import ModelSelector from "../model-selector";
import ModelStatusButton from "../model-selector/ModelStatusButton";

const TitleBarModels: React.FC = () => {
  const { t } = useTranslation();
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
      : selectedLlmModel || t("footer.modelNotSet")
    : t("footer.llmNotSet");

  const llmStatus = selectedProvider
    ? selectedProvider.id === "apple_intelligence" || !!selectedLlmModel
      ? "ready"
      : "unloaded"
    : "none";

  const handleLlmKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setShowLlmDropdown(false);
    }
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
    <div className="title-bar-models flex items-center gap-4 text-[13px] font-bold tabular-nums leading-none">
      <ModelSelector
        statusButtonLabelClassName="font-bold"
        statusButtonDensity="titleBar"
      />

      {selectedProvider && selectedProvider.id !== "apple_intelligence" ? (
        <div className="relative" ref={llmDropdownRef}>
          <ModelStatusButton
            status={llmStatus}
            displayText={t("footer.llmPrefix", { name: llmDisplayText })}
            isDropdownOpen={showLlmDropdown}
            labelClassName="font-bold"
            density="titleBar"
            onClick={() => {
              if (!showLlmDropdown) {
                void fetchPostProcessModels(selectedProvider.id);
              }
              setShowLlmDropdown(!showLlmDropdown);
            }}
          />

          {showLlmDropdown && (
            <div
              className="absolute top-full end-0 mt-2 w-64 max-h-[60vh] overflow-y-auto bg-[var(--card)] border border-mid-gray/20 rounded-lg shadow-lg py-2 z-50 text-text"
              role="listbox"
              onKeyDown={handleLlmKeyDown}
            >
              {llmOptions.length > 0 ? (
                llmOptions.map((model) => (
                  <button
                    key={model}
                    type="button"
                    role="option"
                    aria-selected={selectedLlmModel === model}
                    className={`w-full px-3 py-2 text-start text-sm transition-colors ${
                      selectedLlmModel === model
                        ? "bg-logo-primary text-white hover:bg-logo-primary hover:brightness-110"
                        : "hover:bg-mid-gray/10"
                    }`}
                    onClick={() => {
                      void updatePostProcessModel(selectedProvider.id, model);
                      setShowLlmDropdown(false);
                    }}
                    disabled={isUpdating(
                      `post_process_model:${selectedProvider.id}`,
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate pe-4">{model}</span>
                      {selectedLlmModel === model && (
                        <span className="text-xs text-white">
                          {t("common.active")}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-text/60">
                  {t("footer.noModelsAvailable")}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="relative" ref={llmDropdownRef}>
          <ModelStatusButton
            status={llmStatus}
            displayText={t("footer.llmPrefix", { name: llmDisplayText })}
            isDropdownOpen={false}
            labelClassName="font-bold"
            density="titleBar"
            onClick={() => {}}
          />
        </div>
      )}
    </div>
  );
};

export default TitleBarModels;
