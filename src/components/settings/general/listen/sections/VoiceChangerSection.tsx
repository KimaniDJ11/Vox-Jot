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
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  FileAudio,
  Keyboard,
  Layers,
  Loader2,
  Mic,
  Search,
  Square,
  WandSparkles,
  X,
} from "lucide-react";

import { commands } from "@/bindings";
import { convertVoiceRecording, convertVoiceSample } from "@/lib/voiceChanger";
import ModelListControls from "@/components/model-hub/ModelListControls";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AudioPlayer } from "@/components/ui/AudioPlayer";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import Badge from "@/components/ui/Badge";
import { downloadingModelFilesLabel } from "@/components/model-hub/downloadStatusLabels";
import {
  buildHubDownloadState,
  isDownloadActive,
  isDownloadFailed,
} from "@/components/model-hub/hubDownloadState";
import {
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import { LANGUAGES } from "@/lib/constants/languages";
import {
  DEFAULT_MODEL_SORT_OPTIONS,
  orderModelList,
  TEST_SCORE_MODEL_SORT_OPTION,
  type ModelSortMode,
} from "@/lib/modelListOrdering";
import { getTtsEvaluationResult } from "@/lib/ttsEvaluationResults";
import { modal } from "@/motion/springs";
import type { ListenSpeechState } from "../useListenSpeechState";
import { DraftVoiceModelLibraryCard } from "../sharedComponents";
import {
  findVoiceChangerModel,
  isVoiceChangerCapableModel,
  type VoiceChangerModelSelection,
  voiceChangerModelKey,
} from "../voiceChangerModels";
import {
  getModelLanguageItems,
  huggingFaceRepoIdFromSourceUrl,
  isDraftVoiceModelAvailable,
  ttsModelSupportsLanguage,
} from "../utils";

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

async function audioPathToBlobUrl(path: string): Promise<string> {
  const data = await readFile(path);
  const blob = new Blob([data], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

function errorToMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

const EMPTY_VOICE_CHANGER_MODEL_SELECTION: VoiceChangerModelSelection = {
  providerId: "",
  modelId: "",
};

function readVoiceChangerDraft(): VoiceChangerModelSelection {
  if (typeof window === "undefined") return EMPTY_VOICE_CHANGER_MODEL_SELECTION;
  try {
    const raw = window.localStorage.getItem("vox-jot-voice-changer-draft-v1");
    if (!raw) return EMPTY_VOICE_CHANGER_MODEL_SELECTION;
    const draft = JSON.parse(raw) as Partial<VoiceChangerModelSelection>;
    if (
      typeof draft.providerId === "string" &&
      typeof draft.modelId === "string"
    ) {
      return {
        providerId: draft.providerId,
        modelId: draft.modelId,
      };
    }
  } catch (error) {
    console.warn("Failed to read Voice Changer draft:", error);
  }
  return EMPTY_VOICE_CHANGER_MODEL_SELECTION;
}

function writeVoiceChangerDraft(selection: VoiceChangerModelSelection) {
  if (typeof window === "undefined") return;
  try {
    if (!selection.providerId || !selection.modelId) {
      window.localStorage.removeItem("vox-jot-voice-changer-draft-v1");
      return;
    }
    window.localStorage.setItem(
      "vox-jot-voice-changer-draft-v1",
      JSON.stringify(selection),
    );
  } catch (error) {
    console.warn("Failed to store Voice Changer draft:", error);
  }
}

type WaitPhase = "download" | "prepare" | "finalize" | "convert" | "loadOutput";

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

export const VoiceChangerSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const readyProfiles = useMemo(
    () => speech.profiles.filter((profile) => profile.ready),
    [speech.profiles],
  );
  const initialVoiceChangerDraft = useMemo(readVoiceChangerDraft, []);
  const voiceChangerModels = useMemo(
    () => speech.visibleModels.filter(isVoiceChangerCapableModel),
    [speech.visibleModels],
  );
  const availableVoiceChangerModels = useMemo(
    () => voiceChangerModels.filter(isDraftVoiceModelAvailable),
    [voiceChangerModels],
  );
  const [draftProviderId, setDraftProviderId] = useState(
    initialVoiceChangerDraft.providerId,
  );
  const [draftModelId, setDraftModelId] = useState(
    initialVoiceChangerDraft.modelId,
  );
  const selectedVoiceChangerModel = useMemo(
    () =>
      findVoiceChangerModel(availableVoiceChangerModels, {
        providerId: draftProviderId,
        modelId: draftModelId,
      }),
    [availableVoiceChangerModels, draftModelId, draftProviderId],
  );
  const selectedVoiceChangerProvider =
    speech.visibleProviders.find(
      (provider) => provider.id === selectedVoiceChangerModel?.provider_id,
    ) ?? null;
  const [sourcePath, setSourcePath] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [tau, setTau] = useState(0.3);
  const [isConverting, setIsConverting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [modelProviderFilter, setModelProviderFilter] = useState("all");
  const [modelLanguageFilter, setModelLanguageFilter] = useState("all");
  const [modelSortMode, setModelSortMode] =
    useState<ModelSortMode>("best_match");
  const [status, setStatus] = useState<string | null>(null);
  const [waitPhase, setWaitPhase] = useState<WaitPhase | null>(null);
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    if (
      selectedProfileId &&
      readyProfiles.some((profile) => profile.id === selectedProfileId)
    ) {
      return;
    }
    setSelectedProfileId(readyProfiles[0]?.id ?? "");
  }, [readyProfiles, selectedProfileId]);

  useEffect(() => {
    if (availableVoiceChangerModels.length === 0) {
      if (draftProviderId || draftModelId) {
        setDraftProviderId("");
        setDraftModelId("");
      }
      return;
    }
    if (selectedVoiceChangerModel) return;
    const fallback = availableVoiceChangerModels[0];
    setDraftProviderId(fallback.provider_id);
    setDraftModelId(fallback.id);
  }, [
    availableVoiceChangerModels,
    draftModelId,
    draftProviderId,
    selectedVoiceChangerModel,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<TtsHfDownloadProgress>(
        "tts-hf-download-progress",
        (event) => {
          const progress = event.payload;
          if (!progress.repo_id) return;
          const matchingModel = voiceChangerModels.find(
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
            void speech.refreshAll();
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
  }, [speech, voiceChangerModels]);

  useEffect(() => {
    writeVoiceChangerDraft({
      providerId: draftProviderId,
      modelId: draftModelId,
    });
  }, [draftModelId, draftProviderId]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (!waitPhase || waitStartedAt === null) return;
    const updateElapsed = () => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - waitStartedAt) / 1000)),
      );
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [waitPhase, waitStartedAt]);

  useEffect(() => {
    return () => {
      if (outputUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(outputUrl);
      }
    };
  }, [outputUrl]);

  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        void commands.convoStopAudioCapture();
      }
    };
  }, []);

  const beginWait = useCallback((phase: WaitPhase, message: string) => {
    setWaitPhase(phase);
    setWaitStartedAt(Date.now());
    setElapsedSeconds(0);
    setStatus(message);
  }, []);

  const finishWait = useCallback(() => {
    setWaitPhase(null);
    setWaitStartedAt(null);
    setElapsedSeconds(0);
  }, []);

  const clearOutput = useCallback(() => {
    setOutputPath(null);
    setOutputUrl((current) => {
      if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
      return null;
    });
  }, []);

  const applyConversionResult = useCallback(
    async (result: Awaited<ReturnType<typeof convertVoiceSample>>) => {
      const nextUrl = await audioPathToBlobUrl(result.output_path);
      setSourcePath(result.source_path);
      setOutputPath(result.output_path);
      setOutputUrl((current) => {
        if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setStatus(
        t("listen.voiceChanger.convertedWith", {
          defaultValue: "Converted with {{profileLabel}}.",
          profileLabel: result.target_profile_label,
        }),
      );
      finishWait();
    },
    [finishWait, t],
  );

  const pickSourceAudio = useCallback(async () => {
    if (isRecording) return;
    const filePath = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "WAV audio", extensions: ["wav"] }],
    });
    if (typeof filePath !== "string") return;
    setSourcePath(filePath);
    clearOutput();
    setStatus(null);
  }, [clearOutput, isRecording]);

  const ensureVoiceChangerModel = useCallback(async () => {
    const model = selectedVoiceChangerModel;
    if (!model) {
      throw new Error(
        t("listen.voiceChanger.noVoiceChangerModel", {
          defaultValue:
            "No downloaded, runnable voice changer model is available.",
        }),
      );
    }
  }, [selectedVoiceChangerModel, t]);

  const runConversion = useCallback(async () => {
    const model = selectedVoiceChangerModel;
    if (
      !sourcePath ||
      !selectedProfileId ||
      !model ||
      isConverting ||
      isRecording
    )
      return;
    setIsConverting(true);
    beginWait(
      "prepare",
      t("listen.voiceChanger.preparing", {
        defaultValue: "Preparing offline voice changer.",
      }),
    );
    try {
      await ensureVoiceChangerModel();
      beginWait(
        "convert",
        t("listen.voiceChanger.converting", {
          defaultValue: "Converting voice.",
        }),
      );
      const result = await convertVoiceSample(
        sourcePath,
        selectedProfileId,
        tau,
        model.provider_id,
        model.id,
      );
      beginWait(
        "loadOutput",
        t("listen.voiceChanger.loadingOutput", {
          defaultValue: "Loading converted audio.",
        }),
      );
      await applyConversionResult(result);
    } catch (error) {
      finishWait();
      setStatus(
        errorToMessage(
          error,
          t("listen.voiceChanger.failed", {
            defaultValue: "Voice conversion failed.",
          }),
        ),
      );
    } finally {
      setIsConverting(false);
    }
  }, [
    applyConversionResult,
    beginWait,
    ensureVoiceChangerModel,
    finishWait,
    isConverting,
    isRecording,
    selectedProfileId,
    selectedVoiceChangerModel,
    sourcePath,
    t,
    tau,
  ]);

  const startMicCapture = useCallback(async () => {
    if (
      !selectedProfileId ||
      !selectedVoiceChangerModel ||
      isConverting ||
      isRecording
    )
      return;
    try {
      clearOutput();
      setSourcePath("");
      setStatus(
        t("listen.voiceChanger.listening", {
          defaultValue: "Listening. Tap stop when you are done speaking.",
        }),
      );
      const result = await commands.convoStartAudioCapture();
      if (result.status === "error") {
        throw new Error(result.error);
      }
      setIsRecording(true);
    } catch (error) {
      setStatus(
        errorToMessage(
          error,
          t("listen.voiceChanger.recordingFailed", {
            defaultValue: "Could not start microphone recording.",
          }),
        ),
      );
    }
  }, [
    clearOutput,
    isConverting,
    isRecording,
    selectedProfileId,
    selectedVoiceChangerModel,
    t,
  ]);

  const stopMicCaptureAndConvert = useCallback(async () => {
    if (!isRecording || isConverting) return;
    const model = selectedVoiceChangerModel;
    setIsRecording(false);
    setIsConverting(true);
    beginWait(
      "finalize",
      t("listen.voiceChanger.finalizingRecording", {
        defaultValue: "Finalizing microphone recording.",
      }),
    );
    try {
      const captureResult = await commands.convoStopAudioCapture();
      if (captureResult.status === "error") {
        throw new Error(captureResult.error);
      }
      if (captureResult.data.length === 0) {
        throw new Error(
          t("listen.voiceChanger.noMicAudio", {
            defaultValue: "No microphone audio was captured.",
          }),
        );
      }
      if (!model) {
        throw new Error(
          t("listen.voiceChanger.noVoiceChangerModel", {
            defaultValue:
              "No downloaded, runnable voice changer model is available.",
          }),
        );
      }
      await ensureVoiceChangerModel();
      beginWait(
        "convert",
        t("listen.voiceChanger.converting", {
          defaultValue: "Converting voice.",
        }),
      );
      const result = await convertVoiceRecording(
        captureResult.data,
        selectedProfileId,
        tau,
        model.provider_id,
        model.id,
      );
      beginWait(
        "loadOutput",
        t("listen.voiceChanger.loadingOutput", {
          defaultValue: "Loading converted audio.",
        }),
      );
      await applyConversionResult(result);
    } catch (error) {
      finishWait();
      setStatus(
        errorToMessage(
          error,
          t("listen.voiceChanger.failed", {
            defaultValue: "Voice conversion failed.",
          }),
        ),
      );
    } finally {
      setIsConverting(false);
    }
  }, [
    applyConversionResult,
    beginWait,
    ensureVoiceChangerModel,
    finishWait,
    isConverting,
    isRecording,
    selectedProfileId,
    selectedVoiceChangerModel,
    t,
    tau,
  ]);

  const toggleMicCapture = useCallback(async () => {
    if (isRecording) {
      await stopMicCaptureAndConvert();
      return;
    }
    await startMicCapture();
  }, [isRecording, startMicCapture, stopMicCaptureAndConvert]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key.toLowerCase() !== "r" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      ) {
        return;
      }

      event.preventDefault();
      void toggleMicCapture();
    },
    [toggleMicCapture],
  );

  const selectedVoiceChangerLabel =
    selectedVoiceChangerModel?.label ??
    t("listen.voiceChanger.noModelSelected", {
      defaultValue: "No model selected",
    });
  const selectedVoiceChangerMeta = [
    selectedVoiceChangerProvider?.label,
    selectedVoiceChangerModel?.runtime.label,
    selectedVoiceChangerModel
      ? t("listen.voiceChanger.modelReady", {
          defaultValue: "Ready",
        })
      : t("listen.voiceChanger.chooseModel", {
          defaultValue: "Choose a model",
        }),
  ]
    .filter(Boolean)
    .join(" - ");
  const sourceStatusLabel = sourcePath
    ? t("listen.voiceChanger.sourceReadyShort", {
        defaultValue: "Source ready",
      })
    : t("listen.voiceChanger.needsSourceShort", {
        defaultValue: "Add source",
      });
  const sourceStatusDetail = sourcePath
    ? basename(sourcePath)
    : t("listen.voiceChanger.noAudioSelected", {
        defaultValue: "No audio selected",
      });
  const selectedVoiceChangerIconId = selectedVoiceChangerModel
    ? resolveModelProviderId(
        `${selectedVoiceChangerModel.label} ${selectedVoiceChangerModel.id}`,
        selectedVoiceChangerModel.provider_id,
      )
    : null;
  const toneBlendPercent = Math.min(100, Math.max(0, tau * 100));
  const toneBlendSliderStyle = {
    "--slider-bg": `linear-gradient(to right, color-mix(in srgb, var(--accent), var(--card) 52%) ${toneBlendPercent}%, var(--card) ${toneBlendPercent}%)`,
  } as React.CSSProperties;
  const canConvert = Boolean(
    sourcePath &&
    selectedProfileId &&
    selectedVoiceChangerModel &&
    !isConverting &&
    !isRecording,
  );
  const canRecord = Boolean(
    selectedProfileId && selectedVoiceChangerModel && !isConverting,
  );
  const waitDetail = useMemo(() => {
    if (!waitPhase) return null;
    if (waitPhase === "download") {
      return elapsedSeconds < 8
        ? t("listen.voiceChanger.wait.downloadStarting", {
            defaultValue:
              "Checking the local speech pack and installing any missing runtime pieces.",
          })
        : t("listen.voiceChanger.wait.downloadStillWorking", {
            defaultValue:
              "Still preparing {{modelLabel}}. First setup can take a while.",
            modelLabel: selectedVoiceChangerLabel,
          });
    }
    if (waitPhase === "prepare") {
      return t("listen.voiceChanger.wait.prepare", {
        defaultValue:
          "Starting the offline speech runtime and checking the selected target voice.",
      });
    }
    if (waitPhase === "finalize") {
      return t("listen.voiceChanger.wait.finalize", {
        defaultValue: "Saving your microphone take as a clean WAV source.",
      });
    }
    if (waitPhase === "loadOutput") {
      return t("listen.voiceChanger.wait.loadOutput", {
        defaultValue: "Reading the converted WAV and preparing playback.",
      });
    }
    if (elapsedSeconds < 4) {
      return t("listen.voiceChanger.wait.convertWarmup", {
        defaultValue: "Loading {{modelLabel}} and warming up the converter.",
        modelLabel: selectedVoiceChangerLabel,
      });
    }
    if (elapsedSeconds < 10) {
      return t("listen.voiceChanger.wait.convertExtracting", {
        defaultValue:
          "Extracting tone color from your source and target profile.",
      });
    }
    if (elapsedSeconds < 20) {
      return t("listen.voiceChanger.wait.convertMapping", {
        defaultValue: "Mapping your delivery into the selected voice.",
      });
    }
    return t("listen.voiceChanger.wait.convertStillWorking", {
      defaultValue:
        "Still working. Longer clips and first runs can take extra time.",
    });
  }, [elapsedSeconds, selectedVoiceChangerLabel, t, waitPhase]);
  const selectedVoiceChangerKey = selectedVoiceChangerModel
    ? voiceChangerModelKey(
        selectedVoiceChangerModel.provider_id,
        selectedVoiceChangerModel.id,
      )
    : "";
  const normalizedModelSearch = modelSearchQuery.trim().toLowerCase();
  const modelProviderOptions = useMemo(
    () => [
      { value: "all", label: "Provider" },
      ...speech.visibleProviders.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ],
    [speech.visibleProviders],
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
        speech.visibleProviders.map((provider, index) => [provider.id, index]),
      ),
    [speech.visibleProviders],
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

  const handleDownloadVoiceChangerModel = useCallback(
    async (model: CatalogModelDescriptor) => {
      if (isDraftVoiceModelAvailable(model)) {
        setDraftProviderId(model.provider_id);
        setDraftModelId(model.id);
        setModelPickerOpen(false);
        clearOutput();
        setStatus(null);
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
      setStatus(
        t("listen.voiceChanger.modelDownloadStarting", {
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
          t("listen.voiceChanger.modelDownloadFailed", {
            defaultValue: "Model download failed.",
          }),
        );
        setLocalDownloadErrors((current) => ({
          ...current,
          [model.id]: message,
        }));
        setStatus(message);
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
      clearOutput,
      clearTtsDownloadProgress,
      locallyDownloadingModelIds,
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
          setStatus(result.error);
        }
      } finally {
        setCancellingDownloadModelIds((current) => {
          const next = { ...current };
          delete next[model.id];
          return next;
        });
      }
    },
    [],
  );

  const filteredVoiceChangerModels = voiceChangerModels.filter((model) => {
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
      speech.visibleProviders.find(
        (provider) => provider.id === model.provider_id,
      )?.label ?? "";
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
  const downloadedVoiceChangerModels = orderModelList(
    filteredVoiceChangerModels.filter((model) => model.installed),
    "downloaded",
    modelSortMode,
    {
      label: (model: CatalogModelDescriptor) => model.label,
      active: (model: CatalogModelDescriptor) =>
        voiceChangerModelKey(model.provider_id, model.id) ===
        selectedVoiceChangerKey,
      installed: (model: CatalogModelDescriptor) => model.installed,
      runnable: (model: CatalogModelDescriptor) => model.runnable,
      inProgress: (model: CatalogModelDescriptor) =>
        isDownloadActive(
          ttsDownloadProgress[model.id],
          locallyDownloadingModelIds[model.id],
        ),
      recommended: (model: CatalogModelDescriptor) =>
        isVoiceChangerCapableModel(model),
      rank: (model: CatalogModelDescriptor) =>
        getTtsEvaluationResult(model.id)?.rank,
      latencyMs: (model: CatalogModelDescriptor) =>
        getTtsEvaluationResult(model.id)?.latencyP50Ms,
      providerRank: (model: CatalogModelDescriptor) =>
        modelProviderRankById.get(model.provider_id),
    },
  );
  const availableVoiceChangerHubModels = orderModelList(
    filteredVoiceChangerModels.filter((model) => !model.installed),
    "available",
    modelSortMode,
    {
      label: (model: CatalogModelDescriptor) => model.label,
      active: (model: CatalogModelDescriptor) =>
        voiceChangerModelKey(model.provider_id, model.id) ===
        selectedVoiceChangerKey,
      installed: (model: CatalogModelDescriptor) => model.installed,
      runnable: (model: CatalogModelDescriptor) => model.runnable,
      inProgress: (model: CatalogModelDescriptor) =>
        isDownloadActive(
          ttsDownloadProgress[model.id],
          locallyDownloadingModelIds[model.id],
        ),
      recommended: (model: CatalogModelDescriptor) =>
        isVoiceChangerCapableModel(model),
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
  const handleSelectVoiceChangerModel = useCallback(
    (model: CatalogModelDescriptor) => {
      void handleDownloadVoiceChangerModel(model);
    },
    [handleDownloadVoiceChangerModel],
  );

  const renderModelCard = (model: CatalogModelDescriptor) => {
    const modelKey = voiceChangerModelKey(model.provider_id, model.id);
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
      failedLabel: t("listen.voiceChanger.modelDownloadFailed", {
        defaultValue: "Model download failed.",
      }),
      progressPct: byteProgress ?? fileProgress,
      indeterminate:
        !localDownloadError && byteProgress === null && fileProgress === null,
      cancelling: Boolean(cancellingDownloadModelIds[model.id]),
      onCancel: downloadActive
        ? () => void cancelTtsModelDownload(model)
        : undefined,
      onRetry: downloadFailed
        ? () => void handleDownloadVoiceChangerModel(model)
        : undefined,
      onDismiss: downloadFailed ? () => clearTtsDownloadProgress(model) : undefined,
    });
    return (
      <DraftVoiceModelLibraryCard
        key={modelKey}
        model={model}
        provider={
          speech.visibleProviders.find(
            (provider) => provider.id === model.provider_id,
          ) ?? null
        }
        selected={modelReady && modelKey === selectedVoiceChangerKey}
        selectedBadgeLabel={t("listen.voiceChanger.selectedModel", {
          defaultValue: "Selected",
        })}
        selectedBadgeDetail={t("listen.voiceChanger.selectedModelDetail", {
          defaultValue:
            "Selected for Voice Changer only. The active app voice is unchanged.",
        })}
        statusBadges={
          modelReady
            ? undefined
            : [
                {
                  id: "download-required",
                  label: t("listen.voiceChanger.downloadRequired", {
                    defaultValue: "Download required",
                  }),
                  variant: "secondary",
                  detail: t("listen.voiceChanger.downloadRequiredDetail", {
                    defaultValue:
                      "Download this model before selecting it for Voice Changer.",
                  }),
                },
              ]
        }
        trailing={
          !modelReady && model.downloadable && !downloadActive && !downloadFailed
            ? {
                kind: "acquire",
                onClick: () => void handleDownloadVoiceChangerModel(model),
                disabled: isConverting || isRecording,
                label: t("listen.voiceChanger.downloadModel", {
                  defaultValue: "Download {{modelLabel}} for Voice Changer",
                  modelLabel: model.label,
                }),
              }
            : undefined
        }
        downloadState={downloadState}
        disabled={
          isConverting ||
          isRecording ||
          (!modelReady && !model.downloadable)
        }
        onSelect={() => handleSelectVoiceChangerModel(model)}
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
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-4 text-sm text-[var(--muted)]">
          {emptyMessage}
        </div>
      ) : null}
    </section>
  );

  const modelHubWindow = createPortal(
    <AnimatePresence>
      {modelPickerOpen ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setModelPickerOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setModelPickerOpen(false);
            }
          }}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("listen.voiceChanger.modelHubTitle", {
              defaultValue: "Voice Changer Model Hub",
            })}
            className="relative flex max-h-[min(88vh,920px)] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-4 border-b border-[var(--border)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="relative flex h-10 min-w-[220px] flex-1 items-center"
                  aria-label={t("listen.voiceChanger.searchModelsAriaLabel", {
                    defaultValue: "Search voice changer models",
                  })}
                >
                  <Search
                    className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--muted)]"
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
                    placeholder={t("listen.voiceChanger.searchModels", {
                      defaultValue: "Search voice changer models",
                    })}
                    className="h-10 w-full pl-9 pr-9 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
                  />
                  {modelSearchQuery ? (
                    <button
                      type="button"
                      className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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

            <div className="overflow-y-auto p-4">
              {filteredVoiceChangerModels.length > 0 ? (
                <div className="space-y-5">
                  {downloadedVoiceChangerModels.length > 0
                    ? renderModelSection(
                        t("listen.engineLibrary.downloadedModels", {
                          defaultValue: "Downloaded Models",
                        }),
                        downloadedVoiceChangerModels,
                      )
                    : null}
                  <div
                    className={
                      downloadedVoiceChangerModels.length > 0
                        ? "border-t border-[var(--border)] pt-5"
                        : ""
                    }
                  >
                    {renderModelSection(
                      t("listen.engineLibrary.availableToDownload", {
                        defaultValue: "Available to Download",
                      }),
                      availableVoiceChangerHubModels,
                      t("listen.engineLibrary.allModelsReady", {
                        defaultValue:
                          "Every compatible speech model is already downloaded or active.",
                      }),
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-6 text-sm text-[var(--muted)]">
                  {voiceChangerModels.length > 0
                    ? t("listen.voiceChanger.noVoiceChangerModelMatches", {
                        defaultValue:
                          "No voice-changing models match the current filters.",
                      })
                    : t("listen.voiceChanger.noVoiceChangerModels", {
                        defaultValue:
                          "No voice-changing models are available in the local catalog.",
                      })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );

  const content = (
    <>
      {modelHubWindow}
      <div
        className={`space-y-4 ${showTitle ? "px-4 py-3" : ""} outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={t("listen.voiceChanger.panelAriaLabel", {
          defaultValue: "Voice Changer controls",
        })}
      >
        {status ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                  {waitPhase ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  <span>{status}</span>
                </div>
                {waitDetail ? <p>{waitDetail}</p> : null}
              </div>
              {waitPhase ? (
                <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">
                  {t("listen.voiceChanger.wait.elapsed", {
                    defaultValue: "{{seconds}}s",
                    seconds: elapsedSeconds,
                  })}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="primary-soft"
              size="sm"
              onClick={() => void runConversion()}
              disabled={!canConvert}
              className="inline-flex items-center gap-1.5"
            >
              {isConverting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <WandSparkles className="h-3.5 w-3.5" />
              )}
              {t("listen.voiceChanger.convert", { defaultValue: "Convert" })}
            </Button>
            <Button
              type="button"
              variant={isRecording ? "danger" : "primary-soft"}
              size="sm"
              onClick={() => void toggleMicCapture()}
              disabled={!canRecord && !isRecording}
              className="inline-flex items-center gap-1.5"
            >
              {isRecording ? (
                <Square className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              {isRecording
                ? t("listen.voiceChanger.stopAndConvert", {
                    defaultValue: "Stop & Convert",
                  })
                : t("listen.voiceChanger.recordMic", {
                    defaultValue: "Record Mic",
                  })}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void pickSourceAudio()}
              disabled={isRecording || isConverting}
              className="inline-flex items-center gap-1.5"
            >
              <FileAudio className="h-3.5 w-3.5" />
              {t("listen.voiceChanger.chooseWav", {
                defaultValue: "Choose WAV",
              })}
            </Button>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setModelPickerOpen(true)}
              disabled={voiceChangerModels.length === 0 || isRecording}
              aria-haspopup="dialog"
              aria-expanded={modelPickerOpen}
            >
              <Layers className="h-3.5 w-3.5" />
              {t("listen.createVoices.models", { defaultValue: "Models" })}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.7fr)]">
          <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 truncate text-sm text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">
                  {sourceStatusLabel}
                </span>
                <span> - {sourceStatusDetail}</span>
              </div>
              <span
                className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm font-semibold text-[var(--text)]"
                title={t("listen.voiceChanger.selectedModelTitle", {
                  model: selectedVoiceChangerLabel,
                  detail: selectedVoiceChangerMeta,
                  defaultValue: selectedVoiceChangerMeta
                    ? "Selected model: {{model}} - {{detail}}"
                    : "Selected model: {{model}}",
                })}
                aria-label={t("listen.voiceChanger.selectedModelActionLabel", {
                  defaultValue: "Selected Voice Changer model: {{modelLabel}}",
                  modelLabel: selectedVoiceChangerLabel,
                })}
              >
                {selectedVoiceChangerIconId ? (
                  <ProviderIcon
                    providerId={selectedVoiceChangerIconId}
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
                  {selectedVoiceChangerLabel}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-xs text-[var(--muted)]">
              <Keyboard className="h-3.5 w-3.5 shrink-0" />
              <span>
                {t("listen.voiceChanger.recordShortcutHint", {
                  defaultValue:
                    "Focus this panel and press R to start or stop mic capture.",
                })}
              </span>
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-[var(--text)]">
                {t("listen.voiceChanger.targetProfile", {
                  defaultValue: "Target profile",
                })}
              </span>
              <select
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-sm text-[var(--text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                disabled={
                  readyProfiles.length === 0 || isConverting || isRecording
                }
              >
                {readyProfiles.length > 0 ? (
                  readyProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {t("listen.voiceChanger.noReadyProfiles", {
                      defaultValue: "No ready profiles",
                    })}
                  </option>
                )}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-[var(--text)]">
                {t("listen.voiceChanger.toneBlend", {
                  defaultValue: "Tone blend",
                })}
              </span>
              <div className="relative">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={tau}
                  onChange={(event) => setTau(Number(event.target.value))}
                  disabled={isConverting || isRecording}
                  aria-label={t("listen.voiceChanger.toneBlend", {
                    defaultValue: "Tone blend",
                  })}
                  className="relative z-0 block h-11 w-full cursor-pointer appearance-none bg-transparent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  style={toneBlendSliderStyle}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 z-20 -translate-y-1/2 text-sm font-semibold tabular-nums text-[var(--text)]">
                  {tau.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-medium text-[var(--muted)]">
                <span>
                  {t("listen.voiceChanger.toneBlendSource", {
                    defaultValue: "Source",
                  })}
                </span>
                <span>
                  {t("listen.voiceChanger.toneBlendTarget", {
                    defaultValue: "Target",
                  })}
                </span>
              </div>
            </label>
          </div>

          <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text)]">
                {t("listen.voiceChanger.output", { defaultValue: "Output" })}
              </p>
              <p className="truncate text-xs text-[var(--muted)]">
                {outputPath
                  ? basename(outputPath)
                  : t("listen.voiceChanger.noConvertedAudio", {
                      defaultValue: "No converted audio yet",
                    })}
              </p>
            </div>
            {outputUrl ? (
              <AudioPlayer
                src={outputUrl}
                onPlayRequest={async () => {
                  if (!outputPath) return;
                  const result = await commands.playStoryAudio(outputPath);
                  if (result.status === "error") {
                    throw new Error(result.error);
                  }
                }}
                onStopRequest={async () => {
                  const result = await commands.stopStoryAudio();
                  if (result.status === "error") {
                    throw new Error(result.error);
                  }
                }}
                title={t("listen.voiceChanger.outputTitle", {
                  defaultValue: "Voice Changer output",
                })}
                meta={outputPath ?? undefined}
                autoPlay
              />
            ) : (
              <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] px-4 text-center text-sm text-[var(--muted)]">
                {t("listen.voiceChanger.outputPlaceholder", {
                  defaultValue: "Converted audio appears here.",
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  if (!showTitle) {
    return content;
  }

  return (
    <SettingsGroup
      title={t("listen.voiceChanger.title", { defaultValue: "Voice Changer" })}
    >
      {content}
    </SettingsGroup>
  );
};
