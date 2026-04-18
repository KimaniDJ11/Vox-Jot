import React from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Download,
  Globe,
  Languages,
  Loader2,
  Trash2,
} from "lucide-react";
import type { ModelInfo } from "@/bindings";
import { formatModelSize } from "../../lib/utils/format";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../lib/utils/modelTranslation";
import { Button } from "../ui/Button";
import {
  CompactBadgeRow,
  CompactMetaRow,
  type CompactBadgeItem,
} from "../ui/CompactOverflow";
import { ProviderIcon } from "../ui/ProviderIcon";

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
  const isFeatured = variant === "featured";
  const isClickable =
    status === "available" || status === "active" || status === "downloadable";

  // Get translated model name and description
  const displayName = getTranslatedModelName(model, t);
  const displayDescription = getTranslatedModelDescription(model, t);
  const showsScores = model.accuracy_score > 0 || model.speed_score > 0;
  const headerBadges: CompactBadgeItem[] = [
    showRecommended && model.is_recommended
      ? {
          id: "recommended",
          label: t("onboarding.recommended"),
          variant: "primary" as const,
        }
      : null,
    status === "active"
      ? {
          id: "active",
          label: t("modelSelector.active"),
          variant: "primary" as const,
          icon: <Check className="h-3 w-3" />,
        }
      : null,
    model.is_custom
      ? {
          id: "custom",
          label: t("modelSelector.custom"),
          variant: "secondary" as const,
        }
      : null,
    providerLabel
      ? {
          id: `provider-${providerLabel}`,
          label: providerLabel,
          variant: "secondary" as const,
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

  const baseClasses =
    "flex h-full min-w-0 flex-col gap-3 rounded-xl px-4 py-3 text-left transition-all duration-200";

  const getVariantClasses = () => {
    if (isFeatured) {
      return "border-2 border-logo-primary/25 bg-logo-primary/5 shadow-[var(--shadow-sm)]";
    }
    return "border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]";
  };

  const getInteractiveClasses = () => {
    if (!isClickable) return "";
    if (disabled) return "opacity-50 cursor-not-allowed";
    return "cursor-pointer hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-md group";
  };

  const handleClick = () => {
    if (!isClickable || disabled) return;
    if (status === "downloadable" && onDownload) {
      onDownload(model.id);
    } else {
      onSelect(model.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(model.id);
  };

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && isClickable) handleClick();
      }}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      className={[
        baseClasses,
        getVariantClasses(),
        getInteractiveClasses(),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {providerId && <ProviderIcon providerId={providerId} size="sm" />}
            <h3
              className={`min-w-0 flex-1 truncate text-base font-semibold text-text ${isClickable ? "group-hover:text-[var(--accent)]" : ""} transition-colors`}
              title={displayName}
            >
              {displayName}
            </h3>
            <CompactBadgeRow
              items={headerBadges}
              maxVisible={2}
              overflowLabel={`${displayName} badges`}
            />
          </div>
          <p
            className="mt-2 truncate text-sm text-[var(--muted)]"
            title={displayDescription}
          >
            {displayDescription}
          </p>
        </div>
        {showsScores && (
          <div className="grid shrink-0 gap-2 sm:w-32">
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
        )}
      </div>

      <div className="w-full border-t border-mid-gray/20 pt-3">
        <div className="flex w-full items-center gap-2">
          <CompactMetaRow
            items={metadataItems}
            maxVisible={3}
            icon={
              model.supported_languages.length > 0 ? (
                <Globe className="h-3.5 w-3.5" />
              ) : model.supports_translation ? (
                <Languages className="h-3.5 w-3.5" />
              ) : null
            }
            overflowLabel={`${displayName} model details`}
            className="flex-1"
          />
          {status === "downloadable" && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <Download className="w-3.5 h-3.5" />
              <span>{formatModelSize(Number(model.size_mb))}</span>
            </span>
          )}
          {onDelete && (status === "available" || status === "active") && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDelete}
              title={t("modelSelector.deleteModel", { modelName: displayName })}
              aria-label={t("modelSelector.deleteModel", {
                modelName: displayName,
              })}
              className="ml-auto text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      {/* Download/extract progress */}
      {status === "downloading" && downloadProgress !== undefined && (
        <div className="w-full mt-3">
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
      )}
      {status === "extracting" && (
        <div className="w-full mt-3">
          <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
            <div className="h-full bg-logo-primary rounded-full animate-pulse w-full" />
          </div>
          <p className="text-xs text-[var(--muted)] mt-1">
            {t("modelSelector.extractingGeneric")}
          </p>
        </div>
      )}
    </div>
  );
};

export default ModelCard;
