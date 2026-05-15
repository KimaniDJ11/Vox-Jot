import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Layers, Loader2, Play, X } from "lucide-react";
import { commands } from "@/bindings";
import type { VoiceInfo } from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import {
  createTtsVoicePreset,
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
} from "../utils";
import { resolvedTuningControlsForModel } from "../tuningControls";
import {
  buildVoiceArchitectDraftFromPreset,
  getCachedVoiceArchitectDraft,
  readVoiceArchitectUiDraft,
  saveVoiceArchitectDraft,
  writeVoiceArchitectUiDraft,
} from "../draftStorage";
import {
  InlineCueHint,
  SelectField,
  VoiceTuningCard,
  WorkflowField,
} from "../sharedComponents";
import type { TtsVoicePresetPatch } from "../types";
import CreateVoiceModelHubPicker from "./CreateVoiceModelHubPicker";

function normalizeTuningForCompare(tuning: TtsVoicePresetInput["tuning"]) {
  return {
    tempo_rate: tuning.tempo_rate,
    expressiveness: tuning.expressiveness,
    exaggeration: tuning.exaggeration,
    randomness: tuning.randomness,
    guidance: tuning.guidance,
    stability: tuning.stability,
    repetition_penalty: tuning.repetition_penalty,
    style_instructions: tuning.style_instructions?.trim() || null,
    advanced_overrides: Object.fromEntries(
      Object.entries(tuning.advanced_overrides ?? {})
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

function tuningMatchesDefault(tuning: TtsVoicePresetInput["tuning"]) {
  return (
    JSON.stringify(normalizeTuningForCompare(tuning)) ===
    JSON.stringify(normalizeTuningForCompare(defaultVoiceTuning()))
  );
}

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
  const [modelWindowOpen, setModelWindowOpen] = useState(false);
  const [saveTunedVoiceWindowOpen, setSaveTunedVoiceWindowOpen] =
    useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState(
    initialUiDraft.modelSearchQuery,
  );
  const [modelProviderFilter, setModelProviderFilter] = useState("all");
  const [modelLanguageFilter, setModelLanguageFilter] = useState("all");
  const [modelSortMode, setModelSortMode] =
    useState<ModelSortMode>("best_match");
  const [createVoiceTool, setCreateVoiceTool] = useState<"audio" | "tuning">(
    initialUiDraft.createVoiceTool,
  );
  const lastDraftSelectionKeyRef = useRef<string | null>(null);
  const hasTunedVoiceChanges = useMemo(
    () => !tuningMatchesDefault(draftTuning),
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
            : "Failed to load voices for the selected model",
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
  ]);

  const saveProfileName = saveProfileNameDraft.trim();
  const statusMessage = draftVoiceErrorMessage ?? speech.statusMessage;
  const draftSelectedModelForControls = resolveVoiceModelSelection(
    availableDraftModels,
    draftProviderId,
    draftModelId,
  );
  const draftProviderIdForControls =
    draftSelectedModelForControls?.provider_id ??
    availableDraftModels[0]?.provider_id ??
    "";
  const supportsDraftManualVoiceId =
    draftProviderIdForControls === "local_sidecar_api";
  const draftModelIdForControls =
    draftSelectedModelForControls?.id ?? availableDraftModels[0]?.id ?? "";
  const draftSelectedModel =
    availableDraftModels.find(
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
  if (!speech.settings || !speech.activePreset) return null;
  const isPreviewingDraft = speech.previewingPresetId === "__draft__";
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
      advanced_overrides: {
        ...(current.advanced_overrides ?? {}),
        ...(patch.tuning?.advanced_overrides ?? {}),
      },
    }));
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
        error instanceof Error ? error.message : "Failed to save voice preset",
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
    lastDraftSelectionKeyRef.current = null;
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

  const handleCreateVoiceToolChange = (value: "audio" | "tuning") => {
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

  const tuningView = (
    <>
      {draftSupportsVoiceCloning ? (
        <div className={whiteWorkflowCardClassName}>
          <WorkflowField
            label={t("listen.createVoices.workflow.cloneProfile")}
          >
            <SelectField
              value={draftVoiceProfileId}
              onChange={handleDraftVoiceProfileChange}
              disabled={!speech.ttsEnabled || speech.loadingProfiles}
              options={draftProfileOptions}
            />
          </WorkflowField>
        </div>
      ) : null}

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
          embedded
          modelLabel={draftSelectedModel?.label ?? speech.activeModel?.label}
          onResetAll={() => updateDraftPreset({ tuning: defaultVoiceTuning() })}
        />
      </div>
    </>
  );

  const contentSpacingClassName = showTitle
    ? "space-y-7 px-4 py-3"
    : "space-y-7";
  const showAudioControlsCard =
    (draftMatchesActiveModel && supportsDraftManualVoiceId) ||
    Boolean(statusMessage);
  const audioView = (
    <>
      {showAudioControlsCard ? (
        <div className={whiteWorkflowCardClassName}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-3">
              {draftMatchesActiveModel && supportsDraftManualVoiceId ? (
                <WorkflowField
                  label={t("listen.createVoices.workflow.manualVoiceId")}
                >
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
      ) : null}

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
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-tuned-voice-title"
            className="relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setSaveTunedVoiceWindowOpen(false)}
                aria-label={t("common.close", { defaultValue: "Close" })}
                title={t("common.close", { defaultValue: "Close" })}
              >
                <X aria-hidden />
              </Button>
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

  const content = (
    <>
      {saveTunedVoiceDialog}
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
        onSelectVoice={handleSelectDraftVoice}
        onClose={() => setModelWindowOpen(false)}
      />
      <div
        className={`${contentSpacingClassName} ${
          !speech.ttsEnabled ? "pointer-events-none opacity-50" : ""
        }`}
      >
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
            disabled={
              !speech.ttsEnabled ||
              !draftProviderIdForControls ||
              !draftModelIdForControls
            }
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

          <SegmentedControl<"audio" | "tuning">
            value={createVoiceTool}
            onChange={handleCreateVoiceToolChange}
            layoutId="create-voice-tool-toggle"
            ariaLabel={t("listen.createVoices.toolAriaLabel", {
              defaultValue: "Create Speech tools",
            })}
            items={[
              {
                value: "audio",
                label: t("listen.createVoices.audioTab", {
                  defaultValue: "Audio",
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
              onClick={() => setModelWindowOpen(true)}
            >
              <Layers className="h-3.5 w-3.5" />
              {t("listen.createVoices.voices", { defaultValue: "Voices" })}
            </Button>
          </div>
        </div>

        {createVoiceTool === "audio" ? audioView : tuningView}
      </div>
    </>
  );

  if (!showTitle) {
    return content;
  }

  return (
    <SettingsGroup title={t("appSections.nav.listen.createVoices")}>
      {content}
    </SettingsGroup>
  );
};
