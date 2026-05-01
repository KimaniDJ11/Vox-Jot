import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Download,
  Globe,
  Loader2,
  Monitor,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { commands } from "@/bindings";
import Badge from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import {
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import HubModelCard, {
  type HubTrailing,
} from "@/components/model-hub/HubModelCard";
import type { CompactBadgeItem } from "@/components/ui/CompactOverflow";
import { LANGUAGES } from "@/lib/constants/languages";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import { useSettings } from "@/hooks/useSettings";

type RefineModelSourceKind =
  | "ollama"
  | "lm_studio"
  | "hugging_face"
  | "managed_provider";

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
  titleActionTargetId?: string;
  /** When both are set, search is controlled by the parent (e.g. model hub) and the inline search card is hidden. */
  hubSearchQuery?: string;
  onHubSearchQueryChange?: (value: string) => void;
  /** When true, idle filter labels use "Provider" / "Language" (model hub toolbar). */
  hubFilterLabels?: boolean;
};

const RefineModelsSettings: React.FC<RefineModelsSettingsProps> = ({
  titleActionTargetId,
  hubSearchQuery,
  onHubSearchQueryChange,
  hubFilterLabels = false,
}) => {
  const { t } = useTranslation();
  const { refreshSettings } = useSettings();
  const [catalog, setCatalog] = useState<RefineModelCatalog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [localQuery, setLocalQuery] = useState("");
  const useHubSearch =
    hubSearchQuery !== undefined && onHubSearchQueryChange !== undefined;
  const query = useHubSearch ? (hubSearchQuery ?? "") : localQuery;
  const setQuery: (value: string) => void = useHubSearch
    ? (value) => onHubSearchQueryChange?.(value)
    : setLocalQuery;
  const portalTarget = usePortalTarget(titleActionTargetId);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageSearchInputRef = useRef<HTMLInputElement>(null);
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
  const [confirmingDeleteRuntimeId, setConfirmingDeleteRuntimeId] = useState<
    string | null
  >(null);

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

  const loadCatalog = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoading(true);
    }
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
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  /** Keep provider “ready” state fresh without a manual refresh control. */
  useEffect(() => {
    const lastFetchRef = { at: 0 };
    const throttleMs = 4000;
    const runSilent = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFetchRef.at < throttleMs) return;
      lastFetchRef.at = now;
      void loadCatalog({ silent: true });
    };
    document.addEventListener("visibilitychange", runSilent);
    window.addEventListener("focus", runSilent);
    const intervalId = window.setInterval(runSilent, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", runSilent);
      window.removeEventListener("focus", runSilent);
      window.clearInterval(intervalId);
    };
  }, [loadCatalog]);

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

  const filteredLanguages = useMemo(
    () =>
      LANGUAGES.filter(
        (language) =>
          language.value !== "auto" &&
          language.label.toLowerCase().includes(languageSearch.toLowerCase()),
      ),
    [languageSearch],
  );

  const allRefineLanguageLabels = useMemo(
    () =>
      LANGUAGES.filter((language) => language.value !== "auto").map(
        (language) => `${language.value} ${language.label}`,
      ),
    [],
  );

  const refineProviderOptions = useMemo(() => {
    const idle = hubFilterLabels ? "Provider" : "All providers";
    return [
      { value: "all", label: idle },
      ...(catalog?.providers ?? []).map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ];
  }, [catalog?.providers, hubFilterLabels]);

  const idleLanguageLabel = hubFilterLabels ? "Language" : "All languages";
  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return idleLanguageLabel;
    }
    return (
      LANGUAGES.find((language) => language.value === languageFilter)?.label ??
      idleLanguageLabel
    );
  }, [idleLanguageLabel, languageFilter]);
  const hasActiveLanguageFilter = languageFilter !== "all";

  const getProviderFilterId = useCallback((model: RefineModelDescriptor) => {
    if (model.source_kind === "hugging_face") {
      return "huggingface";
    }
    return model.runtime_provider_id;
  }, []);

  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const models = catalog?.models ?? [];
    return models.filter((model) => {
      if (
        providerFilter !== "all" &&
        getProviderFilterId(model) !== providerFilter
      ) {
        return false;
      }

      if (languageFilter !== "all") {
        // Refine models in the hub are general post-processing models, so we
        // treat them as multilingual rather than hiding the language control.
      }

      if (!normalized) {
        return true;
      }

      const providerLabel =
        refineProviderOptions.find(
          (provider) => provider.value === getProviderFilterId(model),
        )?.label ?? "";
      const haystack = [
        model.title,
        model.description,
        model.source_label,
        providerLabel,
        model.runtime_label,
        model.runtime_model_id,
        model.source_repo_id ?? "",
        ...allRefineLanguageLabels,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [
    allRefineLanguageLabels,
    catalog?.models,
    getProviderFilterId,
    languageFilter,
    providerFilter,
    query,
    refineProviderOptions,
  ]);

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
      await loadCatalog({ silent: true });
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

  const handleDeleteRefineModel = async (model: RefineModelDescriptor) => {
    setBusyModelIds((prev) => new Set(prev).add(model.runtime_model_id));
    try {
      const res = await commands.deleteRefineModel(
        model.runtime_provider_id,
        model.runtime_model_id,
      );
      if (res.status === "error") {
        toast.error(res.error);
        return;
      }
      setConfirmingDeleteRuntimeId(null);
      await refreshSettings();
      await loadCatalog({ silent: true });
      toast.success(
        t("settings.refineModels.toast.removed", { title: model.title }),
      );
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
      await loadCatalog({ silent: true });
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
      await loadCatalog({ silent: true });
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

  const getTrailing = (model: RefineModelDescriptor): HubTrailing => {
    const isBusy = busyModelIds.has(model.runtime_model_id);
    const progress = progressMap[model.runtime_model_id];
    const needsOllamaInstall =
      model.runtime_provider_id === "ollama" &&
      ollamaProvider?.installed === false;
    const needsOllamaStart =
      model.runtime_provider_id === "ollama" &&
      ollamaProvider?.installed !== false &&
      ollamaProvider?.running === false;

    if (model.active) return null;

    const showOllamaRemove =
      model.runtime_provider_id === "ollama" &&
      model.installed &&
      !model.active &&
      confirmingDeleteRuntimeId !== model.runtime_model_id;

    if (showOllamaRemove) {
      return {
        kind: "remove",
        onClick: () => setConfirmingDeleteRuntimeId(model.runtime_model_id),
        disabled: isBusy,
        busy: isBusy,
        label: t("settings.refineModels.actions.removeFromOllama", {
          title: model.title,
        }),
      };
    }

    if (model.installed && model.runnable) return null;

    if (model.downloadable) {
      let label: string;
      if (isBusy && progress?.stage === "downloading") {
        label = t("settings.refineModels.actions.downloading", {
          percent: Math.round(progress.percentage ?? 0),
        });
      } else if (isBusy && progress?.stage === "importing") {
        label = t("settings.refineModels.actions.importing");
      } else if (needsOllamaInstall) {
        label = t("settings.refineModels.actions.installOllama");
      } else if (needsOllamaStart) {
        label = t("settings.refineModels.actions.startOllama");
      } else {
        label = t("settings.refineModels.actions.downloadAndUse");
      }
      return {
        kind: "acquire",
        onClick: () => void handleInstall(model),
        disabled: isBusy,
        busy: isBusy,
        label,
      };
    }

    return {
      kind: "acquire",
      onClick: undefined,
      disabled: true,
      label: t("settings.refineModels.actions.unavailable"),
    };
  };

  const handleCardClick = (model: RefineModelDescriptor) => {
    if (busyModelIds.has(model.runtime_model_id)) return;
    if (confirmingDeleteRuntimeId === model.runtime_model_id) return;
    if (model.active) return;
    if (model.installed && model.runnable) {
      void handleUse(model);
      return;
    }
    if (model.downloadable) {
      void handleInstall(model);
    }
  };

  // Top-right reserved for status only — source/runtime now live in the subline.
  const buildHeaderBadges = (
    model: RefineModelDescriptor,
  ): CompactBadgeItem[] => {
    const items: CompactBadgeItem[] = [];
    if (model.active) {
      items.push({
        id: "active",
        label: t("settings.refineModels.badges.active"),
        variant: "primary",
        icon: <Check className="h-3 w-3" />,
        detail: "Currently used to refine dictated text.",
      });
    } else if (model.installed) {
      items.push({
        id: "ready",
        label: t("settings.refineModels.badges.ready"),
        variant: "success",
        detail: "Installed locally — click card to use.",
      });
    } else {
      items.push({
        id: "needs-download",
        label: t("settings.refineModels.badges.needsDownload"),
        variant: "secondary",
        detail: "Click the download icon to fetch this model.",
      });
    }
    return items;
  };

  const buildSubline = (model: RefineModelDescriptor): string => {
    const parts: string[] = [];
    if (model.source_label) parts.push(model.source_label);
    if (
      model.runtime_label &&
      model.runtime_label.toLowerCase() !== model.source_label?.toLowerCase()
    ) {
      parts.push(model.runtime_label);
    }
    return parts.join(" · ");
  };

  const buildMetaItems = (model: RefineModelDescriptor): string[] => {
    const items: string[] = [];
    if (model.runtime_model_id && model.runtime_model_id !== model.title) {
      items.push(model.runtime_model_id);
    }
    if (model.source_repo_id) {
      items.push(model.source_repo_id);
    }
    return items;
  };

  const buildCapabilityChips = (
    model: RefineModelDescriptor,
  ): CompactBadgeItem[] => {
    const haystack =
      `${model.title} ${model.id} ${model.runtime_model_id} ${model.source_repo_id ?? ""}`.toLowerCase();
    const parameterMatch = haystack.match(/(\d+(?:\.\d+)?)\s*([bm])\b/);
    const parameterLabel = parameterMatch
      ? `${parameterMatch[1]}${parameterMatch[2].toUpperCase()}`
      : null;
    const isLocal =
      model.runtime_provider_id === "ollama" ||
      model.runtime_provider_id === "lmstudio" ||
      model.runtime_provider_id === "apple_intelligence" ||
      model.source_kind === "hugging_face";
    const supportsTools =
      haystack.includes("tool") ||
      haystack.includes("json") ||
      haystack.includes("function");

    return [
      {
        id: "capability-deployment",
        label: isLocal
          ? t("modelHub.chips.local", { defaultValue: "Local" })
          : t("modelHub.chips.cloud", { defaultValue: "Cloud" }),
        variant: "secondary" as const,
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
      parameterLabel
        ? {
            id: "capability-family",
            label: parameterLabel,
            variant: "secondary" as const,
            icon: <Brain className="h-3 w-3" />,
            detail: t("modelHub.chips.parameterDetail", {
              defaultValue: "Model family or approximate parameter size.",
            }),
          }
        : null,
      supportsTools
        ? {
            id: "capability-tools",
            label: t("modelHub.chips.toolUse", { defaultValue: "Tool-use" }),
            variant: "secondary" as const,
            icon: <Wrench className="h-3 w-3" />,
            detail: t("modelHub.chips.toolUseDetail", {
              defaultValue: "Tuned or named for structured/tool-style output.",
            }),
          }
        : null,
      model.source_label
        ? {
            id: "capability-source",
            label: model.source_label,
            variant: "secondary" as const,
            icon: <Cpu className="h-3 w-3" />,
            detail: t("modelHub.chips.sourceDetail", {
              defaultValue: "Catalog source for this model.",
            }),
          }
        : null,
    ].filter(Boolean) as CompactBadgeItem[];
  };

  const renderProgressExtra = (
    model: RefineModelDescriptor,
  ): React.ReactNode => {
    const progress = progressMap[model.runtime_model_id];
    if (!progress) return null;

    if (progress.stage === "downloading") {
      return (
        <div>
          <div className="flex items-center gap-2">
            <progress
              value={progress.percentage ?? 0}
              max={100}
              className="h-1.5 flex-1 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-mid-gray/20 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-logo-primary"
            />
            <span className="min-w-fit text-xs tabular-nums text-[var(--muted)]">
              {Math.round(progress.percentage ?? 0)}%
            </span>
          </div>
          <p className="mt-1 text-xs tabular-nums text-[var(--muted)]">
            {formatBytes(progress.downloaded ?? 0)}
            {(progress.total ?? 0) > 0 &&
              ` / ${formatBytes(progress.total ?? 0)}`}
            {(speedMapRef.current[model.runtime_model_id]?.speed ?? 0) > 0 &&
              ` \u2022 ${speedMapRef.current[model.runtime_model_id].speed.toFixed(1)} MB/s`}
          </p>
        </div>
      );
    }

    if (progress.stage === "importing") {
      return (
        <p className="text-xs font-medium text-[var(--accent)]">
          {t("settings.refineModels.actions.installingIntoOllama")}
        </p>
      );
    }

    return null;
  };

  const renderRefineDeleteConfirm = (
    model: RefineModelDescriptor,
  ): React.ReactNode => (
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
          {t("settings.refineModels.actions.confirmRemoveModel", {
            title: model.title,
          })}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirmingDeleteRuntimeId(null)}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={busyModelIds.has(model.runtime_model_id)}
          onClick={() => void handleDeleteRefineModel(model)}
        >
          {busyModelIds.has(model.runtime_model_id) ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            t("modelSelector.confirmDelete")
          )}
        </Button>
      </div>
    </div>
  );

  const filterAction = (
    <div className="flex items-center gap-2">
      <div className="relative inline-flex w-36">
        <select
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          className="min-h-9 w-full appearance-none rounded-full border border-[var(--border)] bg-[var(--card)] py-1.5 pe-9 ps-3 text-xs font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
        >
          {refineProviderOptions.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {provider.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
      </div>

      <div className="relative" ref={languageDropdownRef}>
        <button
          type="button"
          onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
          className={`flex min-h-9 w-36 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
            hasActiveLanguageFilter
              ? "rounded-full bg-logo-primary text-[var(--inverse-text)]"
              : "rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--card),var(--panel-bg)_12%)]"
          }`}
          aria-haspopup="listbox"
          aria-expanded={languageDropdownOpen}
        >
          <Globe className="h-3 w-3" />
          <span className="min-w-0 flex-1 truncate text-left">
            {selectedLanguageLabel}
          </span>
          <ChevronDown
            className={`h-3 w-3 transition-transform ${
              languageDropdownOpen ? "rotate-180" : ""
            }`}
          />
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
                placeholder={t("settings.general.language.searchPlaceholder")}
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
                    ? "bg-logo-primary font-semibold text-[var(--inverse-text)]"
                    : "hover:bg-mid-gray/10"
                }`}
              >
                {idleLanguageLabel}
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
                      ? "bg-logo-primary font-semibold text-[var(--inverse-text)]"
                      : "hover:bg-mid-gray/10"
                  }`}
                >
                  {language.label}
                </button>
              ))}
              {filteredLanguages.length === 0 ? (
                <div className="px-3 py-2 text-center text-sm text-[var(--muted)]">
                  {t("settings.general.language.noResults")}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderSection = (
    title: string,
    description: string,
    models: RefineModelDescriptor[],
    emptyTitle: string,
    emptyDescription: string,
    hideIntro = false,
  ) => (
    <div className="space-y-3">
      {!hideIntro ? (
        <>
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
          {description.trim().length > 0 ? (
            <p className="px-5 text-sm leading-6 text-[var(--muted)]">
              {description}
            </p>
          ) : null}
        </>
      ) : null}
      {models.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-5 py-5 text-sm text-[var(--muted)]">
          <p className="font-semibold text-[var(--text)]">{emptyTitle}</p>
          <p className="mt-1 leading-6">{emptyDescription}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {models.map((model) => {
            const description =
              model.note && model.note.trim().length > 0
                ? `${model.description} — ${model.note}`
                : model.description;
            const isBusy = busyModelIds.has(model.runtime_model_id);
            return (
              <HubModelCard
                key={`${model.runtime_provider_id}::${model.runtime_model_id}`}
                title={model.title}
                providerId={resolveModelProviderId(
                  `${model.title} ${model.runtime_model_id}`,
                  model.runtime_provider_id,
                )}
                subline={buildSubline(model) || undefined}
                headerBadges={buildHeaderBadges(model)}
                description={description}
                capabilityChips={buildCapabilityChips(model)}
                footerMetaItems={buildMetaItems(model)}
                footerMetaIcon={<Cpu className="h-3.5 w-3.5" />}
                footerMetaMaxVisible={3}
                footerOverflowLabel={`${model.title} runtime details`}
                trailing={getTrailing(model)}
                footerExtra={
                  confirmingDeleteRuntimeId === model.runtime_model_id
                    ? renderRefineDeleteConfirm(model)
                    : renderProgressExtra(model)
                }
                onClick={
                  model.active ||
                  isBusy ||
                  confirmingDeleteRuntimeId === model.runtime_model_id
                    ? undefined
                    : () => handleCardClick(model)
                }
                disabled={isBusy}
                active={model.active}
              />
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {portalTarget ? createPortal(filterAction, portalTarget) : null}

      <SettingsGroup noCard>
        <div className="space-y-5">
          {!useHubSearch ? (
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
                    <Badge
                      variant={provider.available ? "success" : "secondary"}
                    >
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
          ) : null}

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

          {!portalTarget ? (
            <div className="flex justify-end">{filterAction}</div>
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
                true,
              )}

              {renderSection(
                t("settings.refineModels.sections.availableToAdd"),
                "",
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

      {!useHubSearch ? (
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
      ) : null}
    </div>
  );
};

export default RefineModelsSettings;
