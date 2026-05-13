import { listen } from "@tauri-apps/api/event";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  CheckCircle2,
  FileText,
  Monitor,
  Plus,
  ScanSearch,
  Shield,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";

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
import { confirmDestructiveAction } from "@/lib/confirmDestructiveAction";
import {
  MetricTile,
  PreviewSlate,
  SectionHero,
} from "@/components/app-sections/settings-shared";

const REFRESH_INTERVAL_MS = 5000;

const ScreenContextHero: React.FC<{
  enabled: boolean;
  permissionGranted: boolean;
}> = ({ enabled, permissionGranted }) => {
  const { t } = useTranslation();
  return (
    <SectionHero
      icon={<ScanSearch className="h-5 w-5" aria-hidden />}
      eyebrow={t("appSections.hero.screenContext.eyebrow")}
      title={t("appSections.hero.screenContext.title")}
      description={t("appSections.hero.screenContext.description")}
      tone={enabled ? "accent" : "neutral"}
      stats={[
        {
          label: t("appSections.screenContext.captureStatusLabel"),
          value: enabled
            ? t("appSections.screenContext.previewBadgeOn")
            : t("appSections.screenContext.previewBadgeOff"),
        },
        {
          label: t("appSections.screenContext.permissionStatLabel"),
          value: permissionGranted
            ? t("appSections.screenContext.permissionGranted")
            : t("appSections.screenContext.permissionMissing"),
        },
      ]}
      visual={<HeroPreview enabled={enabled} />}
    />
  );
};

const HeroPreview: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const { t } = useTranslation();
  return (
    <PreviewSlate className="w-full">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            {t("appSections.screenContext.previewLabel")}
          </p>
          <span
            className={`inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold ${
              enabled
                ? "border-[color-mix(in_srgb,var(--success)_30%,var(--border))] bg-[var(--success-soft)] text-[var(--success)]"
                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
            }`}
          >
            {enabled
              ? t("appSections.screenContext.previewLive")
              : t("appSections.screenContext.previewPaused")}
          </span>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            <AppWindow className="h-3 w-3 text-[var(--accent)]" />
            <span className="text-[10.5px] font-semibold text-[var(--text)]">
              {t("appSections.screenContext.previewActiveApp")}
            </span>
          </div>
          <div className="rounded-md border-2 border-dashed border-[var(--accent)] bg-[var(--accent-soft)] p-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text)]">
              <FileText className="h-2.5 w-2.5 text-[var(--accent)]" />
              {t("appSections.screenContext.previewContextText")}
            </div>
            <div className="mt-1.5 space-y-1" aria-hidden>
              <span className="block h-1 w-5/6 rounded-full bg-[var(--accent)] opacity-90" />
              <span className="block h-1 w-2/3 rounded-full bg-[var(--accent)] opacity-60" />
              <span className="block h-1 w-3/4 rounded-full bg-[var(--accent)] opacity-40" />
            </div>
          </div>
        </div>
      </div>
    </PreviewSlate>
  );
};

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
    screen_context_ocr_engine: ocrEngineValue,
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
    "screen_context_ocr_engine",
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
  const ocrEngine = ocrEngineValue ?? "native_then_backup";
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
  const permissionGranted = !!diagnostics?.has_screen_permission;

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
    const appName =
      excludedEntries.find((entry) => entry.bundle_id === bundleId)?.name ??
      bundleId;
    if (
      !confirmDestructiveAction(
        t("settings.screenContext.removeExclusionConfirm", {
          appName,
          defaultValue: 'Remove "{{appName}}" from screen context exclusions?',
        }),
      )
    ) {
      return;
    }

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
      <ScreenContextHero
        enabled={enabled as boolean}
        permissionGranted={permissionGranted}
      />

      {diagnostics && !diagnostics.has_screen_permission && enabled ? (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-[var(--warning-soft)] px-5 py-4 shadow-[var(--shadow-sm)]">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--warning-soft)] text-[var(--warning)]">
              <Shield className="h-4 w-4" />
            </span>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-[var(--text)]">
                {t("appSections.screenContext.permissionTitle")}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
                {t("appSections.screenContext.permissionDetail")}
              </p>
              <Button
                onClick={() => void openPermissionSettings()}
                size="sm"
                className="mt-3"
              >
                {t("settings.screenContext.permissionCtaButton")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <SettingsGroup title={t("settings.screenContext.title")}>
        <SettingContainer
          title={t("settings.screenContext.enableLabel")}
          description={t("settings.screenContext.enableDescription")}
          descriptionMode="inline"
          grouped={true}
        >
          <SwitchControl
            checked={enabled as boolean}
            onChange={(value) =>
              void updateSetting("screen_context_enabled", value as never)
            }
            disabled={isUpdating("screen_context_enabled")}
            ariaLabel={t("settings.screenContext.enableLabel")}
          />
        </SettingContainer>
      </SettingsGroup>

      <SettingsGroup title={t("settings.screenContext.captureCadenceTitle")}>
        <SettingContainer
          title={t("appSections.groups.captureMode")}
          description={t("appSections.groups.captureModeDescription")}
          descriptionMode="inline"
          grouped={true}
        >
          <Dropdown
            selectedValue={captureMode as string}
            onSelect={(value) =>
              void updateSetting("context_capture_mode", value as never)
            }
            options={[
              {
                value: "always_frequent",
                label: t("settings.screenContext.captureMode.alwaysFrequent"),
              },
              {
                value: "adaptive_cache",
                label: t("settings.screenContext.captureMode.adaptiveCache"),
              },
              {
                value: "mostly_on_demand",
                label: t("settings.screenContext.captureMode.mostlyOnDemand"),
              },
            ]}
            disabled={controlsDisabled || isUpdating("context_capture_mode")}
          />
        </SettingContainer>
        <SettingContainer
          title={t("appSections.groups.textRecognitionQuality")}
          description={t(
            "appSections.groups.textRecognitionQualityDescription",
          )}
          descriptionMode="inline"
          grouped={true}
        >
          <Dropdown
            selectedValue={ocrQuality as string}
            onSelect={(value) =>
              void updateSetting("screen_context_ocr_quality", value as never)
            }
            options={[
              {
                value: "fast",
                label: t("settings.screenContext.ocrQuality.fast"),
              },
              {
                value: "balanced",
                label: t("settings.screenContext.ocrQuality.balanced"),
              },
              {
                value: "accurate",
                label: t("settings.screenContext.ocrQuality.accurate"),
              },
            ]}
            disabled={
              controlsDisabled || isUpdating("screen_context_ocr_quality")
            }
          />
        </SettingContainer>
      </SettingsGroup>

      <details className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-sm)]">
        <summary className="cursor-pointer list-none px-5 py-4 text-[13px] font-semibold text-[var(--text)]">
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--muted)]" />
            {t("appSections.screenContext.advancedToggle")}
          </span>
        </summary>
        <div className="space-y-4 border-t border-[var(--border)] p-4">
          <SettingsGroup title={t("appSections.groups.recognitionEngine")}>
            <SettingContainer
              title={t("settings.screenContext.ocrEngineLabel")}
              description={t("settings.screenContext.ocrEngineDescription")}
              descriptionMode="inline"
              grouped={true}
            >
              <Dropdown
                selectedValue={ocrEngine as string}
                onSelect={(value) =>
                  void updateSetting(
                    "screen_context_ocr_engine",
                    value as never,
                  )
                }
                options={[
                  {
                    value: "native_then_backup",
                    label: t(
                      "settings.screenContext.ocrEngineNativeThenBackup",
                    ),
                  },
                  {
                    value: "auto",
                    label: t("settings.screenContext.ocrEngineAuto"),
                  },
                  {
                    value: "native_only",
                    label: t("settings.screenContext.ocrEngineNativeOnly"),
                  },
                  {
                    value: "backup_only",
                    label: t("settings.screenContext.ocrEngineBackupOnly"),
                  },
                ]}
                disabled={
                  controlsDisabled || isUpdating("screen_context_ocr_engine")
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
              label={t("appSections.groups.recognitionTimeout")}
              description={t(
                "appSections.groups.recognitionTimeoutDescription",
              )}
              descriptionMode="inline"
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
              label={t("appSections.groups.recencyWindow")}
              description={t("appSections.groups.recencyWindowDescription")}
              descriptionMode="inline"
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
              label={t("appSections.groups.contextAmount")}
              description={t("appSections.groups.contextAmountDescription")}
              descriptionMode="inline"
              grouped={true}
              formatValue={(value) => `${Math.round(value)} units`}
              disabled={controlsDisabled}
            />
            <SettingContainer
              title={t("settings.screenContext.pauseOnIdleLabel")}
              description={t("settings.screenContext.pauseOnIdleDescription")}
              descriptionMode="inline"
              grouped={true}
            >
              <SwitchControl
                checked={pauseOnIdle as boolean}
                onChange={(value) =>
                  void updateSetting(
                    "screen_context_pause_on_idle",
                    value as never,
                  )
                }
                disabled={
                  controlsDisabled || isUpdating("screen_context_pause_on_idle")
                }
                ariaLabel={t("settings.screenContext.pauseOnIdleLabel")}
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
              descriptionMode="inline"
              grouped={true}
              formatValue={(value) =>
                t("settings.screenContext.idleThresholdValue", {
                  seconds: Math.round(value),
                })
              }
              disabled={controlsDisabled || !pauseOnIdle}
            />
          </SettingsGroup>
        </div>
      </details>

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
            <Plus className="mr-1 h-3.5 w-3.5" />
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
            <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-6 text-center text-[12.5px] italic text-[var(--muted)]">
              {t("settings.screenContext.exclusionsEmpty")}
            </div>
          ) : (
            <ul className="space-y-2">
              {excludedEntries.map((entry) => (
                <li
                  key={entry.bundle_id}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-[var(--ring-hairline)] bg-[var(--card)] px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
                      <AppWindow className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-[var(--text)]">
                        {entry.name || entry.bundle_id}
                      </div>
                      {debugMode ? (
                        <div className="truncate text-[10.5px] text-[var(--muted)]">
                          {entry.bundle_id}
                        </div>
                      ) : null}
                    </div>
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

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          label={t("appSections.screenContext.captureStatusLabel")}
          tone={
            diagnostics?.status === "ready"
              ? "success"
              : diagnostics?.status === "disabled"
                ? "neutral"
                : "warning"
          }
          icon={
            diagnostics?.status === "ready" ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )
          }
          value={statusLabel}
        />
        <MetricTile
          label={t("appSections.screenContext.permissionStatLabel")}
          tone={permissionGranted ? "success" : "warning"}
          icon={<Monitor className="h-3 w-3" />}
          value={
            permissionGranted
              ? t("settings.screenContext.screenRecordingGranted")
              : t("settings.screenContext.screenRecordingMissing")
          }
        />
        {debugMode ? (
          <MetricTile
            label={t("appSections.screenContext.cacheStatLabel")}
            icon={<ScanSearch className="h-3 w-3" />}
            value={`${diagnostics?.cache_size ?? 0}`}
            hint={
              diagnostics?.latest_context_age_ms != null
                ? t("settings.screenContext.latestContextAgeValue", {
                    ms: diagnostics.latest_context_age_ms,
                  })
                : t("settings.screenContext.latestContextAgeUnavailable")
            }
          />
        ) : null}
      </section>

      {debugMode ? (
        <SettingsGroup
          title={t("appSections.screenContext.debugPreviewHeader")}
          titleAction={
            <Button onClick={() => void refreshDiagnostics()} size="sm">
              {t("settings.refineModels.refresh")}
            </Button>
          }
        >
          <div className="space-y-3 px-5 py-4 text-sm text-[var(--muted)]">
            {diagnostics?.last_error ? (
              <Alert variant="info">{diagnostics.last_error}</Alert>
            ) : null}
            <details className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-[var(--text)]">
                {t("settings.screenContext.debugPreviewTitle")}
              </summary>
              <div className="mt-2 whitespace-pre-wrap text-xs text-[var(--muted)]">
                {diagnostics?.latest_preview_text
                  ? diagnostics.latest_preview_text
                  : t("settings.screenContext.debugPreviewEmpty")}
              </div>
            </details>
          </div>
        </SettingsGroup>
      ) : null}
    </div>
  );
};

export default ScreenContextSettingsSection;
