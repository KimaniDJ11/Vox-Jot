import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import GatedHuggingFaceAccessDialog from "@/components/model-hub/GatedHuggingFaceAccessDialog";
import {
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import { LANGUAGES } from "@/lib/constants/languages";
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
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

const GATED_TTS_HF_ACCESS_URLS: Record<string, string> = {};

const ttsModelRequiresHfAccess = (model: CatalogModelDescriptor): boolean =>
  Boolean(GATED_TTS_HF_ACCESS_URLS[model.id]);

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
  const supportsStyle = modelHasTuningControls(model);
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
      headerBadges={headerBadges}
      description={model.description}
      capabilityChips={capabilityChips}
      footerMetaItems={detailItems}
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
  const [ttsDownloadProgress, setTtsDownloadProgress] = useState<
    Record<string, TtsHfDownloadProgress>
  >({});
  const [hfTokenStatus, setHfTokenStatus] =
    useState<HuggingFaceTokenStatus | null>(null);
  const [gatedDownloadModel, setGatedDownloadModel] =
    useState<CatalogModelDescriptor | null>(null);
  const [hfTokenDraft, setHfTokenDraft] = useState("");
  const [hfTokenError, setHfTokenError] = useState<string | null>(null);
  const [savingHfToken, setSavingHfToken] = useState(false);
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
  const selectedProviderLabel = useMemo(() => {
    const idle = hubFilterLabels ? "Provider" : "All providers";
    if (providerFilter === "all") {
      return idle;
    }
    return (
      providerOptions.find((provider) => provider.value === providerFilter)
        ?.label ?? idle
    );
  }, [hubFilterLabels, providerFilter, providerOptions]);
  const hasActiveProviderFilter = providerFilter !== "all";
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
      if (!ttsModelRequiresHfAccess(model)) return false;
      setGatedDownloadModel(model);
      setHfTokenDraft("");
      setHfTokenError(null);
      void loadHfTokenStatus();
      return true;
    },
    [loadHfTokenStatus],
  );

  const closeGatedDownload = useCallback(() => {
    if (savingHfToken) return;
    setGatedDownloadModel(null);
    setHfTokenDraft("");
    setHfTokenError(null);
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
    <div className="flex items-center gap-2">
      <div
        className={`relative inline-flex ${hubFilterLabels ? "h-10 w-10 shrink-0" : "w-36"}`}
      >
        <select
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          className={`${hubFilterLabels ? "h-full" : "min-h-9"} w-full appearance-none rounded-full border py-1.5 text-xs font-semibold shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
            hubFilterLabels
              ? hasActiveProviderFilter
                ? "border-[var(--accent)] bg-[var(--accent-soft)] px-0 text-transparent"
                : "border-[var(--border)] bg-[var(--card)] px-0 text-transparent"
              : "border-[var(--border)] bg-[var(--card)] pe-9 ps-3 text-[var(--text)]"
          }`}
          aria-label={`Filter listen models by provider: ${selectedProviderLabel}`}
          title={`Provider: ${selectedProviderLabel}`}
        >
          {providerOptions.map((provider) => (
            <option
              key={provider.value}
              value={provider.value}
              style={{ color: "var(--text)", backgroundColor: "var(--card)" }}
            >
              {provider.label}
            </option>
          ))}
        </select>
        {hubFilterLabels ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {hasActiveProviderFilter ? (
              <ProviderIcon providerId={providerFilter} size="sm" />
            ) : (
              <SlidersHorizontal className="h-4 w-4 text-[var(--text)]" />
            )}
          </div>
        ) : (
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
        )}
      </div>
      <div className="relative" ref={languageDropdownRef}>
        <button
          type="button"
          onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
          className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold transition-colors shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
            hasActiveLanguageFilter
              ? "rounded-full bg-logo-primary text-[var(--inverse-text)]"
              : "rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--card),var(--panel-bg)_12%)]"
          } ${hubFilterLabels ? "h-10 w-10 px-0" : "min-h-9 w-36 px-3"}`}
          aria-haspopup="listbox"
          aria-expanded={languageDropdownOpen}
          aria-label={`Filter listen models by language: ${selectedLanguageLabel}`}
          title={`Language: ${selectedLanguageLabel}`}
        >
          <Globe className={hubFilterLabels ? "h-4 w-4" : "h-3 w-3"} />
          {hubFilterLabels ? null : (
            <>
              <span className="min-w-0 flex-1 truncate text-left">
                {selectedLanguageLabel}
              </span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${
                  languageDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </>
          )}
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
          ttsDownloadProgress={ttsDownloadProgress}
          onGatedDownloadRequest={requestGatedDownload}
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
            ttsDownloadProgress={ttsDownloadProgress}
            onGatedDownloadRequest={requestGatedDownload}
            emptyMessage={
              providerFilter !== "all" || languageFilter !== "all"
                ? "No available speech models match the current filters."
                : "Every compatible speech model is already downloaded or active."
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
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return <SettingsGroup title="Engine Library">{content}</SettingsGroup>;
};
