import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Check, Dna, Layers, X } from "lucide-react";
import { commands, type VoiceInfo } from "@/bindings";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { openModelHub } from "@/components/model-hub/modelHubTabs";
import {
  createTtsVoicePreset,
  type TtsVoicePreset,
  type TtsVoicePresetInput,
} from "@/lib/ttsVoicePresets";
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
import {
  whiteWorkflowCardClassName,
  workflowFieldLabelClassName,
} from "../styles";
import {
  DEFAULT_TTS_PREVIEW_TEXT,
  buildPresetInput,
  defaultVoiceTuning,
  getTtsVoicesForSelection,
  isDraftVoiceModelAvailable,
  isVoiceFixedToModel,
  profileSupportsModel,
  resolveVoiceModelSelection,
  ttsModelSupportsLanguage,
  voiceTuningMatchesDefault,
} from "../utils";
import { resolvedTuningControlsForModel } from "../tuningControls";
import {
  buildVoiceArchitectDraftFromPreset,
  getCachedVoiceArchitectDraft,
  readVoiceArchitectUiDraft,
  saveVoiceArchitectDraft,
  writeVoiceArchitectUiDraft,
} from "../draftStorage";
import { VoiceTuningCard } from "../sharedComponents";
import type { TtsVoicePresetPatch } from "../types";
import { voiceAvatarGradient } from "../createVoiceVoiceHub";
import CreateVoiceModelHubPicker from "./CreateVoiceModelHubPicker";
import { SavedVoiceProfilesSection } from "./SavedVoiceProfilesSection";

type VoiceArchitectTool = "my-voices" | "tuning";

const PREVIEW_RUNNING_DELAY_MS = 1500;

export const VoiceArchitectSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const initialDraft = useMemo(() => {
    const cached = getCachedVoiceArchitectDraft();
    if (cached && cached.presetId === (speech.activePreset?.id ?? null)) {
      return cached;
    }
    return buildVoiceArchitectDraftFromPreset(speech.activePreset);
  }, [speech.activePreset]);
  const initialUiDraft = useMemo(readVoiceArchitectUiDraft, []);
  const [saveProfileNameDraft, setSaveProfileNameDraft] = useState(
    initialUiDraft.saveProfileNameDraft,
  );
  const [draftProviderId, setDraftProviderId] = useState(
    initialDraft.providerId,
  );
  const [draftModelId, setDraftModelId] = useState(initialDraft.modelId);
  const [draftVoiceId, setDraftVoiceId] = useState(initialDraft.voiceId);
  const [draftVoiceProfileId, setDraftVoiceProfileId] = useState(
    initialDraft.voiceProfileId,
  );
  const [draftVoices, setDraftVoices] = useState<VoiceInfo[]>([]);
  const [draftVoiceErrorMessage, setDraftVoiceErrorMessage] = useState<
    string | null
  >(null);
  const [draftTuning, setDraftTuning] = useState(initialDraft.tuning);
  const [previewTextDraft, setPreviewTextDraft] = useState(
    initialUiDraft.previewTextDraft,
  );
  const [draftPreviewRunning, setDraftPreviewRunning] = useState(false);
  const [modelWindowOpen, setModelWindowOpen] = useState(false);
  const [saveTunedVoiceWindowOpen, setSaveTunedVoiceWindowOpen] =
    useState(false);
  const [cloneProfileWindowOpen, setCloneProfileWindowOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState(
    initialUiDraft.modelSearchQuery,
  );
  const [modelProviderFilter, setModelProviderFilter] = useState("all");
  const [modelLanguageFilter, setModelLanguageFilter] = useState("all");
  const [modelSortMode, setModelSortMode] =
    useState<ModelSortMode>("best_match");
  const [createVoiceTool, setCreateVoiceTool] = useState<VoiceArchitectTool>(
    initialUiDraft.createVoiceTool === "tuning" ? "tuning" : "my-voices",
  );
  const lastDraftSelectionKeyRef = useRef<string | null>(null);
  const hasTunedVoiceChanges = useMemo(
    () => !voiceTuningMatchesDefault(draftTuning),
    [draftTuning],
  );
  const availableDraftModels = useMemo(
    () => speech.visibleModels.filter(isDraftVoiceModelAvailable),
    [speech.visibleModels],
  );

  useEffect(() => {
    writeVoiceArchitectUiDraft({
      saveProfileNameDraft,
      previewTextDraft,
      modelSearchQuery,
      createVoiceTool,
    });
  }, [
    createVoiceTool,
    modelSearchQuery,
    previewTextDraft,
    saveProfileNameDraft,
  ]);

  useEffect(() => {
    if (!speech.activePreset) return;

    const cached = getCachedVoiceArchitectDraft();
    const nextDraft =
      cached?.presetId === speech.activePreset.id
        ? cached
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
    if (!hasTunedVoiceChanges) {
      setSaveTunedVoiceWindowOpen(false);
    }
  }, [hasTunedVoiceChanges]);

  useEffect(() => {
    setDraftPreviewRunning(false);
    if (speech.previewingPresetId !== "__draft__") return;

    const timeoutId = window.setTimeout(() => {
      setDraftPreviewRunning(true);
    }, PREVIEW_RUNNING_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [speech.previewingPresetId]);

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
      availableDraftModels,
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
    availableDraftModels,
  ]);

  useEffect(() => {
    if (!speech.settings || !speech.activePreset) return;

    const selectedModel = resolveVoiceModelSelection(
      availableDraftModels,
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
      setDraftVoiceErrorMessage(null);
      return;
    }

    if (isVoiceFixedToModel(providerIdForControls)) {
      setDraftVoices([]);
      setDraftVoiceErrorMessage(null);
      return;
    }

    if (matchesActiveModel) {
      setDraftVoices(speech.voices);
      setDraftVoiceErrorMessage(null);
      return;
    }

    let cancelled = false;
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
            : t("listen.createVoices.loadVoicesFailed", {
                defaultValue: "Failed to load voices for the selected model",
              }),
        );
      })
      .finally(() => {
        if (cancelled) return;
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
    availableDraftModels,
    speech.voices,
    t,
  ]);

  const saveProfileName = saveProfileNameDraft.trim();
  const draftSelectedModelForControls =
    availableDraftModels.find(
      (model) =>
        model.provider_id === draftProviderId && model.id === draftModelId,
    ) ?? null;
  const draftProviderIdForControls =
    draftSelectedModelForControls?.provider_id ?? draftProviderId ?? "";
  const draftModelIdForControls =
    draftSelectedModelForControls?.id ?? draftModelId ?? "";
  const draftSelectedModel =
    availableDraftModels.find(
      (model) =>
        model.provider_id === draftProviderIdForControls &&
        model.id === draftModelIdForControls,
    ) ?? null;
  const draftSupportsVoiceCloning =
    draftSelectedModel?.capabilities.supports_voice_cloning ?? false;
  const noCloneProfileLabel = t("listen.createVoices.noCloneProfile", {
    defaultValue: "No clone profile",
  });
  const draftCompatibleProfiles = draftSelectedModel
    ? speech.profiles.filter((profile) =>
        profileSupportsModel(profile, draftSelectedModel),
      )
    : [];
  const draftProfileOptions = [
    { value: "__none__", label: noCloneProfileLabel },
    ...draftCompatibleProfiles.map((profile) => ({
      value: profile.id,
      label: !profile.ready
        ? t("listen.createVoices.profileNeedsAudio", {
            profile: profile.label,
            defaultValue: "{{profile}} (Needs audio)",
          })
        : profile.label,
    })),
  ];
  const selectedCloneProfileLabel =
    draftProfileOptions.find((option) => option.value === draftVoiceProfileId)
      ?.label ?? noCloneProfileLabel;
  const cloneProfileButtonDisabled =
    !speech.ttsEnabled || !draftSupportsVoiceCloning;
  const cloneProfileUnavailableTitle = t(
    "listen.voiceDesign.cloneProfileUnavailable",
    {
      defaultValue: "The selected model does not support voice cloning.",
    },
  );
  const selectedTuningModel = draftSelectedModel ?? speech.activeModel;
  const controls = resolvedTuningControlsForModel(selectedTuningModel);
  const supportsExpressiveness =
    (selectedTuningModel?.delivery_support.expressiveness_mode ??
      "unsupported") !== "unsupported";
  const draftMatchesActiveModel =
    draftProviderIdForControls === (speech.activePreset?.provider_id ?? "") &&
    draftModelIdForControls === (speech.activePreset?.model_id ?? "");
  const draftVoiceInventory = draftMatchesActiveModel
    ? speech.voices
    : draftVoices;
  const draftSelectedProfile =
    draftCompatibleProfiles.find(
      (profile) => profile.id === draftVoiceProfileId,
    ) ?? null;
  const draftVoiceFixedToModel = isVoiceFixedToModel(
    draftProviderIdForControls,
  );
  const draftVoiceSelectionId =
    draftVoiceFixedToModel || draftVoiceId === "__auto__" ? null : draftVoiceId;
  const draftVoiceSelection =
    draftVoiceInventory.find((voice) => voice.id === draftVoiceSelectionId) ??
    null;
  const draftModelDefaultVoiceLabel =
    draftSelectedModel?.label ?? draftModelIdForControls;
  const draftPreviewVoiceName =
    draftSelectedProfile?.label ??
    draftVoiceSelection?.label ??
    (!draftMatchesActiveModel || draftVoiceFixedToModel
      ? draftModelDefaultVoiceLabel
      : (speech.activePreset?.voice_label_snapshot ?? null)) ??
    t("listen.createVoices.automaticVoice", {
      defaultValue: "Automatic voice",
    });
  const draftPreviewVoiceAvatar = voiceAvatarGradient(
    [
      draftProviderIdForControls,
      draftModelIdForControls,
      draftVoiceSelectionId ?? draftVoiceProfileId ?? "auto",
    ].join("::"),
  );
  useEffect(() => {
    if (!draftSupportsVoiceCloning) {
      setCloneProfileWindowOpen(false);
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

  useEffect(() => {
    if (!cloneProfileWindowOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCloneProfileWindowOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cloneProfileWindowOpen]);

  const normalizedModelSearch = modelSearchQuery.trim().toLowerCase();
  const providerFilterLabel = t("listen.createVoices.providerFilter", {
    defaultValue: "Provider",
  });
  const languageFilterLabel = t("listen.createVoices.languageFilter", {
    defaultValue: "Language",
  });
  const bestMatchLabel = t("listen.createVoices.bestMatchSort", {
    defaultValue: "Best Match",
  });
  const modelProviderOptions = useMemo(
    () => [
      { value: "all", label: providerFilterLabel },
      ...speech.visibleProviders.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ],
    [providerFilterLabel, speech.visibleProviders],
  );
  const selectedModelProviderLabel = useMemo(
    () =>
      modelProviderOptions.find(
        (option) => option.value === modelProviderFilter,
      )?.label ?? providerFilterLabel,
    [modelProviderFilter, modelProviderOptions, providerFilterLabel],
  );
  const modelLanguageOptions = useMemo(
    () => [
      { value: "all", label: languageFilterLabel },
      ...LANGUAGES.filter((language) => language.value !== "auto").map(
        (language) => ({
          value: language.value,
          label: language.label,
        }),
      ),
    ],
    [languageFilterLabel],
  );
  const selectedModelLanguageLabel = useMemo(
    () =>
      modelLanguageOptions.find(
        (option) => option.value === modelLanguageFilter,
      )?.label ?? languageFilterLabel,
    [modelLanguageFilter, modelLanguageOptions, languageFilterLabel],
  );
  const modelSortOptions = useMemo(
    () => [...DEFAULT_MODEL_SORT_OPTIONS, TEST_SCORE_MODEL_SORT_OPTION],
    [],
  );
  const selectedModelSortLabel = useMemo(
    () =>
      modelSortOptions.find((option) => option.value === modelSortMode)
        ?.label ?? bestMatchLabel,
    [bestMatchLabel, modelSortMode, modelSortOptions],
  );
  const modelProviderRankById = useMemo(
    () =>
      new Map(
        speech.visibleProviders.map((provider, index) => [provider.id, index]),
      ),
    [speech.visibleProviders],
  );
  const filteredDraftModels = availableDraftModels.filter((model) => {
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
      model.source_label,
      providerLabel,
      model.locale ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedModelSearch);
  });
  const orderedDraftModels = orderModelList(
    filteredDraftModels,
    "downloaded",
    modelSortMode,
    {
      label: (model: CatalogModelDescriptor) => model.label,
      installed: (model: CatalogModelDescriptor) => model.installed,
      runnable: (model: CatalogModelDescriptor) => model.runnable,
      recommended: (model: CatalogModelDescriptor) => model.selected,
      rank: (model: CatalogModelDescriptor) =>
        getTtsEvaluationResult(model.id)?.rank,
      latencyMs: (model: CatalogModelDescriptor) =>
        getTtsEvaluationResult(model.id)?.latencyP50Ms,
      providerRank: (model: CatalogModelDescriptor) =>
        modelProviderRankById.get(model.provider_id),
    },
  );
  const contentSpacingClassName = showTitle
    ? "space-y-7 px-4 py-3"
    : "space-y-7";
  const sectionTitle = t("appSections.nav.listen.voiceDesign", {
    defaultValue: "Voice Design",
  });
  const renderSection = (sectionContent: React.ReactNode) => {
    if (!showTitle) {
      return <>{sectionContent}</>;
    }

    return <SettingsGroup title={sectionTitle}>{sectionContent}</SettingsGroup>;
  };

  if (!speech.settings) return null;

  if (!speech.activePreset || availableDraftModels.length === 0) {
    const emptyStateTitle = speech.loadingPlatform
      ? t("listen.voiceDesign.loadingSetupTitle", {
          defaultValue: "Checking voice models",
        })
      : t("listen.voiceDesign.setupTitle", {
          defaultValue: "Set up a voice model first",
        });
    const emptyStateDescription = speech.loadingPlatform
      ? t("listen.voiceDesign.loadingSetupDetail", {
          defaultValue:
            "Vox Jot is loading the voice catalog and saved voices.",
        })
      : t("listen.voiceDesign.setupDetail", {
          defaultValue:
            "Voice Design needs a runnable TTS model and a saved voice before tuning, cloning, or previewing voices.",
        });
    const emptyContent = (
      <div className={contentSpacingClassName}>
        {speech.statusMessage ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
            {speech.statusMessage}
          </div>
        ) : null}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[var(--shadow-sm)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold text-[var(--text)]">
                {emptyStateTitle}
              </h3>
              <p className="max-w-[56ch] text-sm leading-6 text-[var(--muted)]">
                {emptyStateDescription}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void speech.refreshAll()}
                disabled={speech.loadingPlatform || speech.loadingPresets}
              >
                {t("common.refresh", { defaultValue: "Refresh" })}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void openModelHub("tts")}
              >
                <Layers className="h-3.5 w-3.5" aria-hidden />
                {t("listen.voiceDesign.openVoiceModels", {
                  defaultValue: "Open Voice Models",
                })}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );

    return renderSection(emptyContent);
  }

  const buildDraftPresetInput = (): TtsVoicePresetInput => {
    const source = buildPresetInput(speech.activePreset);
    const providerOrModelChanged =
      source.provider_id !== draftProviderIdForControls ||
      source.model_id !== draftModelIdForControls;
    const draftProfileSelectionId =
      draftSupportsVoiceCloning && draftVoiceProfileId !== "__none__"
        ? draftVoiceProfileId
        : null;

    return {
      ...source,
      provider_id: draftProviderIdForControls,
      model_id: draftModelIdForControls,
      tuning: { ...draftTuning },
      voice_id: draftVoiceFixedToModel
        ? draftModelIdForControls
        : (draftVoiceSelectionId ?? null),
      voice_profile_id: draftProfileSelectionId,
      voice_label_snapshot:
        draftSelectedProfile?.label ??
        draftVoiceSelection?.label ??
        (providerOrModelChanged || draftVoiceFixedToModel
          ? draftModelDefaultVoiceLabel
          : null),
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
      advanced_overrides: {
        ...(current.advanced_overrides ?? {}),
        ...(patch.tuning?.advanced_overrides ?? {}),
      },
    }));
  };
  const resetDraftTuning = () => {
    setDraftTuning(defaultVoiceTuning());
  };
  const handlePreviewDraftTuning = async () => {
    if (speech.previewingPresetId === "__draft__") {
      const result = await commands.ttsStop();
      if (result.status === "error") {
        speech.setStatusMessage(result.error);
      }
      setDraftPreviewRunning(false);
      return;
    }

    if (
      !speech.ttsEnabled ||
      !draftProviderIdForControls ||
      !draftModelIdForControls
    ) {
      return;
    }

    await speech.previewPresetDraft(
      buildDraftPresetInput(),
      previewTextDraft.trim() ? previewTextDraft : DEFAULT_TTS_PREVIEW_TEXT,
    );
  };
  const handleSaveCurrent = async () => {
    if (
      !saveProfileName ||
      !draftProviderIdForControls ||
      !draftModelIdForControls
    )
      return false;

    try {
      await createTtsVoicePreset({
        ...buildDraftPresetInput(),
        label: saveProfileName,
      });
      await speech.refreshAll();
      setSaveProfileNameDraft("");
      return true;
    } catch (error) {
      speech.setStatusMessage(
        error instanceof Error
          ? error.message
          : t("listen.createVoices.saveVoicePresetFailed", {
              defaultValue: "Failed to save voice preset",
            }),
      );
      return false;
    }
  };

  const handleSelectDraftVoice = ({
    model,
    voiceId,
    voiceLabel,
    locale,
  }: {
    model: CatalogModelDescriptor;
    voiceId: string | null;
    voiceLabel: string | null;
    locale: string | null;
  }) => {
    const matchesActiveModel =
      model.provider_id === (speech.activePreset?.provider_id ?? "") &&
      model.id === (speech.activePreset?.model_id ?? "");
    lastDraftSelectionKeyRef.current = `${model.provider_id}::${model.id}`;
    setDraftVoiceErrorMessage(null);
    setDraftProviderId(model.provider_id);
    setDraftModelId(model.id);
    setDraftVoiceId(voiceId ?? "__auto__");
    setModelWindowOpen(false);
    speech.setStatusMessage(null);

    if (matchesActiveModel) {
      void speech.updateActivePreset({
        voice_id: voiceId,
        voice_label_snapshot: voiceLabel,
        locale_snapshot: locale,
      });
    }
  };

  const handleSelectSavedPreset = (preset: TtsVoicePreset) => {
    lastDraftSelectionKeyRef.current = `${preset.provider_id}::${preset.model_id}`;
    setDraftVoiceErrorMessage(null);
    setDraftProviderId(preset.provider_id);
    setDraftModelId(preset.model_id);
    setDraftVoiceId(preset.voice_id ?? "__auto__");
    setDraftVoiceProfileId(preset.voice_profile_id ?? "__none__");
    setDraftTuning({
      ...preset.tuning,
      advanced_overrides: {
        ...(preset.tuning.advanced_overrides ?? {}),
      },
    });
    setModelWindowOpen(false);
    speech.setStatusMessage(null);
  };

  const handleCreateVoiceToolChange = (value: VoiceArchitectTool) => {
    setCreateVoiceTool(value);
  };

  const handleDraftVoiceProfileChange = (value: string) => {
    setDraftVoiceProfileId(value);
    if (!draftMatchesActiveModel) {
      return;
    }
    const profile =
      draftCompatibleProfiles.find((item) => item.id === value) ?? null;
    void speech.updateActivePreset({
      voice_profile_id: value === "__none__" ? null : value,
      voice_label_snapshot:
        value === "__none__"
          ? (speech.activePreset.voice_label_snapshot ?? null)
          : (profile?.label ?? value),
    });
  };

  const handleCloneProfileSelect = (value: string) => {
    handleDraftVoiceProfileChange(value);
    setCloneProfileWindowOpen(false);
  };

  const tuningView = (
    <>
      <div className={whiteWorkflowCardClassName}>
        <VoiceTuningCard
          preset={buildDraftPresetInput()}
          onUpdatePreset={updateDraftPreset}
          ttsEnabled={speech.ttsEnabled}
          controls={controls}
          supportsExpressiveness={supportsExpressiveness}
          title={t("listen.createVoices.tuning", {
            defaultValue: "Tuning",
          })}
          modelLabel={draftPreviewVoiceName}
          previewButtonGradient={draftPreviewVoiceAvatar}
          previewing={speech.previewingPresetId === "__draft__"}
          previewRunning={draftPreviewRunning}
          previewDisabled={
            !draftProviderIdForControls || !draftModelIdForControls
          }
          onPreview={handlePreviewDraftTuning}
          embedded
          onResetAll={resetDraftTuning}
        />
      </div>
    </>
  );

  const saveTunedVoiceDialog = createPortal(
    <AnimatePresence>
      {saveTunedVoiceWindowOpen ? (
        <motion.div
          className="fixed inset-0 z-[110] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setSaveTunedVoiceWindowOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setSaveTunedVoiceWindowOpen(false);
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
            aria-labelledby="save-tuned-voice-title"
            className="relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[var(--modal-shadow)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="min-w-0">
                <h3
                  id="save-tuned-voice-title"
                  className="truncate text-sm font-semibold text-[var(--text)]"
                >
                  {t("listen.createVoices.saveTunedVoice", {
                    defaultValue: "Save Tuned Voice",
                  })}
                </h3>
                <p className="truncate text-xs text-[var(--muted)]">
                  {t("listen.createVoices.saveTunedVoiceDetail", {
                    defaultValue:
                      "Name these tuned voice settings so you can reuse them.",
                  })}
                </p>
              </div>
              <ActionIconButton
                type="button"
                onClick={() => setSaveTunedVoiceWindowOpen(false)}
                aria-label={t("common.close", { defaultValue: "Close" })}
                title={t("common.close", { defaultValue: "Close" })}
              >
                <X aria-hidden />
              </ActionIconButton>
            </div>
            <div className="space-y-4 p-4">
              <label className="block space-y-2">
                <span className={workflowFieldLabelClassName}>
                  {t("listen.createVoices.tunedVoiceName", {
                    defaultValue: "Tuned voice name",
                  })}
                </span>
                <Input
                  autoFocus
                  value={saveProfileNameDraft}
                  onChange={(event) =>
                    setSaveProfileNameDraft(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSaveCurrent().then((saved) => {
                        if (saved) setSaveTunedVoiceWindowOpen(false);
                      });
                    }
                  }}
                  disabled={!speech.ttsEnabled}
                  aria-label={t("listen.createVoices.tunedVoiceName", {
                    defaultValue: "Tuned voice name",
                  })}
                  placeholder={t("listen.placeholders.savedVoiceName")}
                  className="w-full max-w-none"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSaveTunedVoiceWindowOpen(false)}
                >
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void handleSaveCurrent().then((saved) => {
                      if (saved) setSaveTunedVoiceWindowOpen(false);
                    });
                  }}
                  disabled={
                    !speech.ttsEnabled ||
                    !saveProfileName ||
                    !draftProviderIdForControls ||
                    !draftModelIdForControls
                  }
                >
                  {t("listen.createVoices.saveTunedVoice", {
                    defaultValue: "Save Tuned Voice",
                  })}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );

  const cloneProfileDialog = createPortal(
    <AnimatePresence>
      {cloneProfileWindowOpen ? (
        <motion.div
          className="fixed inset-0 z-[110] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setCloneProfileWindowOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setCloneProfileWindowOpen(false);
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
            aria-labelledby="clone-profile-dialog-title"
            className="relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[var(--modal-shadow)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h3
                id="clone-profile-dialog-title"
                className="text-sm font-semibold leading-snug text-[var(--text)]"
              >
                {t("listen.voiceDesign.cloneProfileDialogDetail", {
                  defaultValue:
                    "Choose a cloned voice profile for the selected model.",
                })}
              </h3>
            </div>
            <div
              role="listbox"
              aria-label={t("listen.voiceDesign.cloneProfileDialogDetail", {
                defaultValue:
                  "Choose a cloned voice profile for the selected model.",
              })}
              className="max-h-[min(60vh,360px)] space-y-1 overflow-y-auto p-2"
            >
              <button
                type="button"
                role="option"
                aria-selected={draftVoiceProfileId === "__none__"}
                disabled={!speech.ttsEnabled || speech.loadingProfiles}
                onClick={() => handleCloneProfileSelect("__none__")}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50 ${
                  draftVoiceProfileId === "__none__"
                    ? "border-[color-mix(in_srgb,var(--accent),transparent_55%)] bg-[var(--accent-soft)]"
                    : "border-transparent hover:border-[var(--border)] hover:bg-[color-mix(in_srgb,var(--text),transparent_94%)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
                >
                  <Dna className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--text)]">
                    {noCloneProfileLabel}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    {t("listen.voiceDesign.noCloneProfileDetail", {
                      defaultValue: "Use the model voice without a clone.",
                    })}
                  </span>
                </span>
                {draftVoiceProfileId === "__none__" ? (
                  <Check
                    className="h-4 w-4 shrink-0 text-[var(--accent)]"
                    aria-hidden="true"
                  />
                ) : null}
              </button>

              {speech.loadingProfiles ? (
                <p className="px-3 py-4 text-sm text-[var(--muted)]">
                  {t("listen.voiceDesign.loadingCloneProfiles", {
                    defaultValue: "Loading clone profiles…",
                  })}
                </p>
              ) : draftCompatibleProfiles.length === 0 ? (
                <p className="px-3 py-4 text-sm text-[var(--muted)]">
                  {t("listen.voiceDesign.noCloneProfilesForModel", {
                    defaultValue:
                      "No clone profiles match this model yet. Create one in Voice Cloning.",
                  })}
                </p>
              ) : (
                draftCompatibleProfiles.map((profile) => {
                  const isSelected = draftVoiceProfileId === profile.id;
                  const profileLabel = !profile.ready
                    ? t("listen.createVoices.profileNeedsAudio", {
                        profile: profile.label,
                        defaultValue: "{{profile}} (Needs audio)",
                      })
                    : profile.label;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={!speech.ttsEnabled}
                      onClick={() => handleCloneProfileSelect(profile.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50 ${
                        isSelected
                          ? "border-[color-mix(in_srgb,var(--accent),transparent_55%)] bg-[var(--accent-soft)]"
                          : "border-transparent hover:border-[var(--border)] hover:bg-[color-mix(in_srgb,var(--text),transparent_94%)]"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-9 w-9 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--avatar-ring)]"
                        style={{
                          background: voiceAvatarGradient(profile.id),
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--text)]">
                          {profileLabel}
                        </span>
                        {profile.description ? (
                          <span className="block truncate text-xs text-[var(--muted)]">
                            {profile.description}
                          </span>
                        ) : !profile.ready ? (
                          <span className="block text-xs text-[var(--muted)]">
                            {t("listen.voiceDesign.profileNeedsAudioDetail", {
                              defaultValue:
                                "Add reference audio in Voice Cloning to use this profile.",
                            })}
                          </span>
                        ) : null}
                      </span>
                      {isSelected ? (
                        <Check
                          className="h-4 w-4 shrink-0 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  );
                })
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
      {saveTunedVoiceDialog}
      {cloneProfileDialog}
      <CreateVoiceModelHubPicker
        open={modelWindowOpen}
        speech={speech}
        models={availableDraftModels}
        providers={speech.visibleProviders}
        selectedProviderId={draftProviderIdForControls}
        selectedModelId={draftModelIdForControls}
        selectedVoiceId={draftVoiceId}
        searchQuery={modelSearchQuery}
        onSearchQueryChange={setModelSearchQuery}
        providerFilter={modelProviderFilter}
        providerOptions={modelProviderOptions}
        selectedProviderLabel={selectedModelProviderLabel}
        onProviderFilterChange={setModelProviderFilter}
        languageFilter={modelLanguageFilter}
        languageOptions={modelLanguageOptions}
        selectedLanguageLabel={selectedModelLanguageLabel}
        onLanguageFilterChange={setModelLanguageFilter}
        sortMode={modelSortMode}
        sortOptions={modelSortOptions}
        selectedSortLabel={selectedModelSortLabel}
        onSortModeChange={setModelSortMode}
        orderedModels={orderedDraftModels}
        filteredModelCount={filteredDraftModels.length}
        mode="voice-design"
        onSelectVoice={handleSelectDraftVoice}
        selectedVoiceProfileId={
          draftVoiceProfileId === "__none__" ? null : draftVoiceProfileId
        }
        onSelectPreset={handleSelectSavedPreset}
        onClose={() => setModelWindowOpen(false)}
      />
      <div className={contentSpacingClassName}>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<VoiceArchitectTool>
            value={createVoiceTool}
            onChange={handleCreateVoiceToolChange}
            layoutId="voice-design-tool-toggle"
            ariaLabel={t("listen.voiceDesign.toolAriaLabel", {
              defaultValue: "Voice Design tools",
            })}
            items={[
              {
                value: "my-voices",
                label: t("listen.createVoices.myVoices", {
                  defaultValue: "My Voices",
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

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {hasTunedVoiceChanges ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSaveTunedVoiceWindowOpen(true)}
                disabled={
                  !speech.ttsEnabled ||
                  !draftProviderIdForControls ||
                  !draftModelIdForControls
                }
              >
                {t("listen.createVoices.saveTunedVoice", {
                  defaultValue: "Save Tuned Voice",
                })}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCloneProfileWindowOpen(true)}
              disabled={cloneProfileButtonDisabled}
              title={
                cloneProfileButtonDisabled
                  ? cloneProfileUnavailableTitle
                  : selectedCloneProfileLabel
              }
              aria-label={t("listen.voiceDesign.cloneProfileAriaLabel", {
                profile: selectedCloneProfileLabel,
                defaultValue: "Clone profile: {{profile}}",
              })}
            >
              <Dna className="h-3.5 w-3.5" />
              {t("listen.voiceDesign.cloneProfile", {
                defaultValue: "Clone Profile",
              })}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setModelWindowOpen(true)}
            >
              <Layers className="h-3.5 w-3.5" />
              {t("listen.createVoices.voices", { defaultValue: "Voices" })}
            </Button>
          </div>
        </div>

        {createVoiceTool === "my-voices" ? (
          <SavedVoiceProfilesSection
            speech={speech}
            showTitle={false}
            revealDeleteOnHover
          />
        ) : (
          tuningView
        )}
      </div>
    </>
  );

  if (!showTitle) {
    return content;
  }

  return renderSection(content);
};
