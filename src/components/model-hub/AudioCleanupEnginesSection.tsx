import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AudioWaveform,
  CheckCircle2,
  Cpu,
  Gauge,
  HardDrive,
  Radio,
  Sparkles,
} from "lucide-react";

import HubModelCard, {
  type HubTrailing,
} from "@/components/model-hub/HubModelCard";
import ModelListControls from "@/components/model-hub/ModelListControls";
import type { ModelHubControlState } from "@/components/model-hub/modelHubControls";
import { buildHubDownloadState } from "@/components/model-hub/hubDownloadState";
import { EmptyState } from "@/components/ui/EmptyState";
import type { CompactBadgeItem } from "@/components/ui/CompactOverflow";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import {
  ENHANCE_MODELS,
  loadEnhanceModel,
  saveEnhanceModel,
  subscribeEnhanceModel,
  type EnhanceModelId,
  type EnhanceModelMeta,
} from "@/lib/enhanceModels";
import {
  DEFAULT_MODEL_SORT_OPTIONS,
  orderModelList,
  type ModelSortMode,
} from "@/lib/modelListOrdering";

interface AudioCleanupEnginesSectionProps {
  titleActionTargetId?: string;
  hubSearchQuery?: string;
  modelHubControls?: ModelHubControlState;
  hubFilterLabels?: boolean;
}

type DenoiseRuntimeStatus = { installed: boolean };
type DemucsRuntimeStatus = {
  runtime_installed: boolean;
  model_installed: boolean;
};
type AudioCleanupArtifactProgress = {
  domain: string;
  artifact_id: string;
  phase: string;
  downloaded_bytes: number;
  total_bytes: number;
  percentage: number;
  error?: string | null;
};

const DEMUCS_DOWNLOAD_DOMAIN = "audio_cleanup";
const DEMUCS_DOWNLOAD_ARTIFACT_ID = "demucs";

const progressCanCancel = (phase?: string | null): boolean =>
  !["complete", "failed", "cancelled", "cancelling"].includes(phase ?? "");

const demucsProgressLabel = (
  phase: string | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string => {
  switch (phase) {
    case "checking":
      return t("modelHub.audioCleanup.demucsChecking", {
        defaultValue: "Checking Demucs setup...",
      });
    case "downloading-runtime":
      return t("modelHub.audioCleanup.demucsDownloadingRuntime", {
        defaultValue: "Downloading Demucs Swift runtime...",
      });
    case "preparing-model":
      return t("modelHub.audioCleanup.demucsPreparingModel", {
        defaultValue: "Preparing Demucs model download...",
      });
    case "downloading-model":
      return t("modelHub.audioCleanup.demucsDownloadingModel", {
        defaultValue: "Downloading HTDemucs weights...",
      });
    case "installing-runtime":
    case "installing-model":
      return t("modelHub.audioCleanup.demucsInstalling", {
        defaultValue: "Installing Demucs...",
      });
    default:
      return t("modelHub.audioCleanup.demucsSettingUp", {
        defaultValue: "Setting up Demucs...",
      });
  }
};

const AudioCleanupEnginesSection: React.FC<AudioCleanupEnginesSectionProps> = ({
  titleActionTargetId,
  hubSearchQuery,
  modelHubControls,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<EnhanceModelId>(() =>
    loadEnhanceModel(),
  );
  const [localSortMode, setLocalSortMode] =
    useState<ModelSortMode>("best_match");
  // DeepFilterNet runs through an on-demand Python sidecar runtime.
  const [runtimeInstalled, setRuntimeInstalled] = useState<boolean | null>(
    null,
  );
  // Demucs has its own runtime (Swift binary + MLX weights), separate from the
  // DeepFilterNet Python runtime tracked by `runtimeInstalled`.
  const [demucsStatus, setDemucsStatus] = useState<DemucsRuntimeStatus | null>(
    null,
  );
  const [demucsProgress, setDemucsProgress] =
    useState<AudioCleanupArtifactProgress | null>(null);
  const [demucsInstalling, setDemucsInstalling] = useState(false);
  const [demucsCancelling, setDemucsCancelling] = useState(false);
  const [demucsInstallError, setDemucsInstallError] = useState<string | null>(
    null,
  );
  const [isInstalling, setIsInstalling] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // Keep selection in sync with the Enhance Audio panel (another window).
  useEffect(() => subscribeEnhanceModel(setSelected), []);

  const refreshRuntime = useCallback(async () => {
    try {
      const status = await invoke<DenoiseRuntimeStatus>(
        "denoise_runtime_status",
      );
      setRuntimeInstalled(status.installed);
    } catch {
      setRuntimeInstalled(false);
    }
    try {
      const demucs = await invoke<DemucsRuntimeStatus>("demucs_runtime_status");
      setDemucsStatus(demucs);
    } catch {
      setDemucsStatus({ runtime_installed: false, model_installed: false });
    }
  }, []);

  const demucsReady =
    demucsStatus?.runtime_installed === true &&
    demucsStatus?.model_installed === true;

  // Demucs is ready only when both its Swift runtime and MLX weights are
  // present; DeepFilterNet uses the shared Python denoise runtime.
  const modelRuntimeReady = useCallback(
    (model: EnhanceModelMeta) => {
      if (model.builtin) return true;
      if (model.id === "demucs") return demucsReady;
      return runtimeInstalled === true;
    },
    [demucsReady, runtimeInstalled],
  );

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  useTauriEvent("external-model-storage-changed", () => {
    void refreshRuntime();
  });

  useTauriEvent<AudioCleanupArtifactProgress>(
    "artifact-download-progress",
    (event) => {
      const progress = event.payload;
      if (
        progress.domain !== DEMUCS_DOWNLOAD_DOMAIN ||
        progress.artifact_id !== DEMUCS_DOWNLOAD_ARTIFACT_ID
      ) {
        return;
      }
      setDemucsProgress(progress);
      if (
        progress.phase === "complete" ||
        progress.phase === "failed" ||
        progress.phase === "cancelled"
      ) {
        setDemucsInstalling(false);
        setDemucsCancelling(false);
        void refreshRuntime();
      }
      if (progress.phase === "failed" && progress.error) {
        setDemucsInstallError(progress.error);
      }
    },
  );

  const selectModel = useCallback((id: EnhanceModelId) => {
    saveEnhanceModel(id);
    setSelected(id);
  }, []);

  const installRuntime = useCallback(async () => {
    if (isInstalling) return;
    setIsInstalling(true);
    setIsCancelling(false);
    setInstallError(null);
    try {
      await invoke("prepare_denoise_runtime");
      setRuntimeInstalled(true);
      // Auto-select DeepFilterNet once it is ready to use.
      selectModel("deepfilternet");
    } catch (err) {
      const message =
        typeof err === "string"
          ? err
          : t("modelHub.audioCleanup.installFailed", {
              defaultValue: "Failed to set up the DeepFilterNet runtime.",
            });
      if (!message.toLowerCase().includes("cancel")) {
        setInstallError(message);
      }
      setRuntimeInstalled(false);
    } finally {
      setIsInstalling(false);
      setIsCancelling(false);
      void refreshRuntime();
    }
  }, [isInstalling, refreshRuntime, selectModel, t]);

  const installDemucs = useCallback(async () => {
    if (demucsInstalling) return;
    setDemucsInstalling(true);
    setDemucsCancelling(false);
    setDemucsInstallError(null);
    setDemucsProgress({
      domain: DEMUCS_DOWNLOAD_DOMAIN,
      artifact_id: DEMUCS_DOWNLOAD_ARTIFACT_ID,
      phase: "preparing",
      downloaded_bytes: 0,
      total_bytes: 0,
      percentage: 0,
    });
    try {
      const status = await invoke<DemucsRuntimeStatus>(
        "prepare_demucs_runtime",
      );
      setDemucsStatus(status);
      setDemucsProgress({
        domain: DEMUCS_DOWNLOAD_DOMAIN,
        artifact_id: DEMUCS_DOWNLOAD_ARTIFACT_ID,
        phase: "complete",
        downloaded_bytes: 100,
        total_bytes: 100,
        percentage: 100,
      });
      if (status.runtime_installed && status.model_installed) {
        selectModel("demucs");
      }
    } catch (err) {
      const message =
        typeof err === "string"
          ? err
          : t("modelHub.audioCleanup.demucsInstallFailed", {
              defaultValue: "Failed to set up Demucs.",
            });
      const cancelled = message.toLowerCase().includes("cancel");
      setDemucsProgress({
        domain: DEMUCS_DOWNLOAD_DOMAIN,
        artifact_id: DEMUCS_DOWNLOAD_ARTIFACT_ID,
        phase: cancelled ? "cancelled" : "failed",
        downloaded_bytes: 0,
        total_bytes: 0,
        percentage: 0,
        error: message,
      });
      if (!cancelled) {
        setDemucsInstallError(message);
      }
    } finally {
      setDemucsInstalling(false);
      setDemucsCancelling(false);
      void refreshRuntime();
    }
  }, [demucsInstalling, refreshRuntime, selectModel, t]);

  const cancelRuntimeSetup = useCallback(async () => {
    if (!isInstalling || isCancelling) return;
    setIsCancelling(true);
    try {
      await invoke("cancel_denoise_runtime_setup");
    } catch (err) {
      setIsCancelling(false);
      setInstallError(
        typeof err === "string"
          ? err
          : t("modelHub.audioCleanup.cancelFailed", {
              defaultValue: "Could not cancel DeepFilterNet setup.",
            }),
      );
    }
  }, [isCancelling, isInstalling, t]);

  const cancelDemucsSetup = useCallback(async () => {
    if (!demucsInstalling || demucsCancelling) return;
    setDemucsCancelling(true);
    try {
      await invoke("cancel_artifact_download", {
        domain: DEMUCS_DOWNLOAD_DOMAIN,
        artifactId: DEMUCS_DOWNLOAD_ARTIFACT_ID,
      });
    } catch (err) {
      setDemucsCancelling(false);
      setDemucsInstallError(
        typeof err === "string"
          ? err
          : t("modelHub.audioCleanup.demucsCancelFailed", {
              defaultValue: "Could not cancel Demucs setup.",
            }),
      );
    }
  }, [demucsCancelling, demucsInstalling, t]);

  const query = (hubSearchQuery ?? "").trim().toLowerCase();
  const sortMode = modelHubControls?.sortMode ?? localSortMode;
  const setSortMode = modelHubControls?.setSortMode ?? setLocalSortMode;
  const headerActionPortal = usePortalTarget(titleActionTargetId ?? null);
  const sortOptions = useMemo(() => DEFAULT_MODEL_SORT_OPTIONS, []);
  const selectedSortLabel =
    sortOptions.find((option) => option.value === sortMode)?.label ??
    "Best Match";

  const visibleModels = useMemo(() => {
    if (!query) return ENHANCE_MODELS;
    return ENHANCE_MODELS.filter((model) =>
      [
        t(model.nameKey, { defaultValue: model.nameDefault }),
        t(model.descKey, { defaultValue: model.descDefault }),
        model.id,
        model.providerId,
        model.builtin ? "built-in bundled" : "neural setup download",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [query, t]);

  const accessors = useMemo(
    () => ({
      label: (model: EnhanceModelMeta) =>
        t(model.nameKey, { defaultValue: model.nameDefault }),
      active: (model: EnhanceModelMeta) => model.id === selected,
      installed: (model: EnhanceModelMeta) => modelRuntimeReady(model),
      runnable: (model: EnhanceModelMeta) => modelRuntimeReady(model),
      inProgress: (model: EnhanceModelMeta) =>
        model.id === "deepfilternet"
          ? isInstalling || runtimeInstalled === null
          : model.id === "demucs"
            ? demucsInstalling || demucsStatus === null
            : false,
      recommended: (model: EnhanceModelMeta) => model.id === "rnnoise",
      providerRank: (model: EnhanceModelMeta) =>
        model.id === "rnnoise" ? 0 : model.id === "spectral" ? 1 : 2,
    }),
    [
      demucsInstalling,
      demucsStatus,
      isInstalling,
      modelRuntimeReady,
      runtimeInstalled,
      selected,
      t,
    ],
  );

  const readyModels = useMemo(
    () =>
      orderModelList(
        visibleModels.filter((model) => modelRuntimeReady(model)),
        "downloaded",
        sortMode,
        accessors,
      ),
    [accessors, modelRuntimeReady, sortMode, visibleModels],
  );

  const downloadableModels = useMemo(
    () =>
      orderModelList(
        visibleModels.filter(
          (model) => model.needsRuntime && !modelRuntimeReady(model),
        ),
        "available",
        sortMode,
        accessors,
      ),
    [accessors, modelRuntimeReady, sortMode, visibleModels],
  );

  const filterAction = (
    <ModelListControls
      sort={{
        value: sortMode,
        options: sortOptions,
        onChange: setSortMode,
        label: selectedSortLabel,
      }}
    />
  );

  const capabilityChipsFor = useCallback(
    (id: EnhanceModelId): CompactBadgeItem[] => {
      const local: CompactBadgeItem = {
        id: "local",
        label: t("modelHub.audioCleanup.chips.local", {
          defaultValue: "On-device",
        }),
        variant: "secondary",
        icon: <Cpu className="h-3 w-3" aria-hidden />,
      };
      if (id === "rnnoise") {
        return [
          local,
          {
            id: "realtime",
            label: t("modelHub.audioCleanup.chips.realtime", {
              defaultValue: "Real-time",
            }),
            variant: "secondary",
            icon: <Radio className="h-3 w-3" aria-hidden />,
          },
          {
            id: "neural",
            label: t("modelHub.audioCleanup.chips.neural", {
              defaultValue: "Neural",
            }),
            variant: "secondary",
            icon: <Activity className="h-3 w-3" aria-hidden />,
          },
        ];
      }
      if (id === "spectral") {
        return [
          local,
          {
            id: "offline",
            label: t("modelHub.audioCleanup.chips.offline", {
              defaultValue: "Whole-file",
            }),
            variant: "secondary",
            icon: <AudioWaveform className="h-3 w-3" aria-hidden />,
          },
          {
            id: "adjustable",
            label: t("modelHub.audioCleanup.chips.adjustable", {
              defaultValue: "Adjustable",
            }),
            variant: "secondary",
            icon: <Gauge className="h-3 w-3" aria-hidden />,
          },
        ];
      }
      if (id === "demucs") {
        return [
          local,
          {
            id: "vocal-stem",
            label: t("modelHub.audioCleanup.chips.vocalStem", {
              defaultValue: "Vocal stem",
            }),
            variant: "secondary",
            icon: <AudioWaveform className="h-3 w-3" aria-hidden />,
          },
          {
            id: "apple-silicon",
            label: t("modelHub.audioCleanup.chips.appleSilicon", {
              defaultValue: "Apple Silicon",
            }),
            variant: "secondary",
            icon: <Cpu className="h-3 w-3" aria-hidden />,
          },
        ];
      }
      return [
        local,
        {
          id: "fullband",
          label: t("modelHub.audioCleanup.chips.fullBand", {
            defaultValue: "Full-band 48 kHz",
          }),
          variant: "secondary",
          icon: <AudioWaveform className="h-3 w-3" aria-hidden />,
        },
        {
          id: "sota",
          label: t("modelHub.audioCleanup.chips.sota", {
            defaultValue: "State-of-the-art",
          }),
          variant: "secondary",
          icon: <Sparkles className="h-3 w-3" aria-hidden />,
        },
      ];
    },
    [t],
  );

  const renderModelCard = (model: EnhanceModelMeta) => {
    const isActive = model.id === selected;
    const isDeepFilter = model.id === "deepfilternet";
    const isDemucs = model.id === "demucs";
    const modelReady = modelRuntimeReady(model);
    const needsSetup =
      (isDeepFilter && runtimeInstalled === false) ||
      (isDemucs && demucsStatus !== null && !modelReady);
    const isChecking =
      (isDeepFilter && runtimeInstalled === null) ||
      (isDemucs && demucsStatus === null);
    const modelInstalling = isDemucs ? demucsInstalling : isInstalling;
    const modelCancelling = isDemucs ? demucsCancelling : isCancelling;

    const headerBadges: CompactBadgeItem[] = [
      isActive
        ? {
            id: "active",
            label: t("listen.engineLibrary.badges.active", {
              defaultValue: "Active",
            }),
            variant: "primary" as const,
            icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
            detail: t("modelHub.audioCleanup.activeDetail", {
              defaultValue: "Used by Enhance Audio for noise removal.",
            }),
          }
        : null,
      model.builtin
        ? {
            id: "builtin",
            label: t("modelHub.audioCleanup.badges.builtin", {
              defaultValue: "Built-in",
            }),
            variant: "secondary" as const,
            icon: <HardDrive className="h-3.5 w-3.5" aria-hidden />,
            detail: t("modelHub.audioCleanup.badges.builtinDetail", {
              defaultValue: "Ships with Vox Jot — no download required.",
            }),
          }
        : null,
    ].filter(Boolean) as CompactBadgeItem[];

    const downloadState = isDemucs
      ? buildHubDownloadState({
          t,
          progress: demucsProgress,
          localBusy: demucsInstalling || isChecking,
          localError: demucsInstallError,
          activeLabel: demucsCancelling
            ? t("modelHub.audioCleanup.demucsCancelling", {
                defaultValue: "Cancelling Demucs setup...",
              })
            : demucsProgressLabel(
                isChecking ? "checking" : demucsProgress?.phase,
                t,
              ),
          progressPct: demucsProgress?.percentage ?? null,
          indeterminate: (demucsProgress?.total_bytes ?? 0) <= 0,
          cancelling: demucsCancelling,
          onCancel:
            demucsInstalling && progressCanCancel(demucsProgress?.phase)
              ? () => void cancelDemucsSetup()
              : undefined,
          cancelLabel: t("modelHub.audioCleanup.cancelDemucsSetup", {
            defaultValue: "Cancel Demucs setup",
          }),
          onRetry: () => void installDemucs(),
          onDismiss: () => {
            setDemucsInstallError(null);
            setDemucsProgress(null);
          },
        })
      : buildHubDownloadState({
          t,
          localBusy: isDeepFilter && (isInstalling || isChecking),
          localError: isDeepFilter ? installError : null,
          activeLabel: isChecking
            ? t("modelHub.audioCleanup.checking", {
                defaultValue: "Checking DeepFilterNet setup…",
              })
            : isCancelling
              ? t("modelHub.audioCleanup.cancelling", {
                  defaultValue: "Cancelling DeepFilterNet setup…",
                })
              : t("modelHub.audioCleanup.installing", {
                  defaultValue: "Setting up DeepFilterNet… (one-time)",
                }),
          indeterminate: true,
          cancelling: isCancelling,
          onCancel:
            isDeepFilter && isInstalling
              ? () => void cancelRuntimeSetup()
              : undefined,
          cancelLabel: t("modelHub.audioCleanup.cancelSetup", {
            defaultValue: "Cancel DeepFilterNet setup",
          }),
          onRetry: () => void installRuntime(),
          onDismiss: () => setInstallError(null),
        });

    let trailing: HubTrailing | undefined;
    if (needsSetup && !modelInstalling && !modelCancelling) {
      trailing = {
        kind: "acquire",
        onClick: () => void (isDemucs ? installDemucs() : installRuntime()),
        sizeLabel: isDemucs
          ? t("modelHub.audioCleanup.demucsDownloadSize", {
              defaultValue: "~240 MB runtime + weights",
            })
          : t("modelHub.audioCleanup.downloadSize", {
              defaultValue: "PyTorch + model",
            }),
        label: isDemucs
          ? t("modelHub.audioCleanup.setUpDemucs", {
              defaultValue: "Set up Demucs",
            })
          : t("modelHub.audioCleanup.setUp", {
              defaultValue: "Set up DeepFilterNet",
            }),
      };
    }

    const footerMetaItems = model.builtin
      ? [
          t("modelHub.audioCleanup.meta.bundled", {
            defaultValue: "Bundled with Vox Jot",
          }),
        ]
      : [
          model.id === "demucs"
            ? t("modelHub.audioCleanup.meta.demucsRuntime", {
                defaultValue: "MLX Swift runtime · downloads on setup",
              })
            : t("modelHub.audioCleanup.meta.sidecar", {
                defaultValue: "Local Python runtime · downloads on first use",
              }),
        ];

    const onClick = (() => {
      if (isChecking || modelInstalling || modelCancelling) return undefined;
      if (needsSetup)
        return () => void (isDemucs ? installDemucs() : installRuntime());
      if (!modelReady) return undefined;
      if (!isActive) return () => selectModel(model.id);
      return undefined;
    })();

    return (
      <HubModelCard
        key={model.id}
        title={t(model.nameKey, { defaultValue: model.nameDefault })}
        providerId={model.providerId}
        subline={
          model.builtin
            ? t("modelHub.audioCleanup.sublineBuiltin", {
                defaultValue: "Built-in · No download",
              })
            : t("modelHub.audioCleanup.sublineSidecar", {
                defaultValue: "Neural · One-time setup",
              })
        }
        headerBadges={headerBadges}
        description={t(model.descKey, {
          defaultValue: model.descDefault,
        })}
        capabilityChips={capabilityChipsFor(model.id)}
        footerMetaItems={footerMetaItems}
        footerMetaIcon={<HardDrive className="h-3.5 w-3.5" aria-hidden />}
        active={isActive}
        trailing={trailing}
        downloadState={downloadState}
        onClick={onClick}
      />
    );
  };

  const sections = [
    {
      title: "",
      models: readyModels,
      showHeader: false,
    },
    {
      title: t("modelHub.sections.available", {
        defaultValue: "Available to Download",
      }),
      models: downloadableModels,
      showHeader: true,
    },
  ].filter((section) => section.models.length > 0);

  return (
    <section className="space-y-4">
      {headerActionPortal
        ? createPortal(filterAction, headerActionPortal)
        : null}
      {!headerActionPortal ? (
        <div className="flex flex-wrap justify-end gap-3">{filterAction}</div>
      ) : null}

      {sections.length > 0 ? (
        <div className="space-y-5">
          {sections.map((section) => (
            <div
              key={section.showHeader ? section.title : "ready"}
              className="space-y-3"
            >
              {section.showHeader ? (
                <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text)]">
                  {section.title}
                </h3>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-2">
                {section.models.map(renderModelCard)}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {visibleModels.length === 0 ? (
        <EmptyState
          title={t("modelHub.audioCleanup.empty.title", {
            defaultValue: "No cleanup engines match the search.",
          })}
          description={t("modelHub.audioCleanup.empty.description", {
            defaultValue: "Clear the search field to show all engines.",
          })}
        />
      ) : null}
    </section>
  );
};

export default AudioCleanupEnginesSection;
