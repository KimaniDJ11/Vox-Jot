import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { type } from "@tauri-apps/plugin-os";

import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
  titleBarOverlayWarningFocusClass,
} from "@/lib/interactiveFocus";
import { prepareMacosPermissionRelaunch } from "@/lib/macosPermissionRelaunch";
import {
  checkAccessibilityPermission,
  checkInputMonitoringPermission,
  checkScreenRecordingPermission,
  requestAccessibilityPermission,
  requestInputMonitoringPermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";

type MissingPermission =
  | "accessibility"
  | "inputMonitoring"
  | "screenRecording"
  | null;
type AccessibilityPermissionsPresentation = "card" | "titleBar";

interface MacPermissionsState {
  accessibility: boolean;
  inputMonitoring: boolean;
  screenRecording: boolean;
}

interface AccessibilityPermissionsProps {
  presentation?: AccessibilityPermissionsPresentation;
}

const AccessibilityPermissions: React.FC<AccessibilityPermissionsProps> = ({
  presentation = "card",
}) => {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState<MacPermissionsState>({
    accessibility: false,
    inputMonitoring: false,
    screenRecording: false,
  });
  const [busyPermission, setBusyPermission] = useState<MissingPermission>(null);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Accessibility permissions are only required on macOS
  const isMacOS = type() === "macos";

  const refreshPermissions = async (): Promise<void> => {
    const [accessibility, inputMonitoring, screenRecording] = await Promise.all(
      [
        checkAccessibilityPermission(),
        checkInputMonitoringPermission(),
        checkScreenRecordingPermission(),
      ],
    );

    setPermissions({
      accessibility,
      inputMonitoring,
      screenRecording,
    });
  };

  const requestPermission = async (
    permission: Exclude<MissingPermission, null>,
  ): Promise<void> => {
    setBusyPermission(permission);

    try {
      await prepareMacosPermissionRelaunch(
        `accessibility-permissions:${permission}`,
      );
      if (permission === "accessibility") {
        await requestAccessibilityPermission();
      } else if (permission === "screenRecording") {
        await requestScreenRecordingPermission();
      } else {
        await requestInputMonitoringPermission();
      }
    } catch (error) {
      console.error("Error requesting permission:", { permission, error });
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

  useEffect(() => {
    if (presentation !== "titleBar" || !isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, presentation]);

  const hasAllPermissions =
    permissions.accessibility &&
    permissions.inputMonitoring &&
    permissions.screenRecording;

  if (!isMacOS || hasAllPermissions) {
    return null;
  }

  const buttonClassName = `inline-flex items-center justify-center rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--accent)] transition hover:bg-[color-mix(in_srgb,var(--accent),transparent_80%)] disabled:cursor-not-allowed disabled:opacity-60 ${interactiveFocusRingClass} ${minTapTargetHeightClass}`;
  const permissionCardClassName =
    "flex flex-col justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--shadow-sm)] sm:flex-row sm:items-center";

  const permissionContent = (
    <>
      <div>
        <p className="text-sm font-semibold">
          {t("accessibility.permissionsTitle")}
        </p>
        <p className="mt-1 text-sm text-[var(--text)]">
          {t("accessibility.permissionsDescription")}
        </p>
      </div>

      {!permissions.accessibility && (
        <div className={permissionCardClassName}>
          <div>
            <p className="text-sm font-semibold">
              {t("onboarding.permissions.accessibility.title")}
            </p>
            <p className="mt-1 text-sm text-[var(--text)]">
              {t("onboarding.permissions.accessibility.cardDescription")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void requestPermission("accessibility")}
            className={buttonClassName}
            disabled={busyPermission !== null}
          >
            {t("onboarding.permissions.grant")}
          </button>
        </div>
      )}

      {!permissions.inputMonitoring && (
        <div className={permissionCardClassName}>
          <div>
            <p className="text-sm font-semibold">
              {t("onboarding.permissions.inputMonitoring.title")}
            </p>
            <p className="mt-1 text-sm text-[var(--text)]">
              {t("onboarding.permissions.inputMonitoring.cardDescription")}
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {t("onboarding.permissions.inputMonitoring.manualCleanupHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void requestPermission("inputMonitoring")}
            className={buttonClassName}
            disabled={busyPermission !== null}
          >
            {t("accessibility.openSettings")}
          </button>
        </div>
      )}

      {!permissions.screenRecording && (
        <div className={permissionCardClassName}>
          <div>
            <p className="text-sm font-semibold">
              {t("onboarding.permissions.screenRecording.title", {
                defaultValue: "Screen Recording",
              })}
            </p>
            <p className="mt-1 text-sm text-[var(--text)]">
              {t("onboarding.permissions.screenRecording.cardDescription", {
                defaultValue:
                  "Vox Jot uses periodic local OCR from the active display to improve names, jargon, and phrase-key accuracy during dictation.",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void requestPermission("screenRecording")}
            className={buttonClassName}
            disabled={busyPermission !== null}
          >
            {t("accessibility.openSettings")}
          </button>
        </div>
      )}
    </>
  );

  if (presentation === "titleBar") {
    const titleBarLabel = t("accessibility.permissionNeeded", {
      defaultValue: "Permission Needed",
    });

    return (
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          className={`flex h-8 max-h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0 text-[11px] font-bold leading-none text-[var(--warning)] transition-[background-color,border-color,color] duration-200 ${titleBarOverlayWarningFocusClass} ${
            isOpen
              ? "border-[color-mix(in_srgb,var(--warning),transparent_68%)] bg-[var(--warning-soft)]"
              : "border-transparent bg-transparent hover:border-[color-mix(in_srgb,var(--warning),transparent_78%)] hover:bg-[color-mix(in_srgb,var(--warning),transparent_90%)]"
          }`}
          onClick={() => setIsOpen((current) => !current)}
          aria-label={t("accessibility.permissionsTitle")}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          title={t("accessibility.permissionsTitle")}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="whitespace-nowrap">{titleBarLabel}</span>
          <span className="sr-only">
            : {t("accessibility.permissionsTitle")}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </button>

        {isOpen && (
          <div
            role="dialog"
            aria-label={t("accessibility.permissionsTitle")}
            className="absolute end-0 top-full z-[420] mt-2 w-[min(28rem,calc(100vw-1.5rem))] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-[var(--shadow-lg)]"
          >
            <div className="space-y-4">{permissionContent}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flat-card w-full rounded-2xl p-4 space-y-4">
      {permissionContent}
    </div>
  );
};

export default AccessibilityPermissions;
