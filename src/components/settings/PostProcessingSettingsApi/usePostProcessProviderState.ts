import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../../../hooks/useSettings";
import { commands, type PostProcessProvider } from "@/bindings";
import type { ModelOption } from "./types";
import type { DropdownOption } from "../../ui/Dropdown";

export type PostProcessProviderState = {
  providerOptions: DropdownOption[];
  selectedProviderId: string;
  selectedProvider: PostProcessProvider | undefined;
  isCustomProvider: boolean;
  isAppleProvider: boolean;
  appleIntelligenceUnavailable: boolean;
  baseUrl: string;
  handleBaseUrlChange: (value: string) => void;
  isBaseUrlUpdating: boolean;
  apiKey: string;
  handleApiKeyChange: (value: string) => void;
  isApiKeyUpdating: boolean;
  model: string;
  handleModelChange: (value: string) => void;
  modelOptions: ModelOption[];
  isModelUpdating: boolean;
  isFetchingModels: boolean;
  handleProviderSelect: (providerId: string) => void;
  handleModelSelect: (value: string) => void;
  handleModelCreate: (value: string) => void;
  handleRefreshModels: () => void;
};

const APPLE_PROVIDER_ID = "apple_intelligence";
const OLLAMA_PROVIDER_ID = "ollama";

const isLocalBaseUrl = (baseUrl: string): boolean => {
  const lower = baseUrl.trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.startsWith("http://localhost") ||
    lower.startsWith("https://localhost") ||
    lower.startsWith("http://127.0.0.1") ||
    lower.startsWith("https://127.0.0.1") ||
    lower.startsWith("http://[::1]") ||
    lower.startsWith("https://[::1]")
  );
};

const isLocalProvider = (provider: PostProcessProvider): boolean => {
  if (provider.id === APPLE_PROVIDER_ID) return true;
  return isLocalBaseUrl(provider.base_url);
};

export const usePostProcessProviderState = (): PostProcessProviderState => {
  const {
    settings,
    isUpdating,
    setPostProcessProvider,
    updatePostProcessBaseUrl,
    updatePostProcessApiKey,
    updatePostProcessModel,
    fetchPostProcessModels,
    postProcessModelOptions,
  } = useSettings();

  // Settings are guaranteed to have providers after migration
  const providers = settings?.post_process_providers || [];
  const localPrivacyMode = settings?.local_privacy_mode ?? false;
  const visibleProviders = useMemo(
    () =>
      localPrivacyMode
        ? providers.filter((provider) => isLocalProvider(provider))
        : providers,
    [localPrivacyMode, providers],
  );

  const selectedProviderId = useMemo(() => {
    const preferredId = settings?.post_process_provider_id;
    if (
      preferredId &&
      visibleProviders.some((provider) => provider.id === preferredId)
    ) {
      return preferredId;
    }
    return visibleProviders[0]?.id || "openai";
  }, [settings?.post_process_provider_id, visibleProviders]);

  const selectedProvider = useMemo(() => {
    return (
      visibleProviders.find((provider) => provider.id === selectedProviderId) ||
      visibleProviders[0]
    );
  }, [visibleProviders, selectedProviderId]);

  const isAppleProvider = selectedProvider?.id === APPLE_PROVIDER_ID;
  const [appleIntelligenceUnavailable, setAppleIntelligenceUnavailable] =
    useState(false);
  const autoFetchedProvidersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const syncAppleAvailability = async () => {
      if (!isAppleProvider) {
        setAppleIntelligenceUnavailable(false);
        return;
      }

      const available = await commands.checkAppleIntelligenceAvailable();
      if (!cancelled) {
        setAppleIntelligenceUnavailable(!available);
      }
    };

    void syncAppleAvailability();

    return () => {
      cancelled = true;
    };
  }, [isAppleProvider]);

  // Use settings directly as single source of truth
  const baseUrl = selectedProvider?.base_url ?? "";
  const apiKey = settings?.post_process_api_keys?.[selectedProviderId] ?? "";
  const model = settings?.post_process_models?.[selectedProviderId] ?? "";

  const providerOptions = useMemo<DropdownOption[]>(() => {
    return visibleProviders.map((provider) => ({
      value: provider.id,
      label: provider.label,
    }));
  }, [visibleProviders]);

  const handleProviderSelect = useCallback(
    async (providerId: string) => {
      // Clear error state on any selection attempt (allows dismissing the error)
      setAppleIntelligenceUnavailable(false);

      if (providerId === selectedProviderId) return;

      // Check Apple Intelligence availability before selecting
      if (providerId === APPLE_PROVIDER_ID) {
        const available = await commands.checkAppleIntelligenceAvailable();
        if (!available) {
          setAppleIntelligenceUnavailable(true);
          // Don't return - still set the provider so dropdown shows the selection
          // The backend gracefully handles unavailable Apple Intelligence
        }
      }

      await setPostProcessProvider(providerId);

      // Auto-fetch available models for the new provider so the model dropdown
      // reflects what's actually valid. Without this, a stale model value from
      // a previous provider/base_url can persist and silently 404 at runtime.
      // Skip when the provider isn't configured yet (no API key / empty base URL)
      // to avoid unnecessary backend errors.
      if (providerId !== APPLE_PROVIDER_ID) {
        const provider = visibleProviders.find((p) => p.id === providerId);
        const apiKey = settings?.post_process_api_keys?.[providerId] ?? "";
        const hasBaseUrl = (provider?.base_url ?? "").trim() !== "";
        const hasApiKey = apiKey.trim() !== "";
        const allowsEmptyApiKey =
          provider?.id === "custom" ||
          provider?.id === "lmstudio" ||
          provider?.id === OLLAMA_PROVIDER_ID;

        if (allowsEmptyApiKey ? hasBaseUrl : hasApiKey) {
          void fetchPostProcessModels(providerId);
        }
      }
    },
    [
      selectedProviderId,
      setPostProcessProvider,
      fetchPostProcessModels,
      visibleProviders,
      settings,
    ],
  );

  const handleBaseUrlChange = useCallback(
    (value: string) => {
      if (!selectedProvider || selectedProvider.id !== "custom") {
        return;
      }
      const trimmed = value.trim();
      if (trimmed && trimmed !== baseUrl) {
        void updatePostProcessBaseUrl(selectedProvider.id, trimmed);
      }
    },
    [selectedProvider, baseUrl, updatePostProcessBaseUrl],
  );

  const handleApiKeyChange = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== apiKey) {
        void updatePostProcessApiKey(selectedProviderId, trimmed);
      }
    },
    [apiKey, selectedProviderId, updatePostProcessApiKey],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== model) {
        void updatePostProcessModel(selectedProviderId, trimmed);
      }
    },
    [model, selectedProviderId, updatePostProcessModel],
  );

  const handleModelSelect = useCallback(
    (value: string) => {
      void updatePostProcessModel(selectedProviderId, value.trim());
    },
    [selectedProviderId, updatePostProcessModel],
  );

  const handleModelCreate = useCallback(
    (value: string) => {
      void updatePostProcessModel(selectedProviderId, value);
    },
    [selectedProviderId, updatePostProcessModel],
  );

  const handleRefreshModels = useCallback(() => {
    if (isAppleProvider) return;
    void fetchPostProcessModels(selectedProviderId);
  }, [fetchPostProcessModels, isAppleProvider, selectedProviderId]);

  const availableModelsRaw = postProcessModelOptions[selectedProviderId] || [];
  const isFetchingModels = isUpdating(
    `post_process_models_fetch:${selectedProviderId}`,
  );

  useEffect(() => {
    if (selectedProviderId !== OLLAMA_PROVIDER_ID) return;
    if (autoFetchedProvidersRef.current.has(selectedProviderId)) return;

    autoFetchedProvidersRef.current.add(selectedProviderId);
    void fetchPostProcessModels(selectedProviderId);
  }, [fetchPostProcessModels, selectedProviderId]);

  useEffect(() => {
    if (selectedProviderId !== OLLAMA_PROVIDER_ID) return;

    const hasFetchedModels = Object.prototype.hasOwnProperty.call(
      postProcessModelOptions,
      selectedProviderId,
    );

    if (!hasFetchedModels || isFetchingModels) return;

    const trimmedModel = model.trim();
    if (!trimmedModel) return;

    const available = new Set(
      availableModelsRaw
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate.length > 0),
    );

    if (!available.has(trimmedModel)) {
      void updatePostProcessModel(selectedProviderId, "");
    }
  }, [
    availableModelsRaw,
    isFetchingModels,
    model,
    postProcessModelOptions,
    selectedProviderId,
    updatePostProcessModel,
  ]);

  const modelOptions = useMemo<ModelOption[]>(() => {
    const seen = new Set<string>();
    const options: ModelOption[] = [];

    const upsert = (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      options.push({ value: trimmed, label: trimmed });
    };

    // Add available models from API
    for (const candidate of availableModelsRaw) {
      upsert(candidate);
    }

    // Ensure current model is in the list
    upsert(model);

    return options;
  }, [availableModelsRaw, model]);

  const isBaseUrlUpdating = isUpdating(
    `post_process_base_url:${selectedProviderId}`,
  );
  const isApiKeyUpdating = isUpdating(
    `post_process_api_key:${selectedProviderId}`,
  );
  const isModelUpdating = isUpdating(
    `post_process_model:${selectedProviderId}`,
  );

  const isCustomProvider = selectedProvider?.id === "custom";

  // No automatic fetching - user must click refresh button

  return {
    providerOptions,
    selectedProviderId,
    selectedProvider,
    isCustomProvider,
    isAppleProvider,
    appleIntelligenceUnavailable,
    baseUrl,
    handleBaseUrlChange,
    isBaseUrlUpdating,
    apiKey,
    handleApiKeyChange,
    isApiKeyUpdating,
    model,
    handleModelChange,
    modelOptions,
    isModelUpdating,
    isFetchingModels,
    handleProviderSelect,
    handleModelSelect,
    handleModelCreate,
    handleRefreshModels,
  };
};
