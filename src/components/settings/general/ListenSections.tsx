import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  Check,
  Cloud,
  Dna,
  Globe,
  HardDrive,
  Loader2,
  Mic2,
  Monitor,
  Play,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  commands,
  type TtsAutoReadbackMode,
  type TtsAutoReadbackScope,
  type TtsPackInfo,
  type TtsReadbackTextMode,
  type VoiceInfo,
} from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { Slider } from "@/components/ui/Slider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import Badge from "@/components/ui/Badge";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { SwitchControl } from "@/components/ui/SwitchControl";
import {
  CompactBadgeRow,
  CompactMetaRow,
  type CompactBadgeItem,
} from "@/components/ui/CompactOverflow";
import HubModelCard, {
  type HubTrailing,
} from "@/components/model-hub/HubModelCard";
import { Trans, useTranslation } from "react-i18next";
import {
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import { LANGUAGES } from "@/lib/constants/languages";
import { modal } from "@/motion/springs";
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
const HIDDEN_TTS_PROVIDER_IDS = new Set<string>();

function scoreCatalogModel(model: CatalogModelDescriptor): number {
  return (
    Number(model.active) * 16 +
    Number(model.selected) * 8 +
    Number(model.installed) * 4 +
    Number(model.runnable) * 2 +
    Number(model.source_kind === "runtime")
  );
}

function dedupeCatalogModels(
  models: CatalogModelDescriptor[],
): CatalogModelDescriptor[] {
  const deduped = new Map<string, CatalogModelDescriptor>();

  for (const model of models) {
    const key = `${model.provider_id}::${model.id}`;
    const existing = deduped.get(key);
    if (!existing || scoreCatalogModel(model) > scoreCatalogModel(existing)) {
      deduped.set(key, model);
    }
  }

  return Array.from(deduped.values());
}

function resolveVoiceModelSelection(
  models: CatalogModelDescriptor[],
  providerId: string,
  modelId: string,
): CatalogModelDescriptor | null {
  return (
    models.find(
      (model) => model.provider_id === providerId && model.id === modelId,
    ) ??
    models.find((model) => model.provider_id === providerId) ??
    models[0] ??
    null
  );
}
const MANAGED_SPEECH_RUNTIME_PROVIDER_IDS = new Set([
  "openvoice",
  "chatterbox",
  "kokoro",
  "xtts",
]);

const TTS_MODEL_SIZE_HINTS: Record<string, string> = {
  openvoice: "~1.6 GB",
  chatterbox: "~3.0 GB",
  "kokoro-82m-v1.0": "~350 MB",
  "kokoro-82m": "~350 MB",
  "xtts-v2": "~1.9 GB",
  "lfm2-5-audio-1-5b-q4-0": "~1.0 GB",
  "vibevoice-realtime-0-5b": "~1.1 GB",
  "qwen3-0.6b-base": "~1.2 GB",
  "qwen3-0.6b-customvoice": "~1.2 GB",
  "qwen3-1.7b-customvoice": "~3.4 GB",
  "tts-sherpa-en-us-lessac-medium": "~60 MB",
  "tts-sherpa-zh-cn-melo": "~120 MB",
  "qwen3-tts-0.6b": "~1.2 GB",
  "qwen3-tts-0.6b-4bit": "~450 MB",
  "qwen3-tts-1.7b": "~3.4 GB",
  "qwen3-tts-1.7b-base": "~3.4 GB",
  "dia-1.6b": "~3.2 GB",
  "csm-1b": "~2.0 GB",
  "spark-tts-0.5b": "~1.0 GB",
  "outetts-0.6b": "~1.2 GB",
  "ming-omni-0.5b": "~500 MB",
  "kugel-audio-7b": "~14 GB",
  "bark-small": "~1.5 GB",
  "fish-audio-s2-pro": "~4.0 GB",
  "lfm2-5-audio-1-5b": "~3.0 GB",
  "pocket-tts": "~1.0 GB",
  "pocket-tts-4bit": "~500 MB",
  "pocket-tts-8bit": "~900 MB",
  "voxcpm2-4bit": "~2.5 GB",
  "voxtral-tts-4b": "~8.0 GB",
  "tada-1b": "~2.0 GB",
  "tada-3b-ml": "~6.0 GB",
  "rhasspy/piper-voices": "~1.0 GB",
  "microsoft/speecht5_tts": "~1.1 GB",
  "onnx-community/kokoro-82m-v1.0-onnx": "~350 MB",
  "hexgrad/kokoro-82m": "~350 MB",
  "parler-tts/parler-tts-mini-v1.1": "~2.4 GB",
  "parler-tts/parler-tts-mini-multilingual-v1.1": "~2.4 GB",
  "outeai/outetts-0.3-1b": "~2.0 GB",
  "outeai/outetts-0.3-1b-gguf": "~0.8 GB",
  "swivid/f5-tts": "~3.0 GB",
  "iriedinamik/microsoft_vibevoice-realtime-0.5b": "~1.1 GB",
  "iriedinamik/microsoft-vibevoice-realtime-0.5b": "~1.1 GB",
};

function emptyVoiceInventoryLabel(_providerId: string) {
  return "No preset voices";
}

const DEFAULT_TTS_PREVIEW_TEXT =
  "The morning light fell softly across the old stone bridge. She paused, took a breath, and said — quite simply — that she'd never felt more alive. Was it the crisp air? The silence? Perhaps both. Either way, something had shifted, quietly and for good.";

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

function formatLanguageCoverage(model: CatalogModelDescriptor) {
  const languages = getModelLanguageItems(model);
  if (languages.length === 0) return "";
  if (languages.length === 1) return languages[0];
  return `${languages[0]}+${languages.length - 1}`;
}

function ttsStorageSizeLabel(
  model: CatalogModelDescriptor,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const normalizedId = model.id.toLowerCase();
  const normalizedLabel = model.label.toLowerCase();
  const sizeHint =
    TTS_MODEL_SIZE_HINTS[model.id] ??
    TTS_MODEL_SIZE_HINTS[normalizedId] ??
    TTS_MODEL_SIZE_HINTS[model.label] ??
    TTS_MODEL_SIZE_HINTS[normalizedLabel];

  if (sizeHint) {
    return sizeHint;
  }

  if (!model.downloadable) {
    return model.capabilities.local_only
      ? t("modelSelector.noDownload", { defaultValue: "No download" })
      : t("modelHub.chips.externalStorage", {
          defaultValue: "External storage",
        });
  }

  return t("modelHub.chips.sizeUnknown", { defaultValue: "Size unknown" });
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

function profileSupportsModel(
  profile: TtsVoiceProfileDescriptor,
  model: CatalogModelDescriptor | null | undefined,
) {
  if (!profile || !model) return false;

  const providerCompatible =
    profile.compatible_provider_ids.length === 0 ||
    profile.compatible_provider_ids.includes(model.provider_id);
  const modelCompatible =
    profile.compatible_model_ids.length === 0 ||
    profile.compatible_model_ids.includes(model.id);

  return providerCompatible && modelCompatible;
}

function cloneModelSelectionValue(
  model: CatalogModelDescriptor | null | undefined,
) {
  return model ? `${model.provider_id}::${model.id}` : "__none__";
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

type VoiceArchitectDraftState = {
  presetId: string | null;
  providerId: string;
  modelId: string;
  voiceId: string;
  voiceProfileId: string;
  tuning: TtsVoiceTuningSettings;
};

let cachedVoiceArchitectDraft: VoiceArchitectDraftState | null = null;

function buildVoiceArchitectDraftFromPreset(
  preset: TtsVoicePreset | null | undefined,
): VoiceArchitectDraftState {
  return {
    presetId: preset?.id ?? null,
    providerId: preset?.provider_id ?? "",
    modelId: preset?.model_id ?? "",
    voiceId: preset?.voice_id ?? "__auto__",
    voiceProfileId: preset?.voice_profile_id ?? "__none__",
    tuning: { ...(preset?.tuning ?? defaultVoiceTuning()) },
  };
}

function saveVoiceArchitectDraft(draft: VoiceArchitectDraftState) {
  cachedVoiceArchitectDraft = {
    ...draft,
    tuning: { ...draft.tuning },
  };
}

function formatEngineFamilyLabel(engineFamily: string | null | undefined) {
  if (!engineFamily) return "Unknown engine";

  const normalized = engineFamily.trim().toLowerCase();
  const knownLabels: Record<string, string> = {
    kokoro: "Kokoro",
    chatterbox: "Chatterbox",
    openvoice: "OpenVoice",
    coqui: "Coqui",
    xtts: "XTTS",
    qwen3: "Qwen3",
    system: "System",
    sherpa_onnx: "Sherpa ONNX",
    sidecar: "Speech Runtime",
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

function providerOptionContext(_provider: ProviderDescriptor) {
  return null;
}

function modelOptionContext(_model: CatalogModelDescriptor) {
  return null;
}

function formatSelectableLabel(label: string, detail: string | null) {
  if (!detail) return label;
  return `${label} (${detail})`;
}

function previewPreparationMessage(model: CatalogModelDescriptor) {
  if (model.source_kind === "runtime") {
    return `Getting ${model.label} ready for first preview…`;
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
    return `Preview failed while starting ${model.label}: ${raw}`;
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

  useEffect(() => {
    if (!settings) return;

    const syncOnFocus = () => {
      void refreshAll();
    };
    const syncOnVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshAll();
      }
    };

    window.addEventListener("focus", syncOnFocus);
    document.addEventListener("visibilitychange", syncOnVisibility);

    return () => {
      window.removeEventListener("focus", syncOnFocus);
      document.removeEventListener("visibilitychange", syncOnVisibility);
    };
  }, [settings, refreshAll]);

  const activePresetId =
    settings?.tts_active_preset_id ?? presets[0]?.id ?? null;
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
      dedupeCatalogModels(
        (platformOverview?.tts.models ?? []).filter(
          (model) =>
            !model.capabilities.coming_soon &&
            allProviders.some((provider) => provider.id === model.provider_id),
        ),
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
  const cloneCapableModels = allModels.filter(
    (model) => model.capabilities.supports_voice_cloning,
  );

  const voiceOptions = [
    { value: "__auto__", label: "Automatic voice" },
    ...voices.map((voice) => ({
      value: voice.id,
      label: `${voice.label}${localeLabel(voice.locale)}`,
    })),
  ];
  const activeCloneModel = activeModel?.capabilities.supports_voice_cloning
    ? activeModel
    : null;
  const compatibleProfiles = profiles.filter((profile) =>
    profileSupportsModel(profile, activeCloneModel),
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
    async (
      profile: TtsVoiceProfileDescriptor,
      model: CatalogModelDescriptor | null | undefined,
    ) => {
      if (!model || !profileSupportsModel(profile, model)) {
        setStatusMessage(
          "Choose a clone-capable target model before creating a clone preset.",
        );
        return;
      }
      await createTtsVoicePreset({
        label: profile.label,
        provider_id: model.provider_id,
        model_id: model.id,
        voice_id: null,
        voice_profile_id: profile.id,
        voice_label_snapshot: profile.label,
        locale_snapshot: null,
        tuning: activePreset?.tuning
          ? { ...activePreset.tuning }
          : defaultVoiceTuning(),
      });
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
    cloneCapableModels,
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
  "rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-[var(--shadow-sm)]";
const whiteWorkflowCardClassName =
  "rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]";
const flatSectionSurfaceClassName =
  "overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-sm)]";
const whiteFlatSectionSurfaceClassName =
  "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]";
const workflowFieldLabelClassName =
  "text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]";
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

const InlineCueHint: React.FC<{ modelLabel?: string | null }> = ({
  modelLabel,
}) => {
  const label = modelLabel?.trim();
  const { t } = useTranslation();
  return (
    <p className="flex items-start gap-1.5 text-xs leading-5 text-[var(--muted)]">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--voice)]" />
      <Trans
        i18nKey="listen.inlineCueHint"
        values={{
          subject:
            label ??
            t("listen.inlineCueHintFallbackSubject", {
              defaultValue: "This model",
            }),
        }}
        components={{
          cueLaughs: <span className="font-medium" />,
          cueSighs: <span className="font-medium" />,
          cueWhispers: <span className="font-medium" />,
        }}
        defaults="{{subject}} supports inline cues in the spoken text, such as <cueLaughs>[laughs]</cueLaughs>, <cueSighs>[sighs]</cueSighs>, or <cueWhispers>[whispers]</cueWhispers>. Exact cue behavior varies by model."
      />
    </p>
  );
};

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

const DraftVoiceModelLibraryCard: React.FC<{
  model: CatalogModelDescriptor;
  provider: ProviderDescriptor | null;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}> = ({ model, provider, selected, disabled, onSelect }) => {
  const { t } = useTranslation();
  const isLocal = model.capabilities.local_only || provider?.local_only;
  const languageCoverage = formatLanguageCoverage(model);
  const supportsStyle =
    (model.delivery_support.expressiveness_mode ?? "unsupported") !==
    "unsupported";
  const availabilityLabel = model.installed
    ? t("modelHub.tts.downloaded", { defaultValue: "Downloaded" })
    : model.downloadable
      ? t("listen.createVoices.downloadRequired", {
          defaultValue: "Download needed",
        })
      : t("listen.createVoices.available", { defaultValue: "Available" });

  const headerBadges: CompactBadgeItem[] = [
    selected
      ? {
          id: "draft",
          label: t("listen.createVoices.draft", { defaultValue: "Draft" }),
          variant: "primary",
          icon: <Check className="h-3.5 w-3.5" />,
          detail: t("listen.createVoices.draftModelDetail", {
            defaultValue:
              "Selected for the Create Voices draft only. The active app voice is unchanged.",
          }),
        }
      : null,
    {
      id: model.installed ? "downloaded" : "availability",
      label: availabilityLabel,
      variant: "secondary",
      detail: model.installed
        ? t("modelHub.tts.downloadedDetail", {
            defaultValue: "Voice pack is installed locally.",
          })
        : t("listen.createVoices.downloadRequiredDetail", {
            defaultValue:
              "Preview can download this model before generating audio.",
          }),
    },
  ].filter(Boolean) as CompactBadgeItem[];

  const sublineParts = [
    provider?.label,
    sourceKindLabel(model.source_kind),
  ].filter((part): part is string => Boolean(part));
  const capabilityChips: CompactBadgeItem[] = [
    {
      id: "capability-deployment",
      label: isLocal
        ? t("modelHub.chips.local", { defaultValue: "Local" })
        : t("modelHub.chips.cloud", { defaultValue: "Cloud" }),
      variant: "secondary",
      icon: isLocal ? (
        <Monitor className="h-3 w-3" />
      ) : (
        <Cloud className="h-3 w-3" />
      ),
      detail: isLocal
        ? t("modelHub.chips.localDetail", {
            defaultValue: "Runs on this Mac or through a local runtime.",
          })
        : t("modelHub.chips.cloudDetail", {
            defaultValue: "Uses a configured network provider.",
          }),
    },
    {
      id: "capability-size",
      label: ttsStorageSizeLabel(model, t),
      variant: "secondary",
      icon: <HardDrive className="h-3 w-3" />,
      detail: t("modelHub.chips.storageSizeDetail", {
        defaultValue: "Approximate model storage footprint.",
      }),
    },
    languageCoverage
      ? {
          id: "capability-languages",
          label: languageCoverage,
          variant: "secondary",
          icon: <Globe className="h-3 w-3" />,
          detail: getModelLanguageItems(model).join(" · "),
        }
      : null,
    model.capabilities.supports_voice_cloning
      ? {
          id: "capability-cloning",
          label: t("modelHub.chips.cloning", { defaultValue: "Cloning" }),
          variant: "secondary",
          icon: <Dna className="h-3 w-3" />,
          detail: t("modelHub.chips.cloningDetail", {
            defaultValue:
              "Supports voice cloning or profile-conditioned speech.",
          }),
        }
      : null,
    supportsStyle
      ? {
          id: "capability-style",
          label: t("modelHub.chips.style", { defaultValue: "Style" }),
          variant: "secondary",
          icon: <SlidersHorizontal className="h-3 w-3" />,
          detail: t("modelHub.chips.styleDetail", {
            defaultValue: "Supports expressive style or delivery controls.",
          }),
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];

  return (
    <HubModelCard
      title={model.label}
      providerId={resolveModelProviderId(
        `${model.label} ${model.id}`,
        model.provider_id,
      )}
      subline={sublineParts.join(" · ") || undefined}
      headerBadges={headerBadges}
      description={model.description}
      capabilityChips={capabilityChips}
      footerMetaItems={[provider?.runtime.label ?? model.runtime.label]}
      footerMetaMaxVisible={4}
      footerMetaIcon={<Globe className="h-3.5 w-3.5" />}
      footerOverflowLabel={t("listen.createVoices.modelDetails", {
        modelName: model.label,
        defaultValue: "{{modelName}} details",
      })}
      trailing={
        selected
          ? {
              kind: "custom",
              node: (
                <Badge
                  variant="primary"
                  className="gap-1 text-[var(--inverse-text)]"
                >
                  <Check className="h-3 w-3" aria-hidden />
                  {t("listen.createVoices.draft", { defaultValue: "Draft" })}
                </Badge>
              ),
            }
          : null
      }
      onClick={onSelect}
      disabled={disabled}
      active={selected}
    />
  );
};

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
              "Higher values keep delivery more consistent with your chosen style.",
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
              "Only available for voice models that support a stability control.",
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
          <p className={workflowFieldLabelClassName}>
            {t("listen.tuning.styleInstructions")}
          </p>
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
            placeholder={t("listen.placeholders.styleInstructions")}
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
  const initialDraft = useMemo(() => {
    if (
      cachedVoiceArchitectDraft &&
      cachedVoiceArchitectDraft.presetId === (speech.activePreset?.id ?? null)
    ) {
      return cachedVoiceArchitectDraft;
    }
    return buildVoiceArchitectDraftFromPreset(speech.activePreset);
  }, [speech.activePreset]);
  const [saveProfileNameDraft, setSaveProfileNameDraft] = useState("");
  const [draftProviderId, setDraftProviderId] = useState(
    initialDraft.providerId,
  );
  const [draftModelId, setDraftModelId] = useState(initialDraft.modelId);
  const [draftVoiceId, setDraftVoiceId] = useState(initialDraft.voiceId);
  const [draftVoiceProfileId, setDraftVoiceProfileId] = useState(
    initialDraft.voiceProfileId,
  );
  const [draftVoices, setDraftVoices] = useState<VoiceInfo[]>([]);
  const [loadingDraftVoices, setLoadingDraftVoices] = useState(false);
  const [draftVoiceErrorMessage, setDraftVoiceErrorMessage] = useState<
    string | null
  >(null);
  const [draftTuning, setDraftTuning] = useState(initialDraft.tuning);
  const [previewTextDraft, setPreviewTextDraft] = useState(
    DEFAULT_TTS_PREVIEW_TEXT,
  );
  const [modelWindowOpen, setModelWindowOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [tuningWindowOpen, setTuningWindowOpen] = useState(false);
  const [createVoiceTool, setCreateVoiceTool] = useState<"models" | "tuning">(
    "models",
  );
  const lastDraftSelectionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setSaveProfileNameDraft("");
  }, [speech.activePreset?.id]);

  useEffect(() => {
    if (!speech.activePreset) return;

    const nextDraft =
      cachedVoiceArchitectDraft?.presetId === speech.activePreset.id
        ? cachedVoiceArchitectDraft
        : buildVoiceArchitectDraftFromPreset(speech.activePreset);

    setDraftProviderId(nextDraft.providerId);
    setDraftModelId(nextDraft.modelId);
    setDraftVoiceId(nextDraft.voiceId);
    setDraftVoiceProfileId(nextDraft.voiceProfileId);
    lastDraftSelectionKeyRef.current = null;
    setDraftTuning({ ...nextDraft.tuning });
    saveVoiceArchitectDraft(nextDraft);
  }, [speech.activePreset?.id]);

  useEffect(() => {
    if (!speech.activePreset) return;

    saveVoiceArchitectDraft({
      presetId: speech.activePreset.id,
      providerId: draftProviderId,
      modelId: draftModelId,
      voiceId: draftVoiceId,
      voiceProfileId: draftVoiceProfileId,
      tuning: draftTuning,
    });
  }, [
    draftModelId,
    draftProviderId,
    draftTuning,
    draftVoiceId,
    draftVoiceProfileId,
    speech.activePreset?.id,
  ]);

  useEffect(() => {
    if (!speech.settings || !speech.activePreset) return;

    const selectedModel = resolveVoiceModelSelection(
      speech.visibleModels,
      draftProviderId,
      draftModelId,
    );
    const providerIdForControls = selectedModel?.provider_id ?? "";
    const modelIdForControls = selectedModel?.id ?? "";
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
    speech.settings,
    speech.visibleModels,
  ]);

  useEffect(() => {
    if (!speech.settings || !speech.activePreset) return;

    const selectedModel = resolveVoiceModelSelection(
      speech.visibleModels,
      draftProviderId,
      draftModelId,
    );
    const providerIdForControls = selectedModel?.provider_id ?? "";
    const modelIdForControls = selectedModel?.id ?? "";
    const matchesActiveModel =
      providerIdForControls === speech.activePreset.provider_id &&
      modelIdForControls === speech.activePreset.model_id;

    if (!providerIdForControls || !modelIdForControls) {
      setDraftVoices([]);
      setLoadingDraftVoices(false);
      setDraftVoiceErrorMessage(null);
      return;
    }

    if (isVoiceFixedToModel(providerIdForControls)) {
      setDraftVoices([]);
      setLoadingDraftVoices(false);
      setDraftVoiceErrorMessage(null);
      return;
    }

    if (matchesActiveModel) {
      setDraftVoices(speech.voices);
      setLoadingDraftVoices(speech.loadingVoices);
      setDraftVoiceErrorMessage(null);
      return;
    }

    let cancelled = false;
    setLoadingDraftVoices(true);
    setDraftVoiceErrorMessage(null);

    void getTtsVoicesForSelection(providerIdForControls, modelIdForControls)
      .then((voices) => {
        if (cancelled) return;
        setDraftVoices(voices);
        setDraftVoiceErrorMessage(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setDraftVoices([]);
        setDraftVoiceErrorMessage(
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
    speech.settings,
    speech.setStatusMessage,
    speech.visibleModels,
    speech.voices,
  ]);

  const activeModelLabel =
    speech.activeModel?.label ?? speech.activePreset?.model_id ?? "";
  const saveProfileName = saveProfileNameDraft.trim();
  const statusMessage = draftVoiceErrorMessage ?? speech.statusMessage;
  const draftSelectedModelForControls = resolveVoiceModelSelection(
    speech.visibleModels,
    draftProviderId,
    draftModelId,
  );
  const draftProviderIdForControls =
    draftSelectedModelForControls?.provider_id ??
    speech.providerOptions[0]?.value ??
    "";
  const supportsDraftManualVoiceId =
    draftProviderIdForControls === "local_sidecar_api";
  const draftModelIdForControls =
    draftSelectedModelForControls?.id ?? speech.visibleModels[0]?.id ?? "";
  const draftSelectedModel =
    speech.allModels.find(
      (model) =>
        model.provider_id === draftProviderIdForControls &&
        model.id === draftModelIdForControls,
    ) ?? null;
  const draftSupportsVoiceCloning =
    draftSelectedModel?.capabilities.supports_voice_cloning ?? false;
  const draftSupportsInlineTags =
    draftSelectedModel?.capabilities.supports_inline_tags ?? false;
  const draftCompatibleProfiles = draftSelectedModel
    ? speech.profiles.filter((profile) =>
        profileSupportsModel(profile, draftSelectedModel),
      )
    : [];
  const draftProfileOptions = [
    { value: "__none__", label: "No clone profile" },
    ...draftCompatibleProfiles.map((profile) => ({
      value: profile.id,
      label: !profile.ready ? `${profile.label} (Needs audio)` : profile.label,
    })),
  ];
  const controls =
    draftSelectedModel?.delivery_support.advanced_controls ??
    speech.activeModel?.delivery_support.advanced_controls ??
    [];
  const supportsExpressiveness =
    (draftSelectedModel?.delivery_support.expressiveness_mode ??
      speech.activeModel?.delivery_support.expressiveness_mode ??
      "unsupported") !== "unsupported";
  const draftMatchesActiveModel =
    draftProviderIdForControls === (speech.activePreset?.provider_id ?? "") &&
    draftModelIdForControls === (speech.activePreset?.model_id ?? "");
  const draftVoiceInventory = draftMatchesActiveModel
    ? speech.voices
    : draftVoices;
  const draftSelectedVoice =
    draftVoiceInventory.find((voice) => voice.id === draftVoiceId) ?? null;
  const draftSelectedProfile =
    draftCompatibleProfiles.find(
      (profile) => profile.id === draftVoiceProfileId,
    ) ?? null;
  useEffect(() => {
    if (!draftSupportsVoiceCloning) {
      if (draftVoiceProfileId !== "__none__") {
        setDraftVoiceProfileId("__none__");
      }
      return;
    }

    if (draftSelectedProfile) {
      return;
    }

    if (
      draftMatchesActiveModel &&
      speech.activePreset?.voice_profile_id &&
      draftCompatibleProfiles.some(
        (profile) => profile.id === speech.activePreset?.voice_profile_id,
      )
    ) {
      setDraftVoiceProfileId(speech.activePreset.voice_profile_id);
      return;
    }

    if (draftVoiceProfileId !== "__none__") {
      setDraftVoiceProfileId("__none__");
    }
  }, [
    draftCompatibleProfiles,
    draftMatchesActiveModel,
    draftSelectedProfile,
    draftSupportsVoiceCloning,
    draftVoiceProfileId,
    speech.activePreset?.voice_profile_id,
  ]);
  if (!speech.settings || !speech.activePreset) return null;

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
            : emptyVoiceInventoryLabel(draftProviderIdForControls);
  const draftVoiceOptions = [
    {
      value: "__auto__",
      label:
        draftVoiceInventory.length > 0
          ? "Automatic voice"
          : emptyVoiceInventoryLabel(draftProviderIdForControls),
      disabled: draftVoiceInventory.length === 0,
    },
    ...draftVoiceInventory.map((voice) => ({
      value: voice.id,
      label: `${voice.label}${localeLabel(voice.locale)}`,
    })),
  ];
  const draftModelLabel = draftSelectedModel?.label ?? activeModelLabel;
  const normalizedModelSearch = modelSearchQuery.trim().toLowerCase();
  const filteredDraftModels = speech.visibleModels.filter((model) => {
    if (!normalizedModelSearch) return true;

    const providerLabel =
      speech.visibleProviders.find(
        (provider) => provider.id === model.provider_id,
      )?.label ?? "";
    const haystack = [
      model.label,
      model.id,
      model.description,
      model.source_label,
      providerLabel,
      model.locale ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedModelSearch);
  });
  const orderedDraftModels = [...filteredDraftModels].sort((first, second) => {
    const firstIsDraft =
      first.provider_id === draftProviderIdForControls &&
      first.id === draftModelIdForControls;
    const secondIsDraft =
      second.provider_id === draftProviderIdForControls &&
      second.id === draftModelIdForControls;

    if (firstIsDraft !== secondIsDraft) {
      return firstIsDraft ? -1 : 1;
    }

    if (first.installed !== second.installed) {
      return first.installed ? -1 : 1;
    }

    return 0;
  });
  const buildDraftPresetInput = (): TtsVoicePresetInput => {
    const source = buildPresetInput(speech.activePreset);
    const providerOrModelChanged =
      source.provider_id !== draftProviderIdForControls ||
      source.model_id !== draftModelIdForControls;
    const voiceIsFixedToModel = isVoiceFixedToModel(draftProviderIdForControls);
    const draftVoiceSelectionId =
      voiceIsFixedToModel || draftVoiceId === "__auto__" ? null : draftVoiceId;
    const draftVoiceSelection =
      draftVoiceInventory.find((voice) => voice.id === draftVoiceSelectionId) ??
      null;
    const draftProfileSelectionId =
      draftSupportsVoiceCloning && draftVoiceProfileId !== "__none__"
        ? draftVoiceProfileId
        : null;

    return {
      ...source,
      provider_id: draftProviderIdForControls,
      model_id: draftModelIdForControls,
      tuning: { ...draftTuning },
      voice_id: voiceIsFixedToModel
        ? draftModelIdForControls
        : (draftVoiceSelectionId ?? null),
      voice_profile_id: draftProfileSelectionId,
      voice_label_snapshot: voiceIsFixedToModel
        ? (draftSelectedModel?.label ?? draftModelIdForControls)
        : (draftSelectedProfile?.label ?? draftVoiceSelection?.label ?? null),
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

  const handleSelectDraftModel = (model: CatalogModelDescriptor) => {
    lastDraftSelectionKeyRef.current = null;
    setDraftVoiceErrorMessage(null);
    setDraftProviderId(model.provider_id);
    setDraftModelId(model.id);
    setCreateVoiceTool("models");
    setModelWindowOpen(false);
    speech.setStatusMessage(null);
  };

  const handleCreateVoiceToolChange = (value: "models" | "tuning") => {
    setCreateVoiceTool(value);
    if (value === "models") {
      setModelWindowOpen(true);
      return;
    }
    setTuningWindowOpen(true);
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
            aria-labelledby="create-voice-model-title"
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
                    id="create-voice-model-title"
                    className="truncate text-sm font-semibold text-[var(--text)]"
                  >
                    {t("listen.createVoices.models", {
                      defaultValue: "Models",
                    })}
                  </h3>
                  <Badge variant="secondary">
                    {t("listen.createVoices.ttsOnly", {
                      defaultValue: "TTS only",
                    })}
                  </Badge>
                </div>
                <p className="truncate text-xs text-[var(--muted)]">
                  {t("listen.createVoices.draftModelPickerDetail", {
                    defaultValue:
                      "Choose a voice model for this draft without changing the active app voice.",
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
                aria-label={t("listen.createVoices.searchModelsAriaLabel", {
                  defaultValue: "Search voice models",
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
                  placeholder={t("listen.createVoices.searchModels", {
                    defaultValue: "Search TTS models",
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
              {filteredDraftModels.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {orderedDraftModels.map((model) => (
                    <DraftVoiceModelLibraryCard
                      key={`${model.provider_id}::${model.id}`}
                      model={model}
                      provider={
                        speech.visibleProviders.find(
                          (provider) => provider.id === model.provider_id,
                        ) ?? null
                      }
                      selected={
                        model.provider_id === draftProviderIdForControls &&
                        model.id === draftModelIdForControls
                      }
                      disabled={!speech.ttsEnabled}
                      onSelect={() => handleSelectDraftModel(model)}
                    />
                  ))}
                </div>
              ) : (
                <div className={speechLibraryCardClassName}>
                  <p className="text-sm leading-6 text-[var(--muted)]">
                    {modelSearchQuery
                      ? t("listen.createVoices.noModelSearchResults", {
                          defaultValue: "No TTS models match that search.",
                        })
                      : t("listen.createVoices.noModels", {
                          defaultValue: "No TTS models are available.",
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

  const tuningWindow = createPortal(
    <AnimatePresence>
      {tuningWindowOpen ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setTuningWindowOpen(false)}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("listen.createVoices.tuning", {
              defaultValue: "Tuning",
            })}
            className="relative max-h-[min(88vh,860px)] w-full max-w-[760px] overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="absolute right-3 top-3 z-10">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setTuningWindowOpen(false)}
                aria-label={t("common.close", { defaultValue: "Close" })}
                title={t("common.close", { defaultValue: "Close" })}
              >
                <X aria-hidden />
              </Button>
            </div>
            <div className="max-h-[min(88vh,860px)] overflow-y-auto p-4 pt-12">
              <VoiceTuningCard
                preset={buildDraftPresetInput()}
                onUpdatePreset={updateDraftPreset}
                ttsEnabled={speech.ttsEnabled}
                controls={controls}
                supportsExpressiveness={supportsExpressiveness}
                title="Tuning"
                embedded
                surfaceClassName="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]"
              />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );

  const isPreviewingDraft = speech.previewingPresetId === "__draft__";
  const contentSpacingClassName = showTitle
    ? "space-y-3 px-4 py-3"
    : "space-y-3";
  const content = (
    <>
      {modelWindow}
      {tuningWindow}
      <div
        className={`${contentSpacingClassName} ${
          !speech.ttsEnabled ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="primary-soft"
              size="sm"
              onClick={() => {
                if (isPreviewingDraft) {
                  void commands.ttsStop();
                  return;
                }

                void speech.previewPresetDraft(
                  buildDraftPresetInput(),
                  previewTextDraft,
                );
              }}
              disabled={!speech.ttsEnabled}
            >
              {isPreviewingDraft ? (
                <Loader2 className="h-3.5 w-3.5 animate-[spin_1s_linear_infinite]" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {isPreviewingDraft
                ? t("common.cancel", { defaultValue: "Cancel" })
                : t("listen.myVoices.preview")}
            </Button>

            <SegmentedControl<"models" | "tuning">
              value={createVoiceTool}
              onChange={handleCreateVoiceToolChange}
              layoutId="create-voice-tool-toggle"
              ariaLabel={t("listen.createVoices.toolAriaLabel", {
                defaultValue: "Create voice tools",
              })}
              items={[
                {
                  value: "models",
                  label: t("listen.createVoices.models", {
                    defaultValue: "Models",
                  }),
                },
                {
                  value: "tuning",
                  label: t("listen.createVoices.tuning", {
                    defaultValue: "Tuning",
                  }),
                },
              ]}
            />
          </div>

          <div className="ms-auto flex min-w-[min(100%,22rem)] flex-1 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
            <Input
              value={saveProfileNameDraft}
              onChange={(event) => setSaveProfileNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSaveCurrent();
                }
              }}
              disabled={!speech.ttsEnabled}
              aria-label={t("listen.myVoices.saveAs")}
              placeholder={t("listen.placeholders.savedVoiceName")}
              className="h-11 min-w-[min(100%,16rem)] flex-1 max-w-none"
            />
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
              className="h-11 shrink-0"
            >
              {t("listen.myVoices.saveCurrent")}
            </Button>
          </div>
        </div>

        <div className={whiteWorkflowCardClassName}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-3">
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
                        draftVoiceInventory.find(
                          (voice) => voice.id === value,
                        ) ?? null;
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

              {draftSupportsVoiceCloning ? (
                <WorkflowField label="Clone Profile">
                  <SelectField
                    value={draftVoiceProfileId}
                    onChange={(value) => {
                      setDraftVoiceProfileId(value);
                      if (!draftMatchesActiveModel) {
                        return;
                      }
                      const profile =
                        draftCompatibleProfiles.find(
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
                    options={draftProfileOptions}
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
                    placeholder={t("listen.placeholders.manualVoiceId")}
                    disabled={!speech.ttsEnabled}
                    className="w-full max-w-none"
                  />
                </WorkflowField>
              ) : null}
            </div>
            {statusMessage ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
                {statusMessage}
              </div>
            ) : null}
          </div>
        </div>

        {/* Preview card — full width at top for a larger textarea */}
        <div className={whiteWorkflowCardClassName}>
          <div className="min-w-0 space-y-2">
            <p className={workflowFieldLabelClassName}>
              {t("listen.myVoices.previewText")}
            </p>
            <Textarea
              value={previewTextDraft}
              onChange={(event) => setPreviewTextDraft(event.target.value)}
              placeholder={DEFAULT_TTS_PREVIEW_TEXT}
              disabled={!speech.ttsEnabled}
              className="w-full min-h-[120px] !rounded-2xl"
            />
            {draftSupportsInlineTags ? (
              <InlineCueHint modelLabel={draftSelectedModel?.label} />
            ) : null}
          </div>
        </div>
      </div>
    </>
  );

  if (!showTitle) {
    return content;
  }

  return <SettingsGroup title="Create Voices">{content}</SettingsGroup>;
};

const SavedVoiceProfilesSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();

  if (!speech.settings || !speech.activePreset) return null;

  const content = (
    <div
      className={`space-y-3 px-4 py-3 ${
        !speech.ttsEnabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      {speech.statusMessage ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
          {speech.statusMessage}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-semibold text-[var(--text)]">
          {t("listen.myVoices.savedProfiles")}
        </p>

        <div className="grid max-h-[520px] gap-2 overflow-y-auto pe-1 lg:grid-cols-2">
          {speech.presets.map((preset) => {
            const isActive = preset.id === speech.activePreset?.id;
            const presetVoiceLabel =
              preset.voice_label_snapshot ?? preset.voice_id ?? "Automatic";

            return (
              <div
                key={preset.id}
                className={
                  isActive
                    ? "rounded-xl border border-[var(--accent)] bg-[var(--card)] px-3 py-2.5 shadow-[var(--shadow-md)]"
                    : "rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 shadow-[var(--shadow-sm)] transition-all duration-200 hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-md"
                }
              >
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold leading-none text-[var(--text)]">
                        {preset.label}
                      </p>
                      {isActive ? (
                        <Badge
                          variant="primary"
                          className="gap-1 text-[var(--inverse-text)] shadow-[var(--shadow-sm)]"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t("listen.myVoices.active")}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                      <Badge variant="secondary">{preset.model_id}</Badge>
                      <Badge variant="secondary">{presetVoiceLabel}</Badge>
                      {preset.voice_profile_id ? (
                        <Badge variant="secondary">
                          {t("listen.myVoices.clone")}
                        </Badge>
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
                        {t("listen.myVoices.useThisVoice")}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void speech.previewPreset(
                          preset.id,
                          DEFAULT_TTS_PREVIEW_TEXT,
                        )
                      }
                      disabled={speech.previewingPresetId === preset.id}
                      className="inline-flex items-center gap-1.5"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {t("listen.myVoices.preview")}
                    </Button>
                    <Button
                      type="button"
                      variant="danger-ghost"
                      size="icon-sm"
                      onClick={() => void speech.removePreset(preset.id)}
                      disabled={
                        !speech.ttsEnabled || speech.presets.length <= 1
                      }
                      title={`Delete ${preset.label}`}
                      aria-label={`Delete ${preset.label}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
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
  const activeSupportsInlineTags =
    speech.activeModel?.capabilities.supports_inline_tags ?? false;

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
                {t("listen.soundTuning.tuneTitle")}
              </h3>
              <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
                {t("listen.soundTuning.activeProfileIs")}{" "}
                <span className="font-semibold text-[var(--text)]">
                  {speech.activePreset.label}
                </span>
                {t("listen.soundTuning.previewFromHere")}
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
                {t("listen.soundTuning.preview")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void commands.ttsStop()}
                className="inline-flex items-center gap-1.5"
              >
                <Square className="h-3.5 w-3.5" />
                {t("listen.soundTuning.stop")}
              </Button>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <p className={workflowFieldLabelClassName}>
              {t("listen.myVoices.previewText")}
            </p>
            <Textarea
              value={previewTextDraft}
              onChange={(event) => setPreviewTextDraft(event.target.value)}
              placeholder={DEFAULT_TTS_PREVIEW_TEXT}
              disabled={!speech.ttsEnabled}
              className="min-h-[110px] resize-y !rounded-2xl"
            />
            {activeSupportsInlineTags ? (
              <InlineCueHint modelLabel={speech.activeModel?.label} />
            ) : null}
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

function ttsHubModelCanRemove(model: CatalogModelDescriptor): boolean {
  if (!model.installed) return false;
  if (model.provider_id === "system_builtin") return false;
  return true;
}

const SpeechModelLibraryCard: React.FC<{
  model: CatalogModelDescriptor;
  provider: ProviderDescriptor | null;
  active: boolean;
  selected: boolean;
  speech: ListenSpeechState;
}> = ({ model, provider, active, selected, speech }) => {
  const { t } = useTranslation();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Top-right reserved for status only. Provider/source/runtime move to subline
  // and footer so the identity row reads cleanly.
  const headerBadges: CompactBadgeItem[] = [
    active
      ? {
          id: "active",
          label: "Active",
          variant: "primary",
          icon: <Check className="h-3.5 w-3.5" />,
          detail: "Currently the active TTS voice.",
        }
      : null,
    !active && selected
      ? {
          id: "selected",
          label: "Selected",
          variant: "primary",
          detail: "Chosen in settings — click card to activate.",
        }
      : null,
    model.installed && !active && !selected
      ? {
          id: "downloaded",
          label: "Downloaded",
          variant: "secondary",
          detail: "Voice pack is installed locally.",
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];

  const sublineParts = [
    provider?.label,
    sourceKindLabel(model.source_kind),
  ].filter((part): part is string => Boolean(part));
  const subline = sublineParts.join(" · ");
  const isLocal = model.capabilities.local_only || provider?.local_only;
  const languageCoverage = formatLanguageCoverage(model);
  const supportsStyle =
    (model.delivery_support.expressiveness_mode ?? "unsupported") !==
    "unsupported";
  const capabilityChips: CompactBadgeItem[] = [
    {
      id: "capability-deployment",
      label: isLocal
        ? t("modelHub.chips.local", { defaultValue: "Local" })
        : t("modelHub.chips.cloud", { defaultValue: "Cloud" }),
      variant: "secondary",
      icon: isLocal ? (
        <Monitor className="h-3 w-3" />
      ) : (
        <Cloud className="h-3 w-3" />
      ),
      detail: isLocal
        ? t("modelHub.chips.localDetail", {
            defaultValue: "Runs on this Mac or through a local runtime.",
          })
        : t("modelHub.chips.cloudDetail", {
            defaultValue: "Uses a configured network provider.",
          }),
    },
    {
      id: "capability-size",
      label: ttsStorageSizeLabel(model, t),
      variant: "secondary" as const,
      icon: <HardDrive className="h-3 w-3" />,
      detail: t("modelHub.chips.storageSizeDetail", {
        defaultValue: "Approximate model storage footprint.",
      }),
    },
    languageCoverage
      ? {
          id: "capability-languages",
          label: languageCoverage,
          variant: "secondary" as const,
          icon: <Globe className="h-3 w-3" />,
          detail: getModelLanguageItems(model).join(" · "),
        }
      : null,
    model.capabilities.supports_voice_cloning
      ? {
          id: "capability-cloning",
          label: t("modelHub.chips.cloning", { defaultValue: "Cloning" }),
          variant: "secondary" as const,
          icon: <Dna className="h-3 w-3" />,
          detail: t("modelHub.chips.cloningDetail", {
            defaultValue:
              "Supports voice cloning or profile-conditioned speech.",
          }),
        }
      : null,
    supportsStyle
      ? {
          id: "capability-style",
          label: t("modelHub.chips.style", { defaultValue: "Style" }),
          variant: "secondary" as const,
          icon: <SlidersHorizontal className="h-3 w-3" />,
          detail: t("modelHub.chips.styleDetail", {
            defaultValue: "Supports expressive style or delivery controls.",
          }),
        }
      : null,
    model.capabilities.supports_instruction_prompt
      ? {
          id: "capability-instructions",
          label: t("modelHub.chips.instructions", {
            defaultValue: "Instructions",
          }),
          variant: "secondary" as const,
          icon: <Mic2 className="h-3 w-3" />,
          detail: t("modelHub.chips.instructionsDetail", {
            defaultValue: "Can follow text style instructions for generation.",
          }),
        }
      : null,
    model.capabilities.supports_inline_tags
      ? {
          id: "capability-inline-cues",
          label: t("modelHub.chips.inlineCues", {
            defaultValue: "Inline cues",
          }),
          variant: "secondary" as const,
          icon: <Sparkles className="h-3 w-3" />,
          detail: t("modelHub.chips.inlineCuesDetail", {
            defaultValue:
              "Supports spoken-text cues such as laughs or whispers.",
          }),
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];

  const detailItems = [provider?.runtime.label ?? model.runtime.label];

  const clickable =
    !active &&
    speech.ttsEnabled &&
    !speech.loadingPlatform &&
    !confirmingRemove;

  let trailing: HubTrailing = null;
  if (!active && model.downloadable && !model.installed) {
    trailing = {
      kind: "acquire",
      onClick: () => void speech.activateModel(model.provider_id, model.id),
      disabled: !speech.ttsEnabled || speech.loadingPlatform,
      label: `Download ${model.label}`,
    };
  } else if (!active && ttsHubModelCanRemove(model) && !confirmingRemove) {
    trailing = {
      kind: "remove",
      onClick: () => setConfirmingRemove(true),
      disabled: !speech.ttsEnabled || speech.loadingPlatform || removing,
      busy: removing,
      label: t("modelHub.tts.remove", {
        modelName: model.label,
        defaultValue: "Remove {{modelName}}",
      }),
    };
  }

  const footerExtra =
    confirmingRemove && ttsHubModelCanRemove(model) ? (
      <div
        className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-start gap-2 text-sm text-[var(--text)]">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
            aria-hidden
          />
          <p className="min-w-0 flex-1 leading-snug">
            {t("modelHub.tts.confirmRemove", {
              modelName: model.label,
              defaultValue:
                "Remove {{modelName}}? Downloaded voice files will be deleted from this Mac.",
            })}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingRemove(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={removing || !speech.ttsEnabled || speech.loadingPlatform}
            onClick={() => {
              void (async () => {
                setRemoving(true);
                try {
                  const result = await commands.removeTtsPack(model.id);
                  if (result.status !== "ok") {
                    speech.setStatusMessage(result.error);
                    return;
                  }
                  setConfirmingRemove(false);
                  await speech.refreshAll();
                } finally {
                  setRemoving(false);
                }
              })();
            }}
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              t("modelSelector.confirmDelete")
            )}
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <HubModelCard
      title={model.label}
      providerId={resolveModelProviderId(
        `${model.label} ${model.id}`,
        model.provider_id,
      )}
      subline={subline || undefined}
      headerBadges={headerBadges}
      description={model.description}
      capabilityChips={capabilityChips}
      footerMetaItems={detailItems}
      footerMetaMaxVisible={4}
      footerMetaIcon={<Globe className="h-3.5 w-3.5" />}
      footerOverflowLabel={`${model.label} details`}
      trailing={trailing}
      footerExtra={footerExtra}
      onClick={
        clickable
          ? () => void speech.activateModel(model.provider_id, model.id)
          : undefined
      }
      disabled={!speech.ttsEnabled || speech.loadingPlatform}
      active={active}
    />
  );
};

const SpeechModelList: React.FC<{
  title: string;
  count: number;
  models: CatalogModelDescriptor[];
  speech: ListenSpeechState;
  emptyMessage: string;
  /** When false, omits the section title and count badge (e.g. downloaded list in model hub). */
  showHeader?: boolean;
}> = ({ title, count, models, speech, emptyMessage, showHeader = true }) => (
  <div className="space-y-3">
    {showHeader ? (
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--text)]">
          {title}
        </h3>
        <Badge
          variant="secondary"
          className="min-w-7 justify-center border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 font-semibold"
        >
          {count}
        </Badge>
      </div>
    ) : null}
    {models.length > 0 ? (
      <div className="flex flex-col gap-3">
        {models.map((model) => (
          <SpeechModelLibraryCard
            key={`${model.provider_id}::${model.id}`}
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
            {t("listen.packManager.title")}
          </h3>
          <p className="text-sm text-[var(--muted)]">
            {t("listen.packManager.description")}
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
                    {t("listen.packManager.remove")}
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
                    {t("listen.packManager.download")}
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
  /** When false, hides the "Active listen model" summary card (e.g. model hub). */
  showActiveModelBanner?: boolean;
  /** Optional text filter from model hub search (applied with provider/language filters). */
  hubSearchQuery?: string;
  /** When true, idle filter labels use "Provider" / "Language" (model hub toolbar). */
  hubFilterLabels?: boolean;
}> = ({
  speech,
  showTitle = true,
  titleActionTargetId,
  showActiveModelBanner = true,
  hubSearchQuery = "",
  hubFilterLabels = false,
}) => {
  const { t } = useTranslation();
  const [providerFilter, setProviderFilter] = useState("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const portalTarget = usePortalTarget(titleActionTargetId);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageSearchInputRef = useRef<HTMLInputElement>(null);
  const providerOptions = useMemo(
    () => [
      {
        value: "all",
        label: hubFilterLabels ? "Provider" : "All providers",
      },
      ...speech.visibleProviders.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ],
    [hubFilterLabels, speech.visibleProviders],
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
      return hubFilterLabels ? "Language" : "All Languages";
    }
    return LANGUAGES.find((lang) => lang.value === languageFilter)?.label ?? "";
  }, [hubFilterLabels, languageFilter]);
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

        const q = hubSearchQuery.trim().toLowerCase();
        if (q) {
          const providerLabel =
            speech.visibleProviders.find((p) => p.id === model.provider_id)
              ?.label ?? "";
          const haystack = [
            model.label,
            model.id,
            model.description,
            model.source_label,
            providerLabel,
            model.locale ?? "",
          ]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }

        return true;
      }),
    [
      hubSearchQuery,
      languageFilter,
      providerFilter,
      speech.visibleModels,
      speech.visibleProviders,
    ],
  );
  const downloadedModels = useMemo(() => {
    const list = filteredModels.filter((model) => model.installed);
    const ap = speech.activePreset;
    if (!ap) return list;
    const idx = list.findIndex(
      (m) => m.provider_id === ap.provider_id && m.id === ap.model_id,
    );
    if (idx <= 0) return list;
    const next = [...list];
    const [activeRow] = next.splice(idx, 1);
    return [activeRow, ...next];
  }, [filteredModels, speech.activePreset]);
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

  if (!speech.settings) return null;

  const filterAction = (
    <div className="flex items-center gap-2">
      <div className="relative inline-flex w-36">
        <select
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          className="min-h-9 w-full appearance-none rounded-full border border-[var(--border)] bg-[var(--card)] py-1.5 pe-9 ps-3 text-xs font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
        >
          {providerOptions.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {provider.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
      </div>
      <div className="relative" ref={languageDropdownRef}>
        <button
          type="button"
          onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
          className={`flex min-h-9 w-36 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
            hasActiveLanguageFilter
              ? "rounded-full bg-logo-primary text-[var(--inverse-text)]"
              : "rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--card),var(--panel-bg)_12%)]"
          }`}
          aria-haspopup="listbox"
          aria-expanded={languageDropdownOpen}
        >
          <Globe className="h-3 w-3" />
          <span className="min-w-0 flex-1 truncate text-left">
            {selectedLanguageLabel}
          </span>
          <ChevronDown
            className={`h-3 w-3 transition-transform ${
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
                placeholder={t("listen.placeholders.searchLanguages")}
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
                    ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                    : "hover:bg-mid-gray/10"
                }`}
              >
                {hubFilterLabels
                  ? "Language"
                  : t("listen.engineLibrary.allLanguages")}
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
                      ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
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

      {showActiveModelBanner ? (
        speech.activeModel ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[var(--shadow-sm)]">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              {t("listen.engineLibrary.activeListenModel")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-lg font-bold text-[var(--text)]">
                {speech.activeModel.label}
              </p>
              <Badge
                variant="secondary"
                className="bg-[var(--accent-soft)] px-2.5 py-1 font-semibold text-[var(--accent)]"
              >
                {speech.activeProvider?.label ?? "Provider"}
              </Badge>
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
              {t("listen.engineLibrary.activeListenModel")}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {t("listen.engineLibrary.chooseProviderModel")}
            </p>
          </div>
        )
      ) : null}

      <div className="space-y-4">
        {!portalTarget ? (
          <div className="flex justify-end px-5">{filterAction}</div>
        ) : null}
        <SpeechModelList
          title="Downloaded Models"
          count={downloadedModels.length}
          models={downloadedModels}
          speech={speech}
          showHeader={false}
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
  const [selectedCloneModelValue, setSelectedCloneModelValue] =
    useState("__none__");
  const selectedCloneModel =
    speech.cloneCapableModels.find(
      (model) => cloneModelSelectionValue(model) === selectedCloneModelValue,
    ) ?? null;
  const visibleProfiles = selectedCloneModel
    ? speech.profiles.filter((profile) =>
        profileSupportsModel(profile, selectedCloneModel),
      )
    : speech.profiles;
  const [selectedProfileId, setSelectedProfileId] = useState("__none__");
  const selectedProfile =
    visibleProfiles.find((profile) => profile.id === selectedProfileId) ?? null;

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
  const cloneModelOptions = [
    {
      value: "__none__",
      label:
        speech.cloneCapableModels.length > 0
          ? "Choose clone model"
          : "No clone-capable models available",
    },
    ...speech.cloneCapableModels.map((model) => ({
      value: cloneModelSelectionValue(model),
      label: `${formatSelectableLabel(model.label, modelOptionContext(model))}${model.installed ? "" : " (Download required)"}`,
    })),
  ];
  const cloneTargetSummary = selectedCloneModel
    ? `${selectedCloneModel.label} will be used when you create a new clone voice preset here. Your current My Voices selection stays unchanged until then.`
    : "Choose a clone-capable model here to build a cloned voice without changing the current My Voices preset.";
  const profileActionHint = !selectedProfile
    ? "Pick a profile or create one below."
    : !selectedProfile.ready
      ? "Import one clear WAV sample to make this profile usable for cloning."
      : selectedCloneModel
        ? "This profile is ready to turn into a saved voice preset using the selected clone model."
        : "Choose a clone model above to create a saved voice preset from this profile.";
  const createPresetDisabled =
    !speech.ttsEnabled ||
    !selectedProfile?.ready ||
    !selectedCloneModel ||
    !profileSupportsModel(selectedProfile, selectedCloneModel);

  const content = (
    <div className={whiteFlatSectionSurfaceClassName}>
      <div className="space-y-3 p-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {t("listen.voiceCloning.cloneProfiles")}
          </h3>
          <p className="text-xs text-[var(--muted)]">
            {t("listen.voiceCloning.cloneProfilesDescription")}
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <WorkflowField
            label="Clone Model"
            hint="This target is used only when you create a clone preset from this section."
          >
            <SelectField
              value={cloneModelSelectionValue(selectedCloneModel)}
              onChange={(value) => {
                setSelectedCloneModelValue(value);
              }}
              disabled={
                !speech.ttsEnabled ||
                speech.loadingPlatform ||
                speech.cloneCapableModels.length === 0
              }
              options={cloneModelOptions}
            />
          </WorkflowField>
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
              }}
              disabled={!speech.ttsEnabled || speech.loadingProfiles}
              options={profilePickerOptions}
            />
          </WorkflowField>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              {t("listen.voiceCloning.cloneTarget")}
            </p>
            <p className="mt-1 text-sm text-[var(--text)]">
              {cloneTargetSummary}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              {t("listen.voiceCloning.nextStep")}
            </p>
            <p className="mt-1 text-sm text-[var(--text)]">
              {profileActionHint}
            </p>
          </div>
        </div>

        {selectedProfile ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                void speech.createPresetFromProfile(
                  selectedProfile,
                  selectedCloneModel,
                )
              }
              disabled={createPresetDisabled}
            >
              {t("listen.voiceCloning.createPreset")}
            </Button>
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
              {t("listen.voiceCloning.importWav")}
            </Button>
            <div className="ms-auto">
              <Button
                type="button"
                variant="danger-ghost"
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
                {t("listen.voiceCloning.deleteProfile")}
              </Button>
            </div>
          </div>
        ) : null}

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
                    {t("listen.voiceCloning.improveFromDictationsDescription")}
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
                    await clearProfileCollectedData(selectedProfile.id);
                    await speech.refreshProfiles();
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
              : "Choose a clone model above, then pick or create a profile to start building a cloned voice here."}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--panel-bg)] p-4">
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
            onChange={(event) => speech.setProfileNameDraft(event.target.value)}
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
          <Textarea
            value={speech.profileTranscriptDraft}
            onChange={(event) =>
              speech.setProfileTranscriptDraft(event.target.value)
            }
            placeholder={t("listen.placeholders.voiceProfileTranscript")}
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
            void speech.updateSetting(
              "tts_auto_readback_mode",
              value as TtsAutoReadbackMode,
            )
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
              void speech.updateSetting(
                "tts_auto_readback_scope",
                value as TtsAutoReadbackScope,
              )
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
              void speech.updateSetting(
                "tts_readback_text_mode",
                value as TtsReadbackTextMode,
              )
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

export const MyVoicesSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return (
    <SavedVoiceProfilesSection speech={speech} showTitle={showGroupTitle} />
  );
};

export const CreateVoicesSection: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const speech = useListenSpeechState();
  return <VoiceArchitectSection speech={speech} showTitle={showGroupTitle} />;
};

export const EngineLibrarySection: React.FC<{
  showGroupTitle?: boolean;
  titleActionTargetId?: string;
  showActiveModelBanner?: boolean;
  hubSearchQuery?: string;
  hubFilterLabels?: boolean;
}> = ({
  showGroupTitle = true,
  titleActionTargetId,
  showActiveModelBanner = true,
  hubSearchQuery,
  hubFilterLabels,
}) => {
  const speech = useListenSpeechState();
  return (
    <EngineLibraryPanel
      speech={speech}
      showTitle={showGroupTitle}
      titleActionTargetId={titleActionTargetId}
      showActiveModelBanner={showActiveModelBanner}
      hubSearchQuery={hubSearchQuery}
      hubFilterLabels={hubFilterLabels}
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
