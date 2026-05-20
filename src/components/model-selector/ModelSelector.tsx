import React, { useCallback, useId, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/bindings";
import { getTranslatedModelName } from "../../lib/utils/modelTranslation";
import { useModelStore } from "../../stores/modelStore";
import ModelStatusButton from "./ModelStatusButton";
import ModelDropdown from "./ModelDropdown";
import DownloadProgressDisplay from "./DownloadProgressDisplay";

import { ModelStateEvent } from "@/lib/types/events";

type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

interface ModelSelectorProps {
  onError?: (error: string) => void;
  statusButtonLabelClassName?: string;
  statusButtonDensity?: "default" | "titleBar";
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  onError,
  statusButtonLabelClassName,
  statusButtonDensity,
}) => {
  const { t } = useTranslation();
  const {
    models,
    currentModel,
    downloadProgress,
    downloadStats,
    extractingModels,
    selectModel,
  } = useModelStore();

  const [modelStatus, setModelStatus] = useState<ModelStatus>("unloaded");
  const [modelError, setModelError] = useState<string | null>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [activeDropdownIndex, setActiveDropdownIndex] = useState(0);
  // Track pending model switch for optimistic display
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modelDropdownId = useId();
  const modelDropdownButtonId = `${modelDropdownId}-button`;
  const modelDropdownListboxId = `${modelDropdownId}-listbox`;

  const displayModelId = pendingModelId || currentModel;

  // Check model status when currentModel changes
  useEffect(() => {
    const checkStatus = async () => {
      if (currentModel) {
        try {
          const statusResult = await commands.getTranscriptionModelStatus();
          if (statusResult.status === "ok") {
            setModelStatus(
              statusResult.data === currentModel ? "ready" : "unloaded",
            );
            setModelError(null);
          } else {
            setModelStatus("error");
            setModelError(statusResult.error);
            onError?.(statusResult.error);
          }
        } catch {
          setModelStatus("error");
          setModelError("Failed to check model status");
          onError?.("Failed to check model status");
        }
      } else {
        setModelStatus("none");
      }
    };
    checkStatus();
  }, [currentModel, onError]);

  useEffect(() => {
    // Listen for model loading lifecycle events
    const modelStateUnlisten = listen<ModelStateEvent>(
      "model-state-changed",
      (event) => {
        const { event_type, error, model_id } = event.payload;
        if (
          model_id &&
          model_id !== displayModelId &&
          model_id !== pendingModelId
        ) {
          return;
        }
        switch (event_type) {
          case "loading_started":
            setModelStatus("loading");
            setModelError(null);
            break;
          case "loading_completed":
            setModelStatus("ready");
            setModelError(null);
            setPendingModelId(null);
            break;
          case "loading_failed":
            setModelStatus("error");
            setModelError(error || "Failed to load model");
            setPendingModelId(null);
            break;
          case "unloaded":
            if (error) {
              setModelStatus("error");
              setModelError(error);
              setPendingModelId(null);
            } else {
              setModelStatus("unloaded");
              setModelError(null);
            }
            break;
        }
      },
    );

    // Click outside to close dropdown
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowModelDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      modelStateUnlisten.then((fn) => fn());
    };
  }, [displayModelId, onError, pendingModelId]);

  useEffect(() => {
    if (pendingModelId && pendingModelId === currentModel) {
      setPendingModelId(null);
    }
  }, [currentModel, pendingModelId]);

  const closeModelDropdown = useCallback(() => {
    setShowModelDropdown(false);
  }, []);

  const returnFocusToTrigger = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openModelDropdown = useCallback(
    (direction: "first" | "last" | "current" = "current") => {
      const downloadedModels = models.filter((model) => model.is_downloaded);
      if (downloadedModels.length === 0) {
        setActiveDropdownIndex(0);
        setShowModelDropdown(true);
        requestAnimationFrame(() => {
          document.getElementById(modelDropdownListboxId)?.focus();
        });
        return;
      }

      if (direction === "first") {
        setActiveDropdownIndex(0);
      } else if (direction === "last") {
        setActiveDropdownIndex(downloadedModels.length - 1);
      } else {
        const selectedIndex = downloadedModels.findIndex(
          (model) => model.id === displayModelId,
        );
        setActiveDropdownIndex(selectedIndex >= 0 ? selectedIndex : 0);
      }
      setShowModelDropdown(true);
      requestAnimationFrame(() => {
        document.getElementById(modelDropdownListboxId)?.focus();
      });
    },
    [displayModelId, modelDropdownListboxId, models],
  );

  const handleTriggerKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (
    event,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openModelDropdown("first");
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      openModelDropdown("last");
      return;
    }

    if (event.key === "Escape" && showModelDropdown) {
      event.preventDefault();
      closeModelDropdown();
    }
  };

  const handleModelSelect = async (modelId: string) => {
    setPendingModelId(modelId);
    setModelError(null);
    closeModelDropdown();
    returnFocusToTrigger();
    const success = await selectModel(modelId);
    if (!success) {
      setPendingModelId(null);
      setModelStatus("error");
      setModelError("Failed to switch model");
      onError?.("Failed to switch model");
    }
  };

  const getModelDisplayText = (): string => {
    const extractingKeys = Object.keys(extractingModels);
    if (extractingKeys.length > 0) {
      if (extractingKeys.length === 1) {
        const modelId = extractingKeys[0];
        const model = models.find((m) => m.id === modelId);
        const modelName = model
          ? getTranslatedModelName(model, t)
          : t("modelSelector.extractingGeneric").replace("...", "");
        return t("modelSelector.extracting", { modelName });
      } else {
        return t("modelSelector.extractingMultiple", {
          count: extractingKeys.length,
        });
      }
    }

    const progressValues = Object.values(downloadProgress);
    if (progressValues.length > 0) {
      if (progressValues.length === 1) {
        const progress = progressValues[0];
        const percentage = Math.max(
          0,
          Math.min(100, Math.round(progress.percentage)),
        );
        return t("modelSelector.downloading", { percentage });
      } else {
        return t("modelSelector.downloadingMultiple", {
          count: progressValues.length,
        });
      }
    }

    const currentModelInfo = models.find((m) => m.id === displayModelId);

    switch (modelStatus) {
      case "ready":
        return currentModelInfo
          ? getTranslatedModelName(currentModelInfo, t)
          : t("modelSelector.modelReady");
      case "loading":
        return currentModelInfo
          ? t("modelSelector.loading", {
              modelName: getTranslatedModelName(currentModelInfo, t),
            })
          : t("modelSelector.loadingGeneric");
      case "extracting":
        return currentModelInfo
          ? t("modelSelector.extracting", {
              modelName: getTranslatedModelName(currentModelInfo, t),
            })
          : t("modelSelector.extractingGeneric");
      case "error":
        return modelError || t("modelSelector.modelError");
      case "unloaded":
        return currentModelInfo
          ? getTranslatedModelName(currentModelInfo, t)
          : t("modelSelector.modelUnloaded");
      case "none":
        return t("modelSelector.noModelDownloadRequired");
      default:
        return currentModelInfo
          ? getTranslatedModelName(currentModelInfo, t)
          : t("modelSelector.modelUnloaded");
    }
  };

  // Derive display status from model status + store state
  const getDisplayStatus = (): ModelStatus => {
    if (Object.keys(extractingModels).length > 0) return "extracting";
    if (Object.keys(downloadProgress).length > 0) return "downloading";
    return modelStatus;
  };

  // Title bar: green when selected model is on disk (like LLM “configured”); live states win.
  const getTitleBarDotStatus = (): ModelStatus => {
    if (Object.keys(extractingModels).length > 0) return "extracting";
    if (Object.keys(downloadProgress).length > 0) return "downloading";
    if (modelStatus === "loading") return "loading";
    if (modelStatus === "error") return "error";

    const id = displayModelId;
    if (!id) return "none";

    const info = models.find((m) => m.id === id);
    if (!info) return "unloaded";
    if (info.is_downloading) return "downloading";
    if (!info.is_downloaded) return "unloaded";

    return "ready";
  };

  const statusForButton =
    statusButtonDensity === "titleBar"
      ? getTitleBarDotStatus()
      : getDisplayStatus();

  return (
    <>
      {/* Model Status and Switcher */}
      <div className="relative" ref={dropdownRef}>
        <ModelStatusButton
          id={modelDropdownButtonId}
          ref={triggerRef}
          status={statusForButton}
          displayText={getModelDisplayText()}
          isDropdownOpen={showModelDropdown}
          onClick={() => {
            if (showModelDropdown) {
              closeModelDropdown();
            } else {
              openModelDropdown();
            }
          }}
          onKeyDown={handleTriggerKeyDown}
          ariaControls={modelDropdownListboxId}
          ariaLabel={t("modelSelector.switcherAriaLabel", {
            defaultValue: "Current model: {{model}}. Open model switcher.",
            model: getModelDisplayText(),
          })}
          labelClassName={statusButtonLabelClassName}
          density={statusButtonDensity}
        />

        {/* Model Dropdown */}
        {showModelDropdown && (
          <ModelDropdown
            id={modelDropdownListboxId}
            labelledBy={modelDropdownButtonId}
            models={models}
            currentModelId={displayModelId}
            onModelSelect={handleModelSelect}
            activeIndex={activeDropdownIndex}
            onActiveIndexChange={setActiveDropdownIndex}
            onClose={closeModelDropdown}
            returnFocusToTrigger={returnFocusToTrigger}
          />
        )}
      </div>

      {/* Download Progress Bar for Models */}
      <DownloadProgressDisplay
        downloadProgress={downloadProgress}
        downloadStats={downloadStats}
      />
    </>
  );
};

export default ModelSelector;
