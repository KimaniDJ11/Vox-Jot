import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Globe, Languages, Loader2 } from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { formatModelSize } from "../../lib/utils/format";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../lib/utils/modelTranslation";
import { Button } from "../ui/Button";
import { type CompactBadgeItem } from "../ui/CompactOverflow";
import HubModelCard, {
  type HubTrailing,
} from "../model-hub/HubModelCard";
import { resolveModelProviderId } from "../ui/ProviderIcon";

const formatLanguageAbbreviation = (language: string): string => {
  const trimmed = language.trim();
  if (!trimmed) return language;
  return trimmed.split(/[-_]/)[0].slice(0, 3).toUpperCase();
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
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  variant = "default",
  status = "downloadable",
  disabled = false,
  className = "",
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
}) => {
  const { t } = useTranslation();
  const isClickable =
    status === "available" || status === "active" || status === "downloadable";

  const displayName = getTranslatedModelName(model, t);
  const displayDescription = getTranslatedModelDescription(model, t);
  const showsScores = model.accuracy_score > 0 || model.speed_score > 0;

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
    providerLabel
      ? {
          id: `provider-${providerLabel}`,
          label: providerLabel,
          variant: "secondary" as const,
          detail: t("modelSelector.providerDetail", {
            defaultValue: "Provider that ships / runs this model.",
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

  const metadataItems = [
    ...model.supported_languages.map(formatLanguageAbbreviation),
    ...(model.supports_translation
      ? [t("modelSelector.capabilities.translate")]
      : []),
    ...(runtimeLabel ? [runtimeLabel] : []),
  ];

  const handleCardClick = () => {
    if (!isClickable || disabled) return;
    if (status === "downloadable" && onDownload) {
      onDownload(model.id);
    } else {
      onSelect(model.id);
    }
  };

  // Trailing: Download icon (acquire) or Trash (remove) — never both.
  let trailing: HubTrailing = null;
  if (status === "downloadable") {
    trailing = {
      kind: "acquire",
      onClick: onDownload ? () => onDownload(model.id) : undefined,
      sizeLabel: formatModelSize(Number(model.size_mb)),
      label: t("modelSelector.downloadModel", {
        modelName: displayName,
        defaultValue: `Download ${displayName}`,
      }),
    };
  } else if (
    onDelete &&
    (status === "available" || status === "active")
  ) {
    trailing = {
      kind: "remove",
      onClick: () => onDelete(model.id),
      label: t("modelSelector.deleteModel", { modelName: displayName }),
    };
  }

  const scoresNode = showsScores ? (
    <div className="grid w-32 gap-1.5">
      <div className="flex items-center gap-2">
        <p className="shrink-0 whitespace-nowrap text-[11px] font-medium text-[var(--muted)]">
          {t("onboarding.modelCard.accuracy")}
        </p>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-mid-gray/20">
          <div
            className="h-full rounded-full bg-logo-primary"
            style={{ width: `${model.accuracy_score * 100}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <p className="shrink-0 whitespace-nowrap text-[11px] font-medium text-[var(--muted)]">
          {t("onboarding.modelCard.speed")}
        </p>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-mid-gray/20">
          <div
            className="h-full rounded-full bg-logo-primary"
            style={{ width: `${model.speed_score * 100}%` }}
          />
        </div>
      </div>
    </div>
  ) : null;

  const progressNode =
    status === "downloading" && downloadProgress !== undefined ? (
      <div className="w-full">
        <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-logo-primary rounded-full transition-all duration-300"
            style={{ width: `${downloadProgress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-[var(--muted)]">
            {t("modelSelector.downloading", {
              percentage: Math.round(downloadProgress),
            })}
          </span>
          <div className="flex items-center gap-2">
            {downloadSpeed !== undefined && downloadSpeed > 0 && (
              <span className="tabular-nums text-[var(--muted)]">
                {t("modelSelector.downloadSpeed", {
                  speed: downloadSpeed.toFixed(1),
                })}
              </span>
            )}
            {onCancel && (
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onCancel(model.id);
                }}
                aria-label={t("modelSelector.cancelDownload")}
              >
                {t("modelSelector.cancel")}
              </Button>
            )}
          </div>
        </div>
      </div>
    ) : status === "extracting" ? (
      <div className="w-full">
        <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
          <div className="h-full bg-logo-primary rounded-full animate-pulse w-full" />
        </div>
        <p className="text-xs text-[var(--muted)] mt-1">
          {t("modelSelector.extractingGeneric")}
        </p>
      </div>
    ) : null;

  const metaIcon =
    model.supported_languages.length > 0 ? (
      <Globe className="h-3.5 w-3.5" />
    ) : model.supports_translation ? (
      <Languages className="h-3.5 w-3.5" />
    ) : null;

  const resolvedProviderId = resolveModelProviderId(
    `${displayName} ${model.id}`,
    providerId,
  );

  return (
    <HubModelCard
      title={displayName}
      providerId={resolvedProviderId}
      headerBadges={headerBadges}
      description={displayDescription}
      secondary={scoresNode}
      footerMetaItems={metadataItems}
      footerMetaIcon={metaIcon}
      footerOverflowLabel={`${displayName} model details`}
      trailing={trailing}
      footerExtra={progressNode}
      onClick={isClickable ? handleCardClick : undefined}
      disabled={disabled}
      variant={variant}
      active={status === "active"}
      className={className}
    />
  );
};

export default ModelCard;
