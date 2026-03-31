import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Globe,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Star,
} from "lucide-react";
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
  type TtsAdvancedControlDescriptor,
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
import {
  createTtsVoicePreset,
  deleteTtsVoicePreset,
  listTtsVoicePresets,
  prepareSidecarEngine,
  previewTtsVoicePreset,
  setActiveTtsVoicePreset,
  updateTtsVoicePreset,
  type TtsVoicePreset,
  type TtsVoicePresetInput,
  type TtsVoiceTuningSettings,
} from "@/lib/ttsVoicePresets";

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

const speechLibraryCardClassName =
  "group rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)] transition-all duration-200";
const speechLibraryBadgeClassName =
  "inline-flex items-center rounded-full bg-[var(--input)] px-3 py-1 text-xs font-medium text-[var(--muted)]";
const speechLibraryActiveBadgeClassName =
  "inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white shadow-[var(--shadow-sm)]";
const speechLibraryCountBadgeClassName =
  "inline-flex min-w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]";
const HIDDEN_TTS_PROVIDER_IDS = new Set(["local_sidecar_api"]);
const DEFAULT_TTS_PREVIEW_TEXT = "Vox Jot is ready.";

function localeLabel(locale: string | null | undefined) {
  return locale ? ` (${locale})` : "";
}

function sourceKindLabel(sourceKind: CatalogModelDescriptor["source_kind"]) {
  return sourceKind === "runtime" ? "Runtime" : "Built-in";
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
  if (model.capabilities.supports_voice_cloning) tags.push("Voice cloning");
  if (model.capabilities.supports_instruction_prompt) tags.push("Instructions");
  if (model.capabilities.local_only) tags.push("Local");
  if (model.downloadable) tags.push("Downloadable");
  return tags.slice(0, 3);
}

function defaultPresetInput(): TtsVoicePresetInput {
  return {
    label: "Default Voice",
    provider_id: "system_builtin",
    model_id: "system-default",
    voice_id: null,
    voice_profile_id: null,
    voice_label_snapshot: "System Voice",
    locale_snapshot: null,
    tuning: defaultVoiceTuning(),
  };
}

function defaultVoiceTuning(): TtsVoiceTuningSettings {
  return {
    tempo_rate: 1,
    expressiveness: 0.5,
    exaggeration: 0.5,
    randomness: 0.7,
    guidance: 0.5,
    stability: 0.5,
    repetition_penalty: 1.2,
    style_instructions: null,
  };
}

function buildPresetInput(preset: TtsVoicePreset): TtsVoicePresetInput {
  return {
    label: preset.label,
    provider_id: preset.provider_id,
    model_id: preset.model_id,
    voice_id: preset.voice_id ?? null,
    voice_profile_id: preset.voice_profile_id ?? null,
    voice_label_snapshot: preset.voice_label_snapshot ?? null,
    locale_snapshot: preset.locale_snapshot ?? null,
    tuning: { ...preset.tuning },
  };
}

type TtsVoicePresetPatch = Omit<Partial<TtsVoicePresetInput>, "tuning"> & {
  tuning?: Partial<TtsVoicePresetInput["tuning"]>;
};

function formatEngineFamilyLabel(engineFamily: string | null | undefined) {
  if (!engineFamily) return "Unknown engine";

  const normalized = engineFamily.trim().toLowerCase();
  const knownLabels: Record<string, string> = {
    fish_speech: "Fish Speech",
    kokoro: "Kokoro",
    chatterbox: "Chatterbox",
    openvoice: "OpenVoice",
    coqui: "Coqui",
    xtts: "XTTS",
    qwen3: "Qwen3",
    system: "System",
    sherpa_onnx: "Sherpa ONNX",
    sidecar: "Speech Runtime",
    tada: "TADA",
    speech_to_speech: "Speech to Speech",
  };

  if (knownLabels[normalized]) {
    return knownLabels[normalized];
  }

  return normalized
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isVoiceFixedToModel(providerId: string) {
  return providerId === "sherpa_pack" || providerId === "qwen3_native";
}

function useListenSpeechState() {
  const { settings, updateSetting, isUpdating, refreshSettings } =
    useSettings();
  const [platformOverview, setPlatformOverview] =
    useState<ModelPlatformOverview | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [packs, setPacks] = useState<TtsPackInfo[]>([]);
  const [profiles, setProfiles] = useState<TtsVoiceProfileDescriptor[]>([]);
  const [presets, setPresets] = useState<TtsVoicePreset[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loadingPlatform, setLoadingPlatform] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [loadingPacks, setLoadingPacks] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [previewingPresetId, setPreviewingPresetId] = useState<string | null>(
    null,
  );
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [busyProfileAction, setBusyProfileAction] = useState<string | null>(
    null,
  );
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [profileDescriptionDraft, setProfileDescriptionDraft] = useState("");
  const [profileTranscriptDraft, setProfileTranscriptDraft] = useState("");

  const ttsEnabled = settings?.tts_enabled ?? false;

  const refreshPlatform = useCallback(async () => {
    setLoadingPlatform(true);
    try {
      setPlatformOverview(await getModelPlatformOverview());
      setStatusMessage(null);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to load TTS models",
      );
    } finally {
      setLoadingPlatform(false);
    }
  }, []);

  const refreshVoices = useCallback(async () => {
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

  const refreshVoiceInventory = useCallback(async () => {
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

  const refreshProfiles = useCallback(async () => {
    setLoadingProfiles(true);
    try {
      setProfiles(await listTtsVoiceProfiles());
      setStatusMessage(null);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to load voice clones",
      );
    } finally {
      setLoadingProfiles(false);
    }
  }, []);

  const refreshPresets = useCallback(async () => {
    setLoadingPresets(true);
    try {
      setPresets(await listTtsVoicePresets());
      setStatusMessage(null);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to load voice presets",
      );
    } finally {
      setLoadingPresets(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshSettings();
    await Promise.all([
      refreshPlatform(),
      refreshVoices(),
      refreshPacks(),
      refreshProfiles(),
      refreshPresets(),
    ]);
  }, [
    refreshPlatform,
    refreshPacks,
    refreshPresets,
    refreshProfiles,
    refreshSettings,
    refreshVoices,
  ]);

  useEffect(() => {
    if (!settings) return;
    void refreshAll();
  }, [settings?.tts_enabled, refreshAll]);

  const activePresetId =
    ((settings as any)?.tts_active_preset_id as string | null | undefined) ??
    presets[0]?.id ??
    null;
  const activePreset =
    presets.find((preset) => preset.id === activePresetId) ??
    presets[0] ??
    null;

  const allProviders = useMemo(
    () =>
      (platformOverview?.tts.providers ?? []).filter(
        (provider) => provider.available && !provider.coming_soon,
      ),
    [platformOverview],
  );
  const visibleProviders = useMemo(
    () =>
      allProviders.filter(
        (provider) => !HIDDEN_TTS_PROVIDER_IDS.has(provider.id),
      ),
    [allProviders],
  );
  const allModels = useMemo(
    () =>
      (platformOverview?.tts.models ?? []).filter(
        (model) =>
          !model.capabilities.coming_soon &&
          allProviders.some((provider) => provider.id === model.provider_id),
      ),
    [allProviders, platformOverview],
  );
  const visibleModels = useMemo(
    () =>
      allModels.filter(
        (model) => !HIDDEN_TTS_PROVIDER_IDS.has(model.provider_id),
      ),
    [allModels],
  );

  const activeModel =
    allModels.find(
      (model) =>
        model.provider_id === activePreset?.provider_id &&
        model.id === activePreset?.model_id,
    ) ?? null;
  const activeProvider =
    allProviders.find(
      (provider) => provider.id === activePreset?.provider_id,
    ) ?? null;
  const providerIdForControls =
    visibleProviders.find(
      (provider) => provider.id === activePreset?.provider_id,
    )?.id ??
    visibleProviders[0]?.id ??
    "";
  const providerOptions = visibleProviders.map((provider) => ({
    value: provider.id,
    label: provider.label,
  }));
  const modelOptions = visibleModels
    .filter((model) => model.provider_id === providerIdForControls)
    .map((model) => ({
      value: model.id,
      label: `${model.label}${model.installed ? "" : " (Download required)"}`,
    }));
  const modelIdForControls =
    modelOptions.find((model) => model.value === activePreset?.model_id)
      ?.value ??
    modelOptions[0]?.value ??
    "";
  const runtimeProviders = visibleProviders.filter(
    (provider) => provider.source_kind === "runtime",
  );
  const runtimeModels = visibleModels.filter(
    (model) => model.source_kind === "runtime",
  );
  const speechRuntimeConnected = runtimeProviders.length > 0;

  const voiceOptions = [
    { value: "__auto__", label: "Automatic voice" },
    ...voices.map((voice) => ({
      value: voice.id,
      label: `${voice.label}${localeLabel(voice.locale)}`,
    })),
  ];
  const compatibleProfiles = profiles.filter(
    (profile) =>
      profile.compatible_provider_ids.includes("qwen3_native") &&
      profile.compatible_model_ids.includes("qwen3-0.6b-base"),
  );
  const profileOptions = [
    { value: "__none__", label: "No clone profile" },
    ...compatibleProfiles.map((profile) => ({
      value: profile.id,
      label: profile.ready ? profile.label : `${profile.label} (Needs audio)`,
    })),
  ];

  const savePreset = useCallback(
    async (preset: TtsVoicePreset, nextInput: TtsVoicePresetInput) => {
      await updateTtsVoicePreset(preset.id, nextInput);
      await refreshAll();
    },
    [refreshAll],
  );

  const setActivePreset = useCallback(
    async (presetId: string) => {
      await setActiveTtsVoicePreset(presetId);
      await refreshAll();
    },
    [refreshAll],
  );

  const updateActivePreset = useCallback(
    async (patch: TtsVoicePresetPatch) => {
      if (!activePreset) return;
      const current = buildPresetInput(activePreset);
      const nextInput: TtsVoicePresetInput = {
        ...current,
        ...patch,
        tuning: {
          ...current.tuning,
          ...(patch.tuning ?? {}),
        },
      };
      await savePreset(activePreset, nextInput);
    },
    [activePreset, savePreset],
  );

  const createFromActivePreset = useCallback(async () => {
    const source = activePreset
      ? buildPresetInput(activePreset)
      : defaultPresetInput();
    await createTtsVoicePreset({
      ...source,
      label: `${source.label || "Voice"} Copy`,
    });
    await refreshAll();
  }, [activePreset, refreshAll]);

  const createNewPreset = useCallback(async () => {
    await createTtsVoicePreset(defaultPresetInput());
    await refreshAll();
  }, [refreshAll]);

  const removePreset = useCallback(
    async (presetId: string) => {
      await deleteTtsVoicePreset(presetId);
      await refreshAll();
    },
    [refreshAll],
  );

  const previewPreset = useCallback(
    async (presetId: string, previewText?: string | null) => {
      setPreviewingPresetId(presetId);
      try {
        const preset = presets.find((p) => p.id === presetId);
        if (preset) {
          const model = allModels.find(
            (m) =>
              m.provider_id === preset.provider_id && m.id === preset.model_id,
          );
          if (
            model &&
            model.source_kind === "runtime" &&
            model.readiness_status === "downloaded"
          ) {
            setStatusMessage(`Preparing ${model.label} for first use\u2026`);
            await prepareSidecarEngine(preset.provider_id);
            await refreshPlatform();
          }
        }
        await previewTtsVoicePreset(presetId, previewText ?? null);
        setStatusMessage(null);
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Failed to preview voice preset",
        );
      } finally {
        setPreviewingPresetId(null);
      }
    },
    [presets, allModels, refreshPlatform],
  );

  const ensureModelInstalled = useCallback(
    async (model: CatalogModelDescriptor) => {
      if (!model.downloadable || model.installed) return;
      const result = await commands.downloadTtsPack(model.id);
      if (result.status === "error") {
        throw new Error(result.error);
      }
    },
    [],
  );

  const selectProvider = useCallback(
    async (providerId: string) => {
      const nextModel =
        visibleModels.find((model) => model.provider_id === providerId) ?? null;
      if (!nextModel) return;
      await ensureModelInstalled(nextModel);
      await setTtsPlatformSelection(providerId, nextModel.id);
      await refreshAll();
    },
    [ensureModelInstalled, refreshAll, visibleModels],
  );

  const selectModel = useCallback(
    async (modelId: string) => {
      const nextModel =
        visibleModels.find(
          (model) =>
            model.provider_id === providerIdForControls && model.id === modelId,
        ) ?? null;
      if (!nextModel) return;
      await ensureModelInstalled(nextModel);
      await setTtsPlatformSelection(providerIdForControls, modelId);
      await refreshAll();
    },
    [ensureModelInstalled, providerIdForControls, refreshAll, visibleModels],
  );

  const activateModel = useCallback(
    async (providerId: string, modelId: string) => {
      const nextModel =
        visibleModels.find(
          (model) => model.provider_id === providerId && model.id === modelId,
        ) ?? null;
      if (!nextModel) return;
      await ensureModelInstalled(nextModel);
      await setTtsPlatformSelection(providerId, modelId);
      await refreshAll();
    },
    [ensureModelInstalled, refreshAll, visibleModels],
  );

  const createPresetFromProfile = useCallback(
    async (profile: TtsVoiceProfileDescriptor) => {
      await createTtsVoicePreset({
        label: profile.label,
        provider_id: "qwen3_native",
        model_id: "qwen3-0.6b-base",
        voice_id: null,
        voice_profile_id: profile.id,
        voice_label_snapshot: profile.label,
        locale_snapshot: null,
        tuning: activePreset?.tuning
          ? { ...activePreset.tuning }
          : defaultVoiceTuning(),
      });
      await setTtsPlatformSelection("qwen3_native", "qwen3-0.6b-base");
      await refreshAll();
    },
    [activePreset, refreshAll],
  );

  return {
    settings,
    updateSetting,
    isUpdating,
    refreshAll,
    refreshPlatform,
    refreshVoiceInventory,
    refreshProfiles,
    refreshPresets,
    refreshPacks,
    voices,
    packs,
    profiles,
    presets,
    activePreset,
    activeModel,
    activeProvider,
    allProviders,
    allModels,
    visibleProviders,
    visibleModels,
    providerIdForControls,
    modelIdForControls,
    providerOptions,
    modelOptions,
    runtimeProviders,
    runtimeModels,
    speechRuntimeConnected,
    voiceOptions,
    profileOptions,
    compatibleProfiles,
    statusMessage,
    setStatusMessage,
    loadingPlatform,
    loadingVoices,
    loadingPacks,
    loadingProfiles,
    loadingPresets,
    previewingPresetId,
    busyPackId,
    setBusyPackId,
    busyProfileAction,
    setBusyProfileAction,
    profileNameDraft,
    setProfileNameDraft,
    profileDescriptionDraft,
    setProfileDescriptionDraft,
    profileTranscriptDraft,
    setProfileTranscriptDraft,
    ttsEnabled,
    savePreset,
    setActivePreset,
    updateActivePreset,
    createFromActivePreset,
    createNewPreset,
    removePreset,
    previewPreset,
    selectProvider,
    selectModel,
    activateModel,
    createPresetFromProfile,
  };
}

type ListenSpeechState = ReturnType<typeof useListenSpeechState>;

const tuningSectionClassName =
  "space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4";

function tuningDescriptorMap(controls: TtsAdvancedControlDescriptor[]) {
  return new Map(controls.map((control) => [control.id, control]));
}

function tuningNumberLabel(
  control: TtsAdvancedControlDescriptor | undefined,
  fallbackLabel: string,
) {
  return control?.label ?? fallbackLabel;
}

function tuningDescription(
  control: TtsAdvancedControlDescriptor | undefined,
  fallbackDescription: string,
) {
  return control?.description ?? fallbackDescription;
}

const VoiceArchitectSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const [labelDraft, setLabelDraft] = useState("");
  const [previewTextDraft, setPreviewTextDraft] = useState(
    DEFAULT_TTS_PREVIEW_TEXT,
  );

  useEffect(() => {
    setLabelDraft(speech.activePreset?.label ?? "");
  }, [speech.activePreset?.id, speech.activePreset?.label]);

  if (!speech.settings || !speech.activePreset) return null;

  const activeEngineFamily = formatEngineFamilyLabel(
    speech.activeModel?.runtime.engine_family ??
      speech.activeProvider?.runtime.engine_family ??
      null,
  );
  const controls = speech.activeModel?.delivery_support.advanced_controls ?? [];
  const descriptors = tuningDescriptorMap(controls);
  const controlIds = new Set(controls.map((control) => control.id));
  const supportsExpressiveness =
    (speech.activeModel?.delivery_support.expressiveness_mode ??
      "unsupported") !== "unsupported";
  const supportsManualVoiceId =
    speech.activePreset.provider_id === "local_sidecar_api";

  return (
    <SettingsGroup title={showTitle ? "Voice Architect" : undefined}>
      <SpeechOutputToggle descriptionMode="tooltip" grouped={true} />

      <SettingContainer
        title="Voice Architect"
        description="Design the active voice, preview it instantly, then save the whole identity and tuning setup as a preset."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
        disabled={!speech.ttsEnabled}
      >
        <div className="space-y-6">
          <div className="rounded-[28px] border border-[color-mix(in_srgb,var(--accent),transparent_72%)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent),transparent_90%)_0%,var(--card)_48%,color-mix(in_srgb,var(--accent),transparent_96%)_100%)] p-6 shadow-[var(--shadow-md)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={speechLibraryActiveBadgeClassName}>
                    <Star className="h-3.5 w-3.5" />
                    Active Preset
                  </span>
                  <span className={speechLibraryBadgeClassName}>
                    {activeEngineFamily}
                  </span>
                </div>
                <Input
                  value={labelDraft}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  onBlur={() => {
                    if (
                      labelDraft.trim() &&
                      labelDraft.trim() !== speech.activePreset?.label
                    ) {
                      void speech.updateActivePreset({
                        label: labelDraft.trim(),
                      });
                    }
                  }}
                  disabled={!speech.ttsEnabled}
                  className="max-w-md"
                />
                <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
                  {speech.statusMessage ??
                    "Tweak this preset, preview the result, and save the full voice identity as part of the preset."}
                </p>
                <div className="max-w-2xl space-y-2 pt-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Preview Message
                  </p>
                  <Textarea
                    value={previewTextDraft}
                    onChange={(event) =>
                      setPreviewTextDraft(event.target.value)
                    }
                    className="min-h-[92px]"
                    placeholder={DEFAULT_TTS_PREVIEW_TEXT}
                  />
                  <p className="text-xs text-[var(--muted)]">
                    Type the exact message you want the voice to read when you
                    press Preview.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void speech.previewPreset(
                      speech.activePreset.id,
                      previewTextDraft,
                    )
                  }
                  disabled={
                    speech.previewingPresetId === speech.activePreset.id
                  }
                  className="inline-flex min-h-11 items-center gap-1"
                >
                  <Play className="h-3.5 w-3.5" />
                  Preview
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void commands.ttsStop()}
                  className="inline-flex min-h-11 items-center gap-1"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void speech.createFromActivePreset()}
                  disabled={!speech.ttsEnabled}
                  className="inline-flex min-h-11 items-center gap-1"
                >
                  Save as New Preset
                </Button>
              </div>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)]">
              <div className="space-y-4">
                <div className={tuningSectionClassName}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Identity
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <SelectField
                      value={speech.providerIdForControls}
                      onChange={(value) => void speech.selectProvider(value)}
                      disabled={!speech.ttsEnabled || speech.loadingPlatform}
                      options={speech.providerOptions}
                    />
                    <SelectField
                      value={speech.modelIdForControls}
                      onChange={(value) => void speech.selectModel(value)}
                      disabled={
                        !speech.ttsEnabled ||
                        speech.loadingPlatform ||
                        speech.modelOptions.length === 0
                      }
                      options={speech.modelOptions}
                    />
                  </div>

                  {!isVoiceFixedToModel(speech.activePreset.provider_id) &&
                  speech.voices.length > 0 ? (
                    <SelectField
                      value={speech.activePreset.voice_id ?? "__auto__"}
                      onChange={(value) => {
                        const selectedVoice =
                          speech.voices.find((voice) => voice.id === value) ??
                          null;
                        void speech.updateActivePreset({
                          voice_id: value === "__auto__" ? null : value,
                          voice_label_snapshot:
                            value === "__auto__"
                              ? "Automatic voice"
                              : (selectedVoice?.label ?? value),
                          locale_snapshot:
                            value === "__auto__"
                              ? null
                              : (selectedVoice?.locale ?? null),
                        });
                      }}
                      disabled={!speech.ttsEnabled || speech.loadingVoices}
                      options={speech.voiceOptions}
                    />
                  ) : null}

                  {supportsManualVoiceId ? (
                    <Input
                      value={speech.activePreset.voice_id ?? ""}
                      onChange={(event) =>
                        void speech.updateActivePreset({
                          voice_id: event.target.value || null,
                          voice_label_snapshot: event.target.value || null,
                        })
                      }
                      placeholder="Optional speaker / voice ID"
                      disabled={!speech.ttsEnabled}
                      className="max-w-md"
                    />
                  ) : null}

                  {speech.activeModel?.capabilities.supports_voice_cloning ? (
                    <SelectField
                      value={speech.activePreset.voice_profile_id ?? "__none__"}
                      onChange={(value) => {
                        const profile =
                          speech.compatibleProfiles.find(
                            (item) => item.id === value,
                          ) ?? null;
                        void speech.updateActivePreset({
                          voice_profile_id: value === "__none__" ? null : value,
                          voice_label_snapshot:
                            value === "__none__"
                              ? (speech.activePreset.voice_label_snapshot ??
                                null)
                              : (profile?.label ?? value),
                        });
                      }}
                      disabled={!speech.ttsEnabled || speech.loadingProfiles}
                      options={speech.profileOptions}
                    />
                  ) : null}
                </div>

                <div className={tuningSectionClassName}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Tempo
                  </p>
                  <Slider
                    value={speech.activePreset.tuning.tempo_rate}
                    onChange={(value) =>
                      void speech.updateActivePreset({
                        tuning: { tempo_rate: value },
                      })
                    }
                    min={0.5}
                    max={2}
                    step={0.05}
                    label="Tempo"
                    description="Saved per preset so every voice can be brisk, measured, or cinematic."
                    descriptionMode="tooltip"
                    grouped={false}
                    formatValue={(value) => `${value.toFixed(2)}x`}
                    disabled={!speech.ttsEnabled}
                  />
                </div>

                <div className={tuningSectionClassName}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Style
                  </p>
                  <Slider
                    value={speech.activePreset.tuning.expressiveness}
                    onChange={(value) =>
                      void speech.updateActivePreset({
                        tuning: { expressiveness: value },
                      })
                    }
                    min={0}
                    max={1}
                    step={0.05}
                    label="Expressiveness"
                    description="Overall energy and liveliness for the preset."
                    descriptionMode="tooltip"
                    grouped={false}
                    formatValue={(value) => `${Math.round(value * 100)}%`}
                    disabled={!speech.ttsEnabled || !supportsExpressiveness}
                  />
                  {controlIds.has("exaggeration") ? (
                    <Slider
                      value={speech.activePreset.tuning.exaggeration}
                      onChange={(value) =>
                        void speech.updateActivePreset({
                          tuning: { exaggeration: value },
                        })
                      }
                      min={descriptors.get("exaggeration")?.min ?? 0}
                      max={descriptors.get("exaggeration")?.max ?? 1}
                      step={descriptors.get("exaggeration")?.step ?? 0.05}
                      label={tuningNumberLabel(
                        descriptors.get("exaggeration"),
                        "Exaggeration",
                      )}
                      description={tuningDescription(
                        descriptors.get("exaggeration"),
                        "Pushes the style further when the model supports it.",
                      )}
                      descriptionMode="tooltip"
                      grouped={false}
                      formatValue={(value) => `${Math.round(value * 100)}%`}
                      disabled={!speech.ttsEnabled}
                    />
                  ) : null}
                </div>

                {controlIds.has("randomness") ? (
                  <div className={tuningSectionClassName}>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Sampler
                    </p>
                    <Slider
                      value={speech.activePreset.tuning.randomness}
                      onChange={(value) =>
                        void speech.updateActivePreset({
                          tuning: { randomness: value },
                        })
                      }
                      min={descriptors.get("randomness")?.min ?? 0}
                      max={descriptors.get("randomness")?.max ?? 1}
                      step={descriptors.get("randomness")?.step ?? 0.05}
                      label={tuningNumberLabel(
                        descriptors.get("randomness"),
                        "Randomness",
                      )}
                      description={tuningDescription(
                        descriptors.get("randomness"),
                        "Higher values make the read less predictable and more varied.",
                      )}
                      descriptionMode="tooltip"
                      grouped={false}
                      formatValue={(value) => `${Math.round(value * 100)}%`}
                      disabled={!speech.ttsEnabled}
                    />
                  </div>
                ) : null}

                {controlIds.has("guidance") ||
                controlIds.has("stability") ||
                controlIds.has("repetition_penalty") ? (
                  <div className={tuningSectionClassName}>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Guidance
                    </p>
                    {controlIds.has("guidance") ? (
                      <Slider
                        value={speech.activePreset.tuning.guidance}
                        onChange={(value) =>
                          void speech.updateActivePreset({
                            tuning: { guidance: value },
                          })
                        }
                        min={descriptors.get("guidance")?.min ?? 0}
                        max={descriptors.get("guidance")?.max ?? 1}
                        step={descriptors.get("guidance")?.step ?? 0.05}
                        label={tuningNumberLabel(
                          descriptors.get("guidance"),
                          "Guidance",
                        )}
                        description={tuningDescription(
                          descriptors.get("guidance"),
                          "Higher values make the engine adhere more tightly to the intended delivery.",
                        )}
                        descriptionMode="tooltip"
                        grouped={false}
                        formatValue={(value) => `${Math.round(value * 100)}%`}
                        disabled={!speech.ttsEnabled}
                      />
                    ) : null}
                    {controlIds.has("stability") ? (
                      <Slider
                        value={speech.activePreset.tuning.stability}
                        onChange={(value) =>
                          void speech.updateActivePreset({
                            tuning: { stability: value },
                          })
                        }
                        min={descriptors.get("stability")?.min ?? 0}
                        max={descriptors.get("stability")?.max ?? 1}
                        step={descriptors.get("stability")?.step ?? 0.05}
                        label={tuningNumberLabel(
                          descriptors.get("stability"),
                          "Stability",
                        )}
                        description={tuningDescription(
                          descriptors.get("stability"),
                          "Use this only for engines that expose a real stability control.",
                        )}
                        descriptionMode="tooltip"
                        grouped={false}
                        formatValue={(value) => `${Math.round(value * 100)}%`}
                        disabled={!speech.ttsEnabled}
                      />
                    ) : null}
                    {controlIds.has("repetition_penalty") ? (
                      <Slider
                        value={speech.activePreset.tuning.repetition_penalty}
                        onChange={(value) =>
                          void speech.updateActivePreset({
                            tuning: { repetition_penalty: value },
                          })
                        }
                        min={descriptors.get("repetition_penalty")?.min ?? 1}
                        max={descriptors.get("repetition_penalty")?.max ?? 3}
                        step={
                          descriptors.get("repetition_penalty")?.step ?? 0.1
                        }
                        label={tuningNumberLabel(
                          descriptors.get("repetition_penalty"),
                          "Repetition Penalty",
                        )}
                        description={tuningDescription(
                          descriptors.get("repetition_penalty"),
                          "Helps reduce repeated words or loops in longer reads.",
                        )}
                        descriptionMode="tooltip"
                        grouped={false}
                        formatValue={(value) => value.toFixed(2)}
                        disabled={!speech.ttsEnabled}
                      />
                    ) : null}
                  </div>
                ) : null}

                {controlIds.has("style_instructions") ? (
                  <div className={tuningSectionClassName}>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Steering
                    </p>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-[var(--text)]">
                        {descriptors.get("style_instructions")?.label ??
                          "Style Instructions"}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {descriptors.get("style_instructions")?.description ??
                          "Optional speaking directions for instruction-capable voices."}
                      </p>
                      <Textarea
                        value={
                          speech.activePreset.tuning.style_instructions ?? ""
                        }
                        onChange={(event) =>
                          void speech.updateActivePreset({
                            tuning: {
                              style_instructions:
                                event.target.value.trim() || null,
                            },
                          })
                        }
                        disabled={!speech.ttsEnabled}
                        className="min-h-[108px]"
                        placeholder="Warm, calm, confident, closer to a product demo than a podcast host."
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Active Routing
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={speechLibraryBadgeClassName}>
                      {speech.activeProvider?.label ??
                        speech.activePreset.provider_id}
                    </span>
                    <span className={speechLibraryBadgeClassName}>
                      {speech.activeModel?.label ??
                        speech.activePreset.model_id}
                    </span>
                    <span className={speechLibraryBadgeClassName}>
                      {speech.activePreset.voice_label_snapshot ??
                        speech.activePreset.voice_id ??
                        "Automatic"}
                    </span>
                    {speech.activePreset.voice_profile_id ? (
                      <span className={speechLibraryBadgeClassName}>
                        Clone attached
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 space-y-2 text-sm leading-6 text-[var(--muted)]">
                    <p>{`Provider: ${speech.activeProvider?.label ?? speech.activePreset.provider_id}`}</p>
                    <p>{`Model: ${speech.activeModel?.label ?? speech.activePreset.model_id}`}</p>
                    <p>{`Voice: ${speech.activePreset.voice_label_snapshot ?? speech.activePreset.voice_id ?? "Automatic"}`}</p>
                    {speech.activePreset.voice_profile_id ? (
                      <p>{`Clone: ${speech.activePreset.voice_profile_id}`}</p>
                    ) : null}
                    {speech.activePreset.tuning.style_instructions ? (
                      <p className="rounded-2xl bg-[var(--panel-bg)] px-3 py-2 text-xs leading-5 text-[var(--text)]">
                        {speech.activePreset.tuning.style_instructions}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Saved Presets
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void speech.createNewPreset()}
                      disabled={!speech.ttsEnabled}
                    >
                      New blank preset
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void speech.refreshPresets()}
                      disabled={speech.loadingPresets}
                      className="inline-flex items-center gap-1"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${speech.loadingPresets ? "animate-spin" : ""}`}
                      />
                      Refresh
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {speech.presets.map((preset) => {
                      const isActive = preset.id === speech.activePreset?.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => void speech.setActivePreset(preset.id)}
                          className={`${speechLibraryCardClassName} text-left ${
                            isActive
                              ? "border-[var(--accent)] shadow-[var(--shadow-md)]"
                              : "hover:border-logo-primary/50 hover:bg-logo-primary/5"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-[var(--text)]">
                                  {preset.label}
                                </span>
                                {isActive ? (
                                  <span
                                    className={
                                      speechLibraryActiveBadgeClassName
                                    }
                                  >
                                    <Star className="h-3.5 w-3.5" />
                                    Active
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                                <span className={speechLibraryBadgeClassName}>
                                  {preset.voice_label_snapshot ??
                                    preset.voice_id ??
                                    "Automatic"}
                                </span>
                                <span className={speechLibraryBadgeClassName}>
                                  {preset.model_id}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void speech.previewPreset(
                                    preset.id,
                                    previewTextDraft,
                                  );
                                }}
                                disabled={
                                  speech.previewingPresetId === preset.id
                                }
                              >
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void speech.removePreset(preset.id);
                                }}
                                disabled={
                                  !speech.ttsEnabled ||
                                  speech.presets.length <= 1
                                }
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SettingContainer>
    </SettingsGroup>
  );
};

const SpeechModelLibraryCard: React.FC<{
  model: CatalogModelDescriptor;
  provider: ProviderDescriptor | null;
  active: boolean;
  selected: boolean;
  speech: ListenSpeechState;
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

  return (
    <div className={`${speechLibraryCardClassName} ${cardStateClassName}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--text)]">
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
              onClick={() =>
                void speech.activateModel(model.provider_id, model.id)
              }
              disabled={!speech.ttsEnabled || speech.loadingPlatform}
            >
              {selected
                ? "Selected"
                : model.downloadable && !model.installed
                  ? "Download & Use"
                  : "Set Active"}
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
  speech: ListenSpeechState;
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
            active={
              speech.activePreset?.provider_id === model.provider_id &&
              speech.activePreset?.model_id === model.id
            }
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

const EngineLibraryPanel: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const [providerFilter, setProviderFilter] = useState("all");
  const [catalogFilter, setCatalogFilter] = useState("all");

  const filteredModels = useMemo(
    () =>
      speech.visibleModels.filter((model) => {
        if (providerFilter !== "all" && model.provider_id !== providerFilter)
          return false;
        if (catalogFilter === "installed") return model.installed;
        if (catalogFilter === "voice_cloning")
          return model.capabilities.supports_voice_cloning;
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

  if (!speech.settings) return null;

  return (
    <SettingsGroup title={showTitle ? "Engine Library" : undefined}>
      <SettingContainer
        title="Active Model"
        description="Model changes are technical; Vox Jot still routes day-to-day voice choice through the active preset."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
        disabled={!speech.ttsEnabled}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <SelectField
              value={
                speech.providerIdForControls ??
                speech.providerOptions[0]?.value ??
                ""
              }
              onChange={(value) => void speech.selectProvider(value)}
              disabled={!speech.ttsEnabled || speech.loadingPlatform}
              options={speech.providerOptions}
            />
            <SelectField
              value={
                speech.modelIdForControls ?? speech.modelOptions[0]?.value ?? ""
              }
              onChange={(value) => void speech.selectModel(value)}
              disabled={
                !speech.ttsEnabled ||
                speech.loadingPlatform ||
                speech.modelOptions.length === 0
              }
              options={speech.modelOptions}
            />
          </div>
          <p className="text-sm text-[var(--muted)]">
            {speech.activeModel
              ? `${speech.activeModel.label} via ${speech.activeProvider?.label ?? speech.activePreset?.provider_id}.`
              : "Choose a provider and model to define how the active preset is rendered."}
          </p>
        </div>
      </SettingContainer>

      <SettingContainer
        title="Pack Manager"
        description="Download or remove offline speech packs without leaving Listen."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
      >
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
                        await speech.refreshAll();
                      }
                      speech.setBusyPackId(null);
                    }}
                  >
                    Remove
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
                        await speech.refreshAll();
                      }
                      speech.setBusyPackId(null);
                    }}
                  >
                    Download
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SettingContainer>

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
          emptyMessage="Every compatible speech model is already downloaded or active."
        />
      </div>
    </SettingsGroup>
  );
};

const VoiceCloningSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const selectedProfile =
    speech.compatibleProfiles.find(
      (profile) => profile.id === speech.activePreset?.voice_profile_id,
    ) ?? null;

  if (!speech.settings) return null;

  return (
    <SettingsGroup title={showTitle ? "Voice Cloning" : undefined}>
      <SettingContainer
        title="Clone Profiles"
        description="Create reusable voice-clone source profiles, then turn any ready profile into a saved voice preset."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              value={speech.activePreset?.voice_profile_id ?? "__none__"}
              onChange={(value) => {
                const profile =
                  speech.compatibleProfiles.find((item) => item.id === value) ??
                  null;
                void speech.updateActivePreset({
                  voice_profile_id: value === "__none__" ? null : value,
                  voice_label_snapshot:
                    value === "__none__" ? null : (profile?.label ?? value),
                });
              }}
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
              Refresh
            </Button>
            {selectedProfile ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  void speech.createPresetFromProfile(selectedProfile)
                }
                disabled={!speech.ttsEnabled || !selectedProfile.ready}
              >
                Create preset
              </Button>
            ) : null}
            {selectedProfile ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  !speech.ttsEnabled || speech.busyProfileAction === "import"
                }
                onClick={async () => {
                  const filePath = await open({
                    multiple: false,
                    filters: [{ name: "WAV", extensions: ["wav"] }],
                  });
                  if (!filePath || Array.isArray(filePath)) return;
                  speech.setBusyProfileAction("import");
                  try {
                    await importTtsVoiceProfileSample(
                      selectedProfile.id,
                      filePath,
                      speech.profileTranscriptDraft ||
                        selectedProfile.transcript ||
                        null,
                    );
                    await speech.refreshProfiles();
                  } finally {
                    speech.setBusyProfileAction(null);
                  }
                }}
              >
                Import WAV
              </Button>
            ) : null}
            {selectedProfile ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={
                  !speech.ttsEnabled || speech.busyProfileAction === "delete"
                }
                onClick={async () => {
                  speech.setBusyProfileAction("delete");
                  try {
                    await deleteTtsVoiceProfile(selectedProfile.id);
                    await speech.refreshProfiles();
                  } finally {
                    speech.setBusyProfileAction(null);
                  }
                }}
              >
                Delete profile
              </Button>
            ) : null}
          </div>

          {selectedProfile ? (
            <div className="space-y-2 text-xs text-[var(--muted)]">
              <p>{`Status: ${
                selectedProfile.fully_optimized
                  ? "Fully optimized"
                  : selectedProfile.ready
                    ? "Ready for cloning"
                    : "Needs reference audio"
              }`}</p>
              {selectedProfile.reference_audio_path ? (
                <p className="break-all">{`Audio: ${selectedProfile.reference_audio_path}`}</p>
              ) : null}
              {selectedProfile.transcript ? (
                <p>{`Transcript: ${selectedProfile.transcript}`}</p>
              ) : (
                <p>Transcript: Optional, but helpful for clone quality.</p>
              )}
              <div className="mt-2 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-[var(--fg)]">
                      Improve from my dictations
                    </p>
                    <p className="text-[10px] text-[var(--muted)]">
                      Uses your speech-to-text dictations to refine this clone
                      locally.
                    </p>
                  </div>
                  <label
                    className={`inline-flex h-6 w-11 items-center ${
                      !speech.ttsEnabled || selectedProfile.fully_optimized
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={selectedProfile.continuous_improvement_enabled}
                      disabled={
                        !speech.ttsEnabled || selectedProfile.fully_optimized
                      }
                      onChange={(event) => {
                        void setActiveImprovementProfile(
                          selectedProfile.id,
                          event.target.checked,
                        ).then(() => speech.refreshProfiles());
                      }}
                    />
                    <div className="relative h-6 w-11 overflow-hidden rounded-full border border-[color-mix(in_srgb,var(--text),transparent_50%)] bg-[color-mix(in_srgb,var(--text),transparent_78%)] transition-colors duration-200 peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-[18px] after:absolute after:start-[2px] after:top-1/2 after:h-5 after:w-5 after:-translate-y-1/2 after:rounded-full after:border after:border-[color-mix(in_srgb,var(--text),transparent_50%)] after:bg-[var(--card)] after:shadow-[0_1px_3px_rgba(0,0,0,0.3)] after:transition-all after:duration-200 after:content-['']" />
                  </label>
                </div>
                {(selectedProfile.collected_audio_duration_secs > 0 ||
                  selectedProfile.continuous_improvement_enabled) && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span>
                        {selectedProfile.fully_optimized
                          ? "Fully optimized"
                          : selectedProfile.continuous_improvement_enabled
                            ? "Currently learning"
                            : "Collection paused"}
                      </span>
                      <span>
                        {`${Math.round(selectedProfile.collected_audio_duration_secs)}s / ${Math.round(selectedProfile.satisfactory_threshold_secs)}s`}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--input)]">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          selectedProfile.fully_optimized
                            ? "bg-green-500"
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
                      await clearProfileCollectedData(selectedProfile.id);
                      await speech.refreshProfiles();
                    }}
                    disabled={!speech.ttsEnabled}
                    className="text-red-500 hover:text-red-600"
                  >
                    Clear collected data
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm leading-6 text-[var(--muted)]">
              Voice cloning becomes active when a preset or model uses `Qwen3
              0.6B Base`.
            </p>
          )}
        </div>
      </SettingContainer>

      <SettingContainer
        title="Create Profile"
        description="Start with a profile name, then import one clear WAV reference clip."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
      >
        <div className="space-y-2">
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
                  await createTtsVoiceProfile(
                    speech.profileNameDraft,
                    speech.profileDescriptionDraft || null,
                    speech.profileTranscriptDraft || null,
                  );
                  speech.setProfileNameDraft("");
                  speech.setProfileDescriptionDraft("");
                  speech.setProfileTranscriptDraft("");
                  await speech.refreshProfiles();
                } finally {
                  speech.setBusyProfileAction(null);
                }
              }}
            >
              Create profile
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                !speech.ttsEnabled || speech.compatibleProfiles.length === 0
              }
              onClick={async () => {
                const targetProfile =
                  speech.compatibleProfiles[
                    speech.compatibleProfiles.length - 1
                  ];
                const filePath = await open({
                  multiple: false,
                  filters: [{ name: "WAV", extensions: ["wav"] }],
                });
                if (!filePath || Array.isArray(filePath)) return;
                speech.setBusyProfileAction("import");
                try {
                  await importTtsVoiceProfileSample(
                    targetProfile.id,
                    filePath,
                    speech.profileTranscriptDraft || null,
                  );
                  await speech.refreshProfiles();
                } finally {
                  speech.setBusyProfileAction(null);
                }
              }}
            >
              Import WAV into latest
            </Button>
          </div>
        </div>
      </SettingContainer>
    </SettingsGroup>
  );
};

const AutoReadbackPanel: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const settings = speech.settings;
  if (!settings) return null;

  return (
    <SettingsGroup title={showTitle ? "Auto-Readback" : undefined}>
      <SettingContainer
        title="Auto Readback"
        description="Choose when Vox Jot automatically speaks the final output."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!speech.ttsEnabled}
      >
        <SelectField
          value={settings.tts_auto_readback_mode ?? "off"}
          onChange={(value) =>
            void speech.updateSetting("tts_auto_readback_mode", value as any)
          }
          disabled={
            !speech.ttsEnabled || speech.isUpdating("tts_auto_readback_mode")
          }
          options={[
            { value: "off", label: "Off" },
            { value: "after_output", label: "After output" },
            { value: "after_preview_confirm", label: "After preview confirm" },
          ]}
        />
      </SettingContainer>

      <SettingContainer
        title="Readback Scope"
        description="Control whether automatic readback applies only to dictation or also to selection actions."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!speech.ttsEnabled}
      >
        <SelectField
          value={settings.tts_auto_readback_scope ?? "dictation_only"}
          onChange={(value) =>
            void speech.updateSetting("tts_auto_readback_scope", value as any)
          }
          disabled={
            !speech.ttsEnabled || speech.isUpdating("tts_auto_readback_scope")
          }
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
        disabled={!speech.ttsEnabled}
      >
        <SelectField
          value={settings.tts_readback_text_mode ?? "final_output"}
          onChange={(value) =>
            void speech.updateSetting("tts_readback_text_mode", value as any)
          }
          disabled={
            !speech.ttsEnabled || speech.isUpdating("tts_readback_text_mode")
          }
          options={[
            { value: "final_output", label: "Final output" },
            { value: "translated_block", label: "Translated block" },
          ]}
        />
      </SettingContainer>

      <ToggleSwitch
        checked={settings.tts_stop_on_record ?? true}
        onChange={(enabled) =>
          void speech.updateSetting("tts_stop_on_record", enabled)
        }
        isUpdating={speech.isUpdating("tts_stop_on_record")}
        label="Stop Speech On Record"
        description="Cancel current speech output as soon as recording starts."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!speech.ttsEnabled}
      />
    </SettingsGroup>
  );
};

const OutputPanel: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const settings = speech.settings;
  if (!settings) return null;

  return (
    <SettingsGroup title={showTitle ? "Output" : undefined}>
      <OutputDeviceSelector
        descriptionMode="tooltip"
        grouped={true}
        disabled={!(settings.tts_enabled || settings.audio_feedback)}
      />
      <Slider
        value={settings.tts_volume ?? 1}
        onChange={(value) => void speech.updateSetting("tts_volume", value)}
        min={0}
        max={1}
        step={0.05}
        label="Speech Volume"
        description="Global playback volume for spoken output on the selected output device."
        descriptionMode="tooltip"
        grouped={true}
        formatValue={(value) => `${Math.round(value * 100)}%`}
        disabled={!speech.ttsEnabled}
      />
    </SettingsGroup>
  );
};

export const MyVoicesSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <VoiceArchitectSection speech={speech} showTitle={showGroupTitle} />;
};

export const SoundAndTuningSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <VoiceArchitectSection speech={speech} showTitle={showGroupTitle} />;
};

export const EngineLibrarySection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <EngineLibraryPanel speech={speech} showTitle={showGroupTitle} />;
};

export const ListenVoiceCloningSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <VoiceCloningSection speech={speech} showTitle={showGroupTitle} />;
};

export const AutoReadbackSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <AutoReadbackPanel speech={speech} showTitle={showGroupTitle} />;
};

export const ListenOutputSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <OutputPanel speech={speech} showTitle={showGroupTitle} />;
};

export const ListenAllSections: React.FC = () => {
  const speech = useListenSpeechState();
  return (
    <div className="space-y-6">
      <VoiceArchitectSection speech={speech} />
      <EngineLibraryPanel speech={speech} />
      <VoiceCloningSection speech={speech} />
      <AutoReadbackPanel speech={speech} />
      <OutputPanel speech={speech} />
    </div>
  );
};
