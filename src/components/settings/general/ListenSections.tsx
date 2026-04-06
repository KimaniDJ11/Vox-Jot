import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Check,
  Globe,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Star,
  Trash2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
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
import {
  CompactBadgeRow,
  CompactMetaRow,
  type CompactBadgeItem,
} from "@/components/ui/CompactOverflow";
import { Trans, useTranslation } from "react-i18next";
import { LANGUAGES } from "@/lib/constants/languages";
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
  previewTtsVoicePresetDraft,
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
    <div className="relative w-full">
      <select
        className="w-full min-w-0 appearance-none rounded-full border border-[var(--border)] bg-[var(--bg)] py-2 pe-9 ps-4 text-sm font-semibold shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50"
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
  "group h-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)] transition-all duration-200";
const speechLibraryBadgeClassName =
  "inline-flex items-center rounded-full bg-[var(--input)] px-3 py-1 text-xs font-medium text-[var(--muted)]";
const speechLibraryActiveBadgeClassName =
  "inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white shadow-[var(--shadow-sm)]";
const speechLibraryCountBadgeClassName =
  "inline-flex min-w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]";
const HIDDEN_TTS_PROVIDER_IDS = new Set(["local_sidecar_api"]);
const MANAGED_SPEECH_RUNTIME_PROVIDER_IDS = new Set([
  "openvoice",
  "chatterbox",
  "kokoro",
  "xtts",
  "fish_speech",
]);
const DEFAULT_TTS_PREVIEW_TEXT = "Vox Jot is ready.";

async function getTtsVoicesForSelection(
  providerId: string,
  modelId: string | null,
) {
  return invoke<VoiceInfo[]>("get_tts_voices_for_selection", {
    providerId,
    modelId,
  });
}

function localeLabel(locale: string | null | undefined) {
  return locale ? ` (${locale})` : "";
}

function sourceKindLabel(sourceKind: CatalogModelDescriptor["source_kind"]) {
  return sourceKind === "runtime" ? "Runtime" : "Built-in";
}

function formatLanguageAbbreviation(language: string) {
  const trimmed = language.trim();
  if (!trimmed) return language;
  return trimmed.split(/[-_]/)[0].slice(0, 3).toUpperCase();
}

function getModelLanguageItems(model: CatalogModelDescriptor) {
  if (model.supported_languages.length === 0) {
    return model.locale
      ? [formatLanguageAbbreviation(model.locale)]
      : ["Provider managed"];
  }
  return model.supported_languages.map(formatLanguageAbbreviation);
}

function ttsModelSupportsLanguage(
  model: CatalogModelDescriptor,
  languageCode: string,
) {
  if (model.supported_languages.includes(languageCode)) {
    return true;
  }

  return model.locale?.split(/[-_]/)[0] === languageCode;
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

function isMlxProvider(providerId: string) {
  return providerId.startsWith("mlx_");
}

function providerOptionContext(provider: ProviderDescriptor) {
  if (isMlxProvider(provider.id)) {
    return "MLX Audio";
  }
  if (MANAGED_SPEECH_RUNTIME_PROVIDER_IDS.has(provider.id)) {
    return "Speech Runtime";
  }
  return null;
}

function modelOptionContext(model: CatalogModelDescriptor) {
  if (isMlxProvider(model.provider_id)) {
    return "MLX Audio";
  }
  if (MANAGED_SPEECH_RUNTIME_PROVIDER_IDS.has(model.provider_id)) {
    return "Speech Runtime";
  }
  return null;
}

function formatSelectableLabel(label: string, detail: string | null) {
  if (!detail) return label;
  return `${label} (${detail})`;
}

function previewPreparationMessage(model: CatalogModelDescriptor) {
  if (model.source_kind === "runtime") {
    return `Preparing ${model.label} runtime for first preview…`;
  }
  return `Preparing ${model.label} preview…`;
}

function previewErrorMessage(
  error: unknown,
  model?: CatalogModelDescriptor | null,
  fallback = "Failed to preview voice preset",
) {
  const raw = error instanceof Error ? error.message : fallback;
  if (
    raw.startsWith("Speech runtime") ||
    raw.startsWith("MLX speech") ||
    raw.startsWith("MLX bridge")
  ) {
    return raw;
  }

  if (model?.source_kind === "runtime") {
    return `Speech runtime preview failed: ${raw}`;
  }
  if (model && isMlxProvider(model.provider_id)) {
    return `MLX preview failed: ${raw}`;
  }
  return `Preview failed: ${raw}`;
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
    label: formatSelectableLabel(
      provider.label,
      providerOptionContext(provider),
    ),
  }));
  const modelOptions = visibleModels
    .filter((model) => model.provider_id === providerIdForControls)
    .map((model) => ({
      value: model.id,
      label: `${formatSelectableLabel(model.label, modelOptionContext(model))}${model.installed ? "" : " (Download required)"}`,
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

  const createFromActivePreset = useCallback(
    async (label?: string) => {
      const source = activePreset
        ? buildPresetInput(activePreset)
        : defaultPresetInput();
      await createTtsVoicePreset({
        ...source,
        label: label?.trim() || source.label || "Voice",
      });
      await refreshAll();
    },
    [activePreset, refreshAll],
  );

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

  const previewPreset = useCallback(
    async (presetId: string, previewText?: string | null) => {
      setPreviewingPresetId(presetId);
      try {
        const preset = presets.find((p) => p.id === presetId);
        let model: CatalogModelDescriptor | null = null;
        if (preset) {
          model =
            allModels.find(
              (m) =>
                m.provider_id === preset.provider_id &&
                m.id === preset.model_id,
            ) ?? null;
          if (model) {
            await ensureModelInstalled(model);
          }
          if (
            model &&
            model.source_kind === "runtime" &&
            model.readiness_status === "downloaded"
          ) {
            setStatusMessage(previewPreparationMessage(model));
            await prepareSidecarEngine(preset.provider_id);
            await refreshPlatform();
          }
        }
        await previewTtsVoicePreset(presetId, previewText ?? null);
        setStatusMessage(null);
      } catch (error) {
        const preset = presets.find((p) => p.id === presetId);
        const model = preset
          ? (allModels.find(
              (item) =>
                item.provider_id === preset.provider_id &&
                item.id === preset.model_id,
            ) ?? null)
          : null;
        setStatusMessage(
          previewErrorMessage(error, model, "Failed to preview voice preset"),
        );
      } finally {
        setPreviewingPresetId(null);
      }
    },
    [presets, allModels, ensureModelInstalled, refreshPlatform],
  );

  const previewPresetDraft = useCallback(
    async (input: TtsVoicePresetInput, previewText?: string | null) => {
      setPreviewingPresetId("__draft__");
      try {
        const model =
          allModels.find(
            (item) =>
              item.provider_id === input.provider_id &&
              item.id === input.model_id,
          ) ?? null;
        if (model) {
          await ensureModelInstalled(model);
          if (
            model.source_kind === "runtime" &&
            model.readiness_status === "downloaded"
          ) {
            setStatusMessage(previewPreparationMessage(model));
            await prepareSidecarEngine(input.provider_id);
            await refreshPlatform();
          }
        }
        await previewTtsVoicePresetDraft(input, previewText ?? null);
        setStatusMessage(null);
      } catch (error) {
        setStatusMessage(
          previewErrorMessage(
            error,
            allModels.find(
              (item) =>
                item.provider_id === input.provider_id &&
                item.id === input.model_id,
            ) ?? null,
            "Failed to preview voice preset draft",
          ),
        );
      } finally {
        setPreviewingPresetId(null);
      }
    },
    [allModels, ensureModelInstalled, refreshPlatform],
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
    previewPresetDraft,
    selectProvider,
    selectModel,
    activateModel,
    createPresetFromProfile,
  };
}

type ListenSpeechState = ReturnType<typeof useListenSpeechState>;

const workflowCardClassName =
  "rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 shadow-[var(--shadow-sm)]";
const whiteWorkflowCardClassName =
  "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--shadow-sm)]";
const flatSectionSurfaceClassName =
  "overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-sm)]";
const whiteFlatSectionSurfaceClassName =
  "overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]";
const workflowFieldLabelClassName =
  "text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]";
const workflowHintClassName = "text-xs leading-5 text-[var(--muted)]";

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

const WorkflowField: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div className="space-y-2">
    <div className="space-y-1">
      <p className={workflowFieldLabelClassName}>{label}</p>
      {hint ? <p className={workflowHintClassName}>{hint}</p> : null}
    </div>
    {children}
  </div>
);

const VoiceTuningCard: React.FC<{
  preset: TtsVoicePreset | TtsVoicePresetInput;
  onUpdatePreset: (patch: TtsVoicePresetPatch) => void;
  ttsEnabled: boolean;
  controls: TtsAdvancedControlDescriptor[];
  supportsExpressiveness: boolean;
  title: string;
  embedded?: boolean;
  surfaceClassName?: string;
}> = ({
  preset,
  onUpdatePreset,
  ttsEnabled,
  controls,
  supportsExpressiveness,
  title,
  embedded = false,
  surfaceClassName = workflowCardClassName,
}) => {
  const { t } = useTranslation();
  const descriptors = tuningDescriptorMap(controls);
  const controlIds = new Set(controls.map((control) => control.id));

  return (
    <div className={embedded ? "space-y-3" : surfaceClassName}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
      </div>

      <div className="mt-3 grid gap-x-5 gap-y-2 md:grid-cols-2">
        <Slider
          value={preset.tuning.tempo_rate ?? 1}
          onChange={(value) =>
            onUpdatePreset({ tuning: { tempo_rate: value } })
          }
          min={0.5}
          max={2}
          step={0.05}
          label="Tempo"
          description="Saved per profile so every voice can be brisk, measured, or cinematic."
          descriptionMode="tooltip"
          grouped={true}
          layout="compact"
          formatValue={(value) => `${value.toFixed(2)}x`}
          disabled={!ttsEnabled}
        />
        <Slider
          value={preset.tuning.expressiveness ?? 0.5}
          onChange={(value) =>
            onUpdatePreset({ tuning: { expressiveness: value } })
          }
          min={0}
          max={1}
          step={0.05}
          label="Expressiveness"
          description="Overall energy and liveliness for the active profile."
          descriptionMode="tooltip"
          grouped={true}
          layout="compact"
          formatValue={(value) => `${Math.round(value * 100)}%`}
          disabled={!ttsEnabled || !supportsExpressiveness}
        />
        {controlIds.has("exaggeration") ? (
          <Slider
            value={preset.tuning.exaggeration ?? 0.5}
            onChange={(value) =>
              onUpdatePreset({ tuning: { exaggeration: value } })
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
            grouped={true}
            layout="compact"
            formatValue={(value) => `${Math.round(value * 100)}%`}
            disabled={!ttsEnabled}
          />
        ) : null}
        {controlIds.has("randomness") ? (
          <Slider
            value={preset.tuning.randomness ?? 0.7}
            onChange={(value) =>
              onUpdatePreset({ tuning: { randomness: value } })
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
            grouped={true}
            layout="compact"
            formatValue={(value) => `${Math.round(value * 100)}%`}
            disabled={!ttsEnabled}
          />
        ) : null}
        {controlIds.has("guidance") ? (
          <Slider
            value={preset.tuning.guidance ?? 0.5}
            onChange={(value) =>
              onUpdatePreset({ tuning: { guidance: value } })
            }
            min={descriptors.get("guidance")?.min ?? 0}
            max={descriptors.get("guidance")?.max ?? 1}
            step={descriptors.get("guidance")?.step ?? 0.05}
            label={tuningNumberLabel(descriptors.get("guidance"), "Guidance")}
            description={tuningDescription(
              descriptors.get("guidance"),
              "Higher values make the engine adhere more tightly to the intended delivery.",
            )}
            descriptionMode="tooltip"
            grouped={true}
            layout="compact"
            formatValue={(value) => `${Math.round(value * 100)}%`}
            disabled={!ttsEnabled}
          />
        ) : null}
        {controlIds.has("stability") ? (
          <Slider
            value={preset.tuning.stability ?? 0.5}
            onChange={(value) =>
              onUpdatePreset({ tuning: { stability: value } })
            }
            min={descriptors.get("stability")?.min ?? 0}
            max={descriptors.get("stability")?.max ?? 1}
            step={descriptors.get("stability")?.step ?? 0.05}
            label={tuningNumberLabel(descriptors.get("stability"), "Stability")}
            description={tuningDescription(
              descriptors.get("stability"),
              "Use this only for engines that expose a real stability control.",
            )}
            descriptionMode="tooltip"
            grouped={true}
            layout="compact"
            formatValue={(value) => `${Math.round(value * 100)}%`}
            disabled={!ttsEnabled}
          />
        ) : null}
        {controlIds.has("repetition_penalty") ? (
          <Slider
            value={preset.tuning.repetition_penalty ?? 1.2}
            onChange={(value) =>
              onUpdatePreset({ tuning: { repetition_penalty: value } })
            }
            min={descriptors.get("repetition_penalty")?.min ?? 1}
            max={descriptors.get("repetition_penalty")?.max ?? 3}
            step={descriptors.get("repetition_penalty")?.step ?? 0.1}
            label={tuningNumberLabel(
              descriptors.get("repetition_penalty"),
              "Repetition Penalty",
            )}
            description={tuningDescription(
              descriptors.get("repetition_penalty"),
              "Helps reduce repeated words or loops in longer reads.",
            )}
            descriptionMode="tooltip"
            grouped={true}
            layout="compact"
            formatValue={(value) => value.toFixed(2)}
            disabled={!ttsEnabled}
          />
        ) : null}
      </div>

      {controlIds.has("style_instructions") ? (
        <div className="mt-3 space-y-2">
          <p className={workflowFieldLabelClassName}>{t('listen.tuning.styleInstructions')}</p>
          <Textarea
            value={preset.tuning.style_instructions ?? ""}
            onChange={(event) =>
              onUpdatePreset({
                tuning: {
                  style_instructions: event.target.value.trim() || null,
                },
              })
            }
            disabled={!ttsEnabled}
            className="min-h-[84px] !rounded-2xl"
            placeholder="Warm, calm, confident, closer to a product demo than a podcast host."
          />
        </div>
      ) : null}
    </div>
  );
};

const VoiceArchitectSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const [saveProfileNameDraft, setSaveProfileNameDraft] = useState("");
  const [draftProviderId, setDraftProviderId] = useState("");
  const [draftModelId, setDraftModelId] = useState("");
  const [draftVoiceId, setDraftVoiceId] = useState("__auto__");
  const [draftVoices, setDraftVoices] = useState<VoiceInfo[]>([]);
  const [loadingDraftVoices, setLoadingDraftVoices] = useState(false);
  const [draftTuning, setDraftTuning] = useState(defaultVoiceTuning());
  const [previewTextDraft, setPreviewTextDraft] = useState(
    DEFAULT_TTS_PREVIEW_TEXT,
  );
  const lastDraftSelectionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setSaveProfileNameDraft("");
  }, [speech.activePreset?.id]);

  useEffect(() => {
    setDraftProviderId(speech.activePreset?.provider_id ?? "");
    setDraftModelId(speech.activePreset?.model_id ?? "");
    setDraftVoiceId(speech.activePreset?.voice_id ?? "__auto__");
    lastDraftSelectionKeyRef.current = null;
    setDraftTuning({
      ...(speech.activePreset?.tuning ?? defaultVoiceTuning()),
    });
  }, [
    speech.activePreset?.id,
    speech.activePreset?.model_id,
    speech.activePreset?.provider_id,
    speech.activePreset?.voice_id,
    speech.activePreset?.tuning,
  ]);

  useEffect(() => {
    if (!speech.settings || !speech.activePreset) return;

    const providerIdForControls =
      speech.providerOptions.find((provider) => provider.value === draftProviderId)
        ?.value ??
      speech.providerOptions[0]?.value ??
      "";
    const modelOptionsForProvider = speech.visibleModels.filter(
      (model) => model.provider_id === providerIdForControls,
    );
    const modelIdForControls =
      modelOptionsForProvider.find((model) => model.id === draftModelId)?.id ??
      modelOptionsForProvider[0]?.id ??
      "";
    const matchesActiveModel =
      providerIdForControls === speech.activePreset.provider_id &&
      modelIdForControls === speech.activePreset.model_id;
    const selectionKey = `${providerIdForControls}::${modelIdForControls}`;

    if (lastDraftSelectionKeyRef.current === selectionKey) {
      return;
    }
    lastDraftSelectionKeyRef.current = selectionKey;

    if (matchesActiveModel) {
      setDraftVoiceId(speech.activePreset.voice_id ?? "__auto__");
    } else {
      setDraftVoiceId("__auto__");
    }
  }, [
    draftModelId,
    draftProviderId,
    speech.activePreset,
    speech.providerOptions,
    speech.settings,
    speech.visibleModels,
  ]);

  useEffect(() => {
    if (!speech.settings || !speech.activePreset) return;

    const providerIdForControls =
      speech.providerOptions.find((provider) => provider.value === draftProviderId)
        ?.value ??
      speech.providerOptions[0]?.value ??
      "";
    const modelOptionsForProvider = speech.visibleModels.filter(
      (model) => model.provider_id === providerIdForControls,
    );
    const modelIdForControls =
      modelOptionsForProvider.find((model) => model.id === draftModelId)?.id ??
      modelOptionsForProvider[0]?.id ??
      "";
    const matchesActiveModel =
      providerIdForControls === speech.activePreset.provider_id &&
      modelIdForControls === speech.activePreset.model_id;

    if (!providerIdForControls || !modelIdForControls) {
      setDraftVoices([]);
      setLoadingDraftVoices(false);
      return;
    }

    if (isVoiceFixedToModel(providerIdForControls)) {
      setDraftVoices([]);
      setLoadingDraftVoices(false);
      return;
    }

    if (matchesActiveModel) {
      setDraftVoices(speech.voices);
      setLoadingDraftVoices(speech.loadingVoices);
      return;
    }

    let cancelled = false;
    setLoadingDraftVoices(true);

    void getTtsVoicesForSelection(providerIdForControls, modelIdForControls)
      .then((voices) => {
        if (cancelled) return;
        setDraftVoices(voices);
      })
      .catch((error) => {
        if (cancelled) return;
        setDraftVoices([]);
        speech.setStatusMessage(
          error instanceof Error
            ? error.message
            : "Failed to load voices for the selected model",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingDraftVoices(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    draftModelId,
    draftProviderId,
    speech.activePreset,
    speech.loadingVoices,
    speech.providerOptions,
    speech.settings,
    speech.setStatusMessage,
    speech.visibleModels,
    speech.voices,
  ]);

  if (!speech.settings || !speech.activePreset) return null;

  const activeEngineFamily = formatEngineFamilyLabel(
    speech.activeModel?.runtime.engine_family ??
      speech.activeProvider?.runtime.engine_family ??
      null,
  );
  const activeCloneProfile =
    speech.compatibleProfiles.find(
      (profile) => profile.id === speech.activePreset?.voice_profile_id,
    ) ?? null;
  const activeModelLabel =
    speech.activeModel?.label ?? speech.activePreset.model_id;
  const activeProviderLabel =
    speech.activeProvider?.label ?? speech.activePreset.provider_id;
  const activeLocaleLabel =
    speech.activePreset.locale_snapshot ?? speech.activeModel?.locale ?? "Auto";
  const saveProfileName = saveProfileNameDraft.trim();
  const draftProviderIdForControls =
    speech.providerOptions.find(
      (provider) => provider.value === draftProviderId,
    )?.value ??
    speech.providerOptions[0]?.value ??
    "";
  const supportsDraftManualVoiceId =
    draftProviderIdForControls === "local_sidecar_api";
  const draftModelOptions = speech.visibleModels
    .filter((model) => model.provider_id === draftProviderIdForControls)
    .map((model) => ({
      value: model.id,
      label: `${formatSelectableLabel(model.label, modelOptionContext(model))}${model.installed ? "" : " (Download required)"}`,
    }));
  const draftModelIdForControls =
    draftModelOptions.find((model) => model.value === draftModelId)?.value ??
    draftModelOptions[0]?.value ??
    "";
  const draftSelectedModel =
    speech.allModels.find(
      (model) =>
        model.provider_id === draftProviderIdForControls &&
        model.id === draftModelIdForControls,
    ) ?? null;
  const draftSelectedProvider =
    speech.allProviders.find(
      (provider) => provider.id === draftProviderIdForControls,
    ) ?? null;
  const controls =
    draftSelectedModel?.delivery_support.advanced_controls ??
    speech.activeModel?.delivery_support.advanced_controls ??
    [];
  const supportsExpressiveness =
    (draftSelectedModel?.delivery_support.expressiveness_mode ??
      speech.activeModel?.delivery_support.expressiveness_mode ??
      "unsupported") !== "unsupported";
  const draftMatchesActiveModel =
    draftProviderIdForControls === speech.activePreset.provider_id &&
    draftModelIdForControls === speech.activePreset.model_id;
  const draftProviderLabel =
    draftSelectedProvider?.label ?? activeProviderLabel;
  const draftLocaleLabel = draftMatchesActiveModel
    ? activeLocaleLabel
    : (draftSelectedModel?.locale ?? "Auto");
  const draftVoiceInventory = draftMatchesActiveModel ? speech.voices : draftVoices;
  const draftSelectedVoice =
    draftVoiceInventory.find((voice) => voice.id === draftVoiceId) ?? null;
  const draftVoiceLabel = isVoiceFixedToModel(draftProviderIdForControls)
    ? (draftSelectedModel?.label ?? draftModelIdForControls)
    : draftVoiceId !== "__auto__" && draftSelectedVoice
      ? draftSelectedVoice.label
      : loadingDraftVoices
        ? "Loading voices..."
        : draftVoiceInventory.length > 1
          ? `${draftVoiceInventory.length} voices`
          : draftVoiceInventory.length === 1
            ? "1 voice"
            : "No preset voices";
  const draftVoiceOptions = [
    {
      value: "__auto__",
      label:
        draftVoiceInventory.length > 0 ? "Automatic voice" : "No preset voices",
      disabled: draftVoiceInventory.length === 0,
    },
    ...draftVoiceInventory.map((voice) => ({
      value: voice.id,
      label: `${voice.label}${localeLabel(voice.locale)}`,
    })),
  ];
  const draftModelLabel = draftSelectedModel?.label ?? activeModelLabel;
  const buildDraftPresetInput = (): TtsVoicePresetInput => {
    const source = buildPresetInput(speech.activePreset);
    const providerOrModelChanged =
      source.provider_id !== draftProviderIdForControls ||
      source.model_id !== draftModelIdForControls;
    const voiceIsFixedToModel = isVoiceFixedToModel(draftProviderIdForControls);
    const draftVoiceSelectionId =
      voiceIsFixedToModel || draftVoiceId === "__auto__" ? null : draftVoiceId;
    const draftVoiceSelection =
      draftVoiceInventory.find((voice) => voice.id === draftVoiceSelectionId) ?? null;

    return {
      ...source,
      provider_id: draftProviderIdForControls,
      model_id: draftModelIdForControls,
      tuning: { ...draftTuning },
      voice_id: voiceIsFixedToModel
        ? draftModelIdForControls
        : (draftVoiceSelectionId ?? null),
      voice_profile_id: providerOrModelChanged
        ? null
        : (source.voice_profile_id ?? null),
      voice_label_snapshot: voiceIsFixedToModel
        ? (draftSelectedModel?.label ?? draftModelIdForControls)
        : (draftVoiceSelection?.label ?? null),
      locale_snapshot: draftVoiceSelection
        ? (draftVoiceSelection.locale ?? null)
        : providerOrModelChanged
          ? (draftSelectedModel?.locale ?? null)
          : (source.locale_snapshot ?? null),
    };
  };
  const updateDraftPreset = (patch: TtsVoicePresetPatch) => {
    if (!patch.tuning) return;
    setDraftTuning((current) => ({
      ...current,
      ...patch.tuning,
    }));
  };
  const handleSaveCurrent = async () => {
    if (
      !saveProfileName ||
      !draftProviderIdForControls ||
      !draftModelIdForControls
    )
      return;

    try {
      await createTtsVoicePreset({
        ...buildDraftPresetInput(),
        label: saveProfileName,
      });
      await speech.refreshAll();
      setSaveProfileNameDraft("");
    } catch (error) {
      speech.setStatusMessage(
        error instanceof Error ? error.message : "Failed to save voice preset",
      );
    }
  };

  const content = (
    <>
      <div
        className={`space-y-3 px-4 py-3 ${
          !speech.ttsEnabled ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <div className={whiteWorkflowCardClassName}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={speechLibraryActiveBadgeClassName}>
                  <Star className="h-3.5 w-3.5" />
                  {t('listen.myVoices.active')}
                </span>
                <span className={speechLibraryBadgeClassName}>
                  {activeEngineFamily}
                </span>
              </div>
              <p className="text-sm text-[var(--muted)]">
                <Trans
                  i18nKey="listen.myVoices.activePreset"
                  values={{ name: speech.activePreset.label }}
                  components={{ bold: <span className="font-semibold text-[var(--text)]" /> }}
                />
              </p>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
                <div className="space-y-1">
                  <p className={workflowFieldLabelClassName}>{t('listen.myVoices.saveAs')}</p>
                  <Input
                    value={saveProfileNameDraft}
                    onChange={(event) =>
                      setSaveProfileNameDraft(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSaveCurrent();
                      }
                    }}
                    disabled={!speech.ttsEnabled}
                    placeholder="Name this saved voice"
                    className="w-full max-w-none"
                  />
                </div>
                <span className={speechLibraryBadgeClassName}>
                  {draftModelLabel}
                </span>
                <span className={speechLibraryBadgeClassName}>
                  {draftVoiceLabel}
                </span>
                {draftMatchesActiveModel && activeCloneProfile ? (
                  <span className={speechLibraryBadgeClassName}>
                    {activeCloneProfile.label}
                  </span>
                ) : null}
              </div>
            </div>
            {speech.statusMessage ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
                {speech.statusMessage}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <div className={whiteWorkflowCardClassName}>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="space-y-2">
                <p className={workflowFieldLabelClassName}>{t('listen.myVoices.previewText')}</p>
                <Textarea
                  value={previewTextDraft}
                  onChange={(event) => setPreviewTextDraft(event.target.value)}
                  placeholder={DEFAULT_TTS_PREVIEW_TEXT}
                  disabled={!speech.ttsEnabled}
                  className="min-h-[92px] max-h-[132px] !rounded-2xl"
                />
              </div>
              <div className="flex min-w-[156px] flex-col items-stretch gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void speech.previewPresetDraft(
                      buildDraftPresetInput(),
                      previewTextDraft,
                    )
                  }
                  disabled={speech.previewingPresetId === "__draft__"}
                  className="inline-flex items-center justify-center gap-1.5"
                >
                  <Play className="h-3.5 w-3.5" />
                  {t('listen.myVoices.preview')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void commands.ttsStop()}
                  className="inline-flex items-center justify-center gap-1.5"
                >
                  <Square className="h-3.5 w-3.5" />
                  {t('listen.myVoices.stop')}
                </Button>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--muted)]">
                  {draftProviderLabel} · {draftLocaleLabel}
                </div>
              </div>
            </div>
          </div>

          <div className={whiteWorkflowCardClassName}>
            <div className="grid content-start gap-2 md:grid-cols-2">
              <WorkflowField label="Provider">
                <SelectField
                  value={draftProviderIdForControls}
                  onChange={(value) => {
                    const nextModelId =
                      speech.visibleModels.find(
                        (model) => model.provider_id === value,
                      )?.id ?? "";
                    lastDraftSelectionKeyRef.current = null;
                    setDraftProviderId(value);
                    setDraftModelId(nextModelId);
                  }}
                  disabled={!speech.ttsEnabled || speech.loadingPlatform}
                  options={speech.providerOptions}
                />
              </WorkflowField>

              <WorkflowField label="Model">
                <SelectField
                  value={draftModelIdForControls}
                  onChange={(value) => {
                    lastDraftSelectionKeyRef.current = null;
                    setDraftModelId(value);
                  }}
                  disabled={
                    !speech.ttsEnabled ||
                    speech.loadingPlatform ||
                    draftModelOptions.length === 0
                  }
                  options={draftModelOptions}
                />
              </WorkflowField>

              {!draftMatchesActiveModel ? (
                <div className="md:col-span-2">
                  <p className="text-xs leading-5 text-[var(--muted)]">
                    {t('listen.myVoices.draftModeHint')}
                  </p>
                </div>
              ) : null}

              {!isVoiceFixedToModel(draftProviderIdForControls) &&
              !supportsDraftManualVoiceId ? (
                <WorkflowField label="Voice">
                  <SelectField
                    value={draftVoiceId}
                    onChange={(value) => {
                      setDraftVoiceId(value);
                      if (!draftMatchesActiveModel) {
                        return;
                      }
                      const selectedVoice =
                        draftVoiceInventory.find((voice) => voice.id === value) ??
                        null;
                      void speech.updateActivePreset({
                        voice_id: value === "__auto__" ? null : value,
                        voice_label_snapshot:
                          value === "__auto__"
                            ? null
                            : (selectedVoice?.label ?? value),
                        locale_snapshot:
                          value === "__auto__"
                            ? null
                            : (selectedVoice?.locale ?? null),
                      });
                    }}
                    disabled={!speech.ttsEnabled || loadingDraftVoices}
                    options={
                      loadingDraftVoices
                        ? [{ value: "__auto__", label: "Loading voices..." }]
                        : draftVoiceOptions
                    }
                  />
                </WorkflowField>
              ) : null}

              {draftMatchesActiveModel &&
              speech.activeModel?.capabilities.supports_voice_cloning ? (
                <WorkflowField label="Clone Profile">
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
                            ? (speech.activePreset.voice_label_snapshot ?? null)
                            : (profile?.label ?? value),
                      });
                    }}
                    disabled={!speech.ttsEnabled || speech.loadingProfiles}
                    options={speech.profileOptions}
                  />
                </WorkflowField>
              ) : null}

              {draftMatchesActiveModel && supportsDraftManualVoiceId ? (
                <WorkflowField label="Manual Voice ID">
                  <Input
                    value={speech.activePreset.voice_id ?? ""}
                    onChange={(event) =>
                      void speech.updateActivePreset({
                        voice_id: event.target.value || null,
                        voice_label_snapshot: event.target.value || null,
                      })
                    }
                    placeholder="Speaker / voice ID"
                    disabled={!speech.ttsEnabled}
                    className="w-full max-w-none"
                  />
                </WorkflowField>
              ) : null}
            </div>
          </div>
        </div>

        <VoiceTuningCard
          preset={buildDraftPresetInput()}
          onUpdatePreset={updateDraftPreset}
          ttsEnabled={speech.ttsEnabled}
          controls={controls}
          supportsExpressiveness={supportsExpressiveness}
          title="Tuning"
          surfaceClassName={whiteWorkflowCardClassName}
        />

        <div className={whiteWorkflowCardClassName}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[var(--text)]">
              {t('listen.myVoices.savedProfiles')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleSaveCurrent()}
                disabled={
                  !speech.ttsEnabled ||
                  !saveProfileName ||
                  !draftProviderIdForControls ||
                  !draftModelIdForControls
                }
              >
                {t('listen.myVoices.saveCurrent')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void speech.createNewPreset()}
                disabled={!speech.ttsEnabled}
              >
                {t('listen.myVoices.new')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void speech.refreshPresets()}
                disabled={speech.loadingPresets}
                className="inline-flex items-center gap-1.5"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    speech.loadingPresets ? "animate-spin" : ""
                  }`}
                />
                {t('listen.myVoices.refresh')}
              </Button>
            </div>
          </div>

          <div className="grid max-h-[320px] gap-2 overflow-y-auto pe-1 lg:grid-cols-2">
            {speech.presets.map((preset) => {
              const isActive = preset.id === speech.activePreset?.id;
              const presetVoiceLabel =
                preset.voice_label_snapshot ?? preset.voice_id ?? "Automatic";

              return (
                <div
                  key={preset.id}
                  className={`rounded-2xl border px-3 py-2.5 transition-colors ${
                    isActive
                      ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent),transparent_92%)]"
                      : "border-[var(--border)] bg-[var(--bg)]"
                  }`}
                >
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-sm font-semibold leading-none text-[var(--text)]">
                          {preset.label}
                        </p>
                        {isActive ? (
                          <span className={speechLibraryActiveBadgeClassName}>
                            <Check className="h-3.5 w-3.5" />
                            {t('listen.myVoices.active')}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                        <span className={speechLibraryBadgeClassName}>
                          {preset.model_id}
                        </span>
                        <span className={speechLibraryBadgeClassName}>
                          {presetVoiceLabel}
                        </span>
                        {preset.voice_profile_id ? (
                          <span className={speechLibraryBadgeClassName}>
                            {t('listen.myVoices.clone')}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      {!isActive ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void speech.setActivePreset(preset.id)}
                          disabled={!speech.ttsEnabled}
                        >
                          {t('listen.myVoices.useThisVoice')}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void speech.previewPreset(preset.id, previewTextDraft)
                        }
                        disabled={speech.previewingPresetId === preset.id}
                        className="inline-flex items-center gap-1.5"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {t('listen.myVoices.preview')}
                      </Button>
                      <Button
                        type="button"
                        variant="danger-ghost"
                        size="sm"
                        onClick={() => void speech.removePreset(preset.id)}
                        disabled={
                          !speech.ttsEnabled || speech.presets.length <= 1
                        }
                        title={`Delete ${preset.label}`}
                        aria-label={`Delete ${preset.label}`}
                        className="inline-flex h-8 w-8 items-center justify-center p-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );

  if (!showTitle) {
    return content;
  }

  return <SettingsGroup title="My Voices">{content}</SettingsGroup>;
};

const SoundDesignSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const [previewTextDraft, setPreviewTextDraft] = useState(
    DEFAULT_TTS_PREVIEW_TEXT,
  );

  if (!speech.settings || !speech.activePreset) return null;

  const controls = speech.activeModel?.delivery_support.advanced_controls ?? [];
  const supportsExpressiveness =
    (speech.activeModel?.delivery_support.expressiveness_mode ??
      "unsupported") !== "unsupported";

  return (
    <SettingsGroup
      title={showTitle ? "Sound & Tuning" : undefined}
      description={
        showTitle
          ? "Use this panel when you already have the right voice selected and just want to shape the delivery."
          : undefined
      }
    >
      <div
        className={`space-y-5 px-5 py-5 ${
          !speech.ttsEnabled ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <div className={workflowCardClassName}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-[var(--text)]">
                {t('listen.soundTuning.tuneTitle')}
              </h3>
              <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
                {t('listen.soundTuning.activeProfileIs')}{" "}
                <span className="font-semibold text-[var(--text)]">
                  {speech.activePreset.label}
                </span>
                {t('listen.soundTuning.previewFromHere')}
              </p>
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
                disabled={speech.previewingPresetId === speech.activePreset.id}
                className="inline-flex items-center gap-1.5"
              >
                <Play className="h-3.5 w-3.5" />
                {t('listen.soundTuning.preview')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void commands.ttsStop()}
                className="inline-flex items-center gap-1.5"
              >
                <Square className="h-3.5 w-3.5" />
                {t('listen.soundTuning.stop')}
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <p className={workflowFieldLabelClassName}>{t('listen.myVoices.previewText')}</p>
            <Textarea
              value={previewTextDraft}
              onChange={(event) => setPreviewTextDraft(event.target.value)}
              placeholder={DEFAULT_TTS_PREVIEW_TEXT}
              disabled={!speech.ttsEnabled}
              className="min-h-[110px] resize-y !rounded-2xl"
            />
          </div>
        </div>

        <VoiceTuningCard
          preset={speech.activePreset}
          onUpdatePreset={(patch) => void speech.updateActivePreset(patch)}
          ttsEnabled={speech.ttsEnabled}
          controls={controls}
          supportsExpressiveness={supportsExpressiveness}
          title="Shape how the current voice performs"
        />
      </div>
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
  const headerBadges: CompactBadgeItem[] = [
    active
      ? {
          id: "active",
          label: "Active",
          variant: "primary",
          icon: <Check className="h-3.5 w-3.5" />,
        }
      : null,
    !active && selected
      ? {
          id: "selected",
          label: "Selected",
          variant: "primary",
        }
      : null,
    {
      id: `provider-${provider?.id ?? model.provider_id}`,
      label: provider?.label ?? "Provider",
      variant: "secondary",
    },
    {
      id: `source-${model.source_kind}`,
      label: sourceKindLabel(model.source_kind),
      variant: "secondary",
    },
    model.installed
      ? {
          id: "downloaded",
          label: "Downloaded",
          variant: "secondary",
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];
  const detailItems = [
    ...getModelLanguageItems(model),
    provider?.runtime.label ?? model.runtime.label,
  ];
  const capabilityBadgeItems: CompactBadgeItem[] = capabilityTags.map(
    (tag) => ({
      id: tag,
      label: tag,
      variant: "secondary",
      icon:
        tag === "Voice cloning" ? (
          <Sparkles className="h-3.5 w-3.5" />
        ) : undefined,
    }),
  );
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
      <div className="flex h-full flex-col gap-3">
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3
              className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--text)]"
              title={model.label}
            >
              {model.label}
            </h3>
            <CompactBadgeRow
              items={headerBadges}
              maxVisible={2}
              overflowLabel={`${model.label} badges`}
            />
          </div>

          <p
            className="truncate text-sm text-[var(--muted)]"
            title={model.description}
          >
            {model.description}
          </p>

          <CompactMetaRow
            items={detailItems}
            maxVisible={4}
            icon={<Globe className="h-4 w-4" />}
            overflowLabel={`${model.label} details`}
          />
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <CompactBadgeRow
            items={capabilityBadgeItems}
            maxVisible={2}
            overflowLabel={`${model.label} capabilities`}
          />
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
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--text)]">
        {title}
      </h3>
      <span className={speechLibraryCountBadgeClassName}>{count}</span>
    </div>
    {models.length > 0 ? (
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
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

const SpeechPackManagerCard: React.FC<{
  speech: ListenSpeechState;
}> = ({ speech }) => {
  const { t } = useTranslation();
  return (
  <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[var(--text)]">
          {t('listen.packManager.title')}
        </h3>
        <p className="text-sm text-[var(--muted)]">
          {t('listen.packManager.description')}
        </p>
      </div>
      <div className="space-y-2">
        {speech.packs.map((pack) => (
          <div
            key={pack.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
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
                  {t('listen.packManager.remove')}
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
                  {t('listen.packManager.download')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
  );
};

const EngineLibraryPanel: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
  titleActionTargetId?: string;
}> = ({ speech, showTitle = true, titleActionTargetId }) => {
  const { t } = useTranslation();
  const [providerFilter, setProviderFilter] = useState("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageSearchInputRef = useRef<HTMLInputElement>(null);
  const providerOptions = useMemo(
    () => [
      { value: "all", label: "All providers" },
      ...speech.visibleProviders.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ],
    [speech.visibleProviders],
  );
  const filteredLanguages = useMemo(
    () =>
      LANGUAGES.filter(
        (lang) =>
          lang.value !== "auto" &&
          lang.label.toLowerCase().includes(languageSearch.toLowerCase()),
      ),
    [languageSearch],
  );
  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return "All Languages";
    }
    return LANGUAGES.find((lang) => lang.value === languageFilter)?.label ?? "";
  }, [languageFilter]);
  const hasActiveLanguageFilter = languageFilter !== "all";
  const filteredModels = useMemo(
    () =>
      speech.visibleModels.filter((model) => {
        if (providerFilter !== "all" && model.provider_id !== providerFilter) {
          return false;
        }

        if (
          languageFilter !== "all" &&
          !ttsModelSupportsLanguage(model, languageFilter)
        ) {
          return false;
        }

        return true;
      }),
    [languageFilter, providerFilter, speech.visibleModels],
  );
  const downloadedModels = useMemo(
    () => filteredModels.filter((model) => model.installed),
    [filteredModels],
  );
  const availableModels = useMemo(
    () => filteredModels.filter((model) => !model.installed),
    [filteredModels],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        languageDropdownRef.current &&
        !languageDropdownRef.current.contains(event.target as Node)
      ) {
        setLanguageDropdownOpen(false);
        setLanguageSearch("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (languageDropdownOpen && languageSearchInputRef.current) {
      languageSearchInputRef.current.focus();
    }
  }, [languageDropdownOpen]);

  useEffect(() => {
    if (!titleActionTargetId) {
      setPortalTarget(null);
      return;
    }

    setPortalTarget(document.getElementById(titleActionTargetId));
  }, [titleActionTargetId]);

  if (!speech.settings) return null;

  const filterAction = (
    <div className="flex items-center gap-2">
      <div className="relative inline-flex">
        <select
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          className="min-h-11 appearance-none rounded-full border border-[var(--border)] bg-[var(--card)] py-2 pe-10 ps-4 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
        >
          {providerOptions.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {provider.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
      </div>
      <div className="relative" ref={languageDropdownRef}>
        <button
          type="button"
          onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
          className={`flex min-h-11 items-center gap-1.5 px-3.5 py-2 text-sm font-semibold transition-colors shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
            hasActiveLanguageFilter
              ? "rounded-full bg-logo-primary text-[var(--inverse-text)]"
              : "rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--card),var(--panel-bg)_12%)]"
          }`}
          aria-haspopup="listbox"
          aria-expanded={languageDropdownOpen}
        >
          <Globe className="h-3.5 w-3.5" />
          <span className="max-w-[140px] truncate">
            {selectedLanguageLabel}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${
              languageDropdownOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {languageDropdownOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-lg)]">
            <div className="border-b border-mid-gray/40 p-2">
              <input
                ref={languageSearchInputRef}
                type="text"
                value={languageSearch}
                onChange={(event) => setLanguageSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && filteredLanguages.length > 0) {
                    setLanguageFilter(filteredLanguages[0].value);
                    setLanguageDropdownOpen(false);
                    setLanguageSearch("");
                  } else if (event.key === "Escape") {
                    setLanguageDropdownOpen(false);
                    setLanguageSearch("");
                  }
                }}
                placeholder="Search languages"
                className="w-full rounded-md border border-mid-gray/40 bg-mid-gray/10 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-logo-primary"
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setLanguageFilter("all");
                  setLanguageDropdownOpen(false);
                  setLanguageSearch("");
                }}
                className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                  languageFilter === "all"
                    ? "bg-logo-primary font-semibold text-[var(--inverse-text)]"
                    : "hover:bg-mid-gray/10"
                }`}
              >
                {t('listen.engineLibrary.allLanguages')}
              </button>
              {filteredLanguages.map((language) => (
                <button
                  key={language.value}
                  type="button"
                  onClick={() => {
                    setLanguageFilter(language.value);
                    setLanguageDropdownOpen(false);
                    setLanguageSearch("");
                  }}
                  className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                    languageFilter === language.value
                      ? "bg-logo-primary font-semibold text-[var(--inverse-text)]"
                      : "hover:bg-mid-gray/10"
                  }`}
                >
                  {language.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const content = (
    <div className="space-y-3">
      {portalTarget ? createPortal(filterAction, portalTarget) : null}

      {speech.activeModel ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            {t('listen.engineLibrary.activeListenModel')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold text-[var(--text)]">
              {speech.activeModel.label}
            </p>
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
              {speech.activeProvider?.label ?? "Provider"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {speech.activeModel.description}
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            {speech.activeProvider?.runtime.label ??
              speech.activeModel.runtime.label}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[var(--shadow-sm)]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            {t('listen.engineLibrary.activeListenModel')}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {t('listen.engineLibrary.chooseProviderModel')}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {!portalTarget ? (
          <div className="flex justify-end px-5">{filterAction}</div>
        ) : null}
        <SpeechModelList
          title="Downloaded Models"
          count={downloadedModels.length}
          models={downloadedModels}
          speech={speech}
          emptyMessage={
            providerFilter !== "all" || languageFilter !== "all"
              ? "No downloaded speech models match the current filters."
              : "No compatible TTS models have been downloaded for this Mac yet."
          }
        />

        <div className="border-t border-[var(--border)] pt-4">
          <SpeechModelList
            title="Available to Download"
            count={availableModels.length}
            models={availableModels}
            speech={speech}
            emptyMessage={
              providerFilter !== "all" || languageFilter !== "all"
                ? "No available speech models match the current filters."
                : "Every compatible speech model is already downloaded or active."
            }
          />
        </div>
      </div>
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return <SettingsGroup title="Engine Library">{content}</SettingsGroup>;
};

const VoiceCloningSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const selectedProfile =
    speech.compatibleProfiles.find(
      (profile) => profile.id === speech.activePreset?.voice_profile_id,
    ) ?? null;

  if (!speech.settings) return null;

  const content = (
    <div className={whiteFlatSectionSurfaceClassName}>
      <div className="space-y-3 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {t('listen.voiceCloning.cloneProfiles')}
          </h3>
          <p className="text-sm text-[var(--muted)]">
            {t('listen.voiceCloning.cloneProfilesDescription')}
          </p>
        </div>
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
            {t('listen.voiceCloning.refresh')}
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
              {t('listen.voiceCloning.createPreset')}
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
              {t('listen.voiceCloning.importWav')}
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
              {t('listen.voiceCloning.deleteProfile')}
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
              <p>{t('listen.voiceCloning.transcriptHint')}</p>
            )}
            <div className="mt-2 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[var(--fg)]">
                    {t('listen.voiceCloning.improveFromDictations')}
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">
                    {t('listen.voiceCloning.improveFromDictationsDescription')}
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
                  {t('listen.voiceCloning.clearCollectedData')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm leading-6 text-[var(--muted)]">
            {t('listen.voiceCloning.cloningInactiveHint')}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--border)] p-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {t('listen.voiceCloning.createProfile')}
            </h3>
            <p className="text-sm text-[var(--muted)]">
              {t('listen.voiceCloning.createProfileDescription')}
            </p>
          </div>
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
              {t('listen.voiceCloning.createProfileButton')}
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
              {t('listen.voiceCloning.importWavIntoLatest')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return <SettingsGroup title="Voice Cloning">{content}</SettingsGroup>;
};

const AutoReadbackPanel: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const settings = speech.settings;
  if (!settings) return null;

  const content = (
    <div className={whiteFlatSectionSurfaceClassName}>
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
            {
              value: "after_preview_confirm",
              label: "After preview confirm",
            },
          ]}
        />
      </SettingContainer>

      <div className="border-t border-[var(--border)]">
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
      </div>

      <div className="border-t border-[var(--border)]">
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
      </div>

      <div className="border-t border-[var(--border)]">
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
      </div>
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return <SettingsGroup title="Auto-Readback">{content}</SettingsGroup>;
};

const OutputPanel: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const settings = speech.settings;
  if (!settings) return null;

  const content = (
    <div className={whiteFlatSectionSurfaceClassName}>
      <OutputDeviceSelector
        descriptionMode="tooltip"
        grouped={true}
        disabled={!(settings.tts_enabled || settings.audio_feedback)}
      />
      <div className="border-t border-[var(--border)]">
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
      </div>
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return <SettingsGroup title="Output">{content}</SettingsGroup>;
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
  return <SoundDesignSection speech={speech} showTitle={showGroupTitle} />;
};

export const EngineLibrarySection: React.FC<{
  showGroupTitle?: boolean;
  titleActionTargetId?: string;
}> = ({ showGroupTitle = true, titleActionTargetId }) => {
  const speech = useListenSpeechState();
  return (
    <EngineLibraryPanel
      speech={speech}
      showTitle={showGroupTitle}
      titleActionTargetId={titleActionTargetId}
    />
  );
};

export const SpeechPackManagerSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  const content = <SpeechPackManagerCard speech={speech} />;

  if (!showGroupTitle) {
    return content;
  }

  return <SettingsGroup title="Speech Packs">{content}</SettingsGroup>;
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
