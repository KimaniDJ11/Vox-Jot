import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Play, RefreshCw, Square } from "lucide-react";
import { commands, type TtsPackInfo, type VoiceInfo } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Slider } from "@/components/ui/Slider";
import { Button } from "@/components/ui/Button";

function SelectField({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      className="min-w-[220px] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function localeLabel(locale: string | null | undefined) {
  return locale ? ` (${locale})` : "";
}

export const SpeechOutputSettingsCard: React.FC = () => {
  const { settings, updateSetting, isUpdating } = useSettings();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [packs, setPacks] = useState<TtsPackInfo[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [loadingPacks, setLoadingPacks] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refreshVoices = useCallback(async () => {
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

  const refreshPacks = useCallback(async () => {
    setLoadingPacks(true);
    const result = await commands.getAvailableTtsPacks();
    if (result.status === "ok") {
      setPacks(result.data);
    }
    setLoadingPacks(false);
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }
    void refreshVoices();
    void refreshPacks();
  }, [refreshPacks, refreshVoices, settings?.tts_engine_preference, settings?.tts_enabled]);

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

  const engineStatus = useMemo(() => {
    if (!settings) {
      return null;
    }

    switch (settings.tts_engine_preference) {
      case "system":
        return "System voices are available on macOS and Windows. Linux needs an offline pack or sidecar.";
      case "sherpa_onnx":
        return packInstalled
          ? "Offline voice packs are installed and ready to manage."
          : "Install an offline voice pack to prepare cross-platform neural speech output.";
      case "sidecar":
        return "Sidecar mode sends speech requests to a local TTS API endpoint.";
      default:
        return packInstalled
          ? "Auto mode will prefer system voices when available and can use installed offline packs."
          : "Auto mode uses system voices on macOS and Windows, and falls back to other configured engines.";
    }
  }, [packInstalled, settings]);

  if (!settings) {
    return null;
  }

  return (
    <SettingsGroup title="Speech Output">
      <ToggleSwitch
        checked={ttsEnabled}
        onChange={(enabled) => void updateSetting("tts_enabled", enabled)}
        isUpdating={isUpdating("tts_enabled")}
        label="Enable Speech Output"
        description="Read back final Vox Jot output after dictation, translation, or selection flows."
        descriptionMode="tooltip"
        grouped={true}
      />

      <SettingContainer
        title="Speech Engine"
        description="Choose whether Vox Jot uses platform voices, downloadable offline packs, or a local sidecar."
        descriptionMode="tooltip"
        grouped={true}
      >
        <SelectField
          value={settings.tts_engine_preference ?? "auto"}
          onChange={(value) =>
            void updateSetting("tts_engine_preference", value as any)
          }
          disabled={isUpdating("tts_engine_preference")}
          options={[
            { value: "auto", label: "Auto" },
            { value: "system", label: "System" },
            { value: "sherpa_onnx", label: "Offline pack" },
            { value: "sidecar", label: "Local sidecar" },
          ]}
        />
      </SettingContainer>

      <SettingContainer
        title="Voice"
        description="Pick a default voice for playback and preview it before using it in dictation flows."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
        disabled={!ttsEnabled}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              value={selectedVoiceId}
              onChange={(value) =>
                void updateSetting(
                  "tts_default_voice_id",
                  value === "__auto__" ? null : value,
                )
              }
              disabled={!ttsEnabled || loadingVoices || isUpdating("tts_default_voice_id")}
              options={voiceOptions}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void refreshVoices()}
              disabled={loadingVoices}
              className="inline-flex items-center gap-1"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingVoices ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={async () => {
                setPreviewingVoice(true);
                const result = await commands.previewTtsVoice(
                  settings.tts_default_voice_id ?? null,
                );
                if (result.status !== "ok") {
                  setStatusMessage(result.error);
                } else {
                  setStatusMessage(null);
                }
                setPreviewingVoice(false);
              }}
              disabled={!ttsEnabled || previewingVoice}
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
              disabled={!ttsEnabled}
              className="inline-flex items-center gap-1"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          </div>
          <p className="text-xs text-[var(--muted)]">
            {statusMessage ?? engineStatus}
          </p>
        </div>
      </SettingContainer>

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
        onChange={(enabled) => void updateSetting("tts_stop_on_record", enabled)}
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

      <SettingContainer
        title="Offline Voice Packs"
        description="Download and remove packaged offline voices hosted with Vox Jot model assets."
        descriptionMode="tooltip"
        grouped={true}
        layout="stacked"
      >
        <div className="space-y-3">
          <p className="text-xs text-[var(--muted)]">
            {loadingPacks
              ? "Loading pack catalog..."
              : "Offline packs are managed separately from STT models so Vox Jot can expand speech output over time."}
          </p>
          <div className="space-y-2">
            {packs.map((pack) => (
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
                      disabled={busyPackId === pack.id}
                      onClick={async () => {
                        setBusyPackId(pack.id);
                        const result = await commands.removeTtsPack(pack.id);
                        if (result.status !== "ok") {
                          setStatusMessage(result.error);
                        } else {
                          setStatusMessage(null);
                          await refreshPacks();
                          await refreshVoices();
                        }
                        setBusyPackId(null);
                      }}
                    >
                      Remove
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busyPackId === pack.id}
                      onClick={async () => {
                        setBusyPackId(pack.id);
                        const result = await commands.downloadTtsPack(pack.id);
                        if (result.status !== "ok") {
                          setStatusMessage(result.error);
                        } else {
                          setStatusMessage(null);
                          await refreshPacks();
                          await refreshVoices();
                        }
                        setBusyPackId(null);
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
