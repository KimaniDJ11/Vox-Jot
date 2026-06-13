import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";

import {
  FileAudio,
  FolderOpen,
  Layers,
  Loader2,
  Mic,
  Search,
  Sparkles,
  Square,
  Upload,
  X,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { commands } from "@/bindings";
import ModelListControls from "@/components/model-hub/ModelListControls";
import { downloadingModelFilesLabel } from "@/components/model-hub/downloadStatusLabels";
import {
  buildHubDownloadState,
  isDownloadActive,
  isDownloadCancelled,
  isDownloadFailed,
} from "@/components/model-hub/hubDownloadState";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import Badge from "@/components/ui/Badge";
import {
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";

import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { modal } from "@/motion/springs";

import {
  createTtsVoiceProfile,
  clearProfileCollectedData,
  importTtsVoiceProfileSample,
  setActiveImprovementProfile,
} from "@/lib/ttsVoiceProfiles";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import { LANGUAGES } from "@/lib/constants/languages";
import {
  DEFAULT_MODEL_SORT_OPTIONS,
  orderModelList,
  TEST_SCORE_MODEL_SORT_OPTION,
  type ModelSortMode,
} from "@/lib/modelListOrdering";
import { getTtsEvaluationResult } from "@/lib/ttsEvaluationResults";
import type { ListenSpeechState } from "../useListenSpeechState";
import {
  speechLibraryCardClassName,
  whiteWorkflowCardClassName,
} from "../styles";
import {
  basename,
  cloneModelSelectionValue,
  getModelLanguageItems,
  huggingFaceRepoIdFromSourceUrl,
  isDraftVoiceModelAvailable,
  profileSupportsModel,
  ttsModelSupportsLanguage,
} from "../utils";
import { voiceAvatarGradient } from "../createVoiceVoiceHub";
import { readVoiceCloningDraft, writeVoiceCloningDraft } from "../draftStorage";
import {
  DraftVoiceModelLibraryCard,
  SelectField,
  WorkflowField,
} from "../sharedComponents";

interface TtsHfDownloadProgress {
  repo_id: string;
  stage: string;
  file?: string | null;
  file_index?: number | null;
  file_count?: number | null;
  downloaded_bytes?: number | null;
  total_bytes?: number | null;
  error?: string | null;
}

function errorToMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

export const VoiceCloningSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const initialDraft = useMemo(readVoiceCloningDraft, []);
  const [selectedCloneModelValue, setSelectedCloneModelValue] = useState(
    initialDraft.selectedCloneModelValue,
  );
  const [modelWindowOpen, setModelWindowOpen] = useState(false);
  const [profileDetailsWindowOpen, setProfileDetailsWindowOpen] =
    useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const [modelSearchQuery, setModelSearchQuery] = useState(
    initialDraft.modelSearchQuery,
  );
  const [modelProviderFilter, setModelProviderFilter] = useState("all");
  const [modelLanguageFilter, setModelLanguageFilter] = useState("all");
  const [modelSortMode, setModelSortMode] =
    useState<ModelSortMode>("best_match");
  const [referenceAudioPathDraft, setReferenceAudioPathDraft] = useState(
    initialDraft.referenceAudioPathDraft,
  );
  const [referenceTranscriptDraft, setReferenceTranscriptDraft] = useState(
    initialDraft.referenceTranscriptDraft,
  );
  const [isReferenceAudioDragOver, setIsReferenceAudioDragOver] =
    useState(false);
  const availableCloneModels = useMemo(
    () => speech.cloneCapableModels.filter(isDraftVoiceModelAvailable),
    [speech.cloneCapableModels],
  );
  const selectedCloneModel =
    availableCloneModels.find(
      (model) => cloneModelSelectionValue(model) === selectedCloneModelValue,
    ) ?? null;
  const selectedCloneModelProviderLabel =
    speech.allProviders.find(
      (provider) => provider.id === selectedCloneModel?.provider_id,
    )?.label ?? null;
  const selectedCloneModelDisplayName =
    selectedCloneModel?.label ??
    t("listen.voiceCloning.workflow.needsModel", {
      defaultValue: "Choose a clone-capable model",
    });
  const selectedCloneModelDetail = [
    selectedCloneModelProviderLabel,
    selectedCloneModel?.runtime.label,
  ]
    .filter(Boolean)
    .join(" · ");
  const selectedCloneModelIconId = selectedCloneModel
    ? resolveModelProviderId(
        `${selectedCloneModel.label} ${selectedCloneModel.id}`,
        selectedCloneModel.provider_id,
      )
    : null;
  const [selectedProfileId, setSelectedProfileId] = useState(
    initialDraft.selectedProfileId,
  );
  const visibleProfiles = selectedCloneModel
    ? speech.profiles.filter((profile) =>
        profileSupportsModel(profile, selectedCloneModel),
      )
    : speech.profiles;
  const [profileNameDraft, setProfileNameDraft] = useState(
    initialDraft.profileNameDraft,
  );
  const [profileDescriptionDraft, setProfileDescriptionDraft] = useState(
    initialDraft.profileDescriptionDraft,
  );
  const [ttsDownloadProgress, setTtsDownloadProgress] = useState<
    Record<string, TtsHfDownloadProgress>
  >({});
  const [locallyDownloadingModelIds, setLocallyDownloadingModelIds] = useState<
    Record<string, true>
  >({});
  const [localDownloadErrors, setLocalDownloadErrors] = useState<
    Record<string, string>
  >({});
  const [cancellingDownloadModelIds, setCancellingDownloadModelIds] = useState<
    Record<string, true>
  >({});
  const [confirmingClearProfileId, setConfirmingClearProfileId] = useState<
    string | null
  >(null);

  useEffect(() => {
    writeVoiceCloningDraft({
      selectedCloneModelValue,
      selectedProfileId,
      modelSearchQuery,
      referenceAudioPathDraft,
      referenceTranscriptDraft,
      profileNameDraft,
      profileDescriptionDraft,
    });
  }, [
    modelSearchQuery,
    profileDescriptionDraft,
    profileNameDraft,
    referenceAudioPathDraft,
    referenceTranscriptDraft,
    selectedCloneModelValue,
    selectedProfileId,
  ]);

  useEffect(() => {
    const activeCloneModel =
      speech.activeModel?.capabilities.supports_voice_cloning &&
      isDraftVoiceModelAvailable(speech.activeModel)
        ? speech.activeModel
        : null;
    const fallbackCloneModel =
      activeCloneModel ?? availableCloneModels[0] ?? null;

    setSelectedCloneModelValue((current) => {
      if (
        current !== "__none__" &&
        availableCloneModels.some(
          (model) => cloneModelSelectionValue(model) === current,
        )
      ) {
        return current;
      }
      return cloneModelSelectionValue(fallbackCloneModel);
    });
  }, [availableCloneModels, speech.activeModel]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<TtsHfDownloadProgress>(
        "tts-hf-download-progress",
        (event) => {
          const progress = event.payload;
          if (!progress.repo_id) return;
          const matchingModel = speech.cloneCapableModels.find(
            (model) =>
              model.id === progress.repo_id ||
              huggingFaceRepoIdFromSourceUrl(model.source_url) ===
                progress.repo_id,
          );
          if (!matchingModel) return;

          if (progress.stage === "complete") {
            setTtsDownloadProgress((current) => {
              const next = { ...current };
              delete next[progress.repo_id];
              delete next[matchingModel.id];
              return next;
            });
            setLocallyDownloadingModelIds((current) => {
              const next = { ...current };
              delete next[matchingModel.id];
              return next;
            });
            setLocalDownloadErrors((current) => {
              const next = { ...current };
              delete next[matchingModel.id];
              return next;
            });
            void speech.refreshAll?.();
            return;
          }

          setTtsDownloadProgress((current) => ({
            ...current,
            [progress.repo_id]: progress,
            [matchingModel.id]: progress,
          }));
          if (progress.stage === "failed") {
            setLocallyDownloadingModelIds((current) => {
              const next = { ...current };
              delete next[matchingModel.id];
              return next;
            });
            if (progress.error) {
              setLocalDownloadErrors((current) => ({
                ...current,
                [matchingModel.id]: progress.error ?? "",
              }));
            }
          }
        },
      );
    })();
    return () => unlisten?.();
  }, [speech]);

  useEffect(() => {
    setSelectedProfileId((current) => {
      if (current === "__none__") {
        return "__none__";
      }
      if (
        current !== "__none__" &&
        visibleProfiles.some((profile) => profile.id === current)
      ) {
        return current;
      }
      return visibleProfiles[0]?.id ?? "__none__";
    });
  }, [visibleProfiles]);

  const acceptReferenceAudioPath = useCallback(
    (path: string) => {
      if (path.split(".").pop()?.toLowerCase() !== "wav") {
        speech.setStatusMessage(
          "Voice cloning currently requires a WAV reference file.",
        );
        return;
      }
      setReferenceAudioPathDraft(path);
      setProfileDetailsWindowOpen(true);
      speech.setStatusMessage(null);
    },
    [speech],
  );

  const pickReferenceAudio = useCallback(async () => {
    const filePath = await open({
      multiple: false,
      filters: [{ name: "WAV audio", extensions: ["wav"] }],
    });
    if (!filePath || Array.isArray(filePath)) return;
    acceptReferenceAudioPath(filePath);
  }, [acceptReferenceAudioPath]);

  useEffect(() => {
    if (modelWindowOpen) {
      setIsReferenceAudioDragOver(false);
      return;
    }

    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsReferenceAudioDragOver(true);
          return;
        }
        if (payload.type === "leave") {
          setIsReferenceAudioDragOver(false);
          return;
        }
        if (payload.type === "drop") {
          setIsReferenceAudioDragOver(false);
          const first = payload.paths?.[0];
          if (!first) return;
          acceptReferenceAudioPath(first);
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [acceptReferenceAudioPath, modelWindowOpen]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        void commands.convoStopAudioCapture();
      }
    };
  }, []);

  const startMicCapture = useCallback(async () => {
    if (isRecording) return;
    try {
      setReferenceAudioPathDraft("");
      speech.setStatusMessage(
        t("listen.voiceCloning.listening", {
          defaultValue: "Listening… tap stop when you are done speaking.",
        }),
      );
      const result = await commands.convoStartAudioCapture();
      if (result.status === "error") {
        throw new Error(result.error);
      }
      setIsRecording(true);
    } catch (error) {
      speech.setStatusMessage(
        error instanceof Error
          ? error.message
          : "Could not start microphone recording.",
      );
    }
  }, [isRecording, speech, t]);

  const stopMicCapture = useCallback(async () => {
    if (!isRecording) return;
    setIsRecording(false);
    speech.setStatusMessage(
      t("listen.voiceCloning.savingRecording", {
        defaultValue: "Saving recording…",
      }),
    );
    try {
      const captureResult = await commands.convoStopAudioCapture();
      if (captureResult.status === "error") {
        throw new Error(captureResult.error);
      }
      if (captureResult.data.length === 0) {
        speech.setStatusMessage("No microphone audio was captured.");
        return;
      }
      let filePath = await save({
        defaultPath: "voice-clone-reference.wav",
        filters: [{ name: "WAV audio", extensions: ["wav"] }],
      });
      if (!filePath) {
        speech.setStatusMessage(null);
        return;
      }
      // macOS save dialog doesn't always append the extension.
      if (!filePath.toLowerCase().endsWith(".wav")) {
        filePath += ".wav";
      }
      const saveResult = await commands.convoSaveAudioCapture(
        filePath,
        captureResult.data,
      );
      if (saveResult.status === "error") {
        throw new Error(saveResult.error);
      }
      setReferenceAudioPathDraft(saveResult.data);
      setProfileDetailsWindowOpen(true);
      speech.setStatusMessage(
        t("listen.voiceCloning.recordingSaved", {
          defaultValue: "Recording saved. Ready to generate.",
        }),
      );
    } catch (error) {
      speech.setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to save microphone recording.",
      );
    }
  }, [isRecording, speech, t]);

  const toggleMicCapture = useCallback(async () => {
    if (isRecording) {
      await stopMicCapture();
    } else {
      await startMicCapture();
    }
  }, [isRecording, startMicCapture, stopMicCapture]);

  const createPresetDisabled =
    !speech.ttsEnabled ||
    !selectedCloneModel ||
    !referenceAudioPathDraft ||
    !profileNameDraft.trim() ||
    isRecording ||
    speech.busyProfileAction === "generate";
  const referenceAudioStatusLabel = referenceAudioPathDraft
    ? t("listen.voiceCloning.referenceReadyShort", {
        defaultValue: "Reference ready",
      })
    : t("listen.voiceCloning.needsReferenceShort", {
        defaultValue: "Add reference",
      });
  const referenceAudioStatusDetail = referenceAudioPathDraft
    ? basename(referenceAudioPathDraft)
    : t("listen.voiceCloning.workflow.needsReference", {
        defaultValue: "Record or choose a WAV",
      });
  const normalizedModelSearch = modelSearchQuery.trim().toLowerCase();
  const modelProviderOptions = useMemo(
    () => [
      { value: "all", label: "Provider" },
      ...speech.allProviders.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ],
    [speech.allProviders],
  );
  const selectedModelProviderLabel = useMemo(
    () =>
      modelProviderOptions.find(
        (option) => option.value === modelProviderFilter,
      )?.label ?? "Provider",
    [modelProviderFilter, modelProviderOptions],
  );
  const modelLanguageOptions = useMemo(
    () => [
      { value: "all", label: "Language" },
      ...LANGUAGES.filter((language) => language.value !== "auto").map(
        (language) => ({
          value: language.value,
          label: language.label,
        }),
      ),
    ],
    [],
  );
  const selectedModelLanguageLabel = useMemo(
    () =>
      modelLanguageOptions.find(
        (option) => option.value === modelLanguageFilter,
      )?.label ?? "Language",
    [modelLanguageFilter, modelLanguageOptions],
  );
  const modelSortOptions = useMemo(
    () => [...DEFAULT_MODEL_SORT_OPTIONS, TEST_SCORE_MODEL_SORT_OPTION],
    [],
  );
  const selectedModelSortLabel = useMemo(
    () =>
      modelSortOptions.find((option) => option.value === modelSortMode)
        ?.label ?? "Best Match",
    [modelSortMode, modelSortOptions],
  );
  const modelProviderRankById = useMemo(
    () =>
      new Map(
        speech.allProviders.map((provider, index) => [provider.id, index]),
      ),
    [speech.allProviders],
  );
  const clearTtsDownloadProgress = useCallback(
    (model: CatalogModelDescriptor) => {
      const repoId =
        huggingFaceRepoIdFromSourceUrl(model.source_url) ?? model.id;
      setTtsDownloadProgress((current) => {
        const next = { ...current };
        delete next[model.id];
        delete next[repoId];
        return next;
      });
      setLocalDownloadErrors((current) => {
        const next = { ...current };
        delete next[model.id];
        return next;
      });
    },
    [],
  );

  const handleDownloadOrSelectCloneModel = useCallback(
    async (model: CatalogModelDescriptor) => {
      if (isDraftVoiceModelAvailable(model)) {
        setSelectedCloneModelValue(cloneModelSelectionValue(model));
        setModelWindowOpen(false);
        speech.setStatusMessage(null);
        return;
      }
      if (!model.downloadable || model.installed) return;
      const progress = ttsDownloadProgress[model.id];
      if (isDownloadActive(progress, locallyDownloadingModelIds[model.id])) {
        return;
      }

      clearTtsDownloadProgress(model);
      setLocallyDownloadingModelIds((current) => ({
        ...current,
        [model.id]: true,
      }));
      speech.setStatusMessage(
        t("listen.voiceCloning.modelDownloadStarting", {
          defaultValue: "Starting {{modelLabel}} download.",
          modelLabel: model.label,
        }),
      );

      let downloadStarted = false;
      try {
        const result = await commands.downloadTtsPack(model.id);
        if (result.status === "error") {
          throw new Error(result.error);
        }
        downloadStarted = true;
      } catch (error) {
        const message = errorToMessage(
          error,
          t("listen.voiceCloning.modelDownloadFailed", {
            defaultValue: "Model download failed.",
          }),
        );
        setLocalDownloadErrors((current) => ({
          ...current,
          [model.id]: message,
        }));
        speech.setStatusMessage(message);
      } finally {
        if (!downloadStarted) {
          setLocallyDownloadingModelIds((current) => {
            const next = { ...current };
            delete next[model.id];
            return next;
          });
        }
      }
    },
    [
      clearTtsDownloadProgress,
      locallyDownloadingModelIds,
      speech,
      t,
      ttsDownloadProgress,
    ],
  );

  const cancelTtsModelDownload = useCallback(
    async (model: CatalogModelDescriptor) => {
      setCancellingDownloadModelIds((current) => ({
        ...current,
        [model.id]: true,
      }));
      try {
        const result = await commands.cancelArtifactDownload("tts", model.id);
        if (result.status === "error") {
          speech.setStatusMessage(result.error);
        }
      } finally {
        setCancellingDownloadModelIds((current) => {
          const next = { ...current };
          delete next[model.id];
          return next;
        });
      }
    },
    [speech],
  );

  const filteredCloneModels = speech.cloneCapableModels.filter((model) => {
    if (
      modelProviderFilter !== "all" &&
      model.provider_id !== modelProviderFilter
    ) {
      return false;
    }
    if (
      modelLanguageFilter !== "all" &&
      !ttsModelSupportsLanguage(model, modelLanguageFilter)
    ) {
      return false;
    }
    if (!normalizedModelSearch) return true;
    const providerLabel =
      speech.allProviders.find((provider) => provider.id === model.provider_id)
        ?.label ?? "";
    const haystack = [
      model.label,
      model.id,
      model.description,
      providerLabel,
      model.runtime.label,
      model.source_label,
      model.locale,
      ...getModelLanguageItems(model),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedModelSearch);
  });
  const downloadedCloneModels = orderModelList(
    filteredCloneModels.filter((model) => model.installed),
    "downloaded",
    modelSortMode,
    {
      label: (model: CatalogModelDescriptor) => model.label,
      active: (model: CatalogModelDescriptor) =>
        isDraftVoiceModelAvailable(model) &&
        cloneModelSelectionValue(model) === selectedCloneModelValue,
      installed: (model: CatalogModelDescriptor) => model.installed,
      runnable: (model: CatalogModelDescriptor) => model.runnable,
      inProgress: (model: CatalogModelDescriptor) =>
        isDownloadActive(
          ttsDownloadProgress[model.id],
          locallyDownloadingModelIds[model.id],
        ),
      recommended: (model: CatalogModelDescriptor) =>
        model.capabilities.supports_voice_cloning,
      rank: (model: CatalogModelDescriptor) =>
        getTtsEvaluationResult(model.id)?.rank,
      latencyMs: (model: CatalogModelDescriptor) =>
        getTtsEvaluationResult(model.id)?.latencyP50Ms,
      providerRank: (model: CatalogModelDescriptor) =>
        modelProviderRankById.get(model.provider_id),
    },
  );
  const availableCloneHubModels = orderModelList(
    filteredCloneModels.filter((model) => !model.installed),
    "available",
    modelSortMode,
    {
      label: (model: CatalogModelDescriptor) => model.label,
      active: (model: CatalogModelDescriptor) =>
        isDraftVoiceModelAvailable(model) &&
        cloneModelSelectionValue(model) === selectedCloneModelValue,
      installed: (model: CatalogModelDescriptor) => model.installed,
      runnable: (model: CatalogModelDescriptor) => model.runnable,
      inProgress: (model: CatalogModelDescriptor) =>
        isDownloadActive(
          ttsDownloadProgress[model.id],
          locallyDownloadingModelIds[model.id],
        ),
      recommended: (model: CatalogModelDescriptor) =>
        model.capabilities.supports_voice_cloning,
      blocked: (model: CatalogModelDescriptor) =>
        !model.downloadable && !model.runnable,
      rank: (model: CatalogModelDescriptor) =>
        getTtsEvaluationResult(model.id)?.rank,
      latencyMs: (model: CatalogModelDescriptor) =>
        getTtsEvaluationResult(model.id)?.latencyP50Ms,
      providerRank: (model: CatalogModelDescriptor) =>
        modelProviderRankById.get(model.provider_id),
    },
  );
  const activeImprovementProfile =
    visibleProfiles.find((profile) => profile.continuous_improvement_enabled) ??
    null;

  if (!speech.settings) return null;

  const handleSelectDraftCloneModel = (model: CatalogModelDescriptor) => {
    void handleDownloadOrSelectCloneModel(model);
  };
  const renderModelCard = (model: CatalogModelDescriptor) => {
    const modelReady = isDraftVoiceModelAvailable(model);
    const downloadProgress = ttsDownloadProgress[model.id];
    const localDownloadError = localDownloadErrors[model.id] ?? null;
    const locallyDownloading = Boolean(locallyDownloadingModelIds[model.id]);
    const downloadActive = isDownloadActive(
      downloadProgress,
      locallyDownloading,
    );
    const downloadFailed = isDownloadFailed(
      downloadProgress,
      localDownloadError,
    );
    const downloadCancelled = isDownloadCancelled(
      downloadProgress,
      localDownloadError,
    );
    const downloadRecoverable = downloadFailed || downloadCancelled;
    const byteProgress =
      downloadProgress?.total_bytes && downloadProgress.total_bytes > 0
        ? Math.min(
            100,
            Math.round(
              ((downloadProgress.downloaded_bytes ?? 0) /
                downloadProgress.total_bytes) *
                100,
            ),
          )
        : null;
    const fileProgress =
      downloadProgress?.file_count && downloadProgress.file_count > 0
        ? Math.min(
            100,
            Math.round(
              ((downloadProgress.file_index ?? 0) /
                downloadProgress.file_count) *
                100,
            ),
          )
        : null;
    const downloadState = buildHubDownloadState({
      t,
      progress: downloadProgress,
      localError: localDownloadError,
      localBusy: locallyDownloading,
      activeLabel: downloadingModelFilesLabel(t),
      failedLabel: t("listen.voiceCloning.modelDownloadFailed", {
        defaultValue: "Model download failed.",
      }),
      progressPct: byteProgress ?? fileProgress,
      indeterminate:
        !localDownloadError && byteProgress === null && fileProgress === null,
      cancelling: Boolean(cancellingDownloadModelIds[model.id]),
      onCancel: downloadActive
        ? () => void cancelTtsModelDownload(model)
        : undefined,
      onRetry: downloadRecoverable
        ? () => void handleDownloadOrSelectCloneModel(model)
        : undefined,
      onDismiss: downloadRecoverable
        ? () => clearTtsDownloadProgress(model)
        : undefined,
    });

    return (
      <DraftVoiceModelLibraryCard
        key={`${model.provider_id}::${model.id}`}
        model={model}
        provider={
          speech.allProviders.find(
            (provider) => provider.id === model.provider_id,
          ) ?? null
        }
        selected={
          modelReady &&
          cloneModelSelectionValue(model) === selectedCloneModelValue
        }
        selectedBadgeLabel={t("listen.voiceCloning.selectedModelBadge", {
          defaultValue: "Selected",
        })}
        selectedBadgeDetail={t("listen.voiceCloning.selectedModelBadgeDetail", {
          defaultValue:
            "Selected for this voice clone only. The active app voice is unchanged.",
        })}
        statusBadges={
          modelReady
            ? undefined
            : [
                {
                  id: "download-required",
                  label: t("listen.voiceCloning.downloadRequired", {
                    defaultValue: "Download required",
                  }),
                  variant: "secondary",
                  detail: t("listen.voiceCloning.downloadRequiredDetail", {
                    defaultValue:
                      "Download this model before selecting it for voice cloning.",
                  }),
                },
              ]
        }
        trailing={
          !modelReady &&
          model.downloadable &&
          !downloadActive &&
          !downloadRecoverable
            ? {
                kind: "acquire",
                onClick: () => void handleDownloadOrSelectCloneModel(model),
                disabled: speech.loadingPlatform,
                label: t("listen.voiceCloning.downloadModel", {
                  defaultValue: "Download {{modelLabel}} for voice cloning",
                  modelLabel: model.label,
                }),
              }
            : undefined
        }
        downloadState={downloadState}
        disabled={
          speech.loadingPlatform || (!modelReady && !model.downloadable)
        }
        onSelect={() => handleSelectDraftCloneModel(model)}
      />
    );
  };

  const renderModelSection = (
    title: string,
    models: CatalogModelDescriptor[],
    emptyMessage?: string,
  ) => (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--text)]">
          {title}
        </h3>
        <Badge
          variant="secondary"
          className="min-w-7 justify-center border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 font-semibold"
        >
          {models.length}
        </Badge>
      </div>
      {models.length > 0 ? (
        <div className="flex flex-col gap-3">{models.map(renderModelCard)}</div>
      ) : emptyMessage ? (
        <div className={speechLibraryCardClassName}>
          <p className="text-sm leading-6 text-[var(--muted)]">
            {emptyMessage}
          </p>
        </div>
      ) : null}
    </section>
  );
  const generateCloneVoice = async () => {
    if (!selectedCloneModel) {
      speech.setStatusMessage(
        "Choose a clone-capable model before generating.",
      );
      return;
    }
    if (!referenceAudioPathDraft) {
      speech.setStatusMessage(
        "Provide a reference audio file or record your voice first.",
      );
      return;
    }

    const profileName = profileNameDraft.trim();
    if (!profileName) {
      speech.setStatusMessage(
        "Give your new voice profile a name before generating.",
      );
      setProfileDetailsWindowOpen(true);
      return;
    }

    speech.setBusyProfileAction("generate");
    speech.setStatusMessage(null);

    try {
      // Always create a brand-new profile for each clone.
      const createdProfile = await createTtsVoiceProfile(
        profileName,
        profileDescriptionDraft || null,
        referenceTranscriptDraft.trim() || null,
      );

      const importedProfile = await importTtsVoiceProfileSample(
        createdProfile.id,
        referenceAudioPathDraft,
        referenceTranscriptDraft.trim() || null,
      );

      await speech.refreshProfiles();
      setSelectedProfileId(importedProfile.id);

      await speech.createPresetFromProfile(importedProfile, selectedCloneModel);

      // Clear the drafts after successful generation.
      setProfileNameDraft("");
      setProfileDescriptionDraft("");
      setReferenceAudioPathDraft("");
      setReferenceTranscriptDraft("");
      speech.setStatusMessage(
        t("listen.voiceCloning.generated", {
          profileLabel: profileName,
          defaultValue: `"${profileName}" voice created and added to your library.`,
        }),
      );
    } catch (error) {
      speech.setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to generate cloned voice.",
      );
    } finally {
      speech.setBusyProfileAction(null);
    }
  };

  const toggleProfileImprovement = async (
    profileId: string,
    enabled: boolean,
  ) => {
    speech.setBusyProfileAction("improvement");
    try {
      const updated = await setActiveImprovementProfile(profileId, enabled);
      await speech.refreshProfiles();
      speech.setStatusMessage(
        enabled
          ? `Continuous improvement is collecting qualified dictations for "${updated.label}".`
          : "Continuous improvement is off.",
      );
    } catch (error) {
      speech.setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to update continuous improvement.",
      );
    } finally {
      speech.setBusyProfileAction(null);
    }
  };

  const clearCollectedProfileAudio = async (profileId: string) => {
    speech.setBusyProfileAction("improvement");
    try {
      await clearProfileCollectedData(profileId);
      await speech.refreshProfiles();
      speech.setStatusMessage("Collected improvement audio was cleared.");
      setConfirmingClearProfileId(null);
    } catch (error) {
      speech.setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to clear collected improvement audio.",
      );
    } finally {
      speech.setBusyProfileAction(null);
    }
  };

  const modelWindow = createPortal(
    <AnimatePresence>
      {modelWindowOpen ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setModelWindowOpen(false)}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-[var(--scrim-bg)] backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("listen.createVoices.models", {
              defaultValue: "Models",
            })}
            className="relative max-h-[min(88vh,920px)] w-full max-w-[980px] overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[var(--modal-shadow)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.defaultPrevented) {
                setModelWindowOpen(false);
              }
            }}
          >
            <div className="space-y-4 border-b border-[var(--border)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="relative flex h-10 min-w-[220px] flex-1 items-center"
                  aria-label={t("listen.voiceCloning.searchModelsAriaLabel", {
                    defaultValue: "Search clone-capable models",
                  })}
                >
                  <Search
                    className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--accent-hover)]"
                    aria-hidden
                  />
                  <Input
                    type="text"
                    role="searchbox"
                    autoComplete="off"
                    value={modelSearchQuery}
                    onChange={(event) =>
                      setModelSearchQuery(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && modelSearchQuery) {
                        setModelSearchQuery("");
                        event.preventDefault();
                      }
                    }}
                    placeholder={t("listen.voiceCloning.searchModels", {
                      defaultValue: "Search clone models",
                    })}
                    className="h-10 w-full border-[1.5px] border-[var(--accent-hover)] bg-transparent pl-9 pr-9 text-sm font-bold text-[var(--accent-hover)] placeholder:text-[var(--accent-hover)] hover:border-[var(--accent-hover)] hover:bg-[var(--accent-soft)] focus:border-[var(--accent-hover)] focus:ring-2 focus:ring-[var(--accent-glow)]"
                  />
                  {modelSearchQuery ? (
                    <button
                      type="button"
                      className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--accent-hover)] transition-colors hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      onClick={() => setModelSearchQuery("")}
                      aria-label={t("listen.createVoices.clearModelSearch", {
                        defaultValue: "Clear model search",
                      })}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </label>
                <ModelListControls
                  provider={{
                    value: modelProviderFilter,
                    options: modelProviderOptions,
                    onChange: setModelProviderFilter,
                    label: selectedModelProviderLabel,
                    show: modelProviderOptions.length > 2,
                  }}
                  language={{
                    value: modelLanguageFilter,
                    options: modelLanguageOptions,
                    onChange: setModelLanguageFilter,
                    label: selectedModelLanguageLabel,
                    show: true,
                  }}
                  sort={{
                    value: modelSortMode,
                    options: modelSortOptions,
                    onChange: setModelSortMode,
                    label: selectedModelSortLabel,
                  }}
                />
              </div>
            </div>

            <div className="max-h-[calc(min(88vh,920px)-80px)] overflow-y-auto p-4">
              {filteredCloneModels.length > 0 ? (
                <div className="space-y-5">
                  {downloadedCloneModels.length > 0
                    ? renderModelSection(
                        t("listen.engineLibrary.downloadedModels", {
                          defaultValue: "Downloaded Models",
                        }),
                        downloadedCloneModels,
                      )
                    : null}
                  <div
                    className={
                      downloadedCloneModels.length > 0
                        ? "border-t border-[var(--border)] pt-5"
                        : ""
                    }
                  >
                    {renderModelSection(
                      t("listen.engineLibrary.availableToDownload", {
                        defaultValue: "Available to Download",
                      }),
                      availableCloneHubModels,
                      t("listen.engineLibrary.allModelsReady", {
                        defaultValue:
                          "Every compatible speech model is already downloaded or active.",
                      }),
                    )}
                  </div>
                </div>
              ) : (
                <div className={speechLibraryCardClassName}>
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    {modelSearchQuery
                      ? t("listen.voiceCloning.noModelSearchResults", {
                          defaultValue:
                            "No clone-capable models match that search.",
                        })
                      : t("listen.voiceCloning.noCloneModels", {
                          defaultValue:
                            "No clone-capable models are available in the local catalog.",
                        })}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );

  const profileDetailsDialog = createPortal(
    <AnimatePresence>
      {profileDetailsWindowOpen ? (
        <motion.div
          className="fixed inset-0 z-[110] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setProfileDetailsWindowOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setProfileDetailsWindowOpen(false);
            }
          }}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-[var(--scrim-bg)] backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-clone-profile-details-title"
            className="relative w-full max-w-[520px] overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[var(--modal-shadow)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="min-w-0">
                <h3
                  id="voice-clone-profile-details-title"
                  className="truncate text-sm font-semibold text-[var(--text)]"
                >
                  {t("listen.voiceCloning.profileDetailsTitle", {
                    defaultValue: "Name This Voice",
                  })}
                </h3>
                <p className="truncate text-xs text-[var(--muted)]">
                  {t("listen.voiceCloning.profileDetailsDescription", {
                    defaultValue:
                      "Add a required profile name and optional note before generating.",
                  })}
                </p>
              </div>
              <ActionIconButton
                type="button"
                onClick={() => setProfileDetailsWindowOpen(false)}
                aria-label={t("common.close", { defaultValue: "Close" })}
                title={t("common.close", { defaultValue: "Close" })}
              >
                <X aria-hidden />
              </ActionIconButton>
            </div>
            <div className="space-y-4 p-4">
              <WorkflowField
                label={t("listen.voiceCloning.profileName", {
                  defaultValue: "Profile name",
                })}
                hint={t("listen.voiceCloning.profileNameHint", {
                  defaultValue:
                    "This required name saves with the cloned voice profile.",
                })}
              >
                <Input
                  autoFocus
                  value={profileNameDraft}
                  onChange={(event) => setProfileNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && profileNameDraft.trim()) {
                      event.preventDefault();
                      setProfileDetailsWindowOpen(false);
                    }
                  }}
                  placeholder={t("listen.placeholders.voiceProfileName", {
                    defaultValue: "New voice profile name",
                  })}
                  disabled={!speech.ttsEnabled}
                  className="w-full max-w-none"
                />
              </WorkflowField>
              <WorkflowField
                label={t("listen.voiceCloning.profileNote", {
                  defaultValue: "Profile note",
                })}
                hint={t("listen.voiceCloning.profileNoteHint", {
                  defaultValue:
                    "Optional context, such as speaker, mic, or source.",
                })}
              >
                <Input
                  value={profileDescriptionDraft}
                  onChange={(event) =>
                    setProfileDescriptionDraft(event.target.value)
                  }
                  placeholder={t("listen.placeholders.voiceProfileNote", {
                    defaultValue: "Optional note about this speaker",
                  })}
                  disabled={!speech.ttsEnabled}
                  className="w-full max-w-none"
                />
              </WorkflowField>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setProfileDetailsWindowOpen(false)}
                >
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setProfileDetailsWindowOpen(false)}
                  disabled={!speech.ttsEnabled || !profileNameDraft.trim()}
                >
                  {t("common.done", { defaultValue: "Done" })}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );

  const content = (
    <>
      {modelWindow}
      {profileDetailsDialog}
      <div className="space-y-7">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary-soft"
            size="sm"
            onClick={() => void generateCloneVoice()}
            disabled={createPresetDisabled}
          >
            {speech.busyProfileAction === "generate" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {t("listen.voiceCloning.generate", { defaultValue: "Generate" })}
          </Button>
          <div className="ml-auto">
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModelWindowOpen(true)}
              >
                <Layers className="h-3.5 w-3.5" />
                {t("listen.createVoices.models", { defaultValue: "Models" })}
              </Button>
            </div>
          </div>
        </div>

        {speech.statusMessage ? (
          <div
            className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]"
            aria-live="polite"
          >
            {speech.statusMessage}
          </div>
        ) : null}

        <>
          <div
            className={[
              whiteWorkflowCardClassName,
              "flex min-h-[190px] flex-col gap-4 border-dashed transition-[border-color,background-color,box-shadow] duration-150",
              isRecording
                ? "border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_6%,transparent)]"
                : isReferenceAudioDragOver
                  ? "border-[var(--accent)] bg-[var(--accent-soft,var(--panel-bg))] shadow-[var(--shadow-md,var(--shadow-sm))]"
                  : referenceAudioPathDraft
                    ? "border-[var(--accent)] bg-[var(--accent-soft,var(--panel-bg))]"
                    : "",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 truncate text-sm text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">
                  {referenceAudioStatusLabel}
                </span>
                <span> - {referenceAudioStatusDetail}</span>
              </div>
              <span
                className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm font-semibold text-[var(--text)]"
                title={t("listen.voiceCloning.selectedModelTitle", {
                  model: selectedCloneModelDisplayName,
                  detail: selectedCloneModelDetail,
                  defaultValue: selectedCloneModelDetail
                    ? "Selected model: {{model}} · {{detail}}"
                    : "Selected model: {{model}}",
                })}
                aria-label={t("listen.voiceCloning.selectedModelAriaLabel", {
                  model: selectedCloneModelDisplayName,
                  defaultValue: "Selected clone model: {{model}}",
                })}
              >
                {selectedCloneModelIconId ? (
                  <ProviderIcon
                    providerId={selectedCloneModelIconId}
                    size="sm"
                    className="rounded-full"
                  />
                ) : (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 truncate">
                  {selectedCloneModelDisplayName}
                </span>
              </span>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              {/* Animated waveform during recording */}
              {isRecording ? (
                <div
                  className="flex h-12 items-end gap-[3px]"
                  aria-label={t("listen.voiceCloning.recordingAudio")}
                >
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="w-[4px] rounded-full bg-[var(--danger)]"
                      style={{
                        animation: `voice-clone-bar 0.8s ease-in-out ${i * 0.12}s infinite alternate`,
                      }}
                    />
                  ))}
                  <style>{`
                    @keyframes voice-clone-bar {
                      0% { height: 8px; opacity: 0.4; }
                      50% { height: 28px; opacity: 0.9; }
                      100% { height: 14px; opacity: 0.6; }
                    }
                  `}</style>
                </div>
              ) : (
                <div
                  className={[
                    "flex size-12 items-center justify-center rounded-full text-[var(--muted)]",
                    referenceAudioPathDraft
                      ? "bg-[var(--accent-soft,var(--input))]"
                      : "bg-[var(--input)]",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  {isReferenceAudioDragOver ? (
                    <Upload className="h-5 w-5" />
                  ) : referenceAudioPathDraft ? (
                    <FileAudio className="h-5 w-5 text-[var(--accent)]" />
                  ) : (
                    <FileAudio className="h-5 w-5" />
                  )}
                </div>
              )}

              <div className="max-w-xl w-full space-y-3">
                {isRecording ? (
                  <>
                    <p className="text-sm font-semibold text-[var(--danger)]">
                      {t("listen.voiceCloning.recordingActive", {
                        defaultValue:
                          "Recording… tap Stop when you are done speaking",
                      })}
                    </p>
                    <p className="text-xs leading-5 text-[var(--muted)]">
                      {t("listen.voiceCloning.recordingHint", {
                        defaultValue:
                          "Speak clearly and steadily. A 5–15 second clip works best.",
                      })}
                    </p>
                  </>
                ) : referenceAudioPathDraft ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
                      <p className="text-sm font-semibold text-[var(--accent)]">
                        {t("listen.voiceCloning.referenceAudioReady", {
                          defaultValue: "Reference audio ready",
                        })}
                      </p>
                    </div>
                    <p className="font-mono-token text-xs text-[var(--text)]">
                      {basename(referenceAudioPathDraft)}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-[var(--text)]">
                      {t("listen.voiceCloning.dropReferenceAudio", {
                        defaultValue:
                          "Drag & drop a WAV file, browse files, or record your voice",
                      })}
                    </p>
                    <p className="text-xs leading-5 text-[var(--muted)]">
                      {t("listen.voiceCloning.referenceAudioHint", {
                        defaultValue:
                          "Use a clear, steady voice sample. The transcript can guide cloning; if left blank, Vox Jot will try to transcribe the sample.",
                      })}
                    </p>
                  </div>
                )}
                {!isRecording ? (
                  <>
                    <div
                      className="flex items-center justify-center gap-3 pt-1"
                      role="group"
                      aria-label={t(
                        referenceAudioPathDraft
                          ? "listen.voiceCloning.replaceReferenceActions"
                          : "listen.voiceCloning.referenceAudioActions",
                        {
                          defaultValue: referenceAudioPathDraft
                            ? "Replace reference audio"
                            : "Reference audio",
                        },
                      )}
                    >
                      <ActionIconButton
                        type="button"
                        onClick={() => void pickReferenceAudio()}
                        disabled={!speech.ttsEnabled}
                        aria-label={t(
                          "listen.voiceCloning.pickReferenceAudio",
                          {
                            defaultValue: "Choose audio file in Finder",
                          },
                        )}
                        title={t("listen.voiceCloning.pickReferenceAudio", {
                          defaultValue: "Choose audio file in Finder",
                        })}
                      >
                        <FolderOpen aria-hidden />
                      </ActionIconButton>
                      <Button
                        type="button"
                        variant="primary"
                        size="icon"
                        onClick={() => void toggleMicCapture()}
                        disabled={!speech.ttsEnabled}
                        aria-label={t("listen.voiceCloning.startRecording", {
                          defaultValue: "Record from microphone",
                        })}
                        title={t("listen.voiceCloning.startRecording", {
                          defaultValue: "Record from microphone",
                        })}
                      >
                        <Mic aria-hidden />
                      </Button>
                    </div>
                    {referenceAudioPathDraft ? (
                      <p className="text-center text-[11px] leading-4 text-[var(--muted)]">
                        {t("listen.voiceCloning.referenceLoadedHint", {
                          defaultValue:
                            "This audio will be used as the voice identity for cloning. You can replace it by dragging a new file or recording again.",
                        })}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
              {isRecording ? (
                <div
                  className="flex items-center justify-center gap-3"
                  role="group"
                  aria-label={t("listen.voiceCloning.recordingActions", {
                    defaultValue: "While recording",
                  })}
                >
                  <ActionIconButton
                    type="button"
                    onClick={() => void pickReferenceAudio()}
                    disabled={!speech.ttsEnabled || isRecording}
                    aria-label={t("listen.voiceCloning.pickReferenceAudio", {
                      defaultValue: "Choose audio file in Finder",
                    })}
                    title={t("listen.voiceCloning.pickReferenceAudio", {
                      defaultValue: "Choose audio file in Finder",
                    })}
                  >
                    <FolderOpen aria-hidden />
                  </ActionIconButton>
                  <Button
                    type="button"
                    variant="danger"
                    size="icon"
                    onClick={() => void toggleMicCapture()}
                    disabled={!speech.ttsEnabled}
                    aria-label={t("listen.voiceCloning.stopRecording", {
                      defaultValue: "Stop recording",
                    })}
                    title={t("listen.voiceCloning.stopRecording", {
                      defaultValue: "Stop recording",
                    })}
                  >
                    <Square className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <div className={whiteWorkflowCardClassName}>
            <WorkflowField
              label={t("listen.voiceCloning.transcript", {
                defaultValue: "Transcript",
              })}
              hint={t("listen.voiceCloning.transcriptForCloneHint", {
                defaultValue:
                  "Optional text for the reference audio. If you are recording your voice, prepare the words you will say here first.",
              })}
            >
              <Textarea
                value={referenceTranscriptDraft}
                onChange={(event) =>
                  setReferenceTranscriptDraft(event.target.value)
                }
                placeholder={t("listen.placeholders.voiceProfileTranscript")}
                disabled={!speech.ttsEnabled}
                className="min-h-[176px]"
              />
            </WorkflowField>
          </div>
        </>

        {visibleProfiles.length > 0 ? (
          <div
            className={`${whiteWorkflowCardClassName} space-y-3`}
            aria-live="polite"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  {t("listen.voiceCloning.improveFromDictationsTitle", {
                    defaultValue: "Improve from dictations",
                  })}
                </h3>
                <p className="text-xs leading-5 text-[var(--muted)]">
                  {t("listen.voiceCloning.improveFromDictationsDescription", {
                    defaultValue:
                      "Use successful dictations that pass quality checks to tune one voice profile in the background.",
                  })}
                </p>
              </div>
              <Badge
                variant={activeImprovementProfile ? "success" : "secondary"}
              >
                {activeImprovementProfile
                  ? t("common.on", { defaultValue: "On" })
                  : t("common.off", { defaultValue: "Off" })}
              </Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {visibleProfiles.map((profile) => {
                const collectedSeconds = Math.round(
                  profile.collected_audio_duration_secs ?? 0,
                );
                const isActive = profile.continuous_improvement_enabled;
                const confirmingClear = confirmingClearProfileId === profile.id;
                return (
                  <div
                    key={profile.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className="h-9 w-9 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--avatar-ring)]"
                          style={{
                            background: voiceAvatarGradient(profile.id),
                          }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--text)]">
                            {profile.label}
                          </p>
                          <p className="text-xs text-[var(--muted)]">
                            {t("listen.voiceCloning.collectedAudioDuration", {
                              count: collectedSeconds,
                              defaultValue: "{{count}}s collected",
                            })}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant={isActive ? "secondary" : "primary-soft"}
                        size="sm"
                        disabled={speech.busyProfileAction === "improvement"}
                        onClick={() =>
                          void toggleProfileImprovement(profile.id, !isActive)
                        }
                      >
                        {isActive ? "Turn off" : "Use profile"}
                      </Button>
                    </div>
                    {collectedSeconds > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                        {confirmingClear ? (
                          <>
                            <span className="text-xs font-medium text-[var(--text)]">
                              {t(
                                "listen.voiceCloning.clearCollectedAudioConfirm",
                                {
                                  defaultValue:
                                    "Clear collected improvement audio for this voice?",
                                },
                              )}
                            </span>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              disabled={
                                speech.busyProfileAction === "improvement"
                              }
                              onClick={() =>
                                void clearCollectedProfileAudio(profile.id)
                              }
                            >
                              {t("common.clear", { defaultValue: "Clear" })}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={
                                speech.busyProfileAction === "improvement"
                              }
                              onClick={() => setConfirmingClearProfileId(null)}
                            >
                              {t("common.cancel", { defaultValue: "Cancel" })}
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={
                              speech.busyProfileAction === "improvement"
                            }
                            onClick={() =>
                              setConfirmingClearProfileId(profile.id)
                            }
                          >
                            {t("listen.voiceCloning.clearCollectedAudio", {
                              defaultValue: "Clear collected audio",
                            })}
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );

  if (!showTitle) {
    return content;
  }

  return (
    <SettingsGroup title={t("appSections.sections.voiceCloningTitle")}>
      {content}
    </SettingsGroup>
  );
};
