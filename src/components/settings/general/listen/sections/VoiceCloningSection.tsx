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
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import Badge from "@/components/ui/Badge";

import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { modal } from "@/motion/springs";

import {
  createTtsVoiceProfile,
  importTtsVoiceProfileSample,
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
  isDraftVoiceModelAvailable,
  profileSupportsModel,
  ttsModelSupportsLanguage,
} from "../utils";
import { readVoiceCloningDraft, writeVoiceCloningDraft } from "../draftStorage";
import {
  DraftVoiceModelLibraryCard,
  SelectField,
  WorkflowField,
} from "../sharedComponents";

export const VoiceCloningSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const initialDraft = useMemo(readVoiceCloningDraft, []);
  const [selectedCloneModelValue, setSelectedCloneModelValue] = useState(
    initialDraft.selectedCloneModelValue,
  );
  const [voiceCloneTool, setVoiceCloneTool] = useState<"audio" | "profile">(
    initialDraft.voiceCloneTool,
  );
  const [modelWindowOpen, setModelWindowOpen] = useState(false);
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
  const visibleProfiles = selectedCloneModel
    ? speech.profiles.filter((profile) =>
        profileSupportsModel(profile, selectedCloneModel),
      )
    : speech.profiles;
  const [selectedProfileId, setSelectedProfileId] = useState(
    initialDraft.selectedProfileId,
  );
  const [profileNameDraft, setProfileNameDraft] = useState(
    initialDraft.profileNameDraft,
  );
  const [profileDescriptionDraft, setProfileDescriptionDraft] = useState(
    initialDraft.profileDescriptionDraft,
  );

  useEffect(() => {
    writeVoiceCloningDraft({
      selectedCloneModelValue,
      selectedProfileId,
      voiceCloneTool,
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
    voiceCloneTool,
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
      setVoiceCloneTool("audio");
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
      setVoiceCloneTool("audio");
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
  const cloneReadinessMessage = !speech.ttsEnabled
    ? "Enable text-to-speech before generating a cloned voice."
    : !selectedCloneModel
      ? "Choose a clone-capable model before generating."
      : !referenceAudioPathDraft
        ? "Record or choose a WAV reference file before generating."
        : !profileNameDraft.trim()
          ? "Name the new voice on the Profile tab to enable Generate."
          : null;
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
  const filteredCloneModels = availableCloneModels.filter((model) => {
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
  const orderedCloneModels = orderModelList(
    filteredCloneModels,
    "downloaded",
    modelSortMode,
    {
      label: (model: CatalogModelDescriptor) => model.label,
      active: (model: CatalogModelDescriptor) =>
        cloneModelSelectionValue(model) === selectedCloneModelValue,
      installed: (model: CatalogModelDescriptor) => model.installed,
      runnable: (model: CatalogModelDescriptor) => model.runnable,
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

  if (!speech.settings) return null;

  const handleSelectDraftCloneModel = (model: CatalogModelDescriptor) => {
    setSelectedCloneModelValue(cloneModelSelectionValue(model));
    setVoiceCloneTool("audio");
    setModelWindowOpen(false);
    speech.setStatusMessage(null);
  };

  const handleVoiceCloneToolChange = (value: "audio" | "profile") => {
    setVoiceCloneTool(value);
  };

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
        "Give your new voice profile a name on the Profile tab.",
      );
      setVoiceCloneTool("profile");
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
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-clone-model-title"
            className="relative max-h-[min(88vh,920px)] w-full max-w-[980px] overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h3
                    id="voice-clone-model-title"
                    className="truncate text-sm font-semibold text-[var(--text)]"
                  >
                    {t("listen.createVoices.models", {
                      defaultValue: "Models",
                    })}
                  </h3>
                  <Badge variant="secondary">
                    {t("modelHub.chips.cloning", { defaultValue: "Cloning" })}
                  </Badge>
                </div>
                <p className="truncate text-xs text-[var(--muted)]">
                  {t("listen.voiceCloning.draftModelPickerDetail", {
                    defaultValue:
                      "Choose a clone-capable model for this draft without changing the active app voice.",
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setModelWindowOpen(false)}
                aria-label={t("common.close", { defaultValue: "Close" })}
                title={t("common.close", { defaultValue: "Close" })}
              >
                <X aria-hidden />
              </Button>
            </div>

            <div className="space-y-4 border-b border-[var(--border)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="relative flex h-10 min-w-[220px] flex-1 items-center"
                  aria-label={t("listen.voiceCloning.searchModelsAriaLabel", {
                    defaultValue: "Search clone-capable models",
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
                    placeholder={t("listen.voiceCloning.searchModels", {
                      defaultValue: "Search clone models",
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

            <div className="max-h-[calc(min(88vh,920px)-146px)] overflow-y-auto p-4">
              {filteredCloneModels.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--text)]">
                      {t("listen.createVoices.availableModels", {
                        defaultValue: "Available Models",
                      })}
                    </h4>
                    <Badge variant="secondary">
                      {orderedCloneModels.length}
                    </Badge>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {orderedCloneModels.map((model) => (
                      <DraftVoiceModelLibraryCard
                        key={`${model.provider_id}::${model.id}`}
                        model={model}
                        provider={
                          speech.allProviders.find(
                            (provider) => provider.id === model.provider_id,
                          ) ?? null
                        }
                        selected={
                          cloneModelSelectionValue(model) ===
                          selectedCloneModelValue
                        }
                        disabled={!speech.ttsEnabled || speech.loadingPlatform}
                        onSelect={() => handleSelectDraftCloneModel(model)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className={speechLibraryCardClassName}>
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    {modelSearchQuery
                      ? t("listen.voiceCloning.noModelSearchResults", {
                          defaultValue:
                            "No downloaded, runnable clone-capable models match that search.",
                        })
                      : t("listen.voiceCloning.noCloneModels", {
                          defaultValue:
                            "No downloaded, runnable clone-capable models are available.",
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

  const profileView = (
    <div className="space-y-3">
      <div className={whiteWorkflowCardClassName}>
        <div className="space-y-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {t("listen.voiceCloning.createProfile", {
                defaultValue: "Create Profile",
              })}
            </h3>
            <p className="text-xs text-[var(--muted)]">
              {t("listen.voiceCloning.createProfileDescription", {
                defaultValue:
                  "Give the profile a name, then import one clear reference clip.",
              })}
            </p>
          </div>
          <Input
            value={profileNameDraft}
            onChange={(event) => setProfileNameDraft(event.target.value)}
            placeholder={t("listen.placeholders.voiceProfileName", {
              defaultValue: "New voice profile name",
            })}
            disabled={!speech.ttsEnabled}
            className="w-full"
          />
          <Input
            value={profileDescriptionDraft}
            onChange={(event) => setProfileDescriptionDraft(event.target.value)}
            placeholder={t("listen.placeholders.voiceProfileNote", {
              defaultValue: "Optional note about this speaker",
            })}
            disabled={!speech.ttsEnabled}
            className="w-full"
          />
        </div>
      </div>

      {visibleProfiles.length > 0 ? (
        <div className={whiteWorkflowCardClassName}>
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              {t("listen.voiceCloning.existingProfiles", {
                defaultValue: "Existing Profiles",
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              {visibleProfiles.map((profile) => (
                <Badge
                  key={profile.id}
                  variant={profile.ready ? "success" : "secondary"}
                  className="text-[11px]"
                >
                  {profile.label}
                  {profile.ready ? "" : " (needs audio)"}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  const content = (
    <>
      {modelWindow}
      <div
        className={`space-y-7 ${
          !speech.ttsEnabled ? "pointer-events-none opacity-50" : ""
        }`}
      >
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
          <SegmentedControl<"audio" | "profile">
            value={voiceCloneTool}
            onChange={handleVoiceCloneToolChange}
            layoutId="voice-clone-tool-toggle"
            ariaLabel={t("listen.voiceCloning.toolAriaLabel", {
              defaultValue: "Voice cloning tools",
            })}
            items={[
              {
                value: "audio",
                label: t("listen.voiceCloning.audioTab", {
                  defaultValue: "Audio",
                }),
              },
              {
                value: "profile",
                label: t("listen.voiceCloning.profileTab", {
                  defaultValue: "Profile",
                }),
              },
            ]}
          />
          <div className="ml-auto">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setModelWindowOpen(true)}
            >
              <Layers className="h-3.5 w-3.5" />
              {t("listen.createVoices.models", { defaultValue: "Models" })}
            </Button>
          </div>
        </div>

        {speech.statusMessage || cloneReadinessMessage ? (
          <div
            className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]"
            aria-live="polite"
          >
            {speech.statusMessage ?? cloneReadinessMessage}
          </div>
        ) : null}

        {voiceCloneTool === "audio" ? (
          <>
            <div
              className={[
                whiteWorkflowCardClassName,
                "flex min-h-[190px] flex-col items-center justify-center gap-3 border-dashed text-center transition-[border-color,background-color,box-shadow] duration-150",
                isRecording
                  ? "border-[var(--danger,red)] bg-[color-mix(in_srgb,var(--danger,red)_6%,transparent)]"
                  : isReferenceAudioDragOver
                    ? "border-[var(--accent)] bg-[var(--accent-soft,var(--panel-bg))] shadow-[var(--shadow-md,var(--shadow-sm))]"
                    : referenceAudioPathDraft
                      ? "border-[var(--accent)] bg-[var(--accent-soft,var(--panel-bg))]"
                      : "",
              ].join(" ")}
            >
              {/* Animated waveform during recording */}
              {isRecording ? (
                <div
                  className="flex h-12 items-end gap-[3px]"
                  aria-label={t("listen.voiceCloning.recordingAudio")}
                >
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="w-[4px] rounded-full bg-[var(--danger,red)]"
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
                    <p className="text-sm font-semibold text-[var(--danger,red)]">
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
                    <p className="font-mono text-xs text-[var(--text)]">
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
                      <Button
                        type="button"
                        variant="primary-soft"
                        size="icon"
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
                      </Button>
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
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
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
                  </Button>
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
        ) : (
          profileView
        )}
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
