import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, HardDrive, XCircle } from "lucide-react";
import { commands, type ExternalModelStorageStatus } from "@/bindings";
import { useSettings } from "@/hooks/useSettings";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { Button } from "@/components/ui/Button";
import { PathDisplay } from "@/components/ui/PathDisplay";
import { SettingContainer } from "@/components/ui/SettingContainer";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";

const emptyStatus = (): ExternalModelStorageStatus => ({
  enabled: false,
  auto_detect: true,
  connected: false,
  configured_path: null,
  resolved_path: null,
  volume_name: null,
  model_count: 0,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const ExternalModelStorage: React.FC<{
  grouped?: boolean;
}> = ({ grouped = true }) => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const enabled = getSetting("external_model_storage_enabled") ?? false;
  const autoDetect = getSetting("external_model_storage_auto_detect") ?? true;
  const [status, setStatus] = useState<ExternalModelStorageStatus>(emptyStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyStatus = useCallback((next: ExternalModelStorageStatus) => {
    setStatus(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void commands
      .getExternalModelStorageStatus()
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ok") {
          applyStatus(result.data);
          setError(null);
        } else {
          setError(result.error);
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(errorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [applyStatus, enabled, autoDetect]);

  useTauriEvent<ExternalModelStorageStatus>(
    "external-model-storage-changed",
    (event) => {
      applyStatus(event.payload);
      setError(null);
    },
  );

  const refreshAfterSettingChange = async () => {
    await refreshSettings();
    const result = await commands.refreshExternalModelStorage();
    if (result.status === "error") {
      setError(result.error);
      return;
    }
    applyStatus(result.data);
    setError(null);
  };

  const handleEnabledChange = async (value: boolean) => {
    setBusy(true);
    try {
      const result =
        await commands.changeExternalModelStorageEnabledSetting(value);
      if (result.status === "error") {
        setError(result.error);
        return;
      }
      await refreshAfterSettingChange();
    } catch (settingError) {
      setError(errorMessage(settingError));
    } finally {
      setBusy(false);
    }
  };

  const handleAutoDetectChange = async (value: boolean) => {
    setBusy(true);
    try {
      const result =
        await commands.changeExternalModelStorageAutoDetectSetting(value);
      if (result.status === "error") {
        setError(result.error);
        return;
      }
      await refreshAfterSettingChange();
    } catch (settingError) {
      setError(errorMessage(settingError));
    } finally {
      setBusy(false);
    }
  };

  const handleBrowse = async () => {
    setBusy(true);
    try {
      const result = await commands.pickExternalModelStorageDir();
      if (result.status === "ok") {
        applyStatus(result.data);
        setError(null);
        await refreshSettings();
      } else {
        setError(result.error);
      }
    } catch (browseError) {
      setError(errorMessage(browseError));
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      const result = await commands.changeExternalModelStoragePathSetting(null);
      if (result.status === "error") {
        setError(result.error);
        return;
      }
      await refreshAfterSettingChange();
    } catch (clearError) {
      setError(errorMessage(clearError));
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async () => {
    if (!status.resolved_path && !status.configured_path) return;
    try {
      const result = await commands.openExternalModelStorageDir();
      if (result.status === "error") {
        setError(result.error);
      } else {
        setError(null);
      }
    } catch (openError) {
      setError(errorMessage(openError));
    }
  };

  const connectedLabel = status.connected
    ? t("appSections.privacy.externalModelStorage.connected", {
        volume:
          status.volume_name ??
          t("appSections.privacy.externalModelStorage.unnamedVolume"),
        count: status.model_count,
      })
    : t("appSections.privacy.externalModelStorage.disconnected");

  const displayPath = status.resolved_path ?? status.configured_path ?? "";

  return (
    <div className="space-y-0">
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => void handleEnabledChange(value)}
        isUpdating={busy}
        label={t("appSections.privacy.externalModelStorage.enabledLabel")}
        description={t(
          "appSections.privacy.externalModelStorage.enabledDescription",
        )}
        descriptionMode="inline"
        grouped={grouped}
      />
      {error ? (
        <p
          role="alert"
          className="border-x border-b border-[color-mix(in_srgb,var(--danger),transparent_65%)] bg-[var(--danger-soft)] px-3 py-2 text-sm leading-5 text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}
      {enabled ? (
        <>
          <ToggleSwitch
            checked={autoDetect}
            onChange={(value) => void handleAutoDetectChange(value)}
            isUpdating={busy}
            label={t(
              "appSections.privacy.externalModelStorage.autoDetectLabel",
            )}
            description={t(
              "appSections.privacy.externalModelStorage.autoDetectDescription",
            )}
            descriptionMode="inline"
            grouped={grouped}
          />
          <SettingContainer
            title={t("appSections.privacy.externalModelStorage.folderTitle")}
            description={t(
              "appSections.privacy.externalModelStorage.folderDescription",
            )}
            descriptionMode="inline"
            grouped={grouped}
            layout="stacked"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${
                  status.connected
                    ? "border-[color-mix(in_srgb,var(--success),transparent_72%)] bg-[var(--success-soft)] text-[var(--success)]"
                    : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--muted)]"
                }`}
              >
                {status.connected ? (
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                ) : (
                  <XCircle className="h-3 w-3" aria-hidden />
                )}
                {connectedLabel}
              </span>
            </div>
            {displayPath ? (
              <PathDisplay
                path={displayPath}
                onOpen={() => void handleOpen()}
                disabled={!displayPath}
                ariaLabel={t(
                  "appSections.privacy.externalModelStorage.pathLabel",
                )}
              />
            ) : (
              <p className="text-sm leading-6 text-[var(--muted)]">
                {t("appSections.privacy.externalModelStorage.noFolder")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleBrowse()}
                disabled={busy}
              >
                <HardDrive className="h-4 w-4" aria-hidden />
                {t("appSections.privacy.externalModelStorage.browse")}
              </Button>
              {status.configured_path ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleClear()}
                  disabled={busy}
                >
                  {t("appSections.privacy.externalModelStorage.clear")}
                </Button>
              ) : null}
            </div>
          </SettingContainer>
        </>
      ) : null}
    </div>
  );
};
