import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Cpu, Download, RefreshCcw, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import Badge from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { ProviderIcon } from "@/components/ui/ProviderIcon";
import { useSettings } from "@/hooks/useSettings";

type RefineModelSourceKind = "ollama" | "lm_studio" | "hugging_face";

type RefineProviderStatus = {
  id: string;
  label: string;
  available: boolean;
  local_only: boolean;
  installed: boolean;
  running: boolean;
  detail: string;
};

type RefineModelDescriptor = {
  id: string;
  title: string;
  description: string;
  source_kind: RefineModelSourceKind;
  source_label: string;
  runtime_provider_id: string;
  runtime_model_id: string;
  runtime_label: string;
  installed: boolean;
  active: boolean;
  runnable: boolean;
  downloadable: boolean;
  source_repo_id?: string | null;
  source_file_name?: string | null;
  source_url?: string | null;
  note?: string | null;
};

type RefineModelCatalog = {
  providers: RefineProviderStatus[];
  models: RefineModelDescriptor[];
};

const sanitizeModelId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const defaultModelIdFromRepo = (repoId: string): string =>
  sanitizeModelId(repoId.split("/").pop() || repoId);

type RefineDownloadProgress = {
  model_id: string;
  downloaded?: number;
  total?: number;
  percentage?: number;
  stage: "downloading" | "importing" | "complete" | "failed";
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

type RefineModelsSettingsProps = {
  /** When both are set, search is controlled by the parent (e.g. model hub) and the inline search card is hidden. */
  hubSearchQuery?: string;
  onHubSearchQueryChange?: (value: string) => void;
};

const RefineModelsSettings: React.FC<RefineModelsSettingsProps> = ({
  hubSearchQuery,
  onHubSearchQueryChange,
}) => {
  const { t } = useTranslation();
  const { refreshSettings } = useSettings();
  const [catalog, setCatalog] = useState<RefineModelCatalog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localQuery, setLocalQuery] = useState("");
  const useHubSearch =
    hubSearchQuery !== undefined && onHubSearchQueryChange !== undefined;
  const query = useHubSearch ? (hubSearchQuery ?? "") : localQuery;
  const setQuery: (value: string) => void = useHubSearch
    ? (value) => onHubSearchQueryChange?.(value)
    : setLocalQuery;
  const [busyModelIds, setBusyModelIds] = useState<Set<string>>(new Set());
  const [progressMap, setProgressMap] = useState<
    Record<string, RefineDownloadProgress>
  >({});
  const speedMapRef = useRef<
    Record<string, { lastBytes: number; lastTime: number; speed: number }>
  >({});
  const [customRepoId, setCustomRepoId] = useState("");
  const [customFileName, setCustomFileName] = useState("");
  const [customModelId, setCustomModelId] = useState("");
  const [customBusy, setCustomBusy] = useState(false);

  const onProgressEvent = useCallback(
    (event: { payload: RefineDownloadProgress }) => {
      const p = event.payload;
      const key = p.model_id;
      if (p.stage === "complete" || p.stage === "failed") {
        setProgressMap((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setBusyModelIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        delete speedMapRef.current[key];
        return;
      }
      const now = Date.now();
      const prev = speedMapRef.current[key] ?? {
        lastBytes: 0,
        lastTime: 0,
        speed: 0,
      };
      const dt = (now - prev.lastTime) / 1000;
      if (dt > 0.1 && prev.lastTime > 0) {
        const db = (p.downloaded ?? 0) - prev.lastBytes;
        speedMapRef.current[key] = {
          lastBytes: p.downloaded ?? 0,
          lastTime: now,
          speed: db / dt / (1024 * 1024),
        };
      } else if (prev.lastTime === 0) {
        speedMapRef.current[key] = {
          lastBytes: p.downloaded ?? 0,
          lastTime: now,
          speed: 0,
        };
      }
      setProgressMap((prev) => ({ ...prev, [key]: p }));
    },
    [],
  );

  const onOllamaPullEvent = useCallback(
    (event: {
      payload: {
        model: string;
        status: string;
        percent: number;
        total?: number;
        completed?: number;
      };
    }) => {
      const p = event.payload;
      const key = p.model;
      if (p.status === "success") {
        onProgressEvent({
          payload: { model_id: key, stage: "complete" },
        });
        return;
      }
      const stage =
        p.status === "starting"
          ? "downloading"
          : p.status.startsWith("pulling")
            ? "downloading"
            : "importing";
      onProgressEvent({
        payload: {
          model_id: key,
          downloaded: p.completed ?? 0,
          total: p.total ?? 0,
          percentage: p.percent ?? 0,
          stage,
        },
      });
    },
    [onProgressEvent],
  );

  useEffect(() => {
    const u1 = listen<RefineDownloadProgress>(
      "refine-download-progress",
      onProgressEvent,
    );
    const u2 = listen("ollama-pull-progress", onOllamaPullEvent);
    return () => {
      void u1.then((fn) => fn());
      void u2.then((fn) => fn());
    };
  }, [onProgressEvent, onOllamaPullEvent]);

  useEffect(() => {
    invoke<string[]>("get_active_refine_installs")
      .then((activeModelIds) => {
        if (activeModelIds.length > 0) {
          setBusyModelIds((prev) => {
            const next = new Set(prev);
            for (const mid of activeModelIds) next.add(mid);
            return next;
          });
        }
      })
      .catch(() => {});
  }, []);

  const loadCatalog = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextCatalog = await invoke<RefineModelCatalog>(
        "get_refine_model_catalog",
      );
      setCatalog(nextCatalog);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load refine models.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const models = catalog?.models ?? [];
    if (!normalized) return models;
    return models.filter((model) => {
      const haystack = [
        model.title,
        model.description,
        model.source_label,
        model.runtime_label,
        model.runtime_model_id,
        model.source_repo_id ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [catalog?.models, query]);

  const activeModels = filteredModels.filter((model) => model.active);
  const readyModels = filteredModels.filter(
    (model) => !model.active && model.installed,
  );
  const downloadableModels = filteredModels.filter((model) => !model.installed);
  const ollamaProvider = useMemo(
    () =>
      catalog?.providers.find((provider) => provider.id === "ollama") ?? null,
    [catalog?.providers],
  );

  const ensureOllamaReady = async (): Promise<void> => {
    if (ollamaProvider?.installed === false) {
      await invoke("install_ollama");
      return;
    }

    if (ollamaProvider?.running === false) {
      await invoke("start_ollama_serve");
    }
  };

  const handleUse = async (model: RefineModelDescriptor) => {
    setBusyModelIds((prev) => new Set(prev).add(model.runtime_model_id));
    try {
      await invoke("set_refine_model_selection", {
        providerId: model.runtime_provider_id,
        modelId: model.runtime_model_id,
      });
      await refreshSettings();
      await loadCatalog();
      toast.success(
        t("settings.refineModels.toast.activated", { title: model.title }),
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("settings.refineModels.toast.activateError");
      toast.error(message);
    } finally {
      setBusyModelIds((prev) => {
        const next = new Set(prev);
        next.delete(model.runtime_model_id);
        return next;
      });
    }
  };

  const handleInstall = async (model: RefineModelDescriptor) => {
    setBusyModelIds((prev) => new Set(prev).add(model.runtime_model_id));
    try {
      if (model.runtime_provider_id === "ollama") {
        await ensureOllamaReady();
      }
      await invoke("install_refine_model", {
        providerId: model.runtime_provider_id,
        modelId: model.runtime_model_id,
        sourceRepoId: model.source_repo_id ?? null,
        sourceFileName: model.source_file_name ?? null,
      });
      await refreshSettings();
      await loadCatalog();
      toast.success(
        t("settings.refineModels.toast.installed", { title: model.title }),
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("settings.refineModels.toast.installError");
      toast.error(message);
    } finally {
      setBusyModelIds((prev) => {
        const next = new Set(prev);
        next.delete(model.runtime_model_id);
        return next;
      });
    }
  };

  const handleCustomImport = async () => {
    const repoId = customRepoId.trim();
    if (!repoId) {
      toast.error(t("settings.refineModels.toast.enterRepo"));
      return;
    }

    const modelId =
      sanitizeModelId(customModelId) || defaultModelIdFromRepo(repoId);
    setCustomBusy(true);
    try {
      await ensureOllamaReady();
      await invoke("install_refine_model", {
        providerId: "ollama",
        modelId,
        sourceRepoId: repoId,
        sourceFileName: customFileName.trim() || null,
      });
      await refreshSettings();
      await loadCatalog();
      setCustomFileName("");
      setCustomModelId(modelId);
      toast.success(
        t("settings.refineModels.toast.importSuccess", { modelId }),
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to import Hugging Face GGUF.";
      toast.error(message);
    } finally {
      setCustomBusy(false);
    }
  };

  const renderAction = (model: RefineModelDescriptor) => {
    const isBusy = busyModelIds.has(model.runtime_model_id);
    const progress = progressMap[model.runtime_model_id];
    const needsOllamaInstall =
      model.runtime_provider_id === "ollama" &&
      ollamaProvider?.installed === false;
    const needsOllamaStart =
      model.runtime_provider_id === "ollama" &&
      ollamaProvider?.installed !== false &&
      ollamaProvider?.running === false;
    if (model.active) {
      return (
        <Button
          size="sm"
          variant="primary-soft"
          disabled
          className="disabled:cursor-default"
        >
          {t("settings.refineModels.actions.active")}
        </Button>
      );
    }

    if (model.installed && model.runnable) {
      return (
        <Button
          size="sm"
          variant="primary"
          onClick={() => void handleUse(model)}
          disabled={isBusy}
          className="disabled:cursor-default"
        >
          {isBusy
            ? t("settings.refineModels.actions.switching")
            : t("settings.refineModels.actions.use")}
        </Button>
      );
    }

    if (model.downloadable) {
      let busyLabel = t("settings.refineModels.actions.preparing");
      if (progress) {
        if (progress.stage === "downloading") {
          const pct = Math.round(progress.percentage ?? 0);
          busyLabel = t("settings.refineModels.actions.downloading", {
            percent: pct,
          });
        } else if (progress.stage === "importing") {
          busyLabel = t("settings.refineModels.actions.importing");
        }
      }
      return (
        <Button
          size="sm"
          variant="primary"
          onClick={() => void handleInstall(model)}
          disabled={isBusy}
          className="disabled:cursor-default"
        >
          {isBusy
            ? busyLabel
            : needsOllamaInstall
              ? t("settings.refineModels.actions.installOllama")
              : needsOllamaStart
                ? t("settings.refineModels.actions.startOllama")
                : t("settings.refineModels.actions.downloadAndUse")}
        </Button>
      );
    }

    return (
      <Button
        size="sm"
        variant="ghost"
        disabled
        className="disabled:cursor-default"
      >
        {t("settings.refineModels.actions.unavailable")}
      </Button>
    );
  };

  const renderSection = (
    title: string,
    description: string,
    models: RefineModelDescriptor[],
    emptyTitle: string,
    emptyDescription: string,
  ) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-5">
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text)]">
          {title}
        </h2>
        <Badge
          variant="secondary"
          className="bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]"
        >
          {models.length}
        </Badge>
      </div>
      <p className="px-5 text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
      {models.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-5 py-5 text-sm text-[var(--muted)]">
          <p className="font-semibold text-[var(--text)]">{emptyTitle}</p>
          <p className="mt-1 leading-6">{emptyDescription}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {models.map((model) => (
            <article
              key={model.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <ProviderIcon
                      providerId={model.runtime_provider_id}
                      size="sm"
                    />
                    <h3 className="min-w-0 truncate text-base font-semibold leading-6 text-[var(--text)]">
                      {model.title}
                    </h3>
                  </div>
                  {model.runtime_model_id !== model.title && (
                    <p className="mt-1 break-all font-mono text-xs text-[var(--muted)]">
                      {model.runtime_model_id}
                    </p>
                  )}
                </div>
                {renderAction(model)}
              </div>

              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                {model.description}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="secondary">{model.source_label}</Badge>
                <Badge variant="secondary">{model.runtime_label}</Badge>
                {model.installed ? (
                  <Badge variant={model.active ? "primary" : "success"}>
                    {model.active
                      ? t("settings.refineModels.badges.active")
                      : t("settings.refineModels.badges.ready")}
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    {t("settings.refineModels.badges.needsDownload")}
                  </Badge>
                )}
              </div>

              {progressMap[model.runtime_model_id]?.stage === "downloading" && (
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <progress
                      value={
                        progressMap[model.runtime_model_id].percentage ?? 0
                      }
                      max={100}
                      className="h-1.5 flex-1 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-mid-gray/20 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-logo-primary"
                    />
                    <span className="min-w-fit text-xs tabular-nums text-[var(--muted)]">
                      {Math.round(
                        progressMap[model.runtime_model_id].percentage ?? 0,
                      )}
                      %
                    </span>
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-[var(--muted)]">
                    {formatBytes(
                      progressMap[model.runtime_model_id].downloaded ?? 0,
                    )}
                    {(progressMap[model.runtime_model_id].total ?? 0) > 0 &&
                      ` / ${formatBytes(progressMap[model.runtime_model_id].total ?? 0)}`}
                    {(speedMapRef.current[model.runtime_model_id]?.speed ?? 0) >
                      0 &&
                      ` \u2022 ${speedMapRef.current[model.runtime_model_id].speed.toFixed(1)} MB/s`}
                  </p>
                </div>
              )}

              {progressMap[model.runtime_model_id]?.stage === "importing" && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-[var(--accent)]">
                    {t("settings.refineModels.actions.installingIntoOllama")}
                  </p>
                </div>
              )}

              {model.note && (
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  {model.note}
                </p>
              )}

              {model.source_repo_id && (
                <p className="mt-2 break-all text-xs leading-5 text-[var(--muted)]">
                  {t("settings.refineModels.source", {
                    repoId: model.source_repo_id,
                  })}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <SettingsGroup
        title={t("settings.refineModels.title")}
        description={t("settings.refineModels.description")}
        titleAction={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadCatalog()}
            disabled={isLoading || customBusy || busyModelIds.size > 0}
          >
            <RefreshCcw className="mr-1 h-3.5 w-3.5" />
            {t("settings.refineModels.refresh")}
          </Button>
        }
      >
        <div className="space-y-5 px-5 py-5">
          <div className="grid gap-3 md:grid-cols-3">
            {(catalog?.providers ?? []).map((provider) => (
              <div
                key={provider.id}
                className={`rounded-2xl border px-4 py-4 ${
                  provider.available
                    ? "border-[var(--success)]/25 bg-[var(--success-soft)]/40"
                    : "border-[var(--border)] bg-[var(--panel-bg)]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <ProviderIcon providerId={provider.id} size="sm" />
                    <p className="truncate text-sm font-semibold text-[var(--text)]">
                      {provider.label}
                    </p>
                  </div>
                  <Badge variant={provider.available ? "success" : "secondary"}>
                    {provider.available
                      ? t("settings.refineModels.badges.ready")
                      : t("settings.refineModels.badges.needsSetup")}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {provider.detail}
                </p>
              </div>
            ))}
          </div>

          {!useHubSearch ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Search className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--text)]">
                    {t("settings.refineModels.search.title")}
                  </p>
                  <p className="text-xs leading-5 text-[var(--muted)]">
                    {t("settings.refineModels.search.description")}
                  </p>
                </div>
              </div>
              <Input
                className="mt-3 w-full"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("settings.refineModels.search.placeholder")}
              />
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-5 py-8 text-sm text-[var(--muted)]">
              {t("settings.refineModels.loading")}
            </div>
          ) : (
            <div className="space-y-6">
              {renderSection(
                t("settings.refineModels.sections.readyNow"),
                t("settings.refineModels.sections.readyNowDescription"),
                [...activeModels, ...readyModels],
                t("settings.refineModels.sections.readyNowEmpty"),
                t("settings.refineModels.sections.readyNowEmptyDescription"),
              )}

              {renderSection(
                t("settings.refineModels.sections.availableToAdd"),
                t("settings.refineModels.sections.availableToAddDescription"),
                downloadableModels,
                t("settings.refineModels.sections.availableToAddEmpty"),
                t(
                  "settings.refineModels.sections.availableToAddEmptyDescription",
                ),
              )}
            </div>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.refineModels.customImport.title")}
        description={t("settings.refineModels.customImport.description")}
      >
        <div className="space-y-4 px-5 py-5">
          <div className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-4">
            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--text)]">
                {t("settings.refineModels.customImport.importDescription")}
              </p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {t("settings.refineModels.customImport.importHint")}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                {t("settings.refineModels.customImport.repoLabel")}
              </label>
              <Input
                value={customRepoId}
                onChange={(event) => {
                  const nextRepo = event.target.value;
                  setCustomRepoId(nextRepo);
                  if (!customModelId.trim()) {
                    setCustomModelId(defaultModelIdFromRepo(nextRepo));
                  }
                }}
                placeholder={t(
                  "settings.refineModels.customImport.repoPlaceholder",
                )}
                disabled={customBusy}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                {t("settings.refineModels.customImport.modelNameLabel")}
              </label>
              <Input
                value={customModelId}
                onChange={(event) => setCustomModelId(event.target.value)}
                placeholder={t(
                  "settings.refineModels.customImport.modelNamePlaceholder",
                )}
                disabled={customBusy}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                {t("settings.refineModels.customImport.fileLabel")}
              </label>
              <Input
                value={customFileName}
                onChange={(event) => setCustomFileName(event.target.value)}
                placeholder={t(
                  "settings.refineModels.customImport.filePlaceholder",
                )}
                disabled={customBusy}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text)]">
                  {t("settings.refineModels.customImport.runtimeTarget")}
                </p>
                <p className="text-sm leading-6 text-[var(--muted)]">
                  {t("settings.refineModels.customImport.runtimeDescription")}
                </p>
              </div>
            </div>

            <Button
              onClick={() => void handleCustomImport()}
              disabled={customBusy}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {customBusy
                ? t("settings.refineModels.customImport.importingCustom")
                : t("settings.refineModels.customImport.importAndUse")}
            </Button>
          </div>
        </div>
      </SettingsGroup>
    </div>
  );
};

export default RefineModelsSettings;
