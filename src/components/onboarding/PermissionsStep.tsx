import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { platform } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
  checkMicrophonePermission,
  requestMicrophonePermission,
} from "tauri-plugin-macos-permissions-api";
import { toast } from "sonner";
import { commands } from "@/bindings";
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
  });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorCountRef = useRef<number>(0);
  const MAX_POLLING_ERRORS = 3;

  const isMacOS = permissionPlatform === "macos";
  const isWindows = permissionPlatform === "windows";
  const showMicrophonePermission = isMacOS || isWindows;
  const showAccessibilityPermission = isMacOS;
  const showDevBypass =
    import.meta.env.DEV &&
    isMacOS &&
    permissions.accessibility !== "granted";

  const allGranted = isMacOS
    ? permissions.accessibility === "granted" &&
      permissions.microphone === "granted"
    : isWindows
      ? permissions.microphone === "granted"
      : true;

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
          const [accessibilityGranted, microphoneGranted] = await Promise.all([
            checkAccessibilityPermission(),
            checkMicrophonePermission(),
          ]);

          if (accessibilityGranted) {
            try {
              await Promise.all([
                commands.initializeEnigo(),
                commands.initializeShortcuts(),
              ]);
            } catch (e) {
              console.warn("Failed to initialize after permission grant:", e);
            }
          }

          const newState: PermissionsState = {
            accessibility: accessibilityGranted ? "granted" : "needed",
            microphone: microphoneGranted ? "granted" : "needed",
          };
          setPermissions(newState);

          if (accessibilityGranted && microphoneGranted) {
            await completeOnboarding();
          }
        } catch (error) {
          console.error("Failed to check macOS permissions:", error);
          toast.error(t("onboarding.permissions.errors.checkFailed"));
          setPermissions({ accessibility: "needed", microphone: "needed" });
        }
        return;
      }

      // Windows
      try {
        const microphoneGranted = await hasWindowsMicrophoneAccess();
        setPermissions({
          accessibility: "granted",
          microphone: microphoneGranted ? "granted" : "needed",
        });
        if (microphoneGranted) await completeOnboarding();
      } catch (error) {
        console.warn("Failed to check Windows microphone permissions:", error);
        setPermissions({ accessibility: "granted", microphone: "granted" });
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

        const [accessibilityGranted, microphoneGranted] = await Promise.all([
          checkAccessibilityPermission(),
          checkMicrophonePermission(),
        ]);

        setPermissions((prev) => {
          const newState = { ...prev };
          if (accessibilityGranted && prev.accessibility !== "granted") {
            newState.accessibility = "granted";
            Promise.all([
              commands.initializeEnigo(),
              commands.initializeShortcuts(),
            ]).catch((e) => {
              console.warn("Failed to initialize after permission grant:", e);
            });
          }
          if (microphoneGranted && prev.microphone !== "granted") {
            newState.microphone = "granted";
          }
          return newState;
        });

        if (accessibilityGranted && microphoneGranted) {
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

  const isChecking =
    permissionPlatform === null ||
    (isMacOS &&
      permissions.accessibility === "checking" &&
      permissions.microphone === "checking") ||
    (isWindows && permissions.microphone === "checking");

  if (isChecking) {
    return (
      <OnboardingLayout
        currentStep="permissions"
        onBack={onBack}
        leftContent={
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Loader2 className="ob-spinner" size={32} color="var(--ob-text-muted)" />
          </div>
        }
      />
    );
  }

  const renderPermissionStatus = (status: PermissionStatus, onGrant: () => void, isWin?: boolean) => {
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
      <div style={{ display: "flex", alignItems: "center" }}>
        <button className="ob-perm-allow-btn" onClick={onGrant}>
          {isWin ? t("accessibility.openSettings") : t("onboarding.permissions.grant")}
        </button>
        <button className="ob-info-btn" title={t("onboarding.permissions.moreInfo")}>
          <Info size={12} />
        </button>
      </div>
    );
  };

  return (
    <OnboardingLayout
      currentStep="permissions"
      onBack={onBack}
      leftContent={
        <>
          <h1 className="ob-heading">{t("onboarding.permissions.heading")}</h1>

          {/* Accessibility Permission */}
          {showAccessibilityPermission && (
            <div
              className={`ob-perm-card ${permissions.accessibility === "granted" ? "ob-perm-card-granted" : ""}`}
            >
              <p className="ob-perm-title">{t("onboarding.permissions.accessibility.cardTitle")}</p>
              <p className="ob-perm-desc">{t("onboarding.permissions.accessibility.cardDescription")}</p>
              {renderPermissionStatus(
                permissions.accessibility,
                handleGrantAccessibility,
              )}
            </div>
          )}

          {/* Microphone Permission */}
          {showMicrophonePermission && (
            <div
              className={`ob-perm-card ${permissions.microphone === "granted" ? "ob-perm-card-granted" : ""}`}
            >
              <p className="ob-perm-title">{t("onboarding.permissions.microphone.cardTitle")}</p>
              <p className="ob-perm-desc">{t("onboarding.permissions.microphone.cardDescription")}</p>
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
                <button className="ob-btn-primary" onClick={onComplete}>
                  {t("onboarding.permissions.continue")}
                </button>
              )}
              {showDevBypass && (
                <button
                  className="ob-btn-secondary"
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
        </>
      }
      rightContent={
        <div className="ob-visual-card ob-visual-center">
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
