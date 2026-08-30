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
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertTriangle,
  Check,
  Cloud,
  Cpu,
  Download,
  ExternalLink,
  Gauge,
  HardDrive,
  KeyRound,
  Loader2,
  Search,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { commands } from "@/bindings";
import Badge from "@/components/ui/Badge";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import {
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import HubModelCard, {
  type HubDownloadState,
  type HubTrailing,
} from "@/components/model-hub/HubModelCard";
import { downloadingModelFilesLabel } from "@/components/model-hub/downloadStatusLabels";
import {
  buildModelIdentityChips,
  inferArchitectureLabel,
  inferParameterClass,
  inferRuntimeFormat,
  mergeSizeWithIdentityChips,
} from "@/components/model-hub/modelIdentityChips";
import ModelListControls from "@/components/model-hub/ModelListControls";
import type { ModelHubControlState } from "@/components/model-hub/modelHubControls";
import type { CompactBadgeItem } from "@/components/ui/CompactOverflow";
import { handleDialogKeyDown, useDialogFocusTrap } from "@/lib/ui/focusTrap";
import { PROVIDER_API_KEY_URLS } from "@/components/settings/PostProcessingSettingsApi/providerKeyUrls";
import {
  getLlmEvaluationResult,
  LLM_EVALUATION_RESULTS,
  LLM_EVALUATION_RUN,
  type LlmEvaluationResult,
} from "@/lib/llmEvaluationResults";
import {
  DEFAULT_MODEL_SORT_OPTIONS,
  orderModelList,
  TEST_SCORE_MODEL_SORT_OPTION,
  type ModelSortMode,
} from "@/lib/modelListOrdering";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import { useSettings } from "@/hooks/useSettings";
import { useTauriEvent } from "@/hooks/useTauriEvent";

type RefineModelSourceKind =
  | "ollama"
  | "lm_studio"
  | "hugging_face"
  | "vox_jot_local"
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
  requires_api_key: boolean;
  source_repo_id?: string | null;
  source_file_name?: string | null;
  source_url?: string | null;
  note?: string | null;
};

type RefineModelCatalog = {
  providers: RefineProviderStatus[];
  models: RefineModelDescriptor[];
};

type ApiKeyDialogState = {
  providerId: string;
  providerLabel: string;
  modelTitle: string;
} | null;

const REFINE_MODEL_SIZE_HINTS: Record<string, string> = {
  "llama-3.2-3b-instruct-q4_k_m": "~2.0 GB",
  "llama-3.2-1b-instruct-q4_k_m": "~0.8 GB",
  "qwen2.5-1.5b-instruct-q4_k_m": "~1.0 GB",
  "qwen2.5-0.5b-instruct-q4_k_m": "~0.4 GB",
  "phi-4-mini-instruct-q4_k_m": "~2.5 GB",
  "lfm2-1.2b-tool-q4_k_m": "~0.8 GB",
  "qwen2.5:0.5b": "~0.4 GB",
  "smollm2:135m": "~0.2 GB",
  "smollm2:360m": "~0.4 GB",
  "tinyllama:1.1b": "~0.7 GB",
  "gemma3:1b": "~1.0 GB",
  "llama3.2:1b": "~1.3 GB",
  "qwen2.5:1.5b": "~1.0 GB",
  "smollm2:1.7b": "~1.1 GB",
  "llama3.2:3b": "~2.0 GB",
  "phi4-mini": "~2.5 GB",
  "falcon3:1b": "~0.7 GB",
  "granite3.1-dense:2b": "~1.6 GB",
  "granite3.1-moe:1b": "~0.9 GB",
  "gemma2:2b": "~1.6 GB",
  "qwen2.5-coder:1.5b": "~1.0 GB",
  "codegemma:2b": "~1.6 GB",
  "stable-code:3b": "~2.1 GB",
  "orca-mini:3b": "~2.0 GB",
  "phi3:mini": "~2.2 GB",
  "tinydolphin:1.1b": "~0.6 GB",
  "mistral:7b-instruct-q2_K": "~2.7 GB",
  "deepseek-coder:1.3b": "~1.0 GB",
};

const extractSizeHint = (value: string | null | undefined): string | null => {
  const match = value?.match(/~?\d+(?:\.\d+)?\s*(?:GB|MB)\b/i);
  return match ? match[0].replace(/\s+/, " ").toUpperCase() : null;
};

const stripLeadingSizeHint = (value: string): string =>
  value
    .replace(/^\s*~?\d+(?:\.\d+)?\s*(?:GB|MB)\b\s*(?:[-—–:]\s*)?/i, "")
    .trim();

const formatApproximateSize = (gb: number): string => {
  if (gb < 1) return `~${Math.max(0.1, gb).toFixed(1)} GB`;
  if (gb < 10) return `~${gb.toFixed(1)} GB`;
  return `~${Math.round(gb)} GB`;
};

const estimateQuantizedGgufSize = (
  model: RefineModelDescriptor,
): string | null => {
  const haystack =
    `${model.title} ${model.id} ${model.runtime_model_id} ${model.source_repo_id ?? ""} ${model.source_file_name ?? ""}`.toLowerCase();
  const parameterMatch = haystack.match(/(\d+(?:\.\d+)?)\s*([bm])\b/);
  let parameterBillions = parameterMatch
    ? Number(parameterMatch[1]) * (parameterMatch[2] === "m" ? 0.001 : 1)
    : null;

  if (parameterBillions == null) {
    if (haystack.includes("phi-3.5-mini")) parameterBillions = 3.8;
    if (haystack.includes("phi-4-mini")) parameterBillions = 3.8;
  }

  if (parameterBillions == null || !Number.isFinite(parameterBillions)) {
    return null;
  }

  const bytesPerParameter =
    haystack.includes("q8_0") || haystack.includes("q8-k")
      ? 1.05
      : haystack.includes("q6_k")
        ? 0.78
        : haystack.includes("q5_k")
          ? 0.68
          : haystack.includes("q4")
            ? 0.57
            : 0.62;

  const overheadGb =
    parameterBillions >= 3 ? 0.25 : parameterBillions >= 1 ? 0.15 : 0.08;
  return formatApproximateSize(
    parameterBillions * bytesPerParameter + overheadGb,
  );
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
  stage:
    | "preparing"
    | "installing_ollama"
    | "starting_ollama"
    | "downloading"
    | "downloading_runtime"
    | "importing"
    | "installing_runtime"
    | "cancelling"
    | "cancelled"
    | "complete"
    | "failed";
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
  modelHubControls?: ModelHubControlState;
  /** When true, idle filter labels use "Provider" / "Language" (model hub toolbar). */
  hubFilterLabels?: boolean;
  showEvaluationPanel?: boolean;
};

const RefineModelsSettings: React.FC<RefineModelsSettingsProps> = ({
  titleActionTargetId,
  hubSearchQuery,
  onHubSearchQueryChange,
  modelHubControls,
  hubFilterLabels = false,
  showEvaluationPanel = true,
}) => {
  const { t } = useTranslation();
  const { refreshSettings } = useSettings();
  const [catalog, setCatalog] = useState<RefineModelCatalog | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localProviderFilter, setLocalProviderFilter] = useState("all");
  const [localSortMode, setLocalSortMode] =
    useState<ModelSortMode>("best_match");
  const providerFilter =
    modelHubControls?.providerFilter ?? localProviderFilter;
  const sortMode = modelHubControls?.sortMode ?? localSortMode;
  const setProviderFilter =
    modelHubControls?.setProviderFilter ?? setLocalProviderFilter;
  const setSortMode = modelHubControls?.setSortMode ?? setLocalSortMode;
  const [localQuery, setLocalQuery] = useState("");
  const useHubSearch =
    hubSearchQuery !== undefined && onHubSearchQueryChange !== undefined;
  const query = useHubSearch ? (hubSearchQuery ?? "") : localQuery;
  const setQuery: (value: string) => void = useHubSearch
    ? (value) => onHubSearchQueryChange?.(value)
    : setLocalQuery;
  const portalTarget = usePortalTarget(titleActionTargetId);
  const [busyModelIds, setBusyModelIds] = useState<Set<string>>(new Set());
  const [cancellingModelIds, setCancellingModelIds] = useState<Set<string>>(
    new Set(),
  );
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
  const [apiKeyDialog, setApiKeyDialog] = useState<ApiKeyDialogState>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySaving, setApiKeySaving] = useState(false);

  const onProgressEvent = useCallback(
    (event: { payload: RefineDownloadProgress }) => {
      const p = event.payload;
      const key = p.model_id;
      if (
        p.stage === "complete" ||
        p.stage === "failed" ||
        p.stage === "cancelled"
      ) {
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
        setCancellingModelIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        delete speedMapRef.current[key];
        return;
      }
      if (p.stage === "cancelling") {
        setCancellingModelIds((prev) => new Set(prev).add(key));
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
      if (p.status === "cancelled") {
        onProgressEvent({
          payload: { model_id: key, stage: "cancelled" },
        });
        return;
      }
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
          setProgressMap((prev) => {
            const next = { ...prev };
            for (const mid of activeModelIds) {
              if (!next[mid]) {
                next[mid] = {
                  model_id: mid,
                  stage: "downloading",
                  downloaded: 0,
                  total: 0,
                  percentage: 0,
                };
              }
            }
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

  useTauriEvent("external-model-storage-changed", () => {
    void loadCatalog({ silent: true });
  });

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
  const selectedProviderLabel = useMemo(() => {
    const idle = hubFilterLabels ? "Provider" : "All providers";
    if (providerFilter === "all") {
      return idle;
    }
    return (
      refineProviderOptions.find(
        (provider) => provider.value === providerFilter,
      )?.label ??
      providerFilter ??
      idle
    );
  }, [hubFilterLabels, providerFilter, refineProviderOptions]);

  useEffect(() => {
    if (modelHubControls) return;
    if (
      providerFilter !== "all" &&
      !refineProviderOptions.some(
        (provider) => provider.value === providerFilter,
      )
    ) {
      setProviderFilter("all");
    }
  }, [
    modelHubControls,
    providerFilter,
    refineProviderOptions,
    setProviderFilter,
  ]);

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
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [
    catalog?.models,
    getProviderFilterId,
    providerFilter,
    query,
    refineProviderOptions,
  ]);

  const providerRankById = useMemo(
    () =>
      new Map(
        refineProviderOptions.map((provider, index) => [provider.value, index]),
      ),
    [refineProviderOptions],
  );

  const refineAccessors = useMemo(
    () => ({
      label: (model: RefineModelDescriptor) => model.title,
      active: (model: RefineModelDescriptor) => model.active,
      installed: (model: RefineModelDescriptor) => model.installed,
      runnable: (model: RefineModelDescriptor) => model.runnable,
      recommended: (model: RefineModelDescriptor) => model.active,
      rank: (model: RefineModelDescriptor) =>
        getLlmEvaluationResult(model.runtime_model_id)?.rank,
      latencyMs: (model: RefineModelDescriptor) =>
        getLlmEvaluationResult(model.runtime_model_id)?.latencyP50Ms,
      providerRank: (model: RefineModelDescriptor) =>
        providerRankById.get(getProviderFilterId(model)),
    }),
    [getProviderFilterId, providerRankById],
  );

  const downloadedModels = useMemo(
    () =>
      orderModelList(
        filteredModels.filter((model) => model.installed),
        "downloaded",
        sortMode,
        refineAccessors,
      ),
    [filteredModels, refineAccessors, sortMode],
  );
  const downloadableModels = useMemo(
    () =>
      orderModelList(
        filteredModels.filter((model) => !model.installed),
        "available",
        sortMode,
        refineAccessors,
      ),
    [filteredModels, refineAccessors, sortMode],
  );
  const activeModels = downloadedModels.filter((model) => model.active);
  const ollamaProvider = useMemo(
    () =>
      catalog?.providers.find((provider) => provider.id === "ollama") ?? null,
    [catalog?.providers],
  );
  const voxJotLocalProvider = useMemo(
    () =>
      catalog?.providers.find((provider) => provider.id === "vox_jot_local") ??
      null,
    [catalog?.providers],
  );
  const evaluatedModels = useMemo(
    () =>
      filteredModels
        .map((model) => ({
          model,
          result: getLlmEvaluationResult(model.runtime_model_id),
        }))
        .filter(
          (
            entry,
          ): entry is {
            model: RefineModelDescriptor;
            result: LlmEvaluationResult;
          } => entry.result !== undefined,
        )
        .sort(
          (a, b) =>
            (a.result.rank ?? Number.MAX_SAFE_INTEGER) -
            (b.result.rank ?? Number.MAX_SAFE_INTEGER),
        ),
    [filteredModels],
  );
  const activeEvaluation = useMemo(() => {
    for (const model of activeModels) {
      const result = getLlmEvaluationResult(model.runtime_model_id);
      if (result) return { model, result };
    }
    return null;
  }, [activeModels]);

  const setModelProgressStage = (
    modelId: string,
    stage: RefineDownloadProgress["stage"],
  ) => {
    setProgressMap((prev) => ({
      ...prev,
      [modelId]: {
        model_id: modelId,
        stage,
        downloaded: 0,
        total: 0,
        percentage: 0,
      },
    }));
  };

  const ensureOllamaReady = async (modelId?: string): Promise<void> => {
    if (ollamaProvider?.installed === false) {
      if (modelId) setModelProgressStage(modelId, "installing_ollama");
      await invoke("install_ollama");
      return;
    }

    if (ollamaProvider?.running === false) {
      if (modelId) setModelProgressStage(modelId, "starting_ollama");
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
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("settings.refineModels.toast.removeError", {
              defaultValue: "Could not remove this model from Ollama.",
            });
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
    setProgressMap((prev) => ({
      ...prev,
      [model.runtime_model_id]: {
        model_id: model.runtime_model_id,
        stage: "preparing",
        downloaded: 0,
        total: 0,
        percentage: 0,
      },
    }));
    try {
      if (model.runtime_provider_id === "ollama") {
        await ensureOllamaReady(model.runtime_model_id);
      }
      await invoke("install_refine_model", {
        providerId: model.runtime_provider_id,
        modelId: model.runtime_model_id,
        sourceRepoId: model.source_repo_id ?? null,
        sourceFileName: model.source_file_name ?? null,
      });
      await refreshSettings();
      await loadCatalog({ silent: true });
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[model.runtime_model_id];
        return next;
      });
      toast.success(
        t("settings.refineModels.toast.installed", { title: model.title }),
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("settings.refineModels.toast.installError");
      if (!message.toLowerCase().includes("cancel")) {
        toast.error(message);
      }
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[model.runtime_model_id];
        return next;
      });
    } finally {
      setBusyModelIds((prev) => {
        const next = new Set(prev);
        next.delete(model.runtime_model_id);
        return next;
      });
      setCancellingModelIds((prev) => {
        const next = new Set(prev);
        next.delete(model.runtime_model_id);
        return next;
      });
    }
  };

  const handleCancelInstall = useCallback(
    async (model: RefineModelDescriptor) => {
      const modelId = model.runtime_model_id;
      setCancellingModelIds((prev) => new Set(prev).add(modelId));
      setProgressMap((prev) => ({
        ...prev,
        [modelId]: {
          ...(prev[modelId] ?? {
            model_id: modelId,
            downloaded: 0,
            total: 0,
            percentage: 0,
          }),
          model_id: modelId,
          stage: "cancelling",
        },
      }));
      try {
        await invoke("cancel_refine_model_install", { modelId });
      } catch (err) {
        setCancellingModelIds((prev) => {
          const next = new Set(prev);
          next.delete(modelId);
          return next;
        });
        toast.error(
          err instanceof Error
            ? err.message
            : t("settings.refineModels.toast.cancelError", {
                defaultValue: "Could not cancel this model download.",
              }),
        );
      }
    },
    [t],
  );

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
      await invoke("install_refine_model", {
        providerId: "vox_jot_local",
        modelId,
        sourceRepoId: repoId,
        sourceFileName: customFileName.trim() || null,
      });
      await refreshSettings();
      await loadCatalog({ silent: true });
      setCustomFileName("");
      setCustomModelId(modelId);
      toast.success(
        t("settings.refineModels.toast.localImportSuccess", { modelId }),
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

  const openApiKeyDialog = useCallback((model: RefineModelDescriptor) => {
    setApiKeyDialog({
      providerId: model.runtime_provider_id,
      providerLabel: model.runtime_label.replace(/\s+runtime$/i, ""),
      modelTitle: model.title,
    });
    setApiKeyDraft("");
    setApiKeyError(null);
  }, []);

  const closeApiKeyDialog = useCallback(() => {
    if (apiKeySaving) return;
    setApiKeyDialog(null);
    setApiKeyDraft("");
    setApiKeyError(null);
  }, [apiKeySaving]);

  const saveApiKeyDialog = useCallback(async () => {
    if (!apiKeyDialog || apiKeySaving) return;
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) {
      setApiKeyError(
        t("settings.refineModels.apiKeyDialog.required", {
          defaultValue: "Paste an API key before saving.",
        }),
      );
      return;
    }

    setApiKeySaving(true);
    setApiKeyError(null);
    try {
      const result = await commands.changePostProcessApiKeySetting(
        apiKeyDialog.providerId,
        trimmed,
      );
      if (result.status === "error") {
        setApiKeyError(result.error);
        return;
      }
      await refreshSettings();
      await loadCatalog({ silent: true });
      toast.success(
        t("settings.refineModels.apiKeyDialog.saved", {
          defaultValue: "{{provider}} API key saved.",
          provider: apiKeyDialog.providerLabel,
        }),
      );
      setApiKeyDialog(null);
      setApiKeyDraft("");
    } catch (error) {
      setApiKeyError(
        error instanceof Error
          ? error.message
          : t("settings.refineModels.apiKeyDialog.saveFailed", {
              defaultValue: "Failed to save API key.",
            }),
      );
    } finally {
      setApiKeySaving(false);
    }
  }, [
    apiKeyDialog,
    apiKeyDraft,
    apiKeySaving,
    loadCatalog,
    refreshSettings,
    t,
  ]);

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
    const needsVoxJotLocalRuntime =
      model.runtime_provider_id === "vox_jot_local" &&
      voxJotLocalProvider?.installed === false;

    if (model.requires_api_key) {
      const label = t("settings.refineModels.actions.apiKeyRequired", {
        provider: model.runtime_label.replace(/\s+runtime$/i, ""),
        defaultValue: "API key required",
      });
      return {
        kind: "custom",
        node: (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={label}
            aria-label={label}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openApiKeyDialog(model);
            }}
            className="h-8 shrink-0 gap-1 px-2 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
            API
          </Button>
        ),
      };
    }

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
        label =
          (progress.total ?? 0) > 0
            ? t("settings.refineModels.actions.downloading", {
                percent: Math.round(progress.percentage ?? 0),
              })
            : downloadingModelFilesLabel(t);
      } else if (isBusy && progress?.stage === "importing") {
        label = t("settings.refineModels.actions.importing");
      } else if (needsOllamaInstall) {
        label = t("settings.refineModels.actions.installOllama");
      } else if (needsOllamaStart) {
        label = t("settings.refineModels.actions.startOllama");
      } else if (needsVoxJotLocalRuntime) {
        label = t("settings.refineModels.actions.setupLocalRuntime", {
          defaultValue: "Set Up & Use",
        });
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
    if (model.requires_api_key) {
      openApiKeyDialog(model);
      return;
    }
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
        detail: t("settings.refineModels.badges.activeDetail"),
      });
    } else if (model.requires_api_key) {
      items.push({
        id: "api-key-needed",
        label: t("settings.refineModels.badges.apiKeyNeeded", {
          defaultValue: "API key",
        }),
        variant: "secondary",
        icon: <KeyRound className="h-3 w-3" />,
        detail: t("settings.refineModels.badges.apiKeyNeededDetail", {
          defaultValue: "Add this provider's API key before use.",
        }),
      });
    } else if (model.installed) {
      items.push({
        id: "ready",
        label: t("settings.refineModels.badges.ready"),
        variant: "success",
        detail: t("settings.refineModels.badges.readyDetail"),
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

  const buildStorageSizeLabel = (model: RefineModelDescriptor): string => {
    const knownSize =
      REFINE_MODEL_SIZE_HINTS[model.runtime_model_id] ??
      REFINE_MODEL_SIZE_HINTS[model.id] ??
      extractSizeHint(model.description) ??
      extractSizeHint(model.note) ??
      extractSizeHint(model.source_file_name) ??
      estimateQuantizedGgufSize(model);

    if (knownSize) return knownSize;

    if (model.source_kind === "managed_provider") {
      return model.runtime_provider_id === "apple_intelligence"
        ? t("modelHub.chips.internalStorage", { defaultValue: "Internal" })
        : t("modelHub.chips.externalStorage", {
            defaultValue: "External storage",
          });
    }

    if (model.source_kind === "lm_studio") {
      return t("modelHub.chips.externalStorage", {
        defaultValue: "External storage",
      });
    }

    return t("modelHub.chips.sizeUnknown", { defaultValue: "Size unknown" });
  };

  const buildCapabilityChips = (
    model: RefineModelDescriptor,
  ): CompactBadgeItem[] => {
    const evaluation = getLlmEvaluationResult(model.runtime_model_id);
    const haystack =
      `${model.title} ${model.id} ${model.runtime_model_id} ${model.source_repo_id ?? ""}`.toLowerCase();
    const isLocal =
      model.runtime_provider_id === "ollama" ||
      model.runtime_provider_id === "vox_jot_local" ||
      model.runtime_provider_id === "lmstudio" ||
      model.runtime_provider_id === "apple_intelligence" ||
      model.source_kind === "hugging_face";
    const supportsTools =
      haystack.includes("tool") ||
      haystack.includes("json") ||
      haystack.includes("function");
    const storageSizeLabel = buildStorageSizeLabel(model);
    const identityChips = buildModelIdentityChips({
      params: inferParameterClass([
        model.title,
        model.id,
        model.runtime_model_id,
        model.source_repo_id,
        model.source_file_name,
      ]),
      arch: inferArchitectureLabel(
        [model.title, model.id, model.runtime_model_id, model.source_repo_id],
        model.source_label,
      ),
      format: inferRuntimeFormat(
        [
          model.runtime_label,
          model.runtime_provider_id,
          model.source_kind,
          model.source_file_name,
        ],
        model.runtime_label,
      ),
    });

    const sizeChip: CompactBadgeItem = {
      id: "capability-size",
      label: storageSizeLabel,
      variant: "secondary" as const,
      icon: <HardDrive className="h-3 w-3" />,
      detail:
        model.source_kind === "managed_provider"
          ? model.runtime_provider_id === "apple_intelligence"
            ? t("modelHub.chips.internalStorageDetail", {
                defaultValue: "Uses a built-in local runtime.",
              })
            : t("modelHub.chips.externalStorageDetail", {
                defaultValue:
                  "Uses a configured provider and stores no local model in Vox Jot.",
              })
          : t("modelHub.chips.storageSizeDetail", {
              defaultValue: "Approximate model storage footprint.",
            }),
    };

    return [
      ...mergeSizeWithIdentityChips(identityChips, sizeChip),
      !isLocal
        ? {
            id: "capability-deployment",
            label: t("modelHub.chips.cloud", { defaultValue: "Cloud" }),
            variant: "secondary" as const,
            icon: <Cloud className="h-3 w-3" />,
            detail: t("modelHub.chips.cloudDetail", {
              defaultValue: "Uses a configured network provider.",
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
      showEvaluationPanel && evaluation?.status === "tested"
        ? {
            id: "capability-evaluation",
            label: evaluation.rank
              ? `Bench #${evaluation.rank}`
              : formatPercent(evaluation.passRate),
            variant: "secondary" as const,
            icon: <Gauge className="h-3 w-3" />,
            detail: `${evaluation.passed ?? 0}/${evaluation.totalCases ?? 0} sanity cases passed; p50 ${formatLatency(evaluation.latencyP50Ms)}.`,
          }
        : null,
    ].filter(Boolean) as CompactBadgeItem[];
  };

  const buildDownloadState = (
    model: RefineModelDescriptor,
  ): HubDownloadState | undefined => {
    const progress = progressMap[model.runtime_model_id];
    if (!progress) return undefined;
    const isCancelling =
      progress.stage === "cancelling" ||
      cancellingModelIds.has(model.runtime_model_id);
    const cancellable =
      progress.stage === "downloading" ||
      progress.stage === "downloading_runtime" ||
      progress.stage === "importing";
    const cancelFields = cancellable
      ? {
          cancelling: isCancelling,
          onCancel: () => void handleCancelInstall(model),
          cancelLabel: t("settings.refineModels.actions.cancelDownload", {
            title: model.title,
            defaultValue: "Cancel {{title}} download",
          }),
        }
      : { cancelling: isCancelling };

    if (progress.stage === "cancelling") {
      return {
        label: t("settings.refineModels.actions.cancelling", {
          defaultValue: "Cancelling download...",
        }),
        detail: model.runtime_label,
        indeterminate: true,
        cancelling: true,
      };
    }

    if (
      progress.stage === "downloading" ||
      progress.stage === "downloading_runtime"
    ) {
      const downloaded = progress.downloaded ?? 0;
      const total = progress.total ?? 0;
      const hasKnownTotal = total > 0;
      const percentage = Math.max(
        0,
        Math.min(100, Math.round(progress.percentage ?? 0)),
      );
      const speed = speedMapRef.current[model.runtime_model_id]?.speed ?? 0;
      const detail = [
        `${formatBytes(downloaded)}${hasKnownTotal ? ` / ${formatBytes(total)}` : ""}`,
        speed >= 0.05
          ? `${speed.toFixed(1)} MB/s`
          : t("modelSelector.waitingForData", {
              defaultValue: "Waiting for data...",
            }),
      ]
        .filter(Boolean)
        .join(" · ");

      return {
        label:
          progress.stage === "downloading_runtime"
            ? t("settings.refineModels.actions.downloadingLocalRuntime", {
                defaultValue: "Downloading local runtime...",
              })
            : downloadingModelFilesLabel(t),
        detail,
        progress: hasKnownTotal ? percentage : null,
        indeterminate: !hasKnownTotal,
        ...cancelFields,
      };
    }

    if (progress.stage === "preparing") {
      return {
        label: t("modelHub.analysis.downloadProgress.preparing", {
          defaultValue: "Checking runtime...",
        }),
        detail: model.runtime_label,
        indeterminate: true,
        ...cancelFields,
      };
    }

    if (progress.stage === "installing_ollama") {
      return {
        label: t("settings.refineModels.actions.installingOllama", {
          defaultValue: "Installing Ollama...",
        }),
        detail: t("settings.refineModels.actions.installingOllamaDetail", {
          defaultValue: "Local refine runtime",
        }),
        indeterminate: true,
        ...cancelFields,
      };
    }

    if (progress.stage === "starting_ollama") {
      return {
        label: t("settings.refineModels.actions.startingOllama", {
          defaultValue: "Starting Ollama...",
        }),
        detail: t("settings.refineModels.actions.startingOllamaDetail", {
          defaultValue: "Preparing the local refine service",
        }),
        indeterminate: true,
        ...cancelFields,
      };
    }

    if (progress.stage === "importing") {
      return {
        label: t("settings.refineModels.actions.installingIntoOllama", {
          defaultValue: "Installing into Ollama...",
        }),
        detail: model.runtime_label,
        indeterminate: true,
        ...cancelFields,
      };
    }

    if (progress.stage === "installing_runtime") {
      return {
        label: t("settings.refineModels.actions.installingLocalRuntime", {
          defaultValue: "Installing local runtime...",
        }),
        detail: t(
          "settings.refineModels.actions.installingLocalRuntimeDetail",
          {
            defaultValue: "Checksum verified · model files stay in place",
          },
        ),
        indeterminate: true,
        ...cancelFields,
      };
    }

    return undefined;
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
    <ModelListControls
      provider={{
        value: providerFilter,
        options: refineProviderOptions,
        onChange: setProviderFilter,
        label: selectedProviderLabel,
        show: refineProviderOptions.length > 2,
      }}
      sort={{
        value: sortMode,
        options: sortOptions,
        onChange: setSortMode,
        label: selectedSortLabel,
      }}
    />
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
            const rawDescription =
              model.note && model.note.trim().length > 0
                ? `${model.description} — ${model.note}`
                : model.description;
            const description = stripLeadingSizeHint(rawDescription);
            const isBusy = busyModelIds.has(model.runtime_model_id);
            const downloadState = buildDownloadState(model);
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
                description={description || undefined}
                capabilityChips={buildCapabilityChips(model)}
                footerMetaItems={buildMetaItems(model)}
                footerMetaIcon={<Cpu className="h-3.5 w-3.5" />}
                footerMetaMaxVisible={3}
                footerOverflowLabel={`${model.title} runtime details`}
                trailing={getTrailing(model)}
                downloadState={downloadState}
                footerExtra={
                  confirmingDeleteRuntimeId === model.runtime_model_id
                    ? renderRefineDeleteConfirm(model)
                    : null
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

  const benchmarkPanel = showEvaluationPanel ? (
    <aside className="min-w-0 lg:sticky lg:top-[5.75rem] lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
      <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              {t("settings.refineModels.evaluation.label", {
                defaultValue: "LLM test results",
              })}
            </p>
            <h2 className="mt-1 text-base font-semibold leading-tight text-[var(--text)]">
              {t("settings.refineModels.evaluation.title", {
                defaultValue: "Real-world post-process benchmark",
              })}
            </h2>
          </div>
          <Activity className="h-4 w-4 shrink-0 text-[var(--accent)]" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <MetricTile
            label={t("settings.refineModels.evaluation.tested")}
            value={`${LLM_EVALUATION_RESULTS.filter((r) => r.status === "tested").length}`}
          />
          <MetricTile
            label={t("settings.refineModels.evaluation.bestPass")}
            value={formatPercent(
              LLM_EVALUATION_RESULTS.filter(
                (r) => r.status === "tested" && r.passRate !== undefined,
              ).sort((a, b) => (b.passRate ?? 0) - (a.passRate ?? 0))[0]
                ?.passRate,
            )}
          />
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
          <p className="text-xs font-semibold text-[var(--text)]">
            {LLM_EVALUATION_RUN.suite}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {LLM_EVALUATION_RUN.corpus}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {t("settings.refineModels.evaluation.timeout", {
              defaultValue: "10s timeout per case; full reports in {{path}}.",
              path: LLM_EVALUATION_RUN.reportPath,
            })}
          </p>
        </div>

        {activeEvaluation ? (
          <LlmEvaluationResultBlock
            title={t("settings.refineModels.evaluation.activeModel")}
            modelName={activeEvaluation.model.title}
            result={activeEvaluation.result}
          />
        ) : null}

        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            {t("settings.refineModels.evaluation.ranking", {
              defaultValue: "Ranking",
            })}
          </p>
          {evaluatedModels.length > 0 ? (
            evaluatedModels
              .slice(0, 8)
              .map(({ model, result }) => (
                <LlmEvaluationResultBlock
                  key={`${model.runtime_provider_id}::${model.runtime_model_id}`}
                  modelName={model.title}
                  result={result}
                  compact
                />
              ))
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-3 py-3 text-sm text-[var(--muted)]">
              {t("settings.refineModels.evaluation.empty", {
                defaultValue:
                  "Results appear here after a local LLM benchmark covers matching models.",
              })}
            </p>
          )}
        </div>
      </div>
    </aside>
  ) : null;

  return (
    <div
      className={
        showEvaluationPanel
          ? "grid w-full min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]"
          : "w-full"
      }
    >
      <div className="min-w-0 space-y-6">
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
                  placeholder={t(
                    "settings.refineModels.search.localPlaceholder",
                  )}
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
                  "Downloaded Models",
                  t("settings.refineModels.sections.readyNowLocalDescription"),
                  downloadedModels,
                  t("settings.refineModels.sections.readyNowEmpty"),
                  t("settings.refineModels.sections.readyNowEmptyDescription"),
                  true,
                )}

                {renderSection(
                  "Available to Download",
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
            description={t(
              "settings.refineModels.customImport.localDescription",
            )}
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
                    {t(
                      "settings.refineModels.customImport.localModelNameLabel",
                    )}
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
                      {t(
                        "settings.refineModels.customImport.localRuntimeDescription",
                      )}
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
      {benchmarkPanel}
      <RefineApiKeyDialog
        open={Boolean(apiKeyDialog)}
        providerId={apiKeyDialog?.providerId ?? ""}
        providerLabel={apiKeyDialog?.providerLabel ?? ""}
        modelTitle={apiKeyDialog?.modelTitle ?? ""}
        value={apiKeyDraft}
        error={apiKeyError}
        busy={apiKeySaving}
        onChange={setApiKeyDraft}
        onCancel={closeApiKeyDialog}
        onConfirm={saveApiKeyDialog}
      />
    </div>
  );
};

const RefineApiKeyDialog: React.FC<{
  open: boolean;
  providerId: string;
  providerLabel: string;
  modelTitle: string;
  value: string;
  error: string | null;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({
  open,
  providerId,
  providerLabel,
  modelTitle,
  value,
  error,
  busy,
  onChange,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap({
    enabled: open,
    containerRef: dialogRef,
    initialFocusSelector: "input",
  });

  if (!open) return null;

  const handleCancel = () => {
    if (!busy) onCancel();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
      role="presentation"
      onClick={handleCancel}
    >
      <div
        className="absolute inset-0 bg-[var(--scrim-bg)] backdrop-blur-[2px]"
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="refine-api-key-dialog-title"
        aria-describedby="refine-api-key-dialog-description"
        className="relative w-full max-w-[560px] rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] p-5 shadow-[var(--modal-shadow)]"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) =>
          handleDialogKeyDown(event, dialogRef.current, onCancel, {
            escapeDisabled: busy,
          })
        }
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="refine-api-key-dialog-title"
              className="text-base font-semibold text-[var(--text)]"
            >
              {t("settings.refineModels.apiKeyDialog.title", {
                defaultValue: "Add {{provider}} API key",
                provider: providerLabel,
              })}
            </h2>
            <p
              id="refine-api-key-dialog-description"
              className="mt-1 text-sm leading-5 text-[var(--muted)]"
            >
              {t("settings.refineModels.apiKeyDialog.description", {
                defaultValue:
                  "{{modelTitle}} needs a {{provider}} API key before Vox Jot can use this cloud model.",
                modelTitle,
                provider: providerLabel,
              })}
            </p>
          </div>
          <ActionIconButton
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label={t("common.close", { defaultValue: "Close" })}
            title={t("common.close", { defaultValue: "Close" })}
          >
            <X aria-hidden />
          </ActionIconButton>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("settings.postProcessing.api.apiKey.title", {
              defaultValue: "API key",
            })}
          </span>
          <Input
            type="password"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && value.trim()) {
                event.preventDefault();
                onConfirm();
              }
            }}
            placeholder={t("settings.postProcessing.api.apiKey.placeholder", {
              defaultValue: "Paste API key",
            })}
            disabled={busy}
            autoFocus
            autoComplete="off"
          />
        </label>

        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {t("settings.refineModels.apiKeyDialog.storageNote", {
            defaultValue:
              "The key is stored in the system credential store and is not shown again after saving.",
          })}
        </p>

        {PROVIDER_API_KEY_URLS[providerId] ? (
          <div className="mt-2 space-y-1">
            <button
              type="button"
              onClick={() => {
                void openUrl(PROVIDER_API_KEY_URLS[providerId]).catch(
                  (openError) => {
                    console.error(
                      "Failed to open provider key page:",
                      openError,
                    );
                  },
                );
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
              {t("settings.postProcessing.api.apiKey.getKeyLink", {
                defaultValue: "Get your {{provider}} API key",
                provider: providerLabel,
              })}
            </button>
            <p className="text-xs leading-5 text-[var(--muted)]">
              {t("settings.postProcessing.api.apiKey.accountNote", {
                defaultValue:
                  "Opens {{provider}} in your browser. You may need to create a free account to generate a key.",
                provider: providerLabel,
              })}
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_65%)] bg-[var(--danger-soft)] p-3 text-sm font-medium text-[var(--danger)]">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={busy || !value.trim()}
            onClick={onConfirm}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("settings.refineModels.apiKeyDialog.save", {
              defaultValue: "Save key",
            })}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const MetricTile: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
      {label}
    </p>
    <p className="mt-1 text-sm font-semibold text-[var(--text)]">{value}</p>
  </div>
);

const LlmEvaluationResultBlock: React.FC<{
  modelName: string;
  result: LlmEvaluationResult;
  title?: string;
  compact?: boolean;
}> = ({ modelName, result, title, compact = false }) => {
  const { t } = useTranslation();
  const statusLabel =
    result.status === "tested"
      ? result.rank
        ? `#${result.rank}`
        : "Tested"
      : "Pending";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-3">
      {title ? (
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
          {title}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">
          {modelName}
        </p>
        <Badge
          variant="secondary"
          className="shrink-0 border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-xs font-semibold"
        >
          {statusLabel}
        </Badge>
      </div>
      {result.status === "tested" ? (
        <div
          className={`mt-2 grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-3"}`}
        >
          <MiniMetric
            icon={<Gauge className="h-3.5 w-3.5" />}
            label={t("settings.refineModels.evaluation.pass")}
            value={`${result.passed ?? 0}/${result.totalCases ?? 0}`}
          />
          <MiniMetric
            icon={<Activity className="h-3.5 w-3.5" />}
            label={t("settings.refineModels.evaluation.similarityShort")}
            value={formatPercent(result.averageSimilarity)}
          />
          {!compact ? (
            <MiniMetric
              label="p50"
              value={formatLatency(result.latencyP50Ms)}
            />
          ) : null}
        </div>
      ) : null}
      {!compact && result.notes ? (
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {result.notes}
        </p>
      ) : null}
      {!compact && result.promptProfile ? (
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {t("settings.refineModels.evaluation.promptProfile", {
            defaultValue: "Prompt profile: {{profile}}.",
            profile: result.promptProfile,
          })}
        </p>
      ) : null}
      {!compact && result.errors ? (
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {t("settings.refineModels.evaluation.errors", {
            count: result.errors,
            defaultValue:
              result.errors === 1
                ? "{{count}} timeout or API error."
                : "{{count}} timeout or API errors.",
          })}
        </p>
      ) : null}
    </div>
  );
};

const MiniMetric: React.FC<{
  label: string;
  value: string;
  icon?: React.ReactNode;
}> = ({ label, value, icon }) => (
  <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5">
    <div className="flex min-w-0 items-center gap-1 text-[var(--muted)]">
      {icon}
      <span className="truncate text-[10px] font-bold uppercase tracking-[0.1em]">
        {label}
      </span>
    </div>
    <p className="mt-0.5 truncate text-xs font-semibold text-[var(--text)]">
      {value}
    </p>
  </div>
);

function formatPercent(value?: number): string {
  if (value === undefined) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value?: number): string {
  if (value === undefined) return "n/a";
  return `${value} ms`;
}

export default RefineModelsSettings;
