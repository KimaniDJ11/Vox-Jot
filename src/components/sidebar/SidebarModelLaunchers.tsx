import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AudioLines,
  ChevronRight,
  Mic,
  ScanText,
  Sparkles,
  Volume2,
} from "lucide-react";
import { commands, type ScreenContextOcrEngine } from "@/bindings";
import { useModelStore } from "@/stores/modelStore";
import { useSettingsSlice } from "@/hooks/useSettings";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";
import {
  MODEL_HUB_TAB_DEFS,
  openModelHub,
  type ModelHubTabId,
} from "@/components/model-hub/modelHubTabs";
import {
  ProviderIcon,
  engineTypeToProviderId,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";

interface LauncherRowProps {
  icon: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  /** When set, the icon node is rendered without the colored circular wrapper. */
  iconBare?: boolean;
  label: string;
  value: string;
  ariaLabel?: string;
  variant?: "default" | "stats";
  onClick: () => void;
}

const LauncherRow: React.FC<LauncherRowProps> = ({
  icon,
  iconBg,
  iconColor,
  iconBare = false,
  label,
  value,
  ariaLabel,
  variant = "default",
  onClick,
}) => {
  const isStatsVariant = variant === "stats";

  const renderIcon = (sizeClass: string) =>
    iconBare ? (
      <span
        className={`flex ${sizeClass} shrink-0 items-center justify-center`}
        aria-hidden
      >
        {icon}
      </span>
    ) : (
      <span
        className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full`}
        style={{ backgroundColor: iconBg, color: iconColor }}
        aria-hidden
      >
        {icon}
      </span>
    );

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? `${label}: ${value}`}
      title={value}
      className={`flat-card group w-full rounded-2xl px-3 py-2.5 text-start transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] ${interactiveFocusRingClass} ${isStatsVariant ? "flex flex-col gap-2" : `flex items-center gap-3 ${minTapTargetHeightClass}`}`}
    >
      {isStatsVariant ? (
        <>
          <span className="flex items-center justify-between gap-2">
            {renderIcon("h-7 w-7")}
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                {label}
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </span>
          <span className="truncate text-[13px] font-semibold leading-tight text-[var(--text)]">
            {value}
          </span>
        </>
      ) : (
        <>
          {renderIcon("h-8 w-8")}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              {label}
            </span>
            <span className="truncate text-[13px] font-semibold leading-tight text-[var(--text)]">
              {value}
            </span>
          </span>
          <ChevronRight
            className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </>
      )}
    </button>
  );
};

interface SidebarModelLaunchersProps {
  variant?: "default" | "stats";
}

const SidebarModelLaunchers: React.FC<SidebarModelLaunchersProps> = ({
  variant = "default",
}) => {
  const { t } = useTranslation();
  const { models, currentModel } = useModelStore();
  const {
    post_process_provider_id: llmProviderId,
    post_process_providers: llmProviders,
    post_process_models: llmModels,
    selected_tts_model_id: selectedTtsModelId,
    selected_tts_provider_id: selectedTtsProviderId,
    screen_context_ocr_engine: ocrEngineValue,
    screen_context_ocr_neural_model_id: ocrNeuralModelIdValue,
    file_transcription_asr_model_id: analysisAsrModelIdValue,
    file_transcription_diarization_model_id: analysisDiarizationModelIdValue,
  } = useSettingsSlice([
    "post_process_provider_id",
    "post_process_providers",
    "post_process_models",
    "selected_tts_model_id",
    "selected_tts_provider_id",
    "screen_context_ocr_engine",
    "screen_context_ocr_neural_model_id",
    "file_transcription_asr_model_id",
    "file_transcription_diarization_model_id",
  ] as const);
  const [ocrCatalogLabel, setOcrCatalogLabel] = useState<string | null>(null);
  const [analysisLabel, setAnalysisLabel] = useState<string | null>(null);

  const sttIconSize = variant === "stats" ? "sm" : "md";
  const otherIconSize = variant === "stats" ? "sm" : "md";

  const sttModel = useMemo(
    () => models.find((m) => m.id === currentModel) ?? null,
    [models, currentModel],
  );

  const sttLabel = useMemo(() => {
    return (
      sttModel?.name ||
      currentModel ||
      t("footer.modelNotSet", { defaultValue: "Not set" })
    );
  }, [sttModel, currentModel, t]);

  const sttProviderId = useMemo(() => {
    if (!sttModel) {
      const inferred = resolveModelProviderId(sttLabel, null);
      return inferred === "generic" ? null : inferred;
    }
    return resolveModelProviderId(
      `${sttModel.name} ${sttModel.id}`,
      engineTypeToProviderId(sttModel.engine_type),
    );
  }, [sttLabel, sttModel]);

  const llmContext = useMemo(() => {
    const providerId = llmProviderId || "";
    const provider =
      llmProviders?.find((candidate) => candidate.id === providerId) || null;
    const selectedModel = llmModels?.[providerId] || "";

    if (!provider) {
      return {
        label: t("footer.llmNotSet", { defaultValue: "Not set" }),
        providerId: null as string | null,
      };
    }
    if (provider.id === "apple_intelligence") {
      return {
        label: "Apple Intelligence",
        providerId: "apple_intelligence",
      };
    }

    const label =
      selectedModel || t("footer.modelNotSet", { defaultValue: "Not set" });
    const resolved = resolveModelProviderId(selectedModel, provider.id);
    return { label, providerId: resolved };
  }, [llmModels, llmProviderId, llmProviders, t]);

  const ttsContext = useMemo(() => {
    const modelId = selectedTtsModelId ?? selectedTtsProviderId ?? null;
    if (!modelId) {
      return {
        label: t("footer.ttsModelNotSet", { defaultValue: "Not set" }),
        providerId: null as string | null,
      };
    }
    const resolved = resolveModelProviderId(
      `${selectedTtsModelId ?? ""} ${selectedTtsProviderId ?? ""}`,
      selectedTtsProviderId ?? null,
    );
    return { label: modelId, providerId: resolved };
  }, [selectedTtsModelId, selectedTtsProviderId, t]);

  const ocrEngine: ScreenContextOcrEngine =
    (ocrEngineValue as ScreenContextOcrEngine | undefined) ??
    "native_then_backup";
  const ocrNeuralModelId =
    (ocrNeuralModelIdValue as string | null | undefined) ?? null;

  useEffect(() => {
    let isCurrent = true;

    if (!ocrNeuralModelId) {
      setOcrCatalogLabel(null);
      return () => {
        isCurrent = false;
      };
    }

    setOcrCatalogLabel(null);
    void commands
      .getOcrModelCatalog()
      .then((result) => {
        if (!isCurrent) return;
        if (result.status !== "ok") {
          setOcrCatalogLabel(ocrNeuralModelId);
          return;
        }
        const activeModel = result.data.models.find(
          (model) => model.id === ocrNeuralModelId,
        );
        setOcrCatalogLabel(activeModel?.title ?? ocrNeuralModelId);
      })
      .catch(() => {
        if (isCurrent) setOcrCatalogLabel(ocrNeuralModelId);
      });

    return () => {
      isCurrent = false;
    };
  }, [ocrNeuralModelId]);

  const analysisAsrModelId = analysisAsrModelIdValue ?? "";
  const analysisDiarizationModelId = analysisDiarizationModelIdValue ?? "";

  useEffect(() => {
    let isCurrent = true;
    setAnalysisLabel(null);

    void commands
      .getSpeechAnalysisCatalog()
      .then((result) => {
        if (!isCurrent) return;
        if (result.status !== "ok") {
          setAnalysisLabel(null);
          return;
        }
        const selectedAsr = result.data.models.find(
          (model) => model.id === result.data.selection.asr_model_id,
        );
        const selectedSpeaker = result.data.models.find(
          (model) => model.id === result.data.selection.diarization_model_id,
        );
        const asrLabel =
          selectedAsr?.label ||
          analysisAsrModelId ||
          t("footer.modelNotSet", { defaultValue: "Not set" });
        const speakerLabel =
          selectedSpeaker?.label ||
          analysisDiarizationModelId ||
          t("footer.modelNotSet", { defaultValue: "Not set" });
        setAnalysisLabel(`${speakerLabel} + ${asrLabel}`);
      })
      .catch(() => {
        if (isCurrent) setAnalysisLabel(null);
      });

    return () => {
      isCurrent = false;
    };
  }, [analysisAsrModelId, analysisDiarizationModelId, t]);

  const ocrLabel = useMemo(() => {
    if (ocrNeuralModelId) {
      return ocrCatalogLabel ?? ocrNeuralModelId;
    }

    switch (ocrEngine) {
      case "native_only":
        return t("modelHub.ocr.options.nativeOnly.title", {
          defaultValue: "System OCR",
        });
      case "backup_only":
        return t("modelHub.ocr.options.backupOnly.title", {
          defaultValue: "Cross-platform (Tesseract)",
        });
      case "auto":
        return t("modelHub.ocr.options.auto.title", {
          defaultValue: "Auto",
        });
      case "native_then_backup":
      default:
        return t("modelHub.ocr.options.nativeThenBackup.title", {
          defaultValue: "Smart (default)",
        });
    }
  }, [ocrCatalogLabel, ocrEngine, ocrNeuralModelId, t]);

  const hubTabLabel = (id: ModelHubTabId) => {
    const def = MODEL_HUB_TAB_DEFS.find((d) => d.id === id)!;
    return t(def.labelKey, { defaultValue: def.defaultLabel });
  };

  return (
    <div className="flex flex-col gap-2">
      <LauncherRow
        icon={
          sttProviderId ? (
            <ProviderIcon providerId={sttProviderId} size={sttIconSize} />
          ) : (
            <Mic className="h-4 w-4" strokeWidth={2} aria-hidden />
          )
        }
        iconBare={Boolean(sttProviderId)}
        iconBg="color-mix(in srgb, var(--accent) 16%, transparent)"
        iconColor="var(--accent)"
        label={hubTabLabel("stt")}
        value={sttLabel}
        variant={variant}
        onClick={() => void openModelHub("stt")}
      />
      <LauncherRow
        icon={<AudioLines className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--warning, #f59e0b) 16%, transparent)"
        iconColor="var(--warning, #f59e0b)"
        label={hubTabLabel("analysis")}
        value={
          analysisLabel ?? t("footer.modelNotSet", { defaultValue: "Not set" })
        }
        variant={variant}
        onClick={() => void openModelHub("analysis")}
      />
      <LauncherRow
        icon={
          llmContext.providerId ? (
            <ProviderIcon
              providerId={llmContext.providerId}
              size={otherIconSize}
            />
          ) : (
            <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
          )
        }
        iconBare={Boolean(llmContext.providerId)}
        iconBg="color-mix(in srgb, var(--voice) 16%, transparent)"
        iconColor="var(--voice)"
        label={hubTabLabel("llm")}
        value={llmContext.label}
        variant={variant}
        onClick={() => void openModelHub("llm")}
      />
      <LauncherRow
        icon={
          ttsContext.providerId ? (
            <ProviderIcon
              providerId={ttsContext.providerId}
              size={otherIconSize}
            />
          ) : (
            <Volume2 className="h-4 w-4" strokeWidth={2} aria-hidden />
          )
        }
        iconBare={Boolean(ttsContext.providerId)}
        iconBg="color-mix(in srgb, var(--success, #22c55e) 16%, transparent)"
        iconColor="var(--success, #22c55e)"
        label={hubTabLabel("tts")}
        value={ttsContext.label}
        variant={variant}
        onClick={() => void openModelHub("tts")}
      />
      <LauncherRow
        icon={<ScanText className="h-4 w-4" strokeWidth={2} aria-hidden />}
        iconBg="color-mix(in srgb, var(--info, #3b82f6) 16%, transparent)"
        iconColor="var(--info, #3b82f6)"
        label={hubTabLabel("ocr")}
        value={ocrLabel}
        variant={variant}
        onClick={() => void openModelHub("ocr")}
      />
    </div>
  );
};

export default SidebarModelLaunchers;
