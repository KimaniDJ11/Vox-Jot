import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { useSettings } from "../../../hooks/useSettings";
import { CorrectionDictionaryView } from "./CorrectionDictionaryView";

export const CorrectionSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const trackingEnabled = getSetting("correction_tracking_enabled") || false;
  const autoApply = getSetting("auto_apply_corrections") ?? true;
  const promptBias = getSetting("correction_prompt_bias_enabled") || false;
  const monitoringDelay = getSetting("correction_monitoring_delay_secs") ?? 30;
  const minFrequency = getSetting("correction_min_frequency") ?? 2;
  const minConfidence = getSetting("correction_min_confidence") ?? 0.5;

  return (
    <div className="w-full space-y-6">
      <SettingsGroup
        title={t("settings.corrections.title")}
        description={t("settings.corrections.description")}
      >
        <ToggleSwitch
          checked={trackingEnabled}
          onChange={(enabled) =>
            updateSetting("correction_tracking_enabled", enabled)
          }
          isUpdating={isUpdating("correction_tracking_enabled")}
          label={t("settings.corrections.tracking.label")}
          description={t("settings.corrections.tracking.description")}
          descriptionMode="tooltip"
          grouped={true}
        />
        <ToggleSwitch
          checked={autoApply}
          onChange={(enabled) =>
            updateSetting("auto_apply_corrections", enabled)
          }
          isUpdating={isUpdating("auto_apply_corrections")}
          label={t("settings.corrections.autoApply.label")}
          description={t("settings.corrections.autoApply.description")}
          descriptionMode="tooltip"
          grouped={true}
          disabled={!trackingEnabled}
        />
        <ToggleSwitch
          checked={promptBias}
          onChange={(enabled) =>
            updateSetting("correction_prompt_bias_enabled", enabled)
          }
          isUpdating={isUpdating("correction_prompt_bias_enabled")}
          label={t("settings.corrections.promptBias.label")}
          description={t("settings.corrections.promptBias.description")}
          descriptionMode="tooltip"
          grouped={true}
          disabled={!trackingEnabled}
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.corrections.thresholds.title")}>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">
              {t("settings.corrections.monitoringDelay.label")}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {t("settings.corrections.monitoringDelay.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={120}
              step={5}
              value={monitoringDelay}
              onChange={(e) =>
                updateSetting(
                  "correction_monitoring_delay_secs",
                  Number(e.target.value),
                )
              }
              disabled={!trackingEnabled}
              className="w-24 accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--muted)] w-10 text-right">
              {monitoringDelay}s
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">
              {t("settings.corrections.minFrequency.label")}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {t("settings.corrections.minFrequency.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={20}
              value={minFrequency}
              onChange={(e) =>
                updateSetting(
                  "correction_min_frequency",
                  Number(e.target.value),
                )
              }
              disabled={!trackingEnabled}
              className="w-16 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--text)] text-center"
            />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">
              {t("settings.corrections.minConfidence.label")}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {t("settings.corrections.minConfidence.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={minConfidence}
              onChange={(e) =>
                updateSetting(
                  "correction_min_confidence",
                  Number(e.target.value),
                )
              }
              disabled={!trackingEnabled}
              className="w-24 accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--muted)] w-10 text-right">
              {(minConfidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settings.corrections.dictionary.title")}>
        <CorrectionDictionaryView />
      </SettingsGroup>
    </div>
  );
};
