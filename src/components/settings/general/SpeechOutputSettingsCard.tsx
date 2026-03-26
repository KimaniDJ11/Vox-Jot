import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Globe, Play, RefreshCw, Sparkles, Square } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { commands, type TtsPackInfo, type VoiceInfo } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { Slider } from "@/components/ui/Slider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { OutputDeviceSelector } from "@/components/settings/OutputDeviceSelector";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { SpeechOutputToggle } from "@/components/settings/SpeechOutputToggle";
import {
  getModelPlatformOverview,
  setTtsPlatformSelection,
  type CatalogModelDescriptor,
  type ModelPlatformOverview,
  type ProviderDescriptor,
} from "@/lib/modelPlatform";
import {
  clearProfileCollectedData,
  createTtsVoiceProfile,
  deleteTtsVoiceProfile,
  importTtsVoiceProfileSample,
  listTtsVoiceProfiles,
  setActiveImprovementProfile,
  type TtsVoiceProfileDescriptor,
} from "@/lib/ttsVoiceProfiles";

function SelectField({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-flex">
      <select
        className="min-w-[220px] appearance-none rounded-full border border-[var(--border)] bg-[var(--bg)] py-2 pe-9 ps-4 text-sm font-semibold shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </div>
  );
}

function localeLabel(locale: string | null | undefined) {
  return locale ? ` (${locale})` : "";
}

function sourceKindLabel(sourceKind: CatalogModelDescriptor["source_kind"]) {
  return sourceKind === "runtime" ? "Runtime" : "Built-in";
}

const refreshLabel = "Refresh";
const previewVoiceLabel = "Preview voice";
const stopLabel = "Stop";
const importWavLabel = "Import WAV";
const deleteLabel = "Delete";
const createProfileLabel = "Create profile";
const removeLabel = "Remove";
const downloadLabel = "Download";
const cloningReadyLabel = "Ready for cloning";
const cloningSetupLabel = "Create or import a reference WAV to finish setup";
const transcriptHintLabel =
  "Optional, but adding the spoken transcript can improve Qwen clone quality.";
const createProfileHelpLabel =
  "Start with a profile name, then import one clear WAV reference clip.";
const cloningActivationNotice =
  "The selected profile is saved across providers, but Vox Jot only activates cloning when Qwen3 Native with Qwen3 0.6B Base is the active speech model.";
const speechLibraryCardClassName =
  "group rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]";
const speechLibraryBadgeClassName =
  "inline-flex items-center rounded-full bg-[var(--input)] px-3 py-1 text-xs font-medium text-[var(--muted)]";
const speechLibraryActiveBadgeClassName =
  "inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white shadow-[var(--shadow-sm)]";
const speechLibraryCountBadgeClassName =
  "inline-flex min-w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]";

type SpeechOutputState = ReturnType<typeof useSpeechOutputState>;

function useSpeechOutputState() {
  const { settings, updateSetting, isUpdating, refreshSettings } =
    useSettings();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [packs, setPacks] = useState<TtsPackInfo[]>([]);
  const [platformOverview, setPlatformOverview] =
    useState<ModelPlatformOverview | null>(null);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [loadingPacks, setLoadingPacks] = useState(false);
  const [loadingPlatform, setLoadingPlatform] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<TtsVoiceProfileDescriptor[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [profileDescriptionDraft, setProfileDescriptionDraft] = useState("");
  const [profileTranscriptDraft, setProfileTranscriptDraft] = useState("");
  const [busyProfileAction, setBusyProfileAction] = useState<string | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    const result = await commands.getAvailableTtsVoices();
    if (result.status === "ok") {
      setVoices(result.data);
      setStatusMessage(null);
    } else {
      setVoices([]);
      setStatusMessage(result.error);
    }
    setLoadingVoices(false);
  }, []);

  const refreshVoices = useCallback(async () => {
    setLoadingVoices(true);
    const result = await commands.refreshTtsVoices();
    if (result.status === "ok") {
      setVoices(result.data);
      setStatusMessage(null);
    } else {
      setVoices([]);
      setStatusMessage(result.error);
    }
    setLoadingVoices(false);
  }, []);

  const refreshPacks = useCallback(async () => {
    setLoadingPacks(true);
    const result = await commands.getAvailableTtsPacks();
    if (result.status === "ok") {
      setPacks(result.data);
    }
    setLoadingPacks(false);
  }, []);

  const refreshPlatform = useCallback(async () => {
    setLoadingPlatform(true);
    try {
      const overview = await getModelPlatformOverview();
      setPlatformOverview(overview);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to load TTS catalog",
      );
    } finally {
      setLoadingPlatform(false);
    }
  }, []);

  const refreshProfiles = useCallback(async () => {
    setLoadingProfiles(true);
    try {
      const nextProfiles = await listTtsVoiceProfiles();
      setProfiles(nextProfiles);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to load voice profiles",
      );
    } finally {
      setLoadingProfiles(false);
    }
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }
    void loadVoices();
    void refreshPacks();
    void refreshPlatform();
    void refreshProfiles();
  }, [
    loadVoices,
    refreshPacks,
    refreshPlatform,
    refreshProfiles,
    settings?.tts_engine_preference,
    settings?.tts_enabled,
    settings?.tts_default_voice_id,
    settings?.selected_tts_provider_id,
    settings?.selected_tts_model_id,
  ]);

  const selectedVoiceId = settings?.tts_default_voice_id ?? "__auto__";
  const ttsEnabled = settings?.tts_enabled ?? false;
  const packInstalled = packs.some((pack) => pack.installed);
  const visibleProviders = useMemo(
    () =>
      (platformOverview?.tts.providers ?? []).filter(
        (provider) => provider.available && !provider.coming_soon,
      ),
    [platformOverview],
  );
  const visibleModels = useMemo(() => {
    const providerIds = new Set(
      visibleProviders.map((provider) => provider.id),
    );
    return (platformOverview?.tts.models ?? []).filter(
      (model) =>
        providerIds.has(model.provider_id) && !model.capabilities.coming_soon,
    );
  }, [platformOverview, visibleProviders]);

  const voiceOptions = useMemo(
    () => [
      { value: "__auto__", label: "Automatic voice" },
      ...voices.map((voice) => ({
        value: voice.id,
        label: `${voice.label}${localeLabel(voice.locale)}`,
      })),
    ],
    [voices],
  );

  const selectedProviderId =
    platformOverview?.selection.selected_tts_provider_id ?? "";
  const selectedModelId =
    platformOverview?.selection.selected_tts_model_id ?? "__auto__";
  const activeProviderId =
    platformOverview?.selection.active_tts_provider_id ?? "";
  const activeModelId = platformOverview?.selection.active_tts_model_id ?? "";
  const selectedProvider = useMemo<ProviderDescriptor | null>(
    () =>
      visibleProviders.find((provider) => provider.id === selectedProviderId) ??
      null,
    [selectedProviderId, visibleProviders],
  );
  const selectedModel = useMemo<CatalogModelDescriptor | null>(
    () => visibleModels.find((model) => model.id === selectedModelId) ?? null,
    [selectedModelId, visibleModels],
  );
  const activeProvider = useMemo<ProviderDescriptor | null>(
    () =>
      visibleProviders.find((provider) => provider.id === activeProviderId) ??
      null,
    [activeProviderId, visibleProviders],
  );
  const activeModel = useMemo<CatalogModelDescriptor | null>(
    () => visibleModels.find((model) => model.id === activeModelId) ?? null,
    [activeModelId, visibleModels],
  );
  const selectedProfileId = settings?.selected_tts_profile_id ?? "__none__";
  const selectedProfile = useMemo(
    () =>
      profiles.find(
        (profile) => profile.id === settings?.selected_tts_profile_id,
      ) ?? null,
    [profiles, settings?.selected_tts_profile_id],
  );
  const qwenCloneEnabled = Boolean(
    activeProvider?.id === "qwen3_native" &&
      activeModel?.id === "qwen3-0.6b-base",
  );
  const voiceCloningModels = useMemo(
    () =>
      visibleModels.filter(
        (model) => model.capabilities.supports_voice_cloning && model.runnable,
      ),
    [visibleModels],
  );
  const compatibleProfiles = useMemo(
    () =>
      profiles.filter(
        (profile) =>
          profile.compatible_provider_ids.includes("qwen3_native") &&
          profile.compatible_model_ids.includes("qwen3-0.6b-base"),
      ),
    [profiles],
  );
  const profileOptions = useMemo(
    () => [
      { value: "__none__", label: "No voice profile" },
      ...compatibleProfiles.map((profile) => ({
        value: profile.id,
        label: profile.ready ? profile.label : `${profile.label} (Needs audio)`,
      })),
    ],
    [compatibleProfiles],
  );

  useEffect(() => {
    if (!selectedProfile) {
      return;
    }
    setProfileTranscriptDraft(selectedProfile.transcript ?? "");
  }, [selectedProfile]);

  const providerOptions = useMemo(
    () =>
      visibleProviders.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    [visibleProviders],
  );

  const modelOptions = useMemo(
    () =>
      visibleModels
        .filter((model) => model.provider_id === selectedProviderId)
        .map((model) => ({
          value: model.id,
          label: model.label,
        })),
    [selectedProviderId, visibleModels],
  );
  const providerSelectionValue = useMemo(
    () =>
      providerOptions.some((option) => option.value === selectedProviderId)
        ? selectedProviderId
        : (providerOptions[0]?.value ?? ""),
    [providerOptions, selectedProviderId],
  );
  const modelSelectionValue = useMemo(
    () =>
      modelOptions.some((option) => option.value === selectedModelId)
        ? selectedModelId
        : (modelOptions[0]?.value ?? ""),
    [modelOptions, selectedModelId],
  );

  const engineStatus = useMemo(() => {
    if (statusMessage) {
      return statusMessage;
    }
    if (selectedModel && !selectedModel.runnable) {
      return (
        selectedModel.readiness_issues[0] ??
        "The selected speech model is not ready on this Mac yet."
      );
    }
    if (activeProvider && activeModel) {
      return `${activeModel.runtime.label}. ${activeProvider.source_label}.`;
    }
    if (selectedProvider && selectedModel) {
      return `${selectedModel.runtime.label}. ${selectedProvider.source_label}.`;
    }
    if (selectedProvider) {
      return `${selectedProvider.runtime.label}. ${selectedProvider.description}`;
    }
    return packInstalled
      ? "Speech output is ready and will auto-route to the selected local runtime."
      : "Choose a provider and model, then Vox Jot will handle the speech runtime automatically.";
  }, [
    activeModel,
    activeProvider,
    packInstalled,
    selectedModel,
    selectedProvider,
    statusMessage,
  ]);

  const syncSelection = useCallback(
    async (providerId: string, modelId?: string | null) => {
      await setTtsPlatformSelection(providerId, modelId ?? null);
      await refreshSettings();
      await refreshPlatform();
      await refreshVoices();
      await refreshProfiles();
    },
    [refreshPlatform, refreshProfiles, refreshSettings, refreshVoices],
  );

  const selectProvider = useCallback(
    async (providerId: string) => {
      const defaultModelId =
        visibleModels.find((model) => model.provider_id === providerId)?.id ??
        null;
      try {
        await syncSelection(providerId, defaultModelId);
        setStatusMessage(null);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [syncSelection, visibleModels],
  );

  const selectModel = useCallback(
    async (providerId: string, modelId: string) => {
      try {
        await syncSelection(providerId, modelId);
        setStatusMessage(null);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [syncSelection],
  );

  const previewSelectedVoice = useCallback(async () => {
    setPreviewingVoice(true);
    const result = await commands.previewTtsVoice(
      selectedProviderId === "qwen3_native"
        ? null
        : (settings?.tts_default_voice_id ?? null),
    );
    if (result.status !== "ok") {
      setStatusMessage(result.error);
    } else {
      setStatusMessage(null);
    }
    setPreviewingVoice(false);
  }, [selectedProviderId, settings?.tts_default_voice_id]);

  useEffect(() => {
    if (loadingPlatform || visibleProviders.length === 0) {
      return;
    }

    const nextProviderId = visibleProviders.some(
      (provider) => provider.id === selectedProviderId,
    )
      ? selectedProviderId
      : (visibleProviders[0]?.id ?? "");

    if (!nextProviderId) {
      return;
    }

    const providerModels = visibleModels.filter(
      (model) => model.provider_id === nextProviderId,
    );
    const nextModelId = providerModels.some(
      (model) => model.id === selectedModelId,
    )
      ? selectedModelId
      : (providerModels[0]?.id ?? null);

    if (
      nextProviderId === selectedProviderId &&
      (nextModelId ?? null) === (selectedModelId || null)
    ) {
      return;
    }

    void syncSelection(nextProviderId, nextModelId).catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    });
  }, [
    loadingPlatform,
    selectedModelId,
    selectedProviderId,
    syncSelection,
    visibleModels,
    visibleProviders,
  ]);

  return {
    settings,
    updateSetting,
    isUpdating,
    refreshSettings,
    voices,
    packs,
    platformOverview,
    loadingVoices,
    loadingPacks,
    loadingPlatform,
    previewingVoice,
    busyPackId,
    profiles,
    loadingProfiles,
    profileNameDraft,
    profileDescriptionDraft,
    profileTranscriptDraft,
    busyProfileAction,
    statusMessage,
    setStatusMessage,
    setPreviewingVoice,
    setBusyPackId,
    setProfileNameDraft,
    setProfileDescriptionDraft,
    setProfileTranscriptDraft,
    setBusyProfileAction,
    refreshVoices,
    refreshPacks,
    refreshPlatform,
    refreshProfiles,
    selectedVoiceId,
    activeProvider,
    activeProviderId,
    activeModel,
    activeModelId,
    selectedProvider,
    selectedProviderId,
    selectedModel,
    selectedModelId,
    selectedProfileId,
    selectedProfile,
    qwenCloneEnabled,
    voiceCloningModels,
    profileOptions,
    providerOptions,
    providerSelectionValue,
    modelOptions,
    modelSelectionValue,
    ttsEnabled,
    voiceOptions,
    engineStatus,
    visibleProviders,
    visibleModels,
    previewSelectedVoice,
    selectProvider,
    selectModel,
  };
}

function formatModelLanguageSummary(model: CatalogModelDescriptor) {
  if (model.supported_languages.length === 0) {
    return model.locale
      ? `Locale: ${model.locale}`
      : "Provider-managed speech model";
  }

  const languages = model.supported_languages.slice(0, 5);
  const remainder = model.supported_languages.length - languages.length;
  return remainder > 0
    ? `${languages.join(", ")} +${remainder} more`
    : languages.join(", ");
}

function formatModelCapabilityTags(model: CatalogModelDescriptor) {
  const tags: string[] = [];

  if (model.capabilities.supports_voice_cloning) {
    tags.push("Voice cloning");
  }
  if (model.capabilities.supports_instruction_prompt) {
    tags.push("Instructions");
  }
  if (model.capabilities.local_only) {
    tags.push("Local");
  }
  if (model.downloadable) {
    tags.push("Downloadable");
  }

  return tags.slice(0, 3);
}

const VoiceCloningProfilesSetting: React.FC<{
  speech: SpeechOutputState;
}> = ({ speech }) => {
  if (speech.voiceCloningModels.length === 0) {
    return (
      <SettingContainer
        title="Voice Cloning Profiles"
        description="Create reusable reference-voice profiles for cloning-capable TTS models."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
      >
        <p className="text-sm leading-6 text-[var(--muted)]">
          Voice cloning turns on after you install the `Qwen3 0.6B Base` pack
          from Offline Voice Packs and make it the active speech model.
        </p>
      </SettingContainer>
    );
  }

  return (
    <SettingContainer
      title="Voice Cloning Profiles"
      description="Create reusable reference-voice profiles for cloning-capable TTS models."
      descriptionMode="tooltip"
      grouped={true}
      layout="stacked"
    >
      <div className="space-y-3">
        <p className="text-xs text-[var(--muted)]">
          {speech.qwenCloneEnabled
            ? "Qwen3 0.6B Base can clone from a saved reference voice profile. Import a WAV file and Vox Jot will normalize it to the format the runtime expects."
            : "Voice cloning is currently active when Qwen3 Native + Qwen3 0.6B Base is selected."}
        </p>

        <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              value={speech.selectedProfileId}
              onChange={(value) =>
                void speech.updateSetting(
                  "selected_tts_profile_id",
                  value === "__none__" ? null : value,
                )
              }
              disabled={!speech.ttsEnabled || speech.loadingProfiles}
              options={speech.profileOptions}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void speech.refreshProfiles()}
              disabled={speech.loadingProfiles}
              className="inline-flex items-center gap-1"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${speech.loadingProfiles ? "animate-spin" : ""}`}
              />
              {refreshLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                !speech.ttsEnabled ||
                speech.selectedProfileId === "__none__" ||
                speech.busyProfileAction === "import"
              }
              onClick={async () => {
                const filePath = await open({
                  multiple: false,
                  filters: [{ name: "WAV", extensions: ["wav"] }],
                });
                if (!filePath || Array.isArray(filePath)) {
                  return;
                }

                speech.setBusyProfileAction("import");
                try {
                  await importTtsVoiceProfileSample(
                    speech.selectedProfileId,
                    filePath,
                    speech.profileTranscriptDraft || null,
                  );
                  speech.setStatusMessage(null);
                  await speech.refreshProfiles();
                } catch (error) {
                  speech.setStatusMessage(
                    error instanceof Error ? error.message : String(error),
                  );
                } finally {
                  speech.setBusyProfileAction(null);
                }
              }}
            >
              {importWavLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={
                !speech.ttsEnabled ||
                speech.selectedProfileId === "__none__" ||
                speech.busyProfileAction === "delete"
              }
              onClick={async () => {
                speech.setBusyProfileAction("delete");
                try {
                  await deleteTtsVoiceProfile(speech.selectedProfileId);
                  await speech.updateSetting("selected_tts_profile_id", null);
                  speech.setStatusMessage(null);
                  await speech.refreshProfiles();
                } catch (error) {
                  speech.setStatusMessage(
                    error instanceof Error ? error.message : String(error),
                  );
                } finally {
                  speech.setBusyProfileAction(null);
                }
              }}
            >
              {deleteLabel}
            </Button>
          </div>

          {speech.selectedProfile ? (
            <div className="space-y-2 text-xs text-[var(--muted)]">
              <p>{`Status: ${speech.selectedProfile.fully_optimized ? "Fully optimized" : speech.selectedProfile.ready ? cloningReadyLabel : cloningSetupLabel}`}</p>
              {speech.selectedProfile.reference_audio_path ? (
                <p className="break-all">
                  {`Audio: ${speech.selectedProfile.reference_audio_path}`}
                </p>
              ) : null}
              {speech.selectedProfile.transcript ? (
                <p>{`Transcript: ${speech.selectedProfile.transcript}`}</p>
              ) : (
                <p>{`Transcript: ${transcriptHintLabel}`}</p>
              )}

              {/* Continuous Improvement */}
              <div className="mt-2 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-[var(--fg)]">
                      Improve from my dictations
                    </p>
                    <p className="text-[10px] text-[var(--muted)]">
                      Uses your speech-to-text dictations to refine this voice
                      clone. Audio is saved locally only.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={
                      speech.selectedProfile.continuous_improvement_enabled
                    }
                    onChange={async (enabled) => {
                      try {
                        await setActiveImprovementProfile(
                          speech.selectedProfile!.id,
                          enabled,
                        );
                        await speech.refreshProfiles();
                      } catch (error) {
                        speech.setStatusMessage(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    }}
                    label="Improve from my dictations"
                    description="Uses your speech-to-text dictations to refine this voice clone. Audio is saved locally only."
                    grouped={false}
                    disabled={
                      !speech.ttsEnabled ||
                      speech.selectedProfile.fully_optimized
                    }
                  />
                </div>

                {/* Progress bar */}
                {(speech.selectedProfile.collected_audio_duration_secs > 0 ||
                  speech.selectedProfile.continuous_improvement_enabled) && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span>
                        {speech.selectedProfile.fully_optimized
                          ? "Fully optimized"
                          : speech.selectedProfile
                                .continuous_improvement_enabled
                            ? "Currently learning"
                            : "Collection paused"}
                      </span>
                      <span>
                        {`${Math.round(speech.selectedProfile.collected_audio_duration_secs)}s / ${Math.round(speech.selectedProfile.satisfactory_threshold_secs)}s`}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--input)]">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          speech.selectedProfile.fully_optimized
                            ? "bg-green-500"
                            : "bg-[var(--accent)]"
                        }`}
                        style={{
                          width: `${Math.min(100, (speech.selectedProfile.collected_audio_duration_secs / speech.selectedProfile.satisfactory_threshold_secs) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Clear collected data */}
                {speech.selectedProfile.collected_audio_duration_secs > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await clearProfileCollectedData(
                          speech.selectedProfile!.id,
                        );
                        await speech.refreshProfiles();
                      } catch (error) {
                        speech.setStatusMessage(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    }}
                    disabled={!speech.ttsEnabled}
                    className="text-red-500 hover:text-red-600"
                  >
                    Clear collected data
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
          <Input
            value={speech.profileNameDraft}
            onChange={(event) => speech.setProfileNameDraft(event.target.value)}
            placeholder="New voice profile name"
            disabled={!speech.ttsEnabled}
          />
          <Input
            value={speech.profileDescriptionDraft}
            onChange={(event) =>
              speech.setProfileDescriptionDraft(event.target.value)
            }
            placeholder="Optional note about this speaker"
            disabled={!speech.ttsEnabled}
          />
          <Textarea
            value={speech.profileTranscriptDraft}
            onChange={(event) =>
              speech.setProfileTranscriptDraft(event.target.value)
            }
            placeholder="Optional transcript of the reference audio"
            disabled={!speech.ttsEnabled}
            className="min-h-[92px]"
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
                  const profile = await createTtsVoiceProfile(
                    speech.profileNameDraft,
                    speech.profileDescriptionDraft || null,
                    speech.profileTranscriptDraft || null,
                  );
                  await speech.updateSetting(
                    "selected_tts_profile_id",
                    profile.id,
                  );
                  speech.setProfileNameDraft("");
                  speech.setProfileDescriptionDraft("");
                  speech.setStatusMessage(null);
                  await speech.refreshProfiles();
                } catch (error) {
                  speech.setStatusMessage(
                    error instanceof Error ? error.message : String(error),
                  );
                } finally {
                  speech.setBusyProfileAction(null);
                }
              }}
            >
              {createProfileLabel}
            </Button>
            <p className="text-xs text-[var(--muted)]">
              {createProfileHelpLabel}
            </p>
          </div>
        </div>

        {!speech.qwenCloneEnabled ? (
          <p className="text-xs text-[var(--muted)]">
            {cloningActivationNotice}
          </p>
        ) : null}
      </div>
    </SettingContainer>
  );
};

const SpeechModelLibraryCard: React.FC<{
  model: CatalogModelDescriptor;
  provider: ProviderDescriptor | null;
  active: boolean;
  selected: boolean;
  speech: SpeechOutputState;
}> = ({ model, provider, active, selected, speech }) => {
  const capabilityTags = formatModelCapabilityTags(model);
  const clickable = !active && speech.ttsEnabled && !speech.loadingPlatform;
  const cardStateClassName = active
    ? "border-[var(--accent)] shadow-[var(--shadow-md)]"
    : selected
      ? "border-logo-primary/40 bg-logo-primary/5 shadow-[var(--shadow-sm)]"
      : clickable
        ? "cursor-pointer hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-md"
        : "";
  const titleClassName = clickable
    ? "transition-colors group-hover:text-[var(--accent)]"
    : "";
  const handleActivate = () => {
    if (!clickable) {
      return;
    }
    void speech.selectModel(model.provider_id, model.id);
  };

  return (
    <div
      className={`${speechLibraryCardClassName} ${cardStateClassName}`}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && clickable) {
          event.preventDefault();
          handleActivate();
        }
      }}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={`text-base font-semibold text-[var(--text)] ${titleClassName}`}
            >
              {model.label}
            </h3>
            {active ? (
              <span className={speechLibraryActiveBadgeClassName}>
                <Check className="h-4 w-4" />
                Active
              </span>
            ) : selected ? (
              <span className={speechLibraryActiveBadgeClassName}>
                Selected
              </span>
            ) : null}
            <span className={speechLibraryBadgeClassName}>
              {provider?.label ?? "Provider"}
            </span>
            <span className={speechLibraryBadgeClassName}>
              {sourceKindLabel(model.source_kind)}
            </span>
            {model.installed ? (
              <span className={speechLibraryBadgeClassName}>Downloaded</span>
            ) : null}
          </div>

          <p className="max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
            {model.description}
          </p>
          {!model.runnable && model.readiness_issues.length > 0 ? (
            <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
              {model.readiness_issues[0]}
            </p>
          ) : null}

          <div className="flex h-5 flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
            <span className="inline-flex items-center gap-2">
              <Globe className="h-4 w-4" />
              {formatModelLanguageSummary(model)}
            </span>
            <span>{provider?.runtime.label ?? model.runtime.label}</span>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {capabilityTags.map((tag) => (
              <span key={tag} className={speechLibraryBadgeClassName}>
                {tag === "Voice cloning" ? (
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                ) : null}
                {tag}
              </span>
            ))}
          </div>
          {!active ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                void speech.selectModel(model.provider_id, model.id);
              }}
              disabled={!speech.ttsEnabled || speech.loadingPlatform}
            >
              {selected ? "Selected" : "Set Active"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const SpeechModelList: React.FC<{
  title: string;
  count: number;
  models: CatalogModelDescriptor[];
  speech: SpeechOutputState;
  emptyMessage: string;
}> = ({ title, count, models, speech, emptyMessage }) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2 px-5">
      <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--text)]">
        {title}
      </h3>
      <span className={speechLibraryCountBadgeClassName}>{count}</span>
    </div>

    {models.length > 0 ? (
      <div className="space-y-4">
        {models.map((model) => (
          <SpeechModelLibraryCard
            key={model.id}
            model={model}
            provider={
              speech.visibleProviders.find(
                (provider) => provider.id === model.provider_id,
              ) ?? null
            }
            active={model.active}
            selected={model.selected}
            speech={speech}
          />
        ))}
      </div>
    ) : (
      <div className={speechLibraryCardClassName}>
        <p className="text-sm leading-6 text-[var(--muted)]">{emptyMessage}</p>
      </div>
    )}
  </div>
);

interface SpeechVoiceEngineSettingsCardProps {
  showEnabledToggle?: boolean;
  showGroupTitle?: boolean;
}

export const SpeechVoiceEngineSettingsCard: React.FC<
  SpeechVoiceEngineSettingsCardProps
> = ({ showEnabledToggle = true, showGroupTitle = true }) => {
  const speech = useSpeechOutputState();

  if (!speech.settings) {
    return null;
  }

  return (
    <SettingsGroup title={showGroupTitle ? "Voice & Engine" : undefined}>
      {showEnabledToggle && (
        <SpeechOutputToggle descriptionMode="tooltip" grouped={true} />
      )}

      <SettingContainer
        title="Speech Provider"
        description="Pick the local TTS provider family. Vox Jot will route speech to the right backend automatically."
        descriptionMode="tooltip"
        grouped={true}
      >
        <SelectField
          value={speech.providerSelectionValue}
          onChange={(value) => void speech.selectProvider(value)}
          disabled={!speech.ttsEnabled || speech.loadingPlatform}
          options={speech.providerOptions}
        />
      </SettingContainer>

      <SettingContainer
        title="Speech Model"
        description="Choose the installed or planned model within the selected provider."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!speech.ttsEnabled}
      >
        <SelectField
          value={speech.modelSelectionValue}
          onChange={(value) =>
            void speech.selectModel(speech.providerSelectionValue, value)
          }
          disabled={
            !speech.ttsEnabled ||
            speech.loadingPlatform ||
            speech.modelOptions.length === 0
          }
          options={speech.modelOptions}
        />
      </SettingContainer>

      <SettingContainer
        title="Voice"
        description="Pick a default voice for playback and preview it before using it in dictation flows."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
        disabled={!speech.ttsEnabled}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              value={speech.selectedVoiceId}
              onChange={(value) =>
                void speech.updateSetting(
                  "tts_default_voice_id",
                  value === "__auto__" ? null : value,
                )
              }
              disabled={
                !speech.ttsEnabled ||
                speech.loadingVoices ||
                speech.isUpdating("tts_default_voice_id")
              }
              options={speech.voiceOptions}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void speech.refreshVoices()}
              disabled={speech.loadingVoices}
              className="inline-flex items-center gap-1"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${speech.loadingVoices ? "animate-spin" : ""}`}
              />
              {refreshLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void speech.previewSelectedVoice()}
              disabled={!speech.ttsEnabled || speech.previewingVoice}
              className="inline-flex items-center gap-1"
            >
              <Play className="h-3.5 w-3.5" />
              {previewVoiceLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void commands.ttsStop()}
              disabled={!speech.ttsEnabled}
              className="inline-flex items-center gap-1"
            >
              <Square className="h-3.5 w-3.5" />
              {stopLabel}
            </Button>
          </div>
          <p className="text-xs text-[var(--muted)]">
            {speech.statusMessage ?? speech.engineStatus}
          </p>
          {(speech.activeProvider ?? speech.selectedProvider) ? (
            <div className="grid gap-1 text-xs text-[var(--muted)]">
              <p>{`Runtime: ${(speech.activeModel ?? speech.selectedModel)?.runtime.label ?? (speech.activeProvider ?? speech.selectedProvider)?.runtime.label}`}</p>
              <p>{`Source: ${(speech.activeProvider ?? speech.selectedProvider)?.source_label}`}</p>
              {(speech.activeModel ?? speech.selectedModel)?.license_label ? (
                <p>{`License: ${(speech.activeModel ?? speech.selectedModel)?.license_label}`}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </SettingContainer>

      <VoiceCloningProfilesSetting speech={speech} />

      <SettingContainer
        title="Offline Voice Packs"
        description="Download and remove packaged offline voices hosted with Vox Jot model assets."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
      >
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)]">
            {speech.loadingPacks
              ? "Loading pack catalog..."
              : "Offline packs are managed separately from STT models so Vox Jot can expand speech output over time."}
          </p>
          <div className="space-y-2">
            {speech.packs.map((pack) => (
              <div
                key={pack.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text)]">
                    {pack.label}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {pack.archive_name}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">
                    {pack.installed ? "Installed" : "Not installed"}
                  </span>
                  {pack.installed ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={speech.busyPackId === pack.id}
                      onClick={async () => {
                        speech.setBusyPackId(pack.id);
                        const result = await commands.removeTtsPack(pack.id);
                        if (result.status !== "ok") {
                          speech.setStatusMessage(result.error);
                        } else {
                          speech.setStatusMessage(null);
                          await speech.refreshPacks();
                          await speech.refreshVoices();
                        }
                        speech.setBusyPackId(null);
                      }}
                    >
                      {removeLabel}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={speech.busyPackId === pack.id}
                      onClick={async () => {
                        speech.setBusyPackId(pack.id);
                        const result = await commands.downloadTtsPack(pack.id);
                        if (result.status !== "ok") {
                          speech.setStatusMessage(result.error);
                        } else {
                          speech.setStatusMessage(null);
                          await speech.refreshPacks();
                          await speech.refreshVoices();
                        }
                        speech.setBusyPackId(null);
                      }}
                    >
                      {downloadLabel}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingContainer>
    </SettingsGroup>
  );
};

export const SpeechModelLibrarySection: React.FC = () => {
  const speech = useSpeechOutputState();
  const [providerFilter, setProviderFilter] = useState("all");
  const [catalogFilter, setCatalogFilter] = useState("all");

  const filteredModels = useMemo(
    () =>
      speech.visibleModels.filter((model) => {
        if (providerFilter !== "all" && model.provider_id !== providerFilter) {
          return false;
        }
        if (catalogFilter === "installed") {
          return model.installed;
        }
        if (catalogFilter === "voice_cloning") {
          return model.capabilities.supports_voice_cloning;
        }
        return true;
      }),
    [catalogFilter, providerFilter, speech.visibleModels],
  );
  const downloadedModels = useMemo(
    () => filteredModels.filter((model) => model.installed),
    [filteredModels],
  );
  const availableModels = useMemo(
    () => filteredModels.filter((model) => !model.installed),
    [filteredModels],
  );

  if (!speech.settings) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <SelectField
          value={providerFilter}
          onChange={setProviderFilter}
          options={[
            { value: "all", label: "All providers" },
            ...speech.visibleProviders.map((provider) => ({
              value: provider.id,
              label: provider.label,
            })),
          ]}
        />
        <SelectField
          value={catalogFilter}
          onChange={setCatalogFilter}
          options={[
            { value: "all", label: "All models" },
            { value: "installed", label: "Downloaded only" },
            { value: "voice_cloning", label: "Voice cloning" },
          ]}
        />
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-5 py-4 shadow-[var(--shadow-sm)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
          Active Speech Model
        </p>
        {speech.activeModel && speech.activeProvider ? (
          <div className="mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-bold text-[var(--text)]">
                {speech.activeModel.label}
              </p>
              <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
                {speech.activeProvider.label}
              </span>
              <span className="rounded-full bg-[var(--panel-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                {sourceKindLabel(speech.activeModel.source_kind)}
              </span>
              {providerFilter !== "all" ? (
                <span className="rounded-full bg-[var(--panel-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
                  Filtered
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {speech.activeModel.description}
            </p>
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
              {speech.activeProvider.runtime.label}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            {speech.selectedModel && !speech.selectedModel.runnable
              ? (speech.selectedModel.readiness_issues[0] ??
                "The selected speech model is not ready on this Mac yet.")
              : "Vox Jot will show the active speech model here once a compatible TTS provider is available on this Mac."}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-5 py-4 shadow-[var(--shadow-sm)]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
            Model Controls
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Only TTS providers and models that work on this operating system are
            shown here.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <SelectField
            value={speech.providerSelectionValue}
            onChange={(value) => void speech.selectProvider(value)}
            disabled={!speech.ttsEnabled || speech.loadingPlatform}
            options={speech.providerOptions}
          />
          <SelectField
            value={speech.modelSelectionValue}
            onChange={(value) =>
              void speech.selectModel(speech.providerSelectionValue, value)
            }
            disabled={
              !speech.ttsEnabled ||
              speech.loadingPlatform ||
              speech.modelOptions.length === 0
            }
            options={speech.modelOptions}
          />
          <SelectField
            value={speech.selectedVoiceId}
            onChange={(value) =>
              void speech.updateSetting(
                "tts_default_voice_id",
                value === "__auto__" ? null : value,
              )
            }
            disabled={
              !speech.ttsEnabled ||
              speech.loadingVoices ||
              speech.isUpdating("tts_default_voice_id")
            }
            options={speech.voiceOptions}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void speech.refreshVoices()}
            disabled={speech.loadingVoices}
            className="inline-flex items-center gap-1"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${speech.loadingVoices ? "animate-spin" : ""}`}
            />
            {refreshLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void speech.previewSelectedVoice()}
            disabled={!speech.ttsEnabled || speech.previewingVoice}
            className="inline-flex items-center gap-1"
          >
            <Play className="h-3.5 w-3.5" />
            {previewVoiceLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void commands.ttsStop()}
            disabled={!speech.ttsEnabled}
            className="inline-flex items-center gap-1"
          >
            <Square className="h-3.5 w-3.5" />
            {stopLabel}
          </Button>
        </div>

        <div className="mt-4 space-y-2 text-sm text-[var(--muted)]">
          <p>{speech.statusMessage ?? speech.engineStatus}</p>
          {(speech.activeModel ?? speech.selectedModel)?.license_label ? (
            <p>{`License: ${(speech.activeModel ?? speech.selectedModel)?.license_label}`}</p>
          ) : null}
        </div>
      </div>

      <SpeechModelList
        title="Downloaded Models"
        count={downloadedModels.length}
        models={downloadedModels}
        speech={speech}
        emptyMessage="No compatible TTS models have been downloaded for this Mac yet."
      />

      <SpeechModelList
        title="Available On This Mac"
        count={availableModels.length}
        models={availableModels}
        speech={speech}
        emptyMessage="Every compatible speech model is already downloaded or activated."
      />
    </div>
  );
};

export const SpeechVoiceCloningSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useSpeechOutputState();

  if (!speech.settings) {
    return null;
  }

  return (
    <SettingsGroup title={showGroupTitle ? "Voice Cloning" : undefined}>
      <VoiceCloningProfilesSetting speech={speech} />
    </SettingsGroup>
  );
};

export const SpeechAutoReadbackSettingsCard: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const { settings, updateSetting, isUpdating } = useSettings();

  if (!settings) {
    return null;
  }

  const ttsEnabled = settings.tts_enabled ?? false;

  return (
    <SettingsGroup title={showGroupTitle ? "Auto Readback" : undefined}>
      <SettingContainer
        title="Auto Readback"
        description="Choose when Vox Jot automatically speaks the final output."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!ttsEnabled}
      >
        <SelectField
          value={settings.tts_auto_readback_mode ?? "off"}
          onChange={(value) =>
            void updateSetting("tts_auto_readback_mode", value as any)
          }
          disabled={!ttsEnabled || isUpdating("tts_auto_readback_mode")}
          options={[
            { value: "off", label: "Off" },
            { value: "after_output", label: "After output" },
            {
              value: "after_preview_confirm",
              label: "After preview confirm",
            },
          ]}
        />
      </SettingContainer>

      <SettingContainer
        title="Readback Scope"
        description="Control whether automatic readback applies only to dictation or also to selection actions."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!ttsEnabled}
      >
        <SelectField
          value={settings.tts_auto_readback_scope ?? "dictation_only"}
          onChange={(value) =>
            void updateSetting("tts_auto_readback_scope", value as any)
          }
          disabled={!ttsEnabled || isUpdating("tts_auto_readback_scope")}
          options={[
            { value: "dictation_only", label: "Dictation only" },
            {
              value: "dictation_and_selection",
              label: "Dictation and selection",
            },
          ]}
        />
      </SettingContainer>

      <SettingContainer
        title="Readback Text"
        description="Choose whether bilingual output reads the translated block or the full final output."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!ttsEnabled}
      >
        <SelectField
          value={settings.tts_readback_text_mode ?? "final_output"}
          onChange={(value) =>
            void updateSetting("tts_readback_text_mode", value as any)
          }
          disabled={!ttsEnabled || isUpdating("tts_readback_text_mode")}
          options={[
            { value: "final_output", label: "Final output" },
            { value: "translated_block", label: "Translated block" },
          ]}
        />
      </SettingContainer>

      <ToggleSwitch
        checked={settings.tts_stop_on_record ?? true}
        onChange={(enabled) =>
          void updateSetting("tts_stop_on_record", enabled)
        }
        isUpdating={isUpdating("tts_stop_on_record")}
        label="Stop Speech On Record"
        description="Cancel current speech output as soon as recording starts."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!ttsEnabled}
      />

      <Slider
        value={settings.tts_rate ?? 1}
        onChange={(value) => void updateSetting("tts_rate", value)}
        min={0.5}
        max={2}
        step={0.05}
        label="Speech Rate"
        description="Adjust how quickly Vox Jot reads text aloud."
        descriptionMode="tooltip"
        grouped={true}
        formatValue={(value) => `${value.toFixed(2)}x`}
        disabled={!ttsEnabled}
      />

      <Slider
        value={settings.tts_volume ?? 1}
        onChange={(value) => void updateSetting("tts_volume", value)}
        min={0}
        max={1}
        step={0.05}
        label="Speech Volume"
        description="Playback volume for spoken output on the selected output device."
        descriptionMode="tooltip"
        grouped={true}
        formatValue={(value) => `${Math.round(value * 100)}%`}
        disabled={!ttsEnabled}
      />
    </SettingsGroup>
  );
};

export const SpeechPlaybackDeviceSettingsCard: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const { settings } = useSettings();

  return (
    <SettingsGroup title={showGroupTitle ? "Playback Device" : undefined}>
      <OutputDeviceSelector
        descriptionMode="tooltip"
        grouped={true}
        disabled={!(settings?.tts_enabled || settings?.audio_feedback)}
      />
    </SettingsGroup>
  );
};

export const SpeechOutputSettingsCard: React.FC = () => {
  return (
    <div className="space-y-6">
      <SpeechVoiceEngineSettingsCard />
      <SpeechAutoReadbackSettingsCard />
      <SpeechPlaybackDeviceSettingsCard />
    </div>
  );
};
