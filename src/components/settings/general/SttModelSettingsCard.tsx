import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { SettingContainer } from "@/components/ui/SettingContainer";
import {
  getModelPlatformOverview,
  setSttPlatformSelection,
  type CatalogModelDescriptor,
  type ModelPlatformOverview,
  type ProviderDescriptor,
} from "@/lib/modelPlatform";
import { LanguageSelector } from "../LanguageSelector";
import { TranslationSettingsCard } from "./TranslationSettingsCard";

function SelectField({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-flex">
      <select
        className="min-w-[220px] appearance-none rounded-full border border-[var(--border)] bg-[var(--bg)] py-2 pe-9 ps-4 text-sm font-semibold shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </div>
  );
}

export const SttModelSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const [platformOverview, setPlatformOverview] =
    useState<ModelPlatformOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshPlatform = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await getModelPlatformOverview();
      setPlatformOverview(overview);
    } catch (error) {
      console.error("Failed to load STT platform overview:", error);
      setStatusMessage("Failed to load STT catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlatform();
  }, [refreshPlatform]);

  const selectedProviderId =
    platformOverview?.selection.selected_stt_provider_id ?? "";
  const selectedModelId =
    platformOverview?.selection.selected_stt_model_id ?? "";

  const selectedProvider = useMemo<ProviderDescriptor | null>(
    () =>
      platformOverview?.stt.providers.find(
        (p) => p.id === selectedProviderId,
      ) ?? null,
    [platformOverview, selectedProviderId],
  );

  const selectedModel = useMemo<CatalogModelDescriptor | null>(
    () =>
      platformOverview?.stt.models.find((m) => m.id === selectedModelId) ??
      null,
    [platformOverview, selectedModelId],
  );

  const providerOptions = useMemo(
    () =>
      (platformOverview?.stt.providers ?? []).map((p) => ({
        value: p.id,
        label: p.coming_soon ? `${p.label} (Coming soon)` : p.label,
        disabled: p.coming_soon || !p.available,
      })),
    [platformOverview],
  );

  const modelOptions = useMemo(
    () =>
      (platformOverview?.stt.models ?? [])
        .filter((m) => m.provider_id === selectedProviderId)
        .map((m) => ({
          value: m.id,
          label: m.capabilities.coming_soon
            ? `${m.label} (Coming soon)`
            : m.label,
          disabled: m.capabilities.coming_soon,
        })),
    [platformOverview, selectedProviderId],
  );

  const handleProviderChange = async (providerId: string) => {
    const firstModelId = platformOverview?.stt.models.find(
      (m) => m.provider_id === providerId && !m.capabilities.coming_soon,
    )?.id;

    if (firstModelId) {
      try {
        await setSttPlatformSelection(providerId, firstModelId);
        await refreshPlatform();
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };

  const handleModelChange = async (modelId: string) => {
    if (selectedProviderId) {
      try {
        await setSttPlatformSelection(selectedProviderId, modelId);
        await refreshPlatform();
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  };

  const supportsLanguageSelection =
    selectedProvider?.label === "Whisper" ||
    selectedProvider?.label === "SenseVoice";

  return (
    <SettingsGroup
      title={t("settings.listen.model_selection", "Speech Engine")}
    >
      <SettingContainer
        title="Speech Provider"
        description="Choose the STT engine family. Each uses different technology optimized for specific languages or speed."
        descriptionMode="tooltip"
        grouped={true}
      >
        <SelectField
          value={selectedProviderId}
          onChange={handleProviderChange}
          options={providerOptions}
          disabled={loading}
        />
      </SettingContainer>

      <SettingContainer
        title="Speech Model"
        description="Select a specific version or size of the model from this provider."
        descriptionMode="tooltip"
        grouped={true}
      >
        <SelectField
          value={selectedModelId}
          onChange={handleModelChange}
          options={modelOptions}
          disabled={loading || modelOptions.length === 0}
        />
      </SettingContainer>

      {supportsLanguageSelection && selectedModel && (
        <LanguageSelector
          descriptionMode="tooltip"
          grouped={true}
          supportedLanguages={selectedModel.supported_languages}
        />
      )}

      <TranslationSettingsCard />

      {statusMessage && (
        <p className="px-4 py-2 text-xs text-red-500">{statusMessage}</p>
      )}

      {selectedProvider && (
        <div className="grid gap-1 px-4 py-2 text-xs text-[var(--muted)]">
          <p>{`Runtime: ${selectedProvider.runtime.label}`}</p>
          <p>{`Source: ${selectedProvider.source_label}`}</p>
          {selectedModel?.description && (
            <p className="mt-1">{selectedModel.description}</p>
          )}
        </div>
      )}
    </SettingsGroup>
  );
};
