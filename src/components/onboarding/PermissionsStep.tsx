import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  checkInputMonitoringPermission,
  checkScreenRecordingPermission,
  requestAccessibilityPermission,
  requestInputMonitoringPermission,
  checkMicrophonePermission,
  requestMicrophonePermission,
  requestScreenRecordingPermission,
} from "tauri-plugin-macos-permissions-api";
import { toast } from "sonner";
import { commands } from "@/bindings";
import { initializeInputServices } from "@/lib/appInitialization";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import { useSettingsStore } from "@/stores/settingsStore";
import { Check, Loader2, Info } from "lucide-react";
import OnboardingLayout from "./OnboardingLayout";

interface PermissionsStepProps {
  onComplete: () => void;
  onBack?: () => void;
}

type PermissionStatus = "checking" | "needed" | "waiting" | "granted";
type PermissionPlatform = "macos" | "windows" | "other";

interface PermissionsState {
  accessibility: PermissionStatus;
  microphone: PermissionStatus;
  inputMonitoring: PermissionStatus;
  screenRecording: PermissionStatus;
}

const PermissionsStep: React.FC<PermissionsStepProps> = ({
  onComplete,
  onBack,
}) => {
  const { t } = useTranslation();
  const refreshAudioDevices = useSettingsStore(
    (state) => state.refreshAudioDevices,
  );
  const refreshOutputDevices = useSettingsStore(
    (state) => state.refreshOutputDevices,
  );
  const [permissionPlatform, setPermissionPlatform] =
    useState<PermissionPlatform | null>(null);
  const [permissions, setPermissions] = useState<PermissionsState>({
    accessibility: "checking",
    microphone: "checking",
    inputMonitoring: "checking",
    screenRecording: "checking",
  });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorCountRef = useRef<number>(0);
  const MAX_POLLING_ERRORS = 3;

  const isMacOS = permissionPlatform === "macos";
  const isWindows = permissionPlatform === "windows";
  const showMicrophonePermission = isMacOS || isWindows;
  const showAccessibilityPermission = isMacOS;
  const showInputMonitoringPermission = isMacOS;
  const showScreenRecordingPermission = isMacOS;

  const allGranted = isMacOS
    ? permissions.accessibility === "granted" &&
      permissions.microphone === "granted" &&
      permissions.inputMonitoring === "granted" &&
      permissions.screenRecording === "granted"
    : isWindows
      ? permissions.microphone === "granted"
      : true;

  const showDevBypass = import.meta.env.DEV && isMacOS && !allGranted;

  const completeOnboarding = useCallback(async () => {
    await Promise.all([refreshAudioDevices(), refreshOutputDevices()]);
    timeoutRef.current = setTimeout(() => onComplete(), 300);
  }, [onComplete, refreshAudioDevices, refreshOutputDevices]);

  const hasWindowsMicrophoneAccess = useCallback(async (): Promise<boolean> => {
    const microphoneStatus =
      await commands.getWindowsMicrophonePermissionStatus();
    if (!microphoneStatus.supported) return true;
    return microphoneStatus.overall_access !== "denied";
  }, []);

  // Check platform and permission status on mount
  useEffect(() => {
    const currentPlatform = platform();
    const nextPlatform: PermissionPlatform =
      currentPlatform === "macos"
        ? "macos"
        : currentPlatform === "windows"
          ? "windows"
          : "other";

    setPermissionPlatform(nextPlatform);

    if (nextPlatform === "other") {
      onComplete();
      return;
    }

    const checkInitial = async () => {
      if (nextPlatform === "macos") {
        try {
          const [
            accessibilityGranted,
            microphoneGranted,
            inputMonitoringGranted,
            screenRecordingGranted,
          ] = await Promise.all([
            checkAccessibilityPermission(),
            checkMicrophonePermission(),
            checkInputMonitoringPermission(),
            checkScreenRecordingPermission(),
          ]);

          if (accessibilityGranted) {
            await initializeInputServices((message) => {
              console.warn(
                `Failed to initialize after permission grant: ${message}`,
              );
            });
          }

          const newState: PermissionsState = {
            accessibility: accessibilityGranted ? "granted" : "needed",
            microphone: microphoneGranted ? "granted" : "needed",
            inputMonitoring: inputMonitoringGranted ? "granted" : "needed",
            screenRecording: screenRecordingGranted ? "granted" : "needed",
          };
          setPermissions(newState);

          if (
            accessibilityGranted &&
            microphoneGranted &&
            inputMonitoringGranted &&
            screenRecordingGranted
          ) {
            await completeOnboarding();
          }
        } catch (error) {
          console.error("Failed to check macOS permissions:", error);
          toast.error(t("onboarding.permissions.errors.checkFailed"));
          setPermissions({
            accessibility: "needed",
            microphone: "needed",
            inputMonitoring: "needed",
            screenRecording: "needed",
          });
        }
        return;
      }

      // Windows
      try {
        const microphoneGranted = await hasWindowsMicrophoneAccess();
        setPermissions({
          accessibility: "granted",
          microphone: microphoneGranted ? "granted" : "needed",
          inputMonitoring: "granted",
          screenRecording: "granted",
        });
        if (microphoneGranted) await completeOnboarding();
      } catch (error) {
        console.warn("Failed to check Windows microphone permissions:", error);
        setPermissions({
          accessibility: "granted",
          microphone: "granted",
          inputMonitoring: "granted",
          screenRecording: "granted",
        });
        await completeOnboarding();
      }
    };

    checkInitial();
  }, [completeOnboarding, hasWindowsMicrophoneAccess, onComplete, t]);

  // Polling for permissions after user clicks a button
  const startPolling = useCallback(() => {
    if (pollingRef.current || permissionPlatform === null) return;

    pollingRef.current = setInterval(async () => {
      try {
        if (permissionPlatform === "windows") {
          const microphoneGranted = await hasWindowsMicrophoneAccess();
          if (microphoneGranted) {
            setPermissions((prev) => ({ ...prev, microphone: "granted" }));
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            await completeOnboarding();
          }
          errorCountRef.current = 0;
          return;
        }

        const [
          accessibilityGranted,
          microphoneGranted,
          inputMonitoringGranted,
          screenRecordingGranted,
        ] = await Promise.all([
          checkAccessibilityPermission(),
          checkMicrophonePermission(),
          checkInputMonitoringPermission(),
          checkScreenRecordingPermission(),
        ]);

        setPermissions((prev) => {
          const newState = { ...prev };
          if (accessibilityGranted && prev.accessibility !== "granted") {
            newState.accessibility = "granted";
            void initializeInputServices((message) => {
              console.warn(
                `Failed to initialize after permission grant: ${message}`,
              );
            });
          }
          if (microphoneGranted && prev.microphone !== "granted") {
            newState.microphone = "granted";
          }
          if (inputMonitoringGranted && prev.inputMonitoring !== "granted") {
            newState.inputMonitoring = "granted";
          }
          if (screenRecordingGranted && prev.screenRecording !== "granted") {
            newState.screenRecording = "granted";
          }
          return newState;
        });

        if (
          accessibilityGranted &&
          microphoneGranted &&
          inputMonitoringGranted &&
          screenRecordingGranted
        ) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          await completeOnboarding();
        }
        errorCountRef.current = 0;
      } catch (error) {
        console.error("Error checking permissions:", error);
        errorCountRef.current += 1;
        if (errorCountRef.current >= MAX_POLLING_ERRORS) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          toast.error(t("onboarding.permissions.errors.checkFailed"));
        }
      }
    }, 1000);
  }, [completeOnboarding, hasWindowsMicrophoneAccess, permissionPlatform, t]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleGrantAccessibility = async () => {
    try {
      await requestAccessibilityPermission();
      setPermissions((prev) => ({ ...prev, accessibility: "waiting" }));
      startPolling();
    } catch (error) {
      console.error("Failed to request accessibility permission:", error);
      toast.error(t("onboarding.permissions.errors.requestFailed"));
    }
  };

  const handleGrantMicrophone = async () => {
    try {
      if (isWindows) {
        await commands.openMicrophonePrivacySettings();
      } else {
        await requestMicrophonePermission();
      }
      setPermissions((prev) => ({ ...prev, microphone: "waiting" }));
      startPolling();
    } catch (error) {
      console.error("Failed to request microphone permission:", error);
      toast.error(t("onboarding.permissions.errors.requestFailed"));
    }
  };

  const handleGrantInputMonitoring = async () => {
    try {
      await requestInputMonitoringPermission();
      setPermissions((prev) => ({ ...prev, inputMonitoring: "waiting" }));
      startPolling();
    } catch (error) {
      console.error("Failed to request input monitoring permission:", error);
      toast.error(t("onboarding.permissions.errors.requestFailed"));
    }
  };

  const handleGrantScreenRecording = async () => {
    try {
      await requestScreenRecordingPermission();
      setPermissions((prev) => ({ ...prev, screenRecording: "waiting" }));
      startPolling();
    } catch (error) {
      console.error("Failed to request screen recording permission:", error);
      toast.error(t("onboarding.permissions.errors.requestFailed"));
    }
  };

  const isChecking =
    permissionPlatform === null ||
    (isMacOS &&
      permissions.accessibility === "checking" &&
      permissions.microphone === "checking" &&
      permissions.inputMonitoring === "checking" &&
      permissions.screenRecording === "checking") ||
    (isWindows && permissions.microphone === "checking");

  if (isChecking) {
    return (
      <OnboardingLayout
        currentStep="permissions"
        onBack={onBack}
        leftContent={
          <div className="flex justify-center">
            <Loader2
              className="ob-spinner"
              size={32}
              color="var(--ob-text-muted)"
            />
          </div>
        }
      />
    );
  }

  const renderPermissionStatus = (
    status: PermissionStatus,
    onGrant: () => void,
    isWin?: boolean,
    buttonLabel?: string,
  ) => {
    if (status === "granted") {
      return (
        <span className="ob-perm-granted-badge">
          <Check size={16} /> {t("onboarding.permissions.granted")}
        </span>
      );
    }
    if (status === "waiting") {
      return (
        <span className="ob-perm-waiting">
          <Loader2 size={16} className="ob-spinner" />{" "}
          {t("onboarding.permissions.waiting")}
        </span>
      );
    }
    return (
      <div className="flex items-center">
        <button
          type="button"
          className={`ob-perm-allow-btn ${interactiveFocusRingClass}`}
          onClick={onGrant}
        >
          {buttonLabel ||
            (isWin
              ? t("accessibility.openSettings")
              : t("onboarding.permissions.grant"))}
        </button>
        <span className="ob-info-wrap">
          <button
            className={`ob-info-btn ${interactiveFocusRingClass}`}
            type="button"
            aria-label={t("onboarding.permissions.moreInfo")}
          >
            <Info size={12} />
          </button>
          <span className="ob-info-tooltip" role="tooltip">
            {t("onboarding.permissions.moreInfo")}
          </span>
        </span>
      </div>
    );
  };

  return (
    <OnboardingLayout
      currentStep="permissions"
      onBack={onBack}
      leftContent={
        <div className="ob-permissions-flow">
          <h1 className="ob-heading">{t("onboarding.permissions.heading")}</h1>

          {/* Accessibility Permission */}
          {showAccessibilityPermission && (
            <div
              className={`ob-perm-card ${permissions.accessibility === "granted" ? "ob-perm-card-granted" : ""}`}
            >
              <p className="ob-perm-title">
                {t("onboarding.permissions.accessibility.cardTitle")}
              </p>
              <p className="ob-perm-desc">
                {t("onboarding.permissions.accessibility.cardDescription")}
              </p>
              {renderPermissionStatus(
                permissions.accessibility,
                handleGrantAccessibility,
              )}
            </div>
          )}

          {showInputMonitoringPermission && (
            <div
              className={`ob-perm-card ${permissions.inputMonitoring === "granted" ? "ob-perm-card-granted" : ""}`}
            >
              <p className="ob-perm-title">
                {t("onboarding.permissions.inputMonitoring.cardTitle")}
              </p>
              <p className="ob-perm-desc">
                {t("onboarding.permissions.inputMonitoring.cardDescription")}
              </p>
              <p className="ob-perm-desc ob-perm-hint-line">
                {t("onboarding.permissions.inputMonitoring.manualCleanupHint")}
              </p>
              {renderPermissionStatus(
                permissions.inputMonitoring,
                handleGrantInputMonitoring,
                false,
                t("accessibility.openSettings"),
              )}
            </div>
          )}

          {showScreenRecordingPermission && (
            <div
              className={`ob-perm-card ${permissions.screenRecording === "granted" ? "ob-perm-card-granted" : ""}`}
            >
              <p className="ob-perm-title">
                {t("onboarding.permissions.screenRecording.title", {
                  defaultValue: "Screen Recording",
                })}
              </p>
              <p className="ob-perm-desc">
                {t("onboarding.permissions.screenRecording.cardDescription", {
                  defaultValue:
                    "Vox Jot uses periodic local OCR from the active display to improve names, jargon, and phrase-key accuracy during dictation.",
                })}
              </p>
              {renderPermissionStatus(
                permissions.screenRecording,
                handleGrantScreenRecording,
                false,
                t("accessibility.openSettings"),
              )}
            </div>
          )}

          {/* Microphone Permission */}
          {showMicrophonePermission && (
            <div
              className={`ob-perm-card ${permissions.microphone === "granted" ? "ob-perm-card-granted" : ""}`}
            >
              <p className="ob-perm-title">
                {t("onboarding.permissions.microphone.cardTitle")}
              </p>
              <p className="ob-perm-desc">
                {t("onboarding.permissions.microphone.cardDescription")}
              </p>
              {renderPermissionStatus(
                permissions.microphone,
                handleGrantMicrophone,
                isWindows,
              )}
            </div>
          )}

          {(allGranted || showDevBypass) && (
            <div className="ob-bottom-actions">
              {allGranted && (
                <button
                  type="button"
                  className={`ob-btn-primary ${interactiveFocusRingClass}`}
                  onClick={onComplete}
                >
                  {t("onboarding.permissions.continue")}
                </button>
              )}
              {showDevBypass && (
                <button
                  type="button"
                  className={`ob-btn-secondary ${interactiveFocusRingClass}`}
                  onClick={onComplete}
                  title={t("onboarding.permissions.devBypassHint", {
                    defaultValue:
                      "Development bypass for accessibility check issues on macOS",
                  })}
                >
                  {t("onboarding.permissions.devBypass", {
                    defaultValue: "Continue In Dev Mode",
                  })}
                </button>
              )}
            </div>
          )}
        </div>
      }
      rightContent={
        <div className="ob-visual-card ob-visual-center ob-permissions-visual">
          <div className="ob-permission-path-card">
            <p className="ob-permission-path-text">
              {t("onboarding.permissions.visualPath")}
            </p>
          </div>
          <p className="ob-permission-path-description">
            {t("onboarding.permissions.visualDescription")}
          </p>
        </div>
      }
    />
  );
};

export default PermissionsStep;
