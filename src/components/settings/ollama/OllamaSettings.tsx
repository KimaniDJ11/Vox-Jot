import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CheckCircle2, Download, Trash2 } from "lucide-react";
import { useOllamaStore } from "../../../stores/ollamaStore";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "../../ui/Button";
import {
  CompactBadgeRow,
  type CompactBadgeItem,
} from "../../ui/CompactOverflow";

const splitDescription = (
  description: string,
): { summary: string; size: string } => {
  const parts = description.split("—").map((part) => part.trim());
  if (parts.length < 2) {
    return { summary: description, size: "" };
  }
  return {
    size: parts[0],
    summary: parts.slice(1).join(" — "),
  };
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const parseParamsB = (modelId: string, label: string): number | null => {
  const combined = `${modelId} ${label}`.toLowerCase();
  const match = combined.match(/(\d+(?:\.\d+)?)\s*([bm])/i);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return unit === "m" ? value / 1000 : value;
};

const estimateScores = (modelId: string, label: string) => {
  const paramsB = parseParamsB(modelId, label);
  if (!paramsB) {
    return { quality: 0.55, speed: 0.55 };
  }

  // Heuristic only: larger tiny models trend higher quality, smaller trend faster.
  const normalized = clamp(paramsB / 6, 0, 1);
  const quality = clamp(0.28 + normalized * 0.68, 0.22, 0.96);
  const speed = clamp(0.94 - normalized * 0.7, 0.2, 0.96);
  return { quality, speed };
};

const OllamaSettings: React.FC = () => {
  const { t } = useTranslation();
  const [actionError, setActionError] = useState<string | null>(null);
  const { getSetting, setPostProcessProvider, updatePostProcessModel } =
    useSettings();
  const {
    status,
    isChecking,
    isInstalling,
    recommendedModels,
    installedModels,
    pullProgress,
    pullingModels,
    checkStatus,
    installOllama,
    pullModel,
    deleteModel,
    loadRecommendedModels,
    startServe,
  } = useOllamaStore();

  useEffect(() => {
    checkStatus().then(() => loadRecommendedModels());
  }, [checkStatus, loadRecommendedModels]);

  const isInstalled = status?.installed ?? false;
  const isRunning = status?.running ?? false;
  const selectedProviderId = getSetting("post_process_provider_id") || "";
  const selectedOllamaModel =
    getSetting("post_process_models")?.["ollama"] || "";
  const isInstalledModel = (modelId: string) =>
    installedModels.some((installed) => installed === modelId);

  const downloadedModels = recommendedModels.filter((model) =>
    isInstalledModel(model.id),
  );

  const availableModels = recommendedModels.filter(
    (model) => !isInstalledModel(model.id),
  );

  const handlePullModel = async (modelId: string) => {
    setActionError(null);
    const ok = await pullModel(modelId);
    if (!ok) {
      setActionError(t("ollama.pullError"));
    }
  };

  const isModelActive = (modelId: string) => {
    if (selectedProviderId !== "ollama") {
      return false;
    }
    return selectedOllamaModel === modelId;
  };
  const activeRefineModel =
    recommendedModels.find((model) => isModelActive(model.id)) ?? null;

  const handleActivateModel = async (modelId: string) => {
    setActionError(null);
    try {
      await setPostProcessProvider("ollama");
      await updatePostProcessModel("ollama", modelId);
    } catch (error) {
      console.error("Failed to activate Ollama model:", error);
      setActionError(t("ollama.activateError"));
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="px-5">
        {!isInstalled ? (
          <div className="flex flex-wrap items-center justify-between gap-3 py-1">
            <p className="text-sm text-[var(--text)]">
              {t("ollama.notInstalled")}
            </p>
            <button
              type="button"
              onClick={installOllama}
              disabled={isInstalling}
              className="px-4 py-2 rounded-full text-sm font-semibold bg-logo-primary text-[var(--inverse-text)] hover:bg-logo-primary/90 disabled:opacity-50 transition-colors"
            >
              {isInstalling ? t("ollama.installing") : t("ollama.install")}
            </button>
          </div>
        ) : !isRunning ? (
          <div className="flex flex-wrap items-center justify-between gap-3 py-1">
            <p className="text-sm text-[var(--text)]">
              {t("ollama.notRunning")}
            </p>
            <button
              type="button"
              onClick={startServe}
              disabled={isChecking}
              className="px-4 py-2 rounded-full text-sm font-semibold bg-logo-primary text-[var(--inverse-text)] hover:bg-logo-primary/90 disabled:opacity-50 transition-colors"
            >
              {isChecking ? t("ollama.checking") : t("ollama.start")}
            </button>
          </div>
        ) : (
          <div className="flex items-center py-1 md:hidden">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="p-1.5 text-[var(--success)] hover:!text-[var(--success)]"
              title={t("ollama.ready")}
              aria-label={t("ollama.ready")}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {/* Model Management */}
      {isInstalled && isRunning && (
        <div className="w-full space-y-6">
          {activeRefineModel ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[var(--shadow-sm)]">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                {t("ollama.activeRefineModel")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-lg font-bold text-[var(--text)]">
                  {activeRefineModel.label}
                </p>
                <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
                  {t("ollama.ollamaBadge")}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {splitDescription(activeRefineModel.description).summary}
              </p>
              <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
                {t("ollama.localOllamaModel")}
              </p>
            </div>
          ) : null}

          {actionError && (
            <div className="rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
              {actionError}
            </div>
          )}
          <div className="space-y-3">
            <h4 className="px-5 text-sm font-bold uppercase tracking-widest text-[var(--text)]">
              {t("ollama.downloadedModels")}
            </h4>
            {downloadedModels.length === 0 ? (
              <div className="rounded-xl border-2 border-mid-gray/20 px-4 py-3 text-sm text-[var(--muted)]">
                {t("ollama.noDownloaded")}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {downloadedModels.map((model) => {
                  const progress = pullProgress[model.id] ?? 0;
                  const isPulling = pullingModels.has(model.id);
                  const details = splitDescription(model.description);
                  const score = estimateScores(model.id, model.label);
                  const isActive = isModelActive(model.id);
                  const headerBadges: CompactBadgeItem[] = [
                    {
                      id: isActive ? "active" : "downloaded",
                      label: isActive
                        ? t("common.active")
                        : t("common.downloaded"),
                      variant: isActive ? "primary" : "secondary",
                      icon: <Check className="h-3 w-3" />,
                    },
                  ];

                  return (
                    <div
                      key={model.id}
                      className={`flex h-full min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-left shadow-[var(--shadow-sm)] transition-all duration-200 ${
                        !isActive
                          ? "cursor-pointer hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-md group"
                          : ""
                      }`}
                    >
                      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <h3
                              className="min-w-0 flex-1 truncate text-base font-semibold text-text transition-colors group-hover:text-[var(--accent)]"
                              title={model.label}
                            >
                              {model.label}
                            </h3>
                            <CompactBadgeRow
                              items={headerBadges}
                              maxVisible={1}
                              overflowLabel={`${model.label} badges`}
                            />
                          </div>
                          <p
                            className="mt-2 truncate text-sm text-[var(--muted)]"
                            title={details.summary}
                          >
                            {details.summary}
                          </p>
                        </div>
                        <div className="grid shrink-0 gap-2 sm:w-32">
                          <div className="flex items-center gap-2">
                            <p className="shrink-0 whitespace-nowrap text-[11px] font-medium text-[var(--muted)]">
                              {t("ollama.quality")}
                            </p>
                            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-mid-gray/20">
                              <div
                                className="h-full rounded-full bg-logo-primary"
                                style={{ width: `${score.quality * 100}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="shrink-0 whitespace-nowrap text-[11px] font-medium text-[var(--muted)]">
                              {t("ollama.speed")}
                            </p>
                            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-mid-gray/20">
                              <div
                                className="h-full rounded-full bg-logo-primary"
                                style={{ width: `${score.speed * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="w-full border-t border-mid-gray/20 pt-3">
                        <div className="flex w-full flex-wrap items-center gap-2">
                          <span className="text-xs text-[var(--muted)]">
                            {t("ollama.localModel")}
                          </span>
                          {details.size ? (
                            <span className="text-xs text-[var(--muted)]">
                              {details.size}
                            </span>
                          ) : null}
                          {!isActive && (
                            <button
                              onClick={() => handleActivateModel(model.id)}
                              className="rounded-md px-2 py-0.5 text-[var(--text)] transition-colors hover:bg-logo-primary/10 hover:text-[var(--accent)]"
                            >
                              <span>{t("ollama.setActive")}</span>
                            </button>
                          )}
                          <button
                            onClick={() => deleteModel(model.id)}
                            title={t("common.delete")}
                            aria-label={t("common.delete")}
                            className="ml-auto inline-flex h-8 w-8 items-center justify-center p-0 text-[var(--accent)] transition-colors hover:bg-logo-primary/10 hover:text-[var(--accent)]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isPulling && (
                        <div className="w-full">
                          <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-logo-primary rounded-full transition-all duration-300"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <p className="text-xs text-[var(--muted)] mt-1">
                            {t("ollama.pulling", {
                              progress: Math.round(progress),
                            })}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="px-5 text-sm font-bold uppercase tracking-widest text-[var(--text)]">
              {t("ollama.availableModels")}
            </h4>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {availableModels.map((model) => {
                const isPulling = pullingModels.has(model.id);
                const progress = pullProgress[model.id] ?? 0;
                const details = splitDescription(model.description);
                const score = estimateScores(model.id, model.label);

                return (
                  <div
                    key={model.id}
                    className="flex h-full min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-left shadow-[var(--shadow-sm)] transition-all duration-200 cursor-pointer hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-md group"
                  >
                    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3
                            className="min-w-0 flex-1 truncate text-base font-semibold text-text transition-colors group-hover:text-[var(--accent)]"
                            title={model.label}
                          >
                            {model.label}
                          </h3>
                        </div>
                        <p
                          className="mt-2 truncate text-sm text-[var(--muted)]"
                          title={details.summary}
                        >
                          {details.summary}
                        </p>
                      </div>
                      <div className="grid shrink-0 gap-2 sm:w-32">
                        <div className="flex items-center gap-2">
                          <p className="shrink-0 whitespace-nowrap text-[11px] font-medium text-[var(--muted)]">
                            {t("ollama.quality")}
                          </p>
                          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-mid-gray/20">
                            <div
                              className="h-full rounded-full bg-logo-primary"
                              style={{ width: `${score.quality * 100}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="shrink-0 whitespace-nowrap text-[11px] font-medium text-[var(--muted)]">
                            {t("ollama.speed")}
                          </p>
                          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-mid-gray/20">
                            <div
                              className="h-full rounded-full bg-logo-primary"
                              style={{ width: `${score.speed * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-full border-t border-mid-gray/20 pt-3">
                      <div className="flex w-full flex-wrap items-center gap-2">
                        {details.size ? (
                          <span className="text-xs text-[var(--muted)]">
                            {details.size}
                          </span>
                        ) : null}
                        {isPulling ? (
                          <span className="ml-auto text-xs text-[var(--muted)]">
                            {t("ollama.pulling", {
                              progress: Math.round(progress),
                            })}
                          </span>
                        ) : (
                          <button
                            onClick={() => handlePullModel(model.id)}
                            disabled={pullingModels.size > 0}
                            title={t("ollama.download")}
                            aria-label={t("ollama.download")}
                            className="ml-auto inline-flex h-8 w-8 items-center justify-center p-0 text-[var(--text)] transition-colors hover:bg-logo-primary/10 hover:text-[var(--accent)] disabled:opacity-50"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {isPulling && (
                      <div className="w-full">
                        <div className="w-full h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-logo-primary rounded-full transition-all duration-300"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OllamaSettings;
