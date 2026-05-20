import React, { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "@/bindings";
import {
  getTranslatedModelName,
  getTranslatedModelDescription,
} from "../../lib/utils/modelTranslation";
import {
  ProviderIcon,
  engineTypeToProviderId,
  resolveModelProviderId,
} from "../ui/ProviderIcon";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";

interface ModelDropdownProps {
  models: ModelInfo[];
  currentModelId: string;
  onModelSelect: (modelId: string) => void;
  id: string;
  labelledBy: string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  returnFocusToTrigger: () => void;
}

const ModelDropdown: React.FC<ModelDropdownProps> = ({
  models,
  currentModelId,
  onModelSelect,
  id,
  labelledBy,
  activeIndex,
  onActiveIndexChange,
  onClose,
  returnFocusToTrigger,
}) => {
  const { t } = useTranslation();
  const downloadedModels = useMemo(
    () => models.filter((m) => m.is_downloaded),
    [models],
  );
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (downloadedModels.length === 0) return;
    const activeModelIndex = downloadedModels.findIndex(
      (model) => model.id === currentModelId,
    );
    onActiveIndexChange(activeModelIndex >= 0 ? activeModelIndex : 0);
  }, [currentModelId, downloadedModels, onActiveIndexChange]);

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleModelClick = (modelId: string) => {
    onModelSelect(modelId);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (downloadedModels.length === 0) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        returnFocusToTrigger();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onActiveIndexChange((activeIndex + 1) % downloadedModels.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onActiveIndexChange(
        (activeIndex - 1 + downloadedModels.length) % downloadedModels.length,
      );
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      onActiveIndexChange(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onActiveIndexChange(downloadedModels.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const activeModel = downloadedModels[activeIndex];
      if (activeModel) {
        onModelSelect(activeModel.id);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      returnFocusToTrigger();
    }
  };

  return (
    <div
      id={id}
      role="listbox"
      aria-labelledby={labelledBy}
      aria-activedescendant={
        downloadedModels[activeIndex]
          ? `${id}-option-${downloadedModels[activeIndex].id}`
          : undefined
      }
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onClose();
        }
      }}
      className="absolute top-full start-0 mt-2 max-h-[60vh] w-64 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] py-2 shadow-lg z-50"
    >
      {downloadedModels.length > 0 ? (
        <div>
          {downloadedModels.map((model, index) => {
            const isSelected = currentModelId === model.id;
            const isKeyboardActive = activeIndex === index;

            return (
              <div
                key={model.id}
                id={`${id}-option-${model.id}`}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={() => handleModelClick(model.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  handleModelClick(model.id);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onActiveIndexChange(index)}
                className={`w-full cursor-pointer px-3 py-2 text-start transition-colors ${interactiveFocusRingClass} ${
                  isSelected
                    ? "bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)]"
                    : isKeyboardActive
                      ? "bg-[var(--input)] text-[var(--text)]"
                      : "text-[var(--text)] hover:bg-[var(--input)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <ProviderIcon
                      providerId={resolveModelProviderId(
                        `${getTranslatedModelName(model, t)} ${model.id}`,
                        engineTypeToProviderId(model.engine_type),
                      )}
                      size="sm"
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <div
                        className={`text-sm ${
                          isSelected
                            ? "text-[var(--accent-foreground)]"
                            : "text-[var(--text)]"
                        }`}
                      >
                        {getTranslatedModelName(model, t)}
                        {model.is_custom && (
                          <span
                            className={`ms-1.5 text-xs font-medium uppercase ${
                              isSelected
                                ? "text-[var(--accent-foreground)]"
                                : "text-[var(--muted)]"
                            }`}
                          >
                            {t("modelSelector.custom")}
                          </span>
                        )}
                      </div>
                      <div
                        className={`text-xs italic pe-4 ${
                          isSelected
                            ? "text-[var(--accent-foreground)]"
                            : "text-[var(--muted)]"
                        }`}
                      >
                        {getTranslatedModelDescription(model, t)}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="text-xs text-[var(--accent-foreground)]">
                      {t("modelSelector.active")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-3 py-2 text-sm text-[var(--muted)]">
          {t("modelSelector.noModelsAvailable")}
        </div>
      )}
    </div>
  );
};

export default ModelDropdown;
