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
import { toast } from "sonner";
import {
  FileAudio,
  FolderOpen,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import Badge from "@/components/ui/Badge";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { modal } from "@/motion/springs";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
import {
  clearProfileCollectedData,
  createTtsVoiceProfile,
  deleteTtsVoiceProfile,
  importTtsVoiceProfileSample,
  setActiveImprovementProfile,
} from "@/lib/ttsVoiceProfiles";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import type { ListenSpeechState } from "../useListenSpeechState";
import {
  speechLibraryCardClassName,
  whiteWorkflowCardClassName,
} from "../styles";
import {
  basename,
  cloneModelSelectionValue,
  getModelLanguageItems,
  profileSupportsModel,
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
  const [voiceCloneTool, setVoiceCloneTool] = useState<"models" | "profiles">(
    initialDraft.voiceCloneTool,
  );
  const [modelWindowOpen, setModelWindowOpen] = useState(false);
  const [profilesWindowOpen, setProfilesWindowOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState(
    initialDraft.modelSearchQuery,
  );
  const [referenceAudioPathDraft, setReferenceAudioPathDraft] = useState(
    initialDraft.referenceAudioPathDraft,
  );
  const [referenceTranscriptDraft, setReferenceTranscriptDraft] = useState(
    initialDraft.referenceTranscriptDraft,
  );
  const [isReferenceAudioDragOver, setIsReferenceAudioDragOver] =
    useState(false);
  const selectedCloneModel =
    speech.cloneCapableModels.find(
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
  const selectedProfile =
    visibleProfiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const lastSyncedProfileIdRef = useRef<string | null>(
    initialDraft.selectedProfileId !== "__none__"
      ? initialDraft.selectedProfileId
      : null,
  );

  useEffect(() => {
    writeVoiceCloningDraft({
      selectedCloneModelValue,
      selectedProfileId,
      voiceCloneTool,
      modelSearchQuery,
      referenceAudioPathDraft,
      referenceTranscriptDraft,
    });
  }, [
    modelSearchQuery,
    referenceAudioPathDraft,
    referenceTranscriptDraft,
    selectedCloneModelValue,
    selectedProfileId,
    voiceCloneTool,
  ]);

  useEffect(() => {
    const activeCloneModel = speech.activeModel?.capabilities
      .supports_voice_cloning
      ? speech.activeModel
      : null;
    const fallbackCloneModel =
      activeCloneModel ?? speech.cloneCapableModels[0] ?? null;

    setSelectedCloneModelValue((current) => {
      if (
        current !== "__none__" &&
        speech.cloneCapableModels.some(
          (model) => cloneModelSelectionValue(model) === current,
        )
      ) {
        return current;
      }
      return cloneModelSelectionValue(fallbackCloneModel);
    });
  }, [speech.activeModel, speech.cloneCapableModels]);

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

  useEffect(() => {
    const nextProfileId = selectedProfile?.id ?? null;
    if (lastSyncedProfileIdRef.current === nextProfileId) {
      return;
    }
    lastSyncedProfileIdRef.current = nextProfileId;
    setReferenceAudioPathDraft("");
    setReferenceTranscriptDraft(selectedProfile?.transcript ?? "");
  }, [selectedProfile?.id, selectedProfile?.transcript]);

  const acceptReferenceAudioPath = useCallback(
    (path: string) => {
      if (path.split(".").pop()?.toLowerCase() !== "wav") {
        speech.setStatusMessage(
          "Voice cloning currently requires a WAV reference file.",
        );
        return;
      }
      setReferenceAudioPathDraft(path);
      setVoiceCloneTool("profiles");
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
    if (modelWindowOpen || profilesWindowOpen) {
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
  }, [acceptReferenceAudioPath, modelWindowOpen, profilesWindowOpen]);

  if (!speech.settings) return null;

  const profilePickerOptions = [
    {
      value: "__none__",
      label:
        visibleProfiles.length > 0
          ? selectedCloneModel
            ? "No clone profile"
            : "Browse profiles"
          : "No clone profiles yet",
    },
    ...visibleProfiles.map((profile) => ({
      value: profile.id,
      label: profile.ready ? profile.label : `${profile.label} (Needs audio)`,
    })),
  ];
  const createPresetDisabled =
    !speech.ttsEnabled ||
    !selectedProfile ||
    !selectedCloneModel ||
    !profileSupportsModel(selectedProfile, selectedCloneModel) ||
    (!selectedProfile.ready && !referenceAudioPathDraft) ||
    speech.busyProfileAction === "generate";
  const normalizedModelSearch = modelSearchQuery.trim().toLowerCase();
  const filteredCloneModels = speech.cloneCapableModels.filter((model) => {
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
  const orderedCloneModels = [...filteredCloneModels].sort((first, second) => {
    const firstIsDraft =
      cloneModelSelectionValue(first) === selectedCloneModelValue;
    const secondIsDraft =
      cloneModelSelectionValue(second) === selectedCloneModelValue;

    if (firstIsDraft !== secondIsDraft) {
      return firstIsDraft ? -1 : 1;
    }

    if (first.installed !== second.installed) {
      return first.installed ? -1 : 1;
    }

    return 0;
  });

  const handleSelectDraftCloneModel = (model: CatalogModelDescriptor) => {
    setSelectedCloneModelValue(cloneModelSelectionValue(model));
    setVoiceCloneTool("models");
    setModelWindowOpen(false);
    speech.setStatusMessage(null);
  };

  const handleVoiceCloneToolChange = (value: "models" | "profiles") => {
    setVoiceCloneTool(value);
    if (value === "models") {
      setModelWindowOpen(true);
      return;
    }
    setProfilesWindowOpen(true);
  };

  const generateCloneVoice = async () => {
    if (!selectedProfile || !selectedCloneModel) return;
    speech.setBusyProfileAction("generate");
    speech.setStatusMessage(null);

    try {
      let profileForPreset = selectedProfile;
      if (referenceAudioPathDraft) {
        profileForPreset = await importTtsVoiceProfileSample(
          selectedProfile.id,
          referenceAudioPathDraft,
          referenceTranscriptDraft.trim() || null,
        );
        await speech.refreshProfiles();
        setSelectedProfileId(profileForPreset.id);
        setReferenceAudioPathDraft("");
        setReferenceTranscriptDraft(profileForPreset.transcript ?? "");
      }

      await speech.createPresetFromProfile(
        profileForPreset,
        selectedCloneModel,
      );
      setProfilesWindowOpen(false);
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
              <label
                className="relative flex h-10 w-full items-center"
                aria-label={t("listen.voiceCloning.searchModelsAriaLabel", {
                  defaultValue: "Search clone-capable models",
                })}
              >
                <Search
                  className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--muted)]"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={modelSearchQuery}
                  onChange={(event) => setModelSearchQuery(event.target.value)}
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
            </div>

            <div className="max-h-[calc(min(88vh,920px)-146px)] overflow-y-auto p-4">
              {filteredCloneModels.length > 0 ? (
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
                            "No clone-capable models are available.",
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

  const profilesWindow = createPortal(
    <AnimatePresence>
      {profilesWindowOpen ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setProfilesWindowOpen(false)}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-clone-profiles-title"
            className="relative max-h-[min(88vh,900px)] w-full max-w-[820px] overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="min-w-0">
                <h3
                  id="voice-clone-profiles-title"
                  className="truncate text-sm font-semibold text-[var(--text)]"
                >
                  {t("listen.voiceCloning.profiles", {
                    defaultValue: "Profiles",
                  })}
                </h3>
                <p className="truncate text-xs text-[var(--muted)]">
                  {t("listen.voiceCloning.profilesWindowDetail", {
                    defaultValue:
                      "Choose or create the reference profile used when you generate a cloned voice.",
                  })}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setProfilesWindowOpen(false)}
                aria-label={t("common.close", { defaultValue: "Close" })}
                title={t("common.close", { defaultValue: "Close" })}
              >
                <X aria-hidden />
              </Button>
            </div>

            <div className="max-h-[calc(min(88vh,900px)-57px)] space-y-4 overflow-y-auto p-4">
              <WorkflowField
                label="Clone Profile"
                hint={
                  selectedCloneModel
                    ? "Only profiles that work with the selected clone model are shown."
                    : "Pick a model first to filter the profile library to compatible voices."
                }
              >
                <SelectField
                  value={selectedProfileId}
                  onChange={(value) => {
                    setSelectedProfileId(value);
                    setVoiceCloneTool("profiles");
                  }}
                  disabled={!speech.ttsEnabled || speech.loadingProfiles}
                  options={profilePickerOptions}
                />
              </WorkflowField>

              {selectedProfile ? (
                <div className="space-y-3 text-xs text-[var(--muted)]">
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedProfile.fully_optimized ? (
                      <Badge
                        variant="success"
                        className="gap-1 px-2.5 py-1 text-[11px] font-semibold"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                        {t("listen.voiceCloning.fullyOptimized")}
                      </Badge>
                    ) : selectedProfile.ready ? (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                        {t("listen.voiceCloning.readyForCloning")}
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-[var(--warning-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--warning)]"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />
                        {t("listen.voiceCloning.needsReferenceAudio")}
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="ms-auto">
                      <Button
                        type="button"
                        variant="danger-ghost"
                        size="sm"
                        disabled={
                          !speech.ttsEnabled ||
                          speech.busyProfileAction === "delete"
                        }
                        onClick={async () => {
                          if (
                            !confirmDestructiveAction(
                              t("listen.voiceCloning.deleteProfileConfirm", {
                                profileLabel: selectedProfile.label,
                                defaultValue:
                                  'Delete voice profile "{{profileLabel}}"?',
                              }),
                            )
                          ) {
                            return;
                          }

                          speech.setBusyProfileAction("delete");
                          try {
                            await deleteTtsVoiceProfile(selectedProfile.id);
                            await speech.refreshProfiles();
                          } catch (error) {
                            console.error(
                              "Failed to delete voice profile:",
                              error,
                            );
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : t("listen.voiceCloning.deleteProfileFailed", {
                                    defaultValue:
                                      "Could not delete voice profile.",
                                  }),
                            );
                          } finally {
                            speech.setBusyProfileAction(null);
                          }
                        }}
                      >
                        {t("listen.voiceCloning.deleteProfile")}
                      </Button>
                    </div>
                  </div>

                  {selectedProfile.reference_audio_path ? (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
                        {t("listen.voiceCloning.audioFile")}
                      </p>
                      <p className="break-all font-mono text-[11px] text-[var(--text)]">
                        {selectedProfile.reference_audio_path}
                      </p>
                    </div>
                  ) : null}
                  {selectedProfile.transcript ? (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
                        {t("listen.voiceCloning.transcript")}
                      </p>
                      <p className="text-[11px] text-[var(--text)]">
                        {selectedProfile.transcript}
                      </p>
                    </div>
                  ) : (
                    <p className="italic text-[var(--muted)]">
                      {t("listen.voiceCloning.transcriptHint")}
                    </p>
                  )}
                  <div className="mt-2 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-[var(--text)]">
                          {t("listen.voiceCloning.improveFromDictations")}
                        </p>
                        <p className="text-[10px] text-[var(--muted)]">
                          {t(
                            "listen.voiceCloning.improveFromDictationsDescription",
                          )}
                        </p>
                      </div>
                      <SwitchControl
                        checked={selectedProfile.continuous_improvement_enabled}
                        disabled={
                          !speech.ttsEnabled || selectedProfile.fully_optimized
                        }
                        onChange={(checked) => {
                          void setActiveImprovementProfile(
                            selectedProfile.id,
                            checked,
                          ).then(() => speech.refreshProfiles());
                        }}
                      />
                    </div>
                    {(selectedProfile.collected_audio_duration_secs > 0 ||
                      selectedProfile.continuous_improvement_enabled) && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-[var(--muted)]">
                            {selectedProfile.fully_optimized
                              ? "Fully optimized"
                              : selectedProfile.continuous_improvement_enabled
                                ? "Currently learning"
                                : "Collection paused"}
                          </span>
                          <span className="font-mono text-[10px] text-[var(--muted)]">
                            {`${Math.round(selectedProfile.collected_audio_duration_secs)}s / ${Math.round(selectedProfile.satisfactory_threshold_secs)}s`}
                          </span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--input)]">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              selectedProfile.fully_optimized
                                ? "bg-[var(--success)]"
                                : "bg-[var(--accent)]"
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                (selectedProfile.collected_audio_duration_secs /
                                  selectedProfile.satisfactory_threshold_secs) *
                                  100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {selectedProfile.collected_audio_duration_secs > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (
                            !confirmDestructiveAction(
                              t(
                                "listen.voiceCloning.clearCollectedDataConfirm",
                                {
                                  profileLabel: selectedProfile.label,
                                  defaultValue:
                                    'Clear collected training data for "{{profileLabel}}"?',
                                },
                              ),
                            )
                          ) {
                            return;
                          }

                          try {
                            await clearProfileCollectedData(selectedProfile.id);
                            await speech.refreshProfiles();
                          } catch (error) {
                            console.error(
                              "Failed to clear collected data:",
                              error,
                            );
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : t(
                                    "listen.voiceCloning.clearCollectedDataFailed",
                                    {
                                      defaultValue:
                                        "Could not clear collected data.",
                                    },
                                  ),
                            );
                          }
                        }}
                        disabled={!speech.ttsEnabled}
                        className="text-red-500 hover:text-red-600"
                      >
                        {t("listen.voiceCloning.clearCollectedData")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-6 text-[var(--muted)]">
                  {selectedCloneModel
                    ? "Choose or create a clone profile to start using reference audio with this model."
                    : "Choose a clone model first, then pick or create a profile to start building a cloned voice here."}
                </p>
              )}

              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="space-y-3">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold text-[var(--text)]">
                      {t("listen.voiceCloning.createProfile")}
                    </h3>
                    <p className="text-xs text-[var(--muted)]">
                      {t("listen.voiceCloning.createProfileDescription")}
                    </p>
                  </div>
                  <Input
                    value={speech.profileNameDraft}
                    onChange={(event) =>
                      speech.setProfileNameDraft(event.target.value)
                    }
                    placeholder={t("listen.placeholders.voiceProfileName")}
                    disabled={!speech.ttsEnabled}
                    className="w-full"
                  />
                  <Input
                    value={speech.profileDescriptionDraft}
                    onChange={(event) =>
                      speech.setProfileDescriptionDraft(event.target.value)
                    }
                    placeholder={t("listen.placeholders.voiceProfileNote")}
                    disabled={!speech.ttsEnabled}
                    className="w-full"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={
                        !speech.ttsEnabled ||
                        !speech.profileNameDraft.trim() ||
                        speech.busyProfileAction === "create"
                      }
                      onClick={async () => {
                        speech.setBusyProfileAction("create");
                        try {
                          const createdProfile = await createTtsVoiceProfile(
                            speech.profileNameDraft,
                            speech.profileDescriptionDraft || null,
                            speech.profileTranscriptDraft || null,
                          );
                          speech.setProfileNameDraft("");
                          speech.setProfileDescriptionDraft("");
                          speech.setProfileTranscriptDraft("");
                          await speech.refreshProfiles();
                          setSelectedProfileId(createdProfile.id);
                        } finally {
                          speech.setBusyProfileAction(null);
                        }
                      }}
                    >
                      {t("listen.voiceCloning.createProfileButton")}
                    </Button>
                  </div>
                </div>
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
      {profilesWindow}
      <div
        className={`space-y-3 ${
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
            <Sparkles className="h-3.5 w-3.5" />
            {t("listen.voiceCloning.generate", { defaultValue: "Generate" })}
          </Button>
          <SegmentedControl<"models" | "profiles">
            value={voiceCloneTool}
            onChange={handleVoiceCloneToolChange}
            layoutId="voice-clone-tool-toggle"
            ariaLabel={t("listen.voiceCloning.toolAriaLabel", {
              defaultValue: "Voice cloning tools",
            })}
            items={[
              {
                value: "models",
                label: t("listen.createVoices.models", {
                  defaultValue: "Models",
                }),
              },
              {
                value: "profiles",
                label: t("listen.voiceCloning.profiles", {
                  defaultValue: "Profiles",
                }),
              },
            ]}
          />
        </div>

        {speech.statusMessage ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
            {speech.statusMessage}
          </div>
        ) : null}

        <div
          className={[
            whiteWorkflowCardClassName,
            "flex min-h-[190px] flex-col items-center justify-center gap-3 border-dashed text-center transition-[border-color,background-color,box-shadow] duration-150",
            isReferenceAudioDragOver
              ? "border-[var(--accent)] bg-[var(--accent-soft,var(--panel-bg))] shadow-[var(--shadow-md,var(--shadow-sm))]"
              : "",
          ].join(" ")}
        >
          <div
            className="flex size-12 items-center justify-center rounded-full bg-[var(--input)] text-[var(--muted)]"
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
          <div className="max-w-xl space-y-1">
            <p className="text-sm font-medium text-[var(--text)]">
              {referenceAudioPathDraft
                ? basename(referenceAudioPathDraft)
                : t("listen.voiceCloning.dropReferenceAudio", {
                    defaultValue: "Drag & drop a WAV reference audio file",
                  })}
            </p>
            <p className="text-xs leading-5 text-[var(--muted)]">
              {t("listen.voiceCloning.referenceAudioHint", {
                defaultValue:
                  "Use a clear voice sample. The transcript can guide cloning; if left blank, Vox Jot will try to transcribe the sample.",
              })}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            onClick={() => void pickReferenceAudio()}
            disabled={!speech.ttsEnabled}
            aria-label={t("listen.voiceCloning.pickReferenceAudio", {
              defaultValue: "Choose reference audio in Finder",
            })}
            title={t("listen.voiceCloning.pickReferenceAudio", {
              defaultValue: "Choose reference audio in Finder",
            })}
          >
            <FolderOpen aria-hidden />
          </Button>
        </div>

        <div className={whiteWorkflowCardClassName}>
          <WorkflowField
            label={t("listen.voiceCloning.transcript", {
              defaultValue: "Transcript",
            })}
            hint={t("listen.voiceCloning.transcriptForCloneHint", {
              defaultValue: "Optional text for the reference audio.",
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
      </div>
    </>
  );

  if (!showTitle) {
    return content;
  }

  return <SettingsGroup title="Voice Cloning">{content}</SettingsGroup>;
};
