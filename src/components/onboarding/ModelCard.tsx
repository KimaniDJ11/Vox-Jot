import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  Clock,
  HardDrive,
  Languages,
  Loader2,
} from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { formatModelSize } from "../../lib/utils/format";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../lib/utils/modelTranslation";
import { Button } from "../ui/Button";
import { type CompactBadgeItem } from "../ui/CompactOverflow";
import HubModelCard, {
  type HubDownloadState,
  type HubTrailing,
} from "../model-hub/HubModelCard";
import {
  providerDisplayName,
  resolveModelProviderId,
} from "../ui/ProviderIcon";
import { getSttEvaluationResult } from "@/lib/sttEvaluationResults";
import {
  buildModelIdentityChips,
  inferArchitectureLabel,
  inferParameterClass,
  inferRuntimeFormat,
  mergeSizeWithIdentityChips,
} from "../model-hub/modelIdentityChips";

const formatLanguageAbbreviation = (language: string): string => {
  const trimmed = language.trim();
  if (!trimmed) return language;
  return trimmed.split(/[-_]/)[0].slice(0, 3).toUpperCase();
};

const formatLanguageCount = (
  languages: string[],
  fallbackLabel: string,
): string => {
  if (languages.length === 0) return fallbackLabel;
  if (languages.length === 1) return formatLanguageAbbreviation(languages[0]);
  return `${formatLanguageAbbreviation(languages[0])}+${languages.length - 1}`;
};

const sourceHostLabel = (sourceUrl?: string | null): string | null => {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return sourceUrl;
  }
};

export type ModelCardStatus =
  | "downloadable"
  | "downloading"
  | "extracting"
  | "switching"
  | "active"
  | "available";

interface ModelCardProps {
  model: ModelInfo;
  variant?: "default" | "featured";
  status?: ModelCardStatus;
  disabled?: boolean;
  className?: string;
  /** Forwarded to HubModelCard — false makes the card hug its content. */
  fillHeight?: boolean;
  /** Max capability chips before extras fold into the overflow button. */
  capabilityChipsMaxVisible?: number;
  onSelect: (modelId: string) => void;
  onDownload?: (modelId: string) => void;
  onDelete?: (modelId: string) => void;
  onCancel?: (modelId: string) => void;
  downloadProgress?: number;
  downloadSpeed?: number; // MB/s
  showRecommended?: boolean;
  providerId?: string;
  providerLabel?: string;
  runtimeLabel?: string;
  licenseLabel?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  variant = "default",
  status = "downloadable",
  disabled = false,
  className = "",
  fillHeight = true,
  capabilityChipsMaxVisible,
  onSelect,
  onDownload,
  onDelete,
  onCancel,
  downloadProgress,
  downloadSpeed,
  showRecommended = true,
  providerId,
  providerLabel,
  runtimeLabel,
  licenseLabel,
  sourceLabel,
  sourceUrl,
}) => {
  const { t } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isClickable =
    !confirmingDelete &&
    !deleting &&
    (status === "available" || status === "active");

  const displayName = getTranslatedModelName(model, t);
  const displayDescription = getTranslatedModelDescription(model, t);
  const resolvedProviderId = resolveModelProviderId(
    `${displayName} ${model.id}`,
    providerId,
  );
  const isQwenFamily = `${displayName} ${model.id}`
    .toLowerCase()
    .includes("qwen");
  const providerLabelIsRuntime =
    providerLabel?.toLowerCase().includes("runtime") ?? false;
  const displayProviderLabel = isQwenFamily
    ? providerDisplayName("stt_qwen")
    : resolvedProviderId !== "generic" &&
        (!providerLabel || providerLabelIsRuntime)
      ? providerDisplayName(resolvedProviderId)
      : providerLabel;

  // Top-right reserved for status only — provider identity now lives in the
  // 40px logo + subline, so the provider chip badge is dropped.
  const headerBadges: CompactBadgeItem[] = [
    showRecommended && model.is_recommended
      ? {
          id: "recommended",
          label: t("onboarding.recommended"),
          variant: "primary" as const,
          detail: t("onboarding.recommendedDetail", {
            defaultValue: "Suggested by Vox Jot for most users.",
          }),
        }
      : null,
    status === "active"
      ? {
          id: "active",
          label: t("modelSelector.active"),
          variant: "primary" as const,
          icon: <Check className="h-3 w-3" />,
          detail: t("modelSelector.activeDetail", {
            defaultValue: "Currently used for speech-to-text.",
          }),
        }
      : null,
    model.is_custom
      ? {
          id: "custom",
          label: t("modelSelector.custom"),
          variant: "secondary" as const,
          detail: t("modelSelector.customDetail", {
            defaultValue: "Imported locally — not from the default catalog.",
          }),
        }
      : null,
    status === "switching"
      ? {
          id: "switching",
          label: t("modelSelector.switching"),
          variant: "secondary" as const,
          icon: <Loader2 className="h-3 w-3 animate-spin" />,
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];

  const sizeLabel =
    Number(model.size_mb) > 0
      ? formatModelSize(Number(model.size_mb))
      : t("modelHub.chips.internalStorage", { defaultValue: "Internal" });
  const languagesSummary = formatLanguageCount(
    model.supported_languages,
    t("settings.general.language.auto", { defaultValue: "Auto" }),
  );
  const languagesDetail =
    model.supported_languages.length > 0
      ? model.supported_languages.map(formatLanguageAbbreviation).join(" · ")
      : undefined;
  const isRealtimeModel =
    model.engine_type === "AppleSpeechStreaming" ||
    displayName.toLowerCase().includes("realtime") ||
    model.id.toLowerCase().includes("realtime");
  const evaluation = getSttEvaluationResult(model.id);
  const plainModelBadge: CompactBadgeItem | null =
    evaluation?.rank === 1
      ? {
          id: "plain-best-quality",
          label: t("modelSelector.badges.bestQuality", {
            defaultValue: "Best Quality",
          }),
          variant: "primary" as const,
          detail: t("modelSelector.badges.bestQualityDetail", {
            defaultValue: "Highest ranked speech model in the current suite.",
          }),
        }
      : evaluation?.latencyP50Ms !== undefined && evaluation.latencyP50Ms <= 80
        ? {
            id: "plain-fastest",
            label: t("modelSelector.badges.fastest", {
              defaultValue: "Fastest",
            }),
            variant: "primary" as const,
            detail: t("modelSelector.badges.fastestDetail", {
              defaultValue: "Very low measured p50 latency.",
            }),
          }
        : model.is_recommended
          ? {
              id: "plain-balanced",
              label: t("modelSelector.badges.balanced", {
                defaultValue: "Balanced",
              }),
              variant: "primary" as const,
              detail: t("modelSelector.badges.balancedDetail", {
                defaultValue:
                  "Recommended balance of speed, quality, and setup.",
              }),
            }
          : Number(model.size_mb) > 0 && Number(model.size_mb) <= 200
            ? {
                id: "plain-smallest",
                label: t("modelSelector.badges.smallest", {
                  defaultValue: "Smallest",
                }),
                variant: "primary" as const,
                detail: t("modelSelector.badges.smallestDetail", {
                  defaultValue: "Small download and disk footprint.",
                }),
              }
            : null;

  const identityChips = buildModelIdentityChips({
    params: inferParameterClass([displayName, model.id, model.filename]),
    arch: inferArchitectureLabel(
      [displayName, model.id, displayProviderLabel, providerLabel],
      displayProviderLabel,
    ),
    format: inferRuntimeFormat(
      [runtimeLabel, model.engine_type, model.filename, model.id],
      runtimeLabel,
    ),
  });

  const sizeChip: CompactBadgeItem | null = sizeLabel
    ? {
        id: "capability-size",
        label: sizeLabel,
        variant: "secondary" as const,
        icon: <HardDrive className="h-3 w-3" />,
        detail:
          Number(model.size_mb) > 0
            ? t("modelSelector.sizeDetail", {
                defaultValue: "Approximate disk size after download.",
              })
            : t("modelHub.chips.internalStorageDetail", {
                defaultValue: "Uses a built-in local runtime.",
              }),
      }
    : null;

  // Capability chips — fact-style differentiators above the divider. Cap at 4.
  const capabilityChips: CompactBadgeItem[] = [
    plainModelBadge,
    ...mergeSizeWithIdentityChips(identityChips, sizeChip),
    languagesSummary
      ? {
          id: "capability-languages",
          label: languagesSummary,
          variant: "secondary" as const,
          icon: <Languages className="h-3 w-3" />,
          detail: languagesDetail,
        }
      : null,
    model.supports_translation
      ? {
          id: "capability-translate",
          label: t("modelSelector.capabilities.translate"),
          variant: "secondary" as const,
          icon: <Languages className="h-3 w-3" />,
          detail: t("modelSelector.translateDetail", {
            defaultValue: "Translates non-English speech to English.",
          }),
        }
      : null,
    isRealtimeModel
      ? {
          id: "capability-realtime",
          label: t("modelHub.chips.realtime", { defaultValue: "Realtime" }),
          variant: "secondary" as const,
          icon: <Clock className="h-3 w-3" />,
          detail: t("modelHub.chips.realtimeDetail", {
            defaultValue:
              "Optimized for lower-latency partial or streaming results.",
          }),
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];

  // Footer chips — runtime context only. Languages live in the capability
  // chip above; the source/runtime row stays factual and short.
  const metadataItems = [
    runtimeLabel,
    licenseLabel,
    sourceLabel ?? sourceHostLabel(sourceUrl),
  ].filter(Boolean) as string[];

  const handleCardClick = () => {
    if (!isClickable || disabled) return;
    onSelect(model.id);
  };

  // Trailing: Download icon (acquire) or Trash (remove) — never both. While
  // the inline confirm row is active we hide the trash icon so the only
  // affordance is the explicit Cancel/Delete pair below.
  let trailing: HubTrailing = null;
  if (status === "downloadable") {
    trailing = {
      kind: "acquire",
      onClick: onDownload ? () => onDownload(model.id) : undefined,
      sizeLabel,
      label: t("modelSelector.downloadModel", {
        modelName: displayName,
        size: sizeLabel,
        defaultValue: `Download ${displayName}`,
      }),
    };
  } else if (
    onDelete &&
    !confirmingDelete &&
    (status === "available" || status === "active")
  ) {
    trailing = {
      kind: "remove",
      onClick: () => setConfirmingDelete(true),
      busy: deleting,
      label: t("modelSelector.deleteModel", { modelName: displayName }),
    };
  }

  const confirmDeleteNode =
    confirmingDelete && onDelete ? (
      <div
        className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-2 text-sm text-[var(--text)]">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
            aria-hidden
          />
          <p className="min-w-0 flex-1 leading-snug">
            {status === "active"
              ? t("modelSelector.deleteActiveConfirm", {
                  modelName: displayName,
                  defaultValue:
                    "Delete {{modelName}}? It is the active model — you'll need to pick another to dictate.",
                })
              : t("modelSelector.deleteConfirm", {
                  modelName: displayName,
                  defaultValue:
                    "Delete {{modelName}}? Files will be removed from disk.",
                })}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={deleting}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setConfirmingDelete(false);
            }}
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={deleting}
            onClick={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              try {
                setDeleting(true);
                await onDelete(model.id);
                setConfirmingDelete(false);
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              t("modelSelector.confirmDelete", {
                defaultValue: "Delete",
              })
            )}
          </Button>
        </div>
      </div>
    ) : null;

  const largeDownloadNotice =
    !confirmDeleteNode &&
    status === "downloadable" &&
    Number(model.size_mb) > 500 ? (
      <div className="rounded-lg border border-[color-mix(in_srgb,var(--warning),transparent_68%)] bg-[var(--warning-soft)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--warning)]">
        {t("modelSelector.largeDownloadWarning", {
          size: sizeLabel,
          defaultValue:
            "Large download: {{size}}. Keep Vox Jot open until install finishes.",
        })}
      </div>
    ) : null;

  const downloadState: HubDownloadState | undefined =
    status === "downloading"
      ? {
          label: t("common.downloading", {
            defaultValue: "Downloading...",
          }),
          detail:
            downloadSpeed !== undefined && downloadSpeed >= 0.05
              ? t("modelSelector.downloadSpeed", {
                  speed: downloadSpeed.toFixed(1),
                })
              : downloadSpeed !== undefined
                ? t("modelSelector.waitingForData", {
                    defaultValue: "Waiting for data...",
                  })
                : metadataItems.join(" · "),
          progress: downloadProgress,
          indeterminate: downloadProgress === undefined,
          onCancel: onCancel ? () => onCancel(model.id) : undefined,
          cancelLabel: t("modelSelector.cancelDownload"),
        }
      : status === "extracting"
        ? {
            label: t("modelSelector.extractingGeneric"),
            detail: metadataItems.join(" · "),
            indeterminate: true,
          }
        : undefined;

  return (
    <HubModelCard
      title={displayName}
      providerId={resolvedProviderId}
      subline={displayProviderLabel ?? undefined}
      headerBadges={headerBadges}
      description={displayDescription}
      capabilityChips={capabilityChips}
      capabilityChipsMaxVisible={capabilityChipsMaxVisible}
      footerMetaItems={metadataItems}
      footerMetaLinks={
        sourceUrl
          ? [
              {
                label: t("modelHub.sourceLink", {
                  defaultValue: "Open model source",
                }),
                url: sourceUrl,
              },
            ]
          : undefined
      }
      footerOverflowLabel={`${displayName} model details`}
      trailing={trailing}
      downloadState={downloadState}
      footerExtra={confirmDeleteNode ?? largeDownloadNotice}
      onClick={isClickable ? handleCardClick : undefined}
      disabled={disabled}
      variant={variant}
      active={status === "active"}
      fillHeight={fillHeight}
      className={className}
    />
  );
};

export default ModelCard;
