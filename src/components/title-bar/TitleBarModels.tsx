import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { interactiveFocusRingClass, minTapTargetHeightClass } from "@/lib/interactiveFocus";
import ModelSelector from "../model-selector";
import ModelStatusButton from "../model-selector/ModelStatusButton";
import { ProviderIcon } from "../ui/ProviderIcon";

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
    <div className="title-bar-models flex items-center gap-4 text-sm font-bold tabular-nums leading-none">
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
            leading={
              <ProviderIcon providerId={selectedProvider.id} size="xs" />
            }
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
              className="absolute top-full end-0 mt-2 w-64 max-h-[60vh] overflow-y-auto bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-lg py-2 z-50 text-[var(--text)]"
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
                    className={`w-full px-3 py-2.5 text-start text-sm transition-colors ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${
                      selectedLlmModel === model
                        ? "bg-[var(--accent)] text-[var(--inverse-text)] hover:bg-[var(--accent)] hover:brightness-110"
                        : "hover:bg-[var(--accent-soft)]"
                    }`}
                    onClick={() => {
                      void updatePostProcessModel(selectedProvider.id, model);
                      setShowLlmDropdown(false);
                    }}
                    disabled={isUpdating(
                      `post_process_model:${selectedProvider.id}`,
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <ProviderIcon
                          providerId={selectedProvider.id}
                          size="xs"
                        />
                        <span className="truncate pe-2">{model}</span>
                      </div>
                      {selectedLlmModel === model && (
                        <span className="text-xs text-[var(--inverse-text)]">
                          {t("common.active")}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-[var(--muted)]">
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
