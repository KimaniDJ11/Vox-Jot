import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { commands, type TtsPackInfo, type VoiceInfo } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import {
  getModelPlatformOverview,
  setTtsPlatformSelection,
  type CatalogModelDescriptor,
  type ModelPlatformOverview,
} from "@/lib/modelPlatform";
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
} from "@/lib/ttsVoicePresets";
import {
  listTtsVoiceProfiles,
  type TtsVoiceProfileDescriptor,
} from "@/lib/ttsVoiceProfiles";
import type { TtsVoicePresetPatch } from "./types";
import {
  HIDDEN_TTS_PROVIDER_IDS,
  buildPresetInput,
  dedupeCatalogModels,
  defaultPresetInput,
  defaultVoiceTuning,
  formatSelectableLabel,
  localeLabel,
  modelOptionContext,
  previewErrorMessage,
  previewPreparationMessage,
  profileSupportsModel,
  providerOptionContext,
  renderableTtsProviders,
  verifiedTtsHuggingFaceRepoId,
} from "./utils";

type ModelInstallResult = "available" | "download-started";

export function useListenSpeechState() {
  const { t } = useTranslation();
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
      renderableTtsProviders(
        platformOverview?.tts.providers ?? [],
        platformOverview?.tts.models ?? [],
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
        (platformOverview?.tts.models ?? []).filter((model) =>
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
          advanced_overrides: {
            ...(current.tuning.advanced_overrides ?? {}),
            ...(patch.tuning?.advanced_overrides ?? {}),
          },
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
      try {
        await deleteTtsVoicePreset(presetId);
        await refreshAll();
      } catch (error) {
        console.error("Failed to delete voice preset:", error);
        toast.error(
          error instanceof Error
            ? error.message
            : t("listen.myVoices.deletePresetFailed", {
                defaultValue: "Could not delete voice.",
              }),
        );
      }
    },
    [refreshAll, t],
  );

  const ensureModelInstalled = useCallback(
    async (model: CatalogModelDescriptor): Promise<ModelInstallResult> => {
      if (!model.downloadable || model.installed) return "available";
      const hfRepoId = verifiedTtsHuggingFaceRepoId(model);
      if (hfRepoId) {
        const result = await commands.downloadTtsHfModel(hfRepoId);
        if (result.status === "error") {
          throw new Error(result.error);
        }
        return "download-started";
      }
      const result = await commands.downloadTtsPack(model.id);
      if (result.status === "error") {
        throw new Error(result.error);
      }
      return "download-started";
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
            const installResult = await ensureModelInstalled(model);
            if (installResult === "download-started") {
              setStatusMessage(
                t("listen.engineLibrary.downloadStarted", {
                  modelName: model.label,
                  defaultValue:
                    "{{modelName}} download started. Preview will be available after it finishes.",
                }),
              );
              void refreshAll();
              return;
            }
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
    [presets, allModels, ensureModelInstalled, refreshAll, refreshPlatform, t],
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
          const installResult = await ensureModelInstalled(model);
          if (installResult === "download-started") {
            setStatusMessage(
              t("listen.engineLibrary.downloadStarted", {
                modelName: model.label,
                defaultValue:
                  "{{modelName}} download started. Preview will be available after it finishes.",
              }),
            );
            void refreshAll();
            return;
          }
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
    [allModels, ensureModelInstalled, refreshAll, refreshPlatform, t],
  );

  const selectProvider = useCallback(
    async (providerId: string) => {
      const nextModel =
        visibleModels.find((model) => model.provider_id === providerId) ?? null;
      if (!nextModel) return;
      const installResult = await ensureModelInstalled(nextModel);
      if (installResult === "download-started") {
        setStatusMessage(
          t("listen.engineLibrary.downloadStarted", {
            modelName: nextModel.label,
            defaultValue:
              "{{modelName}} download started. You can select it after it finishes.",
          }),
        );
        void refreshAll();
        return;
      }
      await setTtsPlatformSelection(providerId, nextModel.id);
      await refreshAll();
    },
    [ensureModelInstalled, refreshAll, t, visibleModels],
  );

  const selectModel = useCallback(
    async (modelId: string) => {
      const nextModel =
        visibleModels.find(
          (model) =>
            model.provider_id === providerIdForControls && model.id === modelId,
        ) ?? null;
      if (!nextModel) return;
      const installResult = await ensureModelInstalled(nextModel);
      if (installResult === "download-started") {
        setStatusMessage(
          t("listen.engineLibrary.downloadStarted", {
            modelName: nextModel.label,
            defaultValue:
              "{{modelName}} download started. You can select it after it finishes.",
          }),
        );
        void refreshAll();
        return;
      }
      await setTtsPlatformSelection(providerIdForControls, modelId);
      await refreshAll();
    },
    [ensureModelInstalled, providerIdForControls, refreshAll, t, visibleModels],
  );

  const activateModel = useCallback(
    async (providerId: string, modelId: string) => {
      const nextModel =
        visibleModels.find(
          (model) => model.provider_id === providerId && model.id === modelId,
        ) ?? null;
      if (!nextModel) return;
      const installResult = await ensureModelInstalled(nextModel);
      if (installResult === "download-started") {
        setStatusMessage(
          t("listen.engineLibrary.downloadStarted", {
            modelName: nextModel.label,
            defaultValue:
              "{{modelName}} download started. Vox Jot will show it as downloaded after it finishes.",
          }),
        );
        void refreshAll();
        return;
      }
      if (!settings?.tts_enabled) {
        await updateSetting("tts_enabled", true);
      }
      await setTtsPlatformSelection(providerId, modelId);
      await refreshAll();
    },
    [
      ensureModelInstalled,
      refreshAll,
      settings?.tts_enabled,
      t,
      updateSetting,
      visibleModels,
    ],
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

export type ListenSpeechState = ReturnType<typeof useListenSpeechState>;
