import { listen } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";

import {
  commands,
  type InstalledApp,
  type ScreenContextDiagnostics,
} from "@/bindings";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import {
  Dropdown,
  SettingContainer,
  SettingsGroup,
  Slider,
  SwitchControl,
} from "@/components/ui";
import {
  useSettings,
  useSettingsSlice,
  useUpdateSetting,
} from "@/hooks/useSettings";
import { useSettingsStore } from "@/stores/settingsStore";

const REFRESH_INTERVAL_MS = 5000;

const ScreenContextSettingsSection: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const updateSetting = useUpdateSetting();
  const isUpdating = useSettingsStore((state) => state.isUpdatingKey);

  const {
    screen_context_enabled: enabledValue,
    screen_context_excluded_bundle_ids: excludedValue,
    screen_context_pause_on_idle: pauseOnIdleValue,
    screen_context_idle_threshold_ms: idleThresholdValue,
    context_capture_mode: captureModeValue,
    screen_context_ocr_quality: ocrQualityValue,
    screen_context_ocr_timeout_ms: ocrTimeoutValue,
    screen_context_token_budget: tokenBudgetValue,
    screen_context_stale_threshold_ms: staleThresholdValue,
  } = useSettingsSlice([
    "screen_context_enabled",
    "screen_context_excluded_bundle_ids",
    "screen_context_pause_on_idle",
    "screen_context_idle_threshold_ms",
    "context_capture_mode",
    "screen_context_ocr_quality",
    "screen_context_ocr_timeout_ms",
    "screen_context_token_budget",
    "screen_context_stale_threshold_ms",
  ] as const);

  const debugMode = getSetting("debug_mode") ?? false;

  const enabled = enabledValue ?? true;
  const excluded = useMemo(
    () =>
      (excludedValue as
        | { bundle_id: string; name: string }[]
        | string[]
        | undefined) ?? [],
    [excludedValue],
  );
  const pauseOnIdle = pauseOnIdleValue ?? true;
  const idleThreshold = idleThresholdValue ?? 60_000;
  const captureMode = captureModeValue ?? "always_frequent";
  const ocrQuality = ocrQualityValue ?? "balanced";
  const ocrTimeout = ocrTimeoutValue ?? 700;
  const tokenBudget = tokenBudgetValue ?? 400;
  const staleThreshold = staleThresholdValue ?? 2500;

  const [diagnostics, setDiagnostics] =
    useState<ScreenContextDiagnostics | null>(null);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [resolvedAppNames, setResolvedAppNames] = useState<
    Record<string, string>
  >({});
  const [addAppError, setAddAppError] = useState<string | null>(null);
  const [addingApp, setAddingApp] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    const result = await commands.getScreenContextDiagnostics();
    if (result.status === "ok") {
      setDiagnostics(result.data);
    }
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
    const id = window.setInterval(() => {
      void refreshDiagnostics();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshDiagnostics]);

  useEffect(() => {
    commands.listInstalledApps().then((result) => {
      if (result.status === "ok") {
        setInstalledApps(result.data);
      }
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    let cleanup = () => {};

    const setup = async () => {
      const unlistenStatus = await listen("screen-context-status", () => {
        void refreshDiagnostics();
      });
      const unlistenCapture = await listen("screen-context-capture", () => {
        void refreshDiagnostics();
      });

      if (!isMounted) {
        unlistenStatus();
        unlistenCapture();
        return;
      }

      cleanup = () => {
        unlistenStatus();
        unlistenCapture();
      };
    };

    void setup();

    return () => {
      isMounted = false;
      cleanup();
    };
  }, [refreshDiagnostics]);

  const controlsDisabled = !enabled;

  const statusLabel = useMemo(() => {
    if (!diagnostics) {
      return t("settings.screenContext.statusUnknown");
    }
    switch (diagnostics.status) {
      case "disabled":
        return t("settings.screenContext.statusDisabled");
      case "excluded_app":
        return t("settings.screenContext.statusExcluded");
      case "paused_idle":
        return t("settings.screenContext.statusPausedIdle");
      default:
        return diagnostics.status;
    }
  }, [diagnostics, t]);

  const excludedEntries: { bundle_id: string; name: string }[] = useMemo(() => {
    const installedNames = new Map(
      installedApps.map((app) => [app.bundle_id.toLowerCase(), app.name]),
    );
    return excluded.map((entry) => {
      if (typeof entry === "string") {
        const resolvedName =
          resolvedAppNames[entry.toLowerCase()] ??
          installedNames.get(entry.toLowerCase()) ??
          entry;
        return { bundle_id: entry, name: resolvedName };
      }
      const resolvedName =
        entry.name ||
        resolvedAppNames[entry.bundle_id.toLowerCase()] ||
        installedNames.get(entry.bundle_id.toLowerCase()) ||
        entry.bundle_id;
      return { bundle_id: entry.bundle_id, name: resolvedName };
    });
  }, [excluded, installedApps, resolvedAppNames]);

  const removeExcludedApp = async (bundleId: string) => {
    const next = excludedEntries
      .filter((entry) => entry.bundle_id !== bundleId)
      .map((entry) => entry.bundle_id);
    await updateSetting("screen_context_excluded_bundle_ids", next as never);
  };

  const addCurrentApp = async () => {
    setAddAppError(null);
    setAddingApp(true);
    try {
      const result = await commands.getFrontmostAppForExclusion();
      if (result.status !== "ok") {
        setAddAppError(t("settings.screenContext.addCurrentAppFailed"));
        return;
      }
      const bundleId = result.data.bundle_id?.trim();
      if (!bundleId) {
        setAddAppError(t("settings.screenContext.addCurrentAppFailed"));
        return;
      }
      if (
        excludedEntries.some(
          (entry) => entry.bundle_id.toLowerCase() === bundleId.toLowerCase(),
        )
      ) {
        setAddAppError(
          t("settings.screenContext.addCurrentAppAlreadyExcluded", {
            name: result.data.localized_name || bundleId,
          }),
        );
        return;
      }
      setResolvedAppNames((current) => ({
        ...current,
        [bundleId.toLowerCase()]: result.data.localized_name || bundleId,
      }));
      const next = [...excludedEntries.map((e) => e.bundle_id), bundleId];
      await updateSetting("screen_context_excluded_bundle_ids", next as never);
    } finally {
      setAddingApp(false);
    }
  };

  const openPermissionSettings = async () => {
    await commands.openScreenRecordingSettings();
  };

  const idleThresholdSeconds = Math.round(idleThreshold / 1000);

  return (
    <div className="space-y-6">
      <Alert variant="info">{t("settings.screenContext.intro")}</Alert>

      <SettingsGroup title={t("settings.screenContext.title")}>
        <SettingContainer
          title={t("settings.screenContext.enableLabel")}
          description={t("settings.screenContext.enableDescription")}
          grouped={true}
        >
          <SwitchControl
            checked={enabled as boolean}
            onChange={(value) =>
              void updateSetting("screen_context_enabled", value as never)
            }
            disabled={isUpdating("screen_context_enabled")}
          />
        </SettingContainer>
      </SettingsGroup>

      {diagnostics && !diagnostics.has_screen_permission && enabled ? (
        <SettingsGroup title={t("settings.screenContext.permissionCtaLabel")}>
          <div className="space-y-3 px-5 py-4 text-sm text-[var(--muted)]">
            <p>{t("settings.screenContext.permissionCtaDescription")}</p>
            <Button onClick={() => void openPermissionSettings()} size="sm">
              {t("settings.screenContext.permissionCtaButton")}
            </Button>
          </div>
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={t("settings.screenContext.captureCadenceTitle")}>
        <SettingContainer
          title="Capture Mode"
          description="Choose how often Vox Jot updates screen text while the app is open."
          grouped={true}
        >
          <Dropdown
            selectedValue={captureMode as string}
            onSelect={(value) =>
              void updateSetting("context_capture_mode", value as never)
            }
            options={[
              { value: "always_frequent", label: "Live updates" },
              { value: "adaptive_cache", label: "Balanced" },
              { value: "mostly_on_demand", label: "On-demand first" },
            ]}
            disabled={controlsDisabled || isUpdating("context_capture_mode")}
          />
        </SettingContainer>
        <SettingContainer
          title="Text Recognition Quality"
          description="Choose faster capture or more accurate text recognition."
          grouped={true}
        >
          <Dropdown
            selectedValue={ocrQuality as string}
            onSelect={(value) =>
              void updateSetting("screen_context_ocr_quality", value as never)
            }
            options={[
              { value: "fast", label: "Fast" },
              { value: "balanced", label: "Balanced" },
              { value: "accurate", label: "Accurate" },
            ]}
            disabled={
              controlsDisabled || isUpdating("screen_context_ocr_quality")
            }
          />
        </SettingContainer>
        <Slider
          value={ocrTimeout as number}
          onChange={(value) =>
            void updateSetting(
              "screen_context_ocr_timeout_ms",
              Math.round(value) as never,
            )
          }
          min={200}
          max={2000}
          step={50}
          label="Recognition Timeout"
          description="How long Vox Jot waits when reading text from one screen capture."
          grouped={true}
          formatValue={(value) => `${Math.round(value)} ms`}
          disabled={controlsDisabled}
        />
        <Slider
          value={staleThreshold as number}
          onChange={(value) =>
            void updateSetting(
              "screen_context_stale_threshold_ms",
              Math.round(value) as never,
            )
          }
          min={500}
          max={5000}
          step={100}
          label="Recency Window"
          description="How recent captured screen text must be before Vox Jot refreshes it."
          grouped={true}
          formatValue={(value) => `${Math.round(value)} ms`}
          disabled={controlsDisabled}
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.screenContext.contextBudgetTitle")}>
        <Slider
          value={tokenBudget as number}
          onChange={(value) =>
            void updateSetting(
              "screen_context_token_budget",
              Math.round(value) as never,
            )
          }
          min={100}
          max={1200}
          step={25}
          label="Context Amount"
          description="How much recent screen text Vox Jot can use during dictation cleanup."
          grouped={true}
          formatValue={(value) => `${Math.round(value)} units`}
          disabled={controlsDisabled}
        />
        <SettingContainer
          title={t("settings.screenContext.pauseOnIdleLabel")}
          description={t("settings.screenContext.pauseOnIdleDescription")}
          grouped={true}
        >
          <SwitchControl
            checked={pauseOnIdle as boolean}
            onChange={(value) =>
              void updateSetting("screen_context_pause_on_idle", value as never)
            }
            disabled={
              controlsDisabled || isUpdating("screen_context_pause_on_idle")
            }
          />
        </SettingContainer>
        <Slider
          value={idleThresholdSeconds}
          onChange={(value) =>
            void updateSetting(
              "screen_context_idle_threshold_ms",
              (Math.round(value) * 1000) as never,
            )
          }
          min={10}
          max={600}
          step={5}
          label={t("settings.screenContext.idleThresholdLabel")}
          description={t("settings.screenContext.idleThresholdDescription")}
          grouped={true}
          formatValue={(value) =>
            t("settings.screenContext.idleThresholdValue", {
              seconds: Math.round(value),
            })
          }
          disabled={controlsDisabled || !pauseOnIdle}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.screenContext.exclusionsTitle")}
        titleAction={
          <Button
            onClick={() => void addCurrentApp()}
            size="sm"
            disabled={
              controlsDisabled ||
              addingApp ||
              isUpdating("screen_context_excluded_bundle_ids")
            }
          >
            {addingApp
              ? t("settings.screenContext.addCurrentAppResolving")
              : t("settings.screenContext.addCurrentAppLabel")}
          </Button>
        }
      >
        <div className="space-y-3 px-5 py-4 text-sm text-[var(--muted)]">
          <p>{t("settings.screenContext.exclusionsDescription")}</p>
          {addAppError ? <Alert variant="info">{addAppError}</Alert> : null}
          {excludedEntries.length === 0 ? (
            <p className="italic">
              {t("settings.screenContext.exclusionsEmpty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {excludedEntries.map((entry) => (
                <li
                  key={entry.bundle_id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--text)]">
                      {entry.name || entry.bundle_id}
                    </div>
                    {debugMode ? (
                      <div className="truncate text-xs text-[var(--muted)]">
                        {entry.bundle_id}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    onClick={() => void removeExcludedApp(entry.bundle_id)}
                    size="sm"
                    variant="ghost"
                    aria-label={t(
                      "settings.screenContext.removeExclusionLabel",
                    )}
                    disabled={isUpdating("screen_context_excluded_bundle_ids")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Screen Context Status"
        titleAction={
          debugMode ? (
            <Button onClick={() => void refreshDiagnostics()} size="sm">
              {t("settings.refineModels.refresh")}
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-3 px-5 py-4 text-sm text-[var(--muted)]">
          <p>
            {t("settings.screenContext.statusLabel")}{" "}
            <span className="font-semibold text-[var(--text)]">
              {statusLabel}
            </span>
          </p>
          <p>
            {t("settings.screenContext.screenRecordingLabel")}{" "}
            <span className="font-semibold text-[var(--text)]">
              {diagnostics?.has_screen_permission
                ? t("settings.screenContext.screenRecordingGranted")
                : t("settings.screenContext.screenRecordingMissing")}
            </span>
          </p>
          {debugMode ? (
            <>
              <p>
                {t("settings.screenContext.cacheSizeLabel")} {" "}
                <span className="font-semibold text-[var(--text)]">
                  {diagnostics?.cache_size ?? 0}
                </span>
              </p>
              <p>
                {t("settings.screenContext.latestContextAgeLabel")} {" "}
                <span className="font-semibold text-[var(--text)]">
                  {diagnostics?.latest_context_age_ms != null
                    ? t("settings.screenContext.latestContextAgeValue", {
                        ms: diagnostics.latest_context_age_ms,
                      })
                    : t("settings.screenContext.latestContextAgeUnavailable")}
                </span>
              </p>
              {diagnostics?.last_error ? (
                <Alert variant="info">{diagnostics.last_error}</Alert>
              ) : null}
            </>
          ) : null}
          {debugMode ? (
            <details className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-[var(--text)]">
                {t("settings.screenContext.debugPreviewTitle")}
              </summary>
              <div className="mt-2 whitespace-pre-wrap text-xs text-[var(--muted)]">
                {diagnostics?.latest_preview_text
                  ? diagnostics.latest_preview_text
                  : t("settings.screenContext.debugPreviewEmpty")}
              </div>
            </details>
          ) : null}
        </div>
      </SettingsGroup>
    </div>
  );
};

export default ScreenContextSettingsSection;
