import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Play, RefreshCw, Square } from "lucide-react";
import { commands, type TtsPackInfo, type VoiceInfo } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { Slider } from "@/components/ui/Slider";
import { Button } from "@/components/ui/Button";
import { OutputDeviceSelector } from "@/components/settings/OutputDeviceSelector";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { SpeechOutputToggle } from "@/components/settings/SpeechOutputToggle";
import {
  getModelPlatformOverview,
  setTtsPlatformSelection,
  type CatalogModelDescriptor,
  type ModelPlatformOverview,
  type ProviderDescriptor,
} from "@/lib/modelPlatform";

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

function localeLabel(locale: string | null | undefined) {
  return locale ? ` (${locale})` : "";
}

function useSpeechOutputState() {
  const { settings, updateSetting, isUpdating } = useSettings();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [packs, setPacks] = useState<TtsPackInfo[]>([]);
  const [platformOverview, setPlatformOverview] =
    useState<ModelPlatformOverview | null>(null);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [loadingPacks, setLoadingPacks] = useState(false);
  const [loadingPlatform, setLoadingPlatform] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    const result = await commands.getAvailableTtsVoices();
    if (result.status === "ok") {
      setVoices(result.data);
      setStatusMessage(null);
    } else {
      setVoices([]);
      setStatusMessage(result.error);
    }
    setLoadingVoices(false);
  }, []);

  const refreshVoices = useCallback(async () => {
    setLoadingVoices(true);
    const result = await commands.refreshTtsVoices();
    if (result.status === "ok") {
      setVoices(result.data);
      setStatusMessage(null);
    } else {
      setVoices([]);
      setStatusMessage(result.error);
    }
    setLoadingVoices(false);
  }, []);

  const refreshPacks = useCallback(async () => {
    setLoadingPacks(true);
    const result = await commands.getAvailableTtsPacks();
    if (result.status === "ok") {
      setPacks(result.data);
    }
    setLoadingPacks(false);
  }, []);

  const refreshPlatform = useCallback(async () => {
    setLoadingPlatform(true);
    try {
      const overview = await getModelPlatformOverview();
      setPlatformOverview(overview);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to load TTS catalog",
      );
    } finally {
      setLoadingPlatform(false);
    }
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }
    void loadVoices();
    void refreshPacks();
    void refreshPlatform();
  }, [
    loadVoices,
    refreshPacks,
    refreshPlatform,
    settings?.tts_engine_preference,
    settings?.tts_enabled,
    settings?.tts_default_voice_id,
  ]);

  const selectedVoiceId = settings?.tts_default_voice_id ?? "__auto__";
  const ttsEnabled = settings?.tts_enabled ?? false;
  const packInstalled = packs.some((pack) => pack.installed);

  const voiceOptions = useMemo(
    () => [
      { value: "__auto__", label: "Automatic voice" },
      ...voices.map((voice) => ({
        value: voice.id,
        label: `${voice.label}${localeLabel(voice.locale)}`,
      })),
    ],
    [voices],
  );

  const selectedProviderId =
    platformOverview?.selection.selected_tts_provider_id ?? "";
  const selectedModelId =
    platformOverview?.selection.selected_tts_model_id ?? "__auto__";
  const selectedProvider = useMemo<ProviderDescriptor | null>(
    () =>
      platformOverview?.tts.providers.find(
        (provider) => provider.id === selectedProviderId,
      ) ?? null,
    [platformOverview, selectedProviderId],
  );
  const selectedModel = useMemo<CatalogModelDescriptor | null>(
    () =>
      platformOverview?.tts.models.find(
        (model) => model.id === selectedModelId,
      ) ?? null,
    [platformOverview, selectedModelId],
  );

  const providerOptions = useMemo(
    () =>
      (platformOverview?.tts.providers ?? []).map((provider) => ({
        value: provider.id,
        label: provider.coming_soon
          ? `${provider.label} (Coming soon)`
          : provider.label,
        disabled: provider.coming_soon || !provider.available,
      })),
    [platformOverview],
  );

  const modelOptions = useMemo(
    () =>
      (platformOverview?.tts.models ?? [])
        .filter((model) => model.provider_id === selectedProviderId)
        .map((model) => ({
          value: model.id,
          label: model.capabilities.coming_soon
            ? `${model.label} (Coming soon)`
            : model.label,
          disabled: model.capabilities.coming_soon,
        })),
    [platformOverview, selectedProviderId],
  );

  const engineStatus = useMemo(() => {
    if (statusMessage) {
      return statusMessage;
    }
    if (selectedProvider && selectedModel) {
      return `${selectedProvider.runtime.label}. ${selectedProvider.source_label}.`;
    }
    if (selectedProvider) {
      return `${selectedProvider.runtime.label}. ${selectedProvider.description}`;
    }
    return packInstalled
      ? "Speech output is ready and will auto-route to the selected local runtime."
      : "Choose a provider and model, then Vox Jot will handle the speech runtime automatically.";
  }, [packInstalled, selectedModel, selectedProvider, statusMessage]);

  return {
    settings,
    updateSetting,
    isUpdating,
    voices,
    packs,
    platformOverview,
    loadingVoices,
    loadingPacks,
    loadingPlatform,
    previewingVoice,
    busyPackId,
    statusMessage,
    setStatusMessage,
    setPreviewingVoice,
    setBusyPackId,
    refreshVoices,
    refreshPacks,
    refreshPlatform,
    selectedVoiceId,
    selectedProvider,
    selectedProviderId,
    selectedModel,
    selectedModelId,
    providerOptions,
    modelOptions,
    ttsEnabled,
    voiceOptions,
    engineStatus,
  };
}

interface SpeechVoiceEngineSettingsCardProps {
  showEnabledToggle?: boolean;
  showGroupTitle?: boolean;
}

export const SpeechVoiceEngineSettingsCard: React.FC<
  SpeechVoiceEngineSettingsCardProps
> = ({ showEnabledToggle = true, showGroupTitle = true }) => {
  const speech = useSpeechOutputState();

  if (!speech.settings) {
    return null;
  }

  return (
    <SettingsGroup title={showGroupTitle ? "Voice & Engine" : undefined}>
      {showEnabledToggle && (
        <SpeechOutputToggle descriptionMode="tooltip" grouped={true} />
      )}

      <SettingContainer
        title="Speech Provider"
        description="Pick the local TTS provider family. Vox Jot will route speech to the right backend automatically."
        descriptionMode="tooltip"
        grouped={true}
      >
        <SelectField
          value={
            speech.selectedProviderId || speech.providerOptions[0]?.value || ""
          }
          onChange={(value) => {
            const defaultModelId =
              speech.platformOverview?.tts.models.find(
                (model) =>
                  model.provider_id === value &&
                  !model.capabilities.coming_soon,
              )?.id ?? null;
            void setTtsPlatformSelection(value, defaultModelId)
              .then(async () => {
                await speech.refreshPlatform();
                await speech.refreshVoices();
              })
              .catch((error) => {
                speech.setStatusMessage(
                  error instanceof Error ? error.message : String(error),
                );
              });
          }}
          disabled={!speech.ttsEnabled || speech.loadingPlatform}
          options={speech.providerOptions}
        />
      </SettingContainer>

      <SettingContainer
        title="Speech Model"
        description="Choose the installed or planned model within the selected provider."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!speech.ttsEnabled}
      >
        <SelectField
          value={speech.selectedModelId || speech.modelOptions[0]?.value || ""}
          onChange={(value) => {
            void setTtsPlatformSelection(speech.selectedProviderId, value)
              .then(async () => {
                await speech.refreshPlatform();
                await speech.refreshVoices();
              })
              .catch((error) => {
                speech.setStatusMessage(
                  error instanceof Error ? error.message : String(error),
                );
              });
          }}
          disabled={
            !speech.ttsEnabled ||
            speech.loadingPlatform ||
            speech.modelOptions.length === 0
          }
          options={speech.modelOptions}
        />
      </SettingContainer>

      <SettingContainer
        title="Voice"
        description="Pick a default voice for playback and preview it before using it in dictation flows."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
        disabled={!speech.ttsEnabled}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              value={speech.selectedVoiceId}
              onChange={(value) =>
                void speech.updateSetting(
                  "tts_default_voice_id",
                  value === "__auto__" ? null : value,
                )
              }
              disabled={
                !speech.ttsEnabled ||
                speech.loadingVoices ||
                speech.isUpdating("tts_default_voice_id")
              }
              options={speech.voiceOptions}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void speech.refreshVoices()}
              disabled={speech.loadingVoices}
              className="inline-flex items-center gap-1"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${speech.loadingVoices ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={async () => {
                speech.setPreviewingVoice(true);
                const result = await commands.previewTtsVoice(
                  speech.settings?.tts_default_voice_id ?? null,
                );
                if (result.status !== "ok") {
                  speech.setStatusMessage(result.error);
                } else {
                  speech.setStatusMessage(null);
                }
                speech.setPreviewingVoice(false);
              }}
              disabled={!speech.ttsEnabled || speech.previewingVoice}
              className="inline-flex items-center gap-1"
            >
              <Play className="h-3.5 w-3.5" />
              Preview voice
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void commands.ttsStop()}
              disabled={!speech.ttsEnabled}
              className="inline-flex items-center gap-1"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          </div>
          <p className="text-xs text-[var(--muted)]">
            {speech.statusMessage ?? speech.engineStatus}
          </p>
          {speech.selectedProvider ? (
            <div className="grid gap-1 text-xs text-[var(--muted)]">
              <p>Runtime: {speech.selectedProvider.runtime.label}</p>
              <p>Source: {speech.selectedProvider.source_label}</p>
              {speech.selectedModel?.license_label ? (
                <p>License: {speech.selectedModel.license_label}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </SettingContainer>

      <SettingContainer
        title="Offline Voice Packs"
        description="Download and remove packaged offline voices hosted with Vox Jot model assets."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
      >
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)]">
            {speech.loadingPacks
              ? "Loading pack catalog..."
              : "Offline packs are managed separately from STT models so Vox Jot can expand speech output over time."}
          </p>
          <div className="space-y-2">
            {speech.packs.map((pack) => (
              <div
                key={pack.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text)]">
                    {pack.label}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {pack.archive_name}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)]">
                    {pack.installed ? "Installed" : "Not installed"}
                  </span>
                  {pack.installed ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={speech.busyPackId === pack.id}
                      onClick={async () => {
                        speech.setBusyPackId(pack.id);
                        const result = await commands.removeTtsPack(pack.id);
                        if (result.status !== "ok") {
                          speech.setStatusMessage(result.error);
                        } else {
                          speech.setStatusMessage(null);
                          await speech.refreshPacks();
                          await speech.refreshVoices();
                        }
                        speech.setBusyPackId(null);
                      }}
                    >
                      Remove
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={speech.busyPackId === pack.id}
                      onClick={async () => {
                        speech.setBusyPackId(pack.id);
                        const result = await commands.downloadTtsPack(pack.id);
                        if (result.status !== "ok") {
                          speech.setStatusMessage(result.error);
                        } else {
                          speech.setStatusMessage(null);
                          await speech.refreshPacks();
                          await speech.refreshVoices();
                        }
                        speech.setBusyPackId(null);
                      }}
                    >
                      Download
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingContainer>
    </SettingsGroup>
  );
};

export const SpeechAutoReadbackSettingsCard: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const { settings, updateSetting, isUpdating } = useSettings();

  if (!settings) {
    return null;
  }

  const ttsEnabled = settings.tts_enabled ?? false;

  return (
    <SettingsGroup title={showGroupTitle ? "Auto Readback" : undefined}>
      <SettingContainer
        title="Auto Readback"
        description="Choose when Vox Jot automatically speaks the final output."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!ttsEnabled}
      >
        <SelectField
          value={settings.tts_auto_readback_mode ?? "off"}
          onChange={(value) =>
            void updateSetting("tts_auto_readback_mode", value as any)
          }
          disabled={!ttsEnabled || isUpdating("tts_auto_readback_mode")}
          options={[
            { value: "off", label: "Off" },
            { value: "after_output", label: "After output" },
            {
              value: "after_preview_confirm",
              label: "After preview confirm",
            },
          ]}
        />
      </SettingContainer>

      <SettingContainer
        title="Readback Scope"
        description="Control whether automatic readback applies only to dictation or also to selection actions."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!ttsEnabled}
      >
        <SelectField
          value={settings.tts_auto_readback_scope ?? "dictation_only"}
          onChange={(value) =>
            void updateSetting("tts_auto_readback_scope", value as any)
          }
          disabled={!ttsEnabled || isUpdating("tts_auto_readback_scope")}
          options={[
            { value: "dictation_only", label: "Dictation only" },
            {
              value: "dictation_and_selection",
              label: "Dictation and selection",
            },
          ]}
        />
      </SettingContainer>

      <SettingContainer
        title="Readback Text"
        description="Choose whether bilingual output reads the translated block or the full final output."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!ttsEnabled}
      >
        <SelectField
          value={settings.tts_readback_text_mode ?? "final_output"}
          onChange={(value) =>
            void updateSetting("tts_readback_text_mode", value as any)
          }
          disabled={!ttsEnabled || isUpdating("tts_readback_text_mode")}
          options={[
            { value: "final_output", label: "Final output" },
            { value: "translated_block", label: "Translated block" },
          ]}
        />
      </SettingContainer>

      <ToggleSwitch
        checked={settings.tts_stop_on_record ?? true}
        onChange={(enabled) =>
          void updateSetting("tts_stop_on_record", enabled)
        }
        isUpdating={isUpdating("tts_stop_on_record")}
        label="Stop Speech On Record"
        description="Cancel current speech output as soon as recording starts."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!ttsEnabled}
      />

      <Slider
        value={settings.tts_rate ?? 1}
        onChange={(value) => void updateSetting("tts_rate", value)}
        min={0.5}
        max={2}
        step={0.05}
        label="Speech Rate"
        description="Adjust how quickly Vox Jot reads text aloud."
        descriptionMode="tooltip"
        grouped={true}
        formatValue={(value) => `${value.toFixed(2)}x`}
        disabled={!ttsEnabled}
      />

      <Slider
        value={settings.tts_volume ?? 1}
        onChange={(value) => void updateSetting("tts_volume", value)}
        min={0}
        max={1}
        step={0.05}
        label="Speech Volume"
        description="Playback volume for spoken output on the selected output device."
        descriptionMode="tooltip"
        grouped={true}
        formatValue={(value) => `${Math.round(value * 100)}%`}
        disabled={!ttsEnabled}
      />
    </SettingsGroup>
  );
};

export const SpeechPlaybackDeviceSettingsCard: React.FC<{
  showGroupTitle?: boolean;
}> = ({ showGroupTitle = true }) => {
  const { settings } = useSettings();

  return (
    <SettingsGroup title={showGroupTitle ? "Playback Device" : undefined}>
      <OutputDeviceSelector
        descriptionMode="tooltip"
        grouped={true}
        disabled={!(settings?.tts_enabled || settings?.audio_feedback)}
      />
    </SettingsGroup>
  );
};

export const SpeechOutputSettingsCard: React.FC = () => {
  return (
    <div className="space-y-6">
      <SpeechVoiceEngineSettingsCard />
      <SpeechAutoReadbackSettingsCard />
      <SpeechPlaybackDeviceSettingsCard />
    </div>
  );
};
