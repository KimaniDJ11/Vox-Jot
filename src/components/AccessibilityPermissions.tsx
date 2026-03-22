import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  checkInputMonitoringPermission,
  requestAccessibilityPermission,
  requestInputMonitoringPermission,
} from "tauri-plugin-macos-permissions-api";

type MissingPermission = "accessibility" | "inputMonitoring" | null;

interface MacPermissionsState {
  accessibility: boolean;
  inputMonitoring: boolean;
}

const AccessibilityPermissions: React.FC = () => {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState<MacPermissionsState>({
    accessibility: false,
    inputMonitoring: false,
  });
  const [busyPermission, setBusyPermission] = useState<MissingPermission>(null);

  // Accessibility permissions are only required on macOS
  const isMacOS = type() === "macos";

  const refreshPermissions = async (): Promise<void> => {
    const [accessibility, inputMonitoring] = await Promise.all([
      checkAccessibilityPermission(),
      checkInputMonitoringPermission(),
    ]);

    setPermissions({
      accessibility,
      inputMonitoring,
    });
  };

  const requestPermission = async (
    permission: Exclude<MissingPermission, null>,
  ): Promise<void> => {
    setBusyPermission(permission);

    try {
      if (permission === "accessibility") {
        await requestAccessibilityPermission();
      } else {
        await requestInputMonitoringPermission();
      }
    } catch (error) {
      console.error(`Error requesting ${permission} permission:`, error);
    } finally {
      await refreshPermissions();
      setBusyPermission(null);
    }
  };

  // On app boot - check permissions (only on macOS)
  useEffect(() => {
    if (!isMacOS) return;

    const initialSetup = async (): Promise<void> => {
      await refreshPermissions();
    };

    void initialSetup();
  }, [isMacOS]);

  const hasAllPermissions =
    permissions.accessibility && permissions.inputMonitoring;

  if (!isMacOS || hasAllPermissions) {
    return null;
  }

  const buttonClassName =
    "rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent)] transition hover:bg-[color-mix(in_srgb,var(--accent),transparent_80%)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="flat-card w-full rounded-2xl p-4 space-y-4">
      <div>
        <p className="text-sm font-semibold">
          {t("accessibility.permissionsTitle")}
        </p>
        <p className="mt-1 text-sm text-[color-mix(in_srgb,var(--text),transparent_28%)]">
          {t("accessibility.permissionsDescription")}
        </p>
      </div>

      {!permissions.accessibility && (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--border)] p-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold">
              {t("onboarding.permissions.accessibility.title")}
            </p>
            <p className="mt-1 text-sm text-[color-mix(in_srgb,var(--text),transparent_32%)]">
              {t("onboarding.permissions.accessibility.cardDescription")}
            </p>
          </div>
          <button
            onClick={() => void requestPermission("accessibility")}
            className={buttonClassName}
            disabled={busyPermission !== null}
          >
            {t("onboarding.permissions.grant")}
          </button>
        </div>
      )}

      {!permissions.inputMonitoring && (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--border)] p-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold">
              {t("onboarding.permissions.inputMonitoring.title")}
            </p>
            <p className="mt-1 text-sm text-[color-mix(in_srgb,var(--text),transparent_32%)]">
              {t("onboarding.permissions.inputMonitoring.cardDescription")}
            </p>
            <p className="mt-2 text-xs text-[color-mix(in_srgb,var(--text),transparent_42%)]">
              {t("onboarding.permissions.inputMonitoring.manualCleanupHint")}
            </p>
          </div>
          <button
            onClick={() => void requestPermission("inputMonitoring")}
            className={buttonClassName}
            disabled={busyPermission !== null}
          >
            {t("accessibility.openSettings")}
          </button>
        </div>
      )}
    </div>
  );
};

export default AccessibilityPermissions;
