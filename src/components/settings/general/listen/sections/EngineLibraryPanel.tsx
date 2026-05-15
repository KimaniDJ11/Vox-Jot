import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  Check,
  Dna,
  Globe,
  HardDrive,
  Loader2,
  Mic2,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { commands } from "@/bindings";
import type { HuggingFaceTokenStatus } from "@/bindings";
import { Button } from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { type CompactBadgeItem } from "@/components/ui/CompactOverflow";
import HubModelCard, {
  type HubDownloadState,
  type HubTrailing,
} from "@/components/model-hub/HubModelCard";
import {
  buildModelIdentityChips,
  inferArchitectureLabel,
  inferParameterClass,
  inferRuntimeFormat,
  mergeSizeWithIdentityChips,
} from "@/components/model-hub/modelIdentityChips";
import GatedHuggingFaceAccessDialog from "@/components/model-hub/GatedHuggingFaceAccessDialog";
import LicenseAcknowledgementDialog, {
  type LicenseAcknowledgementGate,
} from "@/components/model-hub/LicenseAcknowledgementDialog";
import {
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import { LANGUAGES } from "@/lib/constants/languages";
import ModelListControls from "@/components/model-hub/ModelListControls";
import type { ModelHubControlState } from "@/components/model-hub/modelHubControls";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
import {
  DEFAULT_MODEL_SORT_OPTIONS,
  orderModelList,
  TEST_SCORE_MODEL_SORT_OPTION,
  type ModelSortMode,
} from "@/lib/modelListOrdering";
import { getTtsEvaluationResult } from "@/lib/ttsEvaluationResults";
import type {
  CatalogModelDescriptor,
  ProviderDescriptor,
} from "@/lib/modelPlatform";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import type { ListenSpeechState } from "../useListenSpeechState";
import { speechLibraryCardClassName } from "../styles";
import {
  formatLanguageCoverage,
  getModelLanguageItems,
  sourceKindLabel,
  ttsHubModelCanRemove,
  ttsModelSupportsLanguage,
  ttsStorageSizeLabel,
} from "../utils";
import { modelHasTuningControls } from "../tuningControls";

const GATED_TTS_HF_ACCESS_URLS: Record<string, string> = {
  "xtts-v2": "https://huggingface.co/coqui/XTTS-v2",
};

const TTS_LICENSE_ACKNOWLEDGEMENT_GATES: Record<
  string,
  LicenseAcknowledgementGate
> = {
  "xtts-v2": {
    kind: "non_commercial",
    licenseLabel: "Coqui Public Model License",
    termsUrl: "https://huggingface.co/coqui/XTTS-v2/blob/main/LICENSE.txt",
    requiresVoiceConsent: true,
  },
  "fish-audio-s2-pro": {
    kind: "custom_review",
    licenseLabel: "Fish Audio Research License",
    termsUrl: "https://huggingface.co/mlx-community/fish-audio-s2-pro-bf16",
    requiresVoiceConsent: true,
    note: "Commercial use requires a separate Fish Audio license.",
  },
  "fish-audio-s2-pro-8bit": {
    kind: "custom_review",
    licenseLabel: "Fish Audio Research License",
    termsUrl: "https://huggingface.co/mlx-community/fish-audio-s2-pro-8bit",
    requiresVoiceConsent: true,
    note: "Commercial use requires a separate Fish Audio license.",
  },
  "spark-tts-0.5b": {
    kind: "non_commercial",
    licenseLabel: "CC-BY-NC-SA-4.0",
    termsUrl: "https://huggingface.co/mlx-community/Spark-TTS-0.5B-bf16",
  },
  "spark-tts-0.5b-4-6bit": {
    kind: "non_commercial",
    licenseLabel: "CC-BY-NC-SA-4.0",
    termsUrl: "https://huggingface.co/mlx-community/Spark-TTS-0.5B-4-6bit",
  },
  "outetts-1b-4bit": {
    kind: "non_commercial",
    licenseLabel: "CC-BY-NC-SA-4.0",
    termsUrl: "https://huggingface.co/mlx-community/Llama-OuteTTS-1.0-1B-4bit",
    requiresVoiceConsent: true,
  },
  "voxtral-tts-4b": {
    kind: "non_commercial",
    licenseLabel: "CC-BY-NC-4.0",
    termsUrl:
      "https://huggingface.co/mlx-community/Voxtral-4B-TTS-2603-mlx-bf16",
  },
  "voxtral-tts-4b-4bit": {
    kind: "non_commercial",
    licenseLabel: "CC-BY-NC-4.0",
    termsUrl:
      "https://huggingface.co/mlx-community/Voxtral-4B-TTS-2603-mlx-4bit",
  },
  "lfm2-5-audio-1-5b": {
    kind: "custom_review",
    licenseLabel: "LFM Open License v1.0",
    termsUrl: "https://huggingface.co/LiquidAI/LFM2.5-Audio-1.5B",
    note: "Review the custom LFM license before using this model in a distributed or commercial setting.",
  },
};

const ttsModelRequiresHfAccess = (model: CatalogModelDescriptor): boolean =>
  Boolean(GATED_TTS_HF_ACCESS_URLS[model.id]);

const ttsModelLicenseGate = (
  model: CatalogModelDescriptor,
): LicenseAcknowledgementGate | null =>
  TTS_LICENSE_ACKNOWLEDGEMENT_GATES[model.id] ?? null;

interface TtsHfDownloadProgress {
  repo_id: string;
  stage: string;
  file?: string | null;
  file_index?: number | null;
  file_count?: number | null;
  error?: string | null;
}

const SpeechModelLibraryCard: React.FC<{
  model: CatalogModelDescriptor;
  provider: ProviderDescriptor | null;
  active: boolean;
  selected: boolean;
  speech: ListenSpeechState;
  downloadProgress?: TtsHfDownloadProgress;
  onGatedDownloadRequest: (model: CatalogModelDescriptor) => boolean;
}> = ({
  model,
  provider,
  active,
  selected,
  speech,
  downloadProgress,
  onGatedDownloadRequest,
}) => {
  const { t } = useTranslation();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [locallyDownloading, setLocallyDownloading] = useState(false);
  const headerBadges: CompactBadgeItem[] = [
    active
      ? {
          id: "active",
          label: t("listen.engineLibrary.badges.active"),
          variant: "primary",
          icon: <Check className="h-3.5 w-3.5" />,
          detail: t("listen.engineLibrary.badges.activeDetail"),
        }
      : null,
    !active && selected
      ? {
          id: "selected",
          label: t("listen.engineLibrary.badges.selected"),
          variant: "primary",
          detail: t("listen.engineLibrary.badges.selectedDetail"),
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];
  const titleBadges: CompactBadgeItem[] = [
    ttsModelLicenseGate(model)
      ? {
          id: "license-gate",
          label: t("modelHub.licenseGate.badge", {
            defaultValue: "Restricted license",
          }),
          variant: "secondary" as const,
          icon: <AlertTriangle className="h-3 w-3" />,
          detail: t("modelHub.licenseGate.badgeDetail", {
            defaultValue:
              "Requires acknowledging publisher license restrictions before download.",
          }),
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];

  const sublineParts = [
    provider?.label,
    sourceKindLabel(model.source_kind),
  ].filter((part): part is string => Boolean(part));
  const subline = sublineParts.join(" · ");
  const languageCoverage = formatLanguageCoverage(model);
  const supportsStyle = modelHasTuningControls(model);
  const storageSizeLabel = ttsStorageSizeLabel(model, t);
  const identityChips = buildModelIdentityChips({
    params: inferParameterClass([
      model.label,
      model.id,
      provider?.label,
      model.source_label,
    ]),
    arch: inferArchitectureLabel(
      [model.label, model.id, provider?.label, model.runtime.engine_family],
      provider?.label,
    ),
    format: inferRuntimeFormat(
      [
        model.runtime.label,
        model.runtime.engine_family,
        model.source_label,
        model.id,
      ],
      model.runtime.label,
    ),
  });
  const sizeChip: CompactBadgeItem = {
    id: "capability-size",
    label: storageSizeLabel,
    variant: "secondary" as const,
    icon: <HardDrive className="h-3 w-3" />,
    detail: t("modelHub.chips.storageSizeDetail", {
      defaultValue: "Approximate model storage footprint.",
    }),
  };
  const capabilityChips: CompactBadgeItem[] = [
    ...mergeSizeWithIdentityChips(identityChips, sizeChip),
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

  const detailItems = [
    provider?.runtime.label ?? model.runtime.label,
    model.license_label,
    model.source_label,
  ].filter(Boolean) as string[];

  const clickable =
    !active &&
    speech.ttsEnabled &&
    !speech.loadingPlatform &&
    !confirmingRemove &&
    !locallyDownloading &&
    !downloadProgress;

  const downloadOrActivate = useCallback(async () => {
    if (locallyDownloading || downloadProgress) return;
    if (
      model.downloadable &&
      !model.installed &&
      onGatedDownloadRequest(model)
    ) {
      return;
    }
    setLocallyDownloading(model.downloadable && !model.installed);
    try {
      await speech.activateModel(model.provider_id, model.id);
    } finally {
      setLocallyDownloading(false);
    }
  }, [
    downloadProgress,
    locallyDownloading,
    model.downloadable,
    model.id,
    model.installed,
    model.provider_id,
    onGatedDownloadRequest,
    speech,
  ]);

  let trailing: HubTrailing = null;
  if (
    !active &&
    model.downloadable &&
    !model.installed &&
    !locallyDownloading &&
    !downloadProgress
  ) {
    trailing = {
      kind: "acquire",
      onClick: () => void downloadOrActivate(),
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

  const progressFileName = downloadProgress?.file
    ? downloadProgress.file.includes("/")
      ? downloadProgress.file.slice(downloadProgress.file.lastIndexOf("/") + 1)
      : downloadProgress.file
    : null;
  const fileProgress =
    downloadProgress?.file_count && downloadProgress.file_count > 0
      ? Math.min(
          100,
          Math.round(
            ((downloadProgress.file_index ?? 0) / downloadProgress.file_count) *
              100,
          ),
        )
      : null;
  const downloadState: HubDownloadState | undefined =
    downloadProgress || locallyDownloading
      ? {
          label: downloadProgress?.error
            ? t("listen.engineLibrary.downloadFailed", {
                defaultValue: "Setup failed",
              })
            : downloadProgress?.stage === "preparing"
              ? t("listen.engineLibrary.downloadPreparing", {
                  defaultValue: "Checking model files...",
                })
              : downloadProgress?.stage === "installing-runtime"
                ? t("listen.engineLibrary.installingRuntime", {
                    defaultValue: "Installing required runtime...",
                  })
                : downloadProgress?.stage === "complete"
                  ? t("listen.engineLibrary.ready", {
                      defaultValue: "Ready to use",
                    })
                  : locallyDownloading && !downloadProgress
                    ? t("listen.engineLibrary.preparingModel", {
                        defaultValue: "Preparing model...",
                      })
                    : t("settings.refineModels.actions.downloadingUnknown", {
                        defaultValue: "Downloading model files...",
                      }),
          detail:
            progressFileName ??
            provider?.runtime.label ??
            model.runtime.label ??
            model.id,
          error: downloadProgress?.error ?? null,
          progress: fileProgress,
          indeterminate: fileProgress === null,
        }
      : undefined;

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
      titleBadges={titleBadges}
      headerBadges={headerBadges}
      description={model.description}
      capabilityChips={capabilityChips}
      footerMetaItems={detailItems}
      footerMetaLinks={
        model.source_url
          ? [
              {
                label: t("modelHub.sourceLink", {
                  defaultValue: "Open model source",
                }),
                url: model.source_url,
              },
            ]
          : undefined
      }
      footerMetaMaxVisible={4}
      footerMetaIcon={<Globe className="h-3.5 w-3.5" />}
      footerOverflowLabel={`${model.label} details`}
      trailing={trailing}
      downloadState={downloadState}
      footerExtra={footerExtra}
      onClick={clickable ? () => void downloadOrActivate() : undefined}
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
  showHeader?: boolean;
  ttsDownloadProgress: Record<string, TtsHfDownloadProgress>;
  onGatedDownloadRequest: (model: CatalogModelDescriptor) => boolean;
}> = ({
  title,
  count,
  models,
  speech,
  emptyMessage,
  showHeader = true,
  ttsDownloadProgress,
  onGatedDownloadRequest,
}) => (
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
            downloadProgress={ttsDownloadProgress[model.id]}
            onGatedDownloadRequest={onGatedDownloadRequest}
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

export const EngineLibraryPanel: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
  titleActionTargetId?: string;
  showActiveModelBanner?: boolean;
  hubSearchQuery?: string;
  modelHubControls?: ModelHubControlState;
  hubFilterLabels?: boolean;
}> = ({
  speech,
  showTitle = true,
  titleActionTargetId,
  showActiveModelBanner = true,
  hubSearchQuery = "",
  modelHubControls,
  hubFilterLabels = false,
}) => {
  const { t } = useTranslation();
  const [localProviderFilter, setLocalProviderFilter] = useState("all");
  const [localLanguageFilter, setLocalLanguageFilter] = useState("all");
  const [localSortMode, setLocalSortMode] =
    useState<ModelSortMode>("best_match");
  const providerFilter =
    modelHubControls?.providerFilter ?? localProviderFilter;
  const languageFilter =
    modelHubControls?.languageFilter ?? localLanguageFilter;
  const sortMode = modelHubControls?.sortMode ?? localSortMode;
  const setProviderFilter =
    modelHubControls?.setProviderFilter ?? setLocalProviderFilter;
  const setLanguageFilter =
    modelHubControls?.setLanguageFilter ?? setLocalLanguageFilter;
  const setSortMode = modelHubControls?.setSortMode ?? setLocalSortMode;
  const [ttsDownloadProgress, setTtsDownloadProgress] = useState<
    Record<string, TtsHfDownloadProgress>
  >({});
  const [hfTokenStatus, setHfTokenStatus] =
    useState<HuggingFaceTokenStatus | null>(null);
  const [gatedDownloadModel, setGatedDownloadModel] =
    useState<CatalogModelDescriptor | null>(null);
  const [licenseGateDownloadModel, setLicenseGateDownloadModel] =
    useState<CatalogModelDescriptor | null>(null);
  const [hfTokenDraft, setHfTokenDraft] = useState("");
  const [hfTokenError, setHfTokenError] = useState<string | null>(null);
  const [savingHfToken, setSavingHfToken] = useState(false);
  const portalTarget = usePortalTarget(titleActionTargetId);
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
  const languageOptions = useMemo(
    () => [
      {
        value: "all",
        label: hubFilterLabels ? "Language" : "All Languages",
      },
      ...LANGUAGES.filter((lang) => lang.value !== "auto").map((lang) => ({
        value: lang.value,
        label: lang.label,
      })),
    ],
    [hubFilterLabels],
  );
  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return hubFilterLabels ? "Language" : "All Languages";
    }
    return (
      LANGUAGES.find((lang) => lang.value === languageFilter)?.label ??
      languageFilter
    );
  }, [hubFilterLabels, languageFilter]);
  const selectedProviderLabel = useMemo(() => {
    const idle = hubFilterLabels ? "Provider" : "All providers";
    if (providerFilter === "all") {
      return idle;
    }
    return (
      providerOptions.find((provider) => provider.value === providerFilter)
        ?.label ??
      providerFilter ??
      idle
    );
  }, [hubFilterLabels, providerFilter, providerOptions]);

  useEffect(() => {
    if (modelHubControls) return;
    if (
      providerFilter !== "all" &&
      !providerOptions.some((provider) => provider.value === providerFilter)
    ) {
      setProviderFilter("all");
    }
  }, [modelHubControls, providerFilter, providerOptions, setProviderFilter]);

  useEffect(() => {
    if (modelHubControls) return;
    if (
      languageFilter !== "all" &&
      !languageOptions.some((language) => language.value === languageFilter)
    ) {
      setLanguageFilter("all");
    }
  }, [languageFilter, languageOptions, modelHubControls, setLanguageFilter]);

  const providerRankById = useMemo(
    () =>
      new Map(
        speech.visibleProviders.map((provider, index) => [provider.id, index]),
      ),
    [speech.visibleProviders],
  );
  const sortOptions = useMemo(
    () => [...DEFAULT_MODEL_SORT_OPTIONS, TEST_SCORE_MODEL_SORT_OPTION],
    [],
  );
  const selectedSortLabel = useMemo(
    () =>
      sortOptions.find((option) => option.value === sortMode)?.label ??
      "Best Match",
    [sortMode, sortOptions],
  );
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
    return orderModelList(
      filteredModels.filter((model) => model.installed),
      "downloaded",
      sortMode,
      {
        label: (model) => model.label,
        active: (model) =>
          model.provider_id === speech.activePreset?.provider_id &&
          model.id === speech.activePreset?.model_id,
        installed: (model) => model.installed,
        runnable: (model) => model.runnable,
        recommended: (model) => model.active || model.selected,
        rank: (model) => getTtsEvaluationResult(model.id)?.rank,
        latencyMs: (model) => getTtsEvaluationResult(model.id)?.latencyP50Ms,
        providerRank: (model) => providerRankById.get(model.provider_id),
      },
    );
  }, [filteredModels, providerRankById, sortMode, speech.activePreset]);
  const availableModels = useMemo(
    () =>
      orderModelList(
        filteredModels.filter((model) => !model.installed),
        "available",
        sortMode,
        {
          label: (model) => model.label,
          active: (model) =>
            model.provider_id === speech.activePreset?.provider_id &&
            model.id === speech.activePreset?.model_id,
          installed: (model) => model.installed,
          runnable: (model) => model.runnable,
          recommended: (model) => model.selected,
          gated: (model) =>
            ttsModelRequiresHfAccess(model) ||
            Boolean(ttsModelLicenseGate(model)),
          blocked: (model) => model.capabilities.coming_soon,
          rank: (model) => getTtsEvaluationResult(model.id)?.rank,
          latencyMs: (model) => getTtsEvaluationResult(model.id)?.latencyP50Ms,
          providerRank: (model) => providerRankById.get(model.provider_id),
        },
      ),
    [filteredModels, providerRankById, sortMode, speech.activePreset],
  );

  const loadHfTokenStatus = useCallback(async () => {
    const result = await commands.getHuggingFaceTokenStatus();
    if (result.status === "ok") {
      setHfTokenStatus(result.data);
    } else {
      setHfTokenStatus({ configured: false, source: null });
      setHfTokenError(result.error);
    }
  }, []);

  const requestGatedDownload = useCallback(
    (model: CatalogModelDescriptor): boolean => {
      if (ttsModelRequiresHfAccess(model)) {
        setGatedDownloadModel(model);
        setHfTokenDraft("");
        setHfTokenError(null);
        void loadHfTokenStatus();
        return true;
      }
      if (ttsModelLicenseGate(model)) {
        setLicenseGateDownloadModel(model);
        return true;
      }
      return false;
    },
    [loadHfTokenStatus],
  );

  const closeGatedDownload = useCallback(() => {
    if (savingHfToken) return;
    setGatedDownloadModel(null);
    setHfTokenDraft("");
    setHfTokenError(null);
  }, [savingHfToken]);

  const closeLicenseGateDownload = useCallback(() => {
    if (savingHfToken) return;
    setLicenseGateDownloadModel(null);
  }, [savingHfToken]);

  const confirmGatedDownload = useCallback(async () => {
    if (!gatedDownloadModel || savingHfToken) return;
    const token = hfTokenDraft.trim();
    if (!token && !hfTokenStatus?.configured) {
      setHfTokenError(
        t("modelHub.analysis.hfAccess.tokenRequired", {
          defaultValue:
            "Paste a Hugging Face read token, or save one with the HF CLI first.",
        }),
      );
      return;
    }

    setSavingHfToken(true);
    setHfTokenError(null);
    if (token) {
      const result = await commands.setHuggingFaceToken(token);
      if (result.status === "ok") {
        setHfTokenStatus(result.data);
        setHfTokenDraft("");
      } else {
        setHfTokenError(result.error);
        setSavingHfToken(false);
        return;
      }
    }

    const model = gatedDownloadModel;
    if (ttsModelLicenseGate(model)) {
      setSavingHfToken(false);
      setGatedDownloadModel(null);
      setLicenseGateDownloadModel(model);
      setHfTokenDraft("");
      setHfTokenError(null);
      return;
    }
    try {
      await speech.activateModel(model.provider_id, model.id);
      setGatedDownloadModel(null);
      setHfTokenDraft("");
      setHfTokenError(null);
    } catch (error) {
      setHfTokenError(
        error instanceof Error
          ? error.message
          : t("modelHub.tts.downloadFailed", {
              defaultValue: "Download failed.",
            }),
      );
    } finally {
      setSavingHfToken(false);
    }
  }, [
    gatedDownloadModel,
    hfTokenDraft,
    hfTokenStatus?.configured,
    savingHfToken,
    speech,
    t,
  ]);

  const clearHfToken = useCallback(async () => {
    if (savingHfToken) return;
    if (
      !confirmDestructiveAction(
        t("modelHub.analysis.hfAccess.clearTokenConfirm", {
          defaultValue:
            "Clear the saved Hugging Face token from Vox Jot? Gated model downloads will need a token again.",
        }),
      )
    ) {
      return;
    }
    const result = await commands.clearHuggingFaceToken();
    if (result.status === "ok") {
      setHfTokenStatus(result.data);
      setHfTokenDraft("");
      setHfTokenError(null);
    } else {
      setHfTokenError(result.error);
    }
  }, [savingHfToken, t]);

  const confirmLicenseGateDownload = useCallback(async () => {
    if (!licenseGateDownloadModel || savingHfToken) return;
    const model = licenseGateDownloadModel;
    setSavingHfToken(true);
    try {
      await speech.activateModel(model.provider_id, model.id);
      setLicenseGateDownloadModel(null);
    } catch (error) {
      speech.setStatusMessage(
        error instanceof Error
          ? error.message
          : t("modelHub.tts.downloadFailed", {
              defaultValue: "Download failed.",
            }),
      );
    } finally {
      setSavingHfToken(false);
    }
  }, [licenseGateDownloadModel, savingHfToken, speech, t]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<TtsHfDownloadProgress>(
        "tts-hf-download-progress",
        (event) => {
          const progress = event.payload;
          if (!progress.repo_id) return;
          setTtsDownloadProgress((current) => {
            const next = { ...current };
            if (progress.stage === "complete") {
              delete next[progress.repo_id];
            } else {
              next[progress.repo_id] = progress;
            }
            return next;
          });
        },
      );
    })();
    return () => unlisten?.();
  }, []);

  if (!speech.settings) return null;

  const filterAction = (
    <ModelListControls
      provider={{
        value: providerFilter,
        options: providerOptions,
        onChange: setProviderFilter,
        label: selectedProviderLabel,
        show: providerOptions.length > 2,
      }}
      language={{
        value: languageFilter,
        options: languageOptions,
        onChange: setLanguageFilter,
        label: selectedLanguageLabel,
        show: true,
      }}
      sort={{
        value: sortMode,
        options: sortOptions,
        onChange: setSortMode,
        label: selectedSortLabel,
      }}
    />
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
          title={t("listen.engineLibrary.downloadedModels")}
          count={downloadedModels.length}
          models={downloadedModels}
          speech={speech}
          ttsDownloadProgress={ttsDownloadProgress}
          onGatedDownloadRequest={requestGatedDownload}
          showHeader={false}
          emptyMessage={
            providerFilter !== "all" || languageFilter !== "all"
              ? t("listen.engineLibrary.noDownloadedMatches")
              : t("listen.engineLibrary.noDownloadedModels")
          }
        />

        <div className="border-t border-[var(--border)] pt-4">
          <SpeechModelList
            title={t("listen.engineLibrary.availableToDownload")}
            count={availableModels.length}
            models={availableModels}
            speech={speech}
            ttsDownloadProgress={ttsDownloadProgress}
            onGatedDownloadRequest={requestGatedDownload}
            emptyMessage={
              providerFilter !== "all" || languageFilter !== "all"
                ? t("listen.engineLibrary.noAvailableMatches")
                : t("listen.engineLibrary.allModelsReady")
            }
          />
        </div>
      </div>
      <GatedHuggingFaceAccessDialog
        open={Boolean(gatedDownloadModel)}
        modelName={gatedDownloadModel?.label ?? ""}
        titleId="tts-hf-access-title"
        tokenStatus={hfTokenStatus}
        tokenDraft={hfTokenDraft}
        error={hfTokenError}
        busy={savingHfToken}
        onTokenDraftChange={setHfTokenDraft}
        onOpenAccessPage={async () => {
          if (!gatedDownloadModel) return;
          const accessUrl = GATED_TTS_HF_ACCESS_URLS[gatedDownloadModel.id];
          if (!accessUrl) return;
          setHfTokenError(null);
          try {
            await openUrl(accessUrl);
          } catch (error) {
            setHfTokenError(
              error instanceof Error
                ? error.message
                : t("modelHub.analysis.hfAccess.openAccessFailed", {
                    defaultValue: "Failed to open Hugging Face access page.",
                  }),
            );
          }
        }}
        onClearToken={clearHfToken}
        onCancel={closeGatedDownload}
        onConfirm={confirmGatedDownload}
      />
      <LicenseAcknowledgementDialog
        open={Boolean(licenseGateDownloadModel)}
        modelName={licenseGateDownloadModel?.label ?? ""}
        acknowledgementId={
          licenseGateDownloadModel
            ? `tts.${licenseGateDownloadModel.provider_id}.${licenseGateDownloadModel.id}`
            : "tts.unknown"
        }
        gate={
          licenseGateDownloadModel
            ? ttsModelLicenseGate(licenseGateDownloadModel)
            : null
        }
        busy={savingHfToken}
        onOpenTerms={async () => {
          if (!licenseGateDownloadModel) return;
          const gate = ttsModelLicenseGate(licenseGateDownloadModel);
          if (!gate) return;
          await openUrl(gate.termsUrl);
        }}
        onCancel={closeLicenseGateDownload}
        onConfirm={confirmLicenseGateDownload}
      />
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return (
    <SettingsGroup title={t("listen.engineLibrary.title")}>
      {content}
    </SettingsGroup>
  );
};
