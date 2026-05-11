import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Check,
  Eye,
  Keyboard,
  type LucideIcon,
  Loader2,
  Mic,
  Monitor,
  ShieldCheck,
} from "lucide-react";
import OnboardingLayout from "./OnboardingLayout";
import microphoneVisual from "@/assets/onboarding/permission-microphone.webp";
import accessibilityVisual from "@/assets/onboarding/permission-accessibility.webp";
import inputMonitoringVisual from "@/assets/onboarding/permission-input-monitoring.webp";
import screenContextVisual from "@/assets/onboarding/permission-screen-context.webp";

interface PermissionsStepProps {
  onComplete: () => void;
  onBack?: () => void;
}

type PermissionId =
  | "microphone"
  | "accessibility"
  | "inputMonitoring"
  | "screenRecording";
type PermissionStatus = "checking" | "needed" | "waiting" | "granted";
type PermissionPlatform = "macos" | "windows" | "other";

interface PermissionsState {
  accessibility: PermissionStatus;
  microphone: PermissionStatus;
  inputMonitoring: PermissionStatus;
  screenRecording: PermissionStatus;
}

interface PermissionStory {
  id: PermissionId;
  required: boolean;
  icon: LucideIcon;
  visual: string;
  titleKey: string;
  eyebrowKey: string;
  descriptionKey: string;
  bulletsKey: string;
  privacyKey: string;
  ctaKey: string;
}

const permissionStories: Record<PermissionId, PermissionStory> = {
  microphone: {
    id: "microphone",
    required: true,
    icon: Mic,
    visual: microphoneVisual,
    titleKey: "onboarding.permissions.microphone.storyTitle",
    eyebrowKey: "onboarding.permissions.microphone.eyebrow",
    descriptionKey: "onboarding.permissions.microphone.storyDescription",
    bulletsKey: "onboarding.permissions.microphone.bullets",
    privacyKey: "onboarding.permissions.microphone.privacy",
    ctaKey: "onboarding.permissions.microphone.cta",
  },
  accessibility: {
    id: "accessibility",
    required: true,
    icon: Keyboard,
    visual: accessibilityVisual,
    titleKey: "onboarding.permissions.accessibility.storyTitle",
    eyebrowKey: "onboarding.permissions.accessibility.eyebrow",
    descriptionKey: "onboarding.permissions.accessibility.storyDescription",
    bulletsKey: "onboarding.permissions.accessibility.bullets",
    privacyKey: "onboarding.permissions.accessibility.privacy",
    ctaKey: "onboarding.permissions.accessibility.cta",
  },
  inputMonitoring: {
    id: "inputMonitoring",
    required: true,
    icon: ShieldCheck,
    visual: inputMonitoringVisual,
    titleKey: "onboarding.permissions.inputMonitoring.storyTitle",
    eyebrowKey: "onboarding.permissions.inputMonitoring.eyebrow",
    descriptionKey: "onboarding.permissions.inputMonitoring.storyDescription",
    bulletsKey: "onboarding.permissions.inputMonitoring.bullets",
    privacyKey: "onboarding.permissions.inputMonitoring.privacy",
    ctaKey: "onboarding.permissions.inputMonitoring.cta",
  },
  screenRecording: {
    id: "screenRecording",
    required: false,
    icon: Monitor,
    visual: screenContextVisual,
    titleKey: "onboarding.permissions.screenRecording.storyTitle",
    eyebrowKey: "onboarding.permissions.screenRecording.eyebrow",
    descriptionKey: "onboarding.permissions.screenRecording.storyDescription",
    bulletsKey: "onboarding.permissions.screenRecording.bullets",
    privacyKey: "onboarding.permissions.screenRecording.privacy",
    ctaKey: "onboarding.permissions.screenRecording.cta",
  },
};

const initialPermissions: PermissionsState = {
  accessibility: "checking",
  microphone: "checking",
  inputMonitoring: "checking",
  screenRecording: "checking",
};

const macPermissionOrder: PermissionId[] = [
  "microphone",
  "accessibility",
  "inputMonitoring",
  "screenRecording",
];

const windowsPermissionOrder: PermissionId[] = ["microphone"];

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
  const [permissions, setPermissions] =
    useState<PermissionsState>(initialPermissions);
  const [skippedOptional, setSkippedOptional] = useState<
    Partial<Record<PermissionId, boolean>>
  >({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorCountRef = useRef<number>(0);
  const MAX_POLLING_ERRORS = 3;

  const isMacOS = permissionPlatform === "macos";
  const isWindows = permissionPlatform === "windows";

  const permissionOrder = useMemo<PermissionId[]>(() => {
    if (isMacOS) return macPermissionOrder;
    if (isWindows) return windowsPermissionOrder;
    return [];
  }, [isMacOS, isWindows]);

  const requiredPermissionsGranted = useMemo(() => {
    return permissionOrder
      .filter((id) => permissionStories[id].required)
      .every((id) => permissions[id] === "granted");
  }, [permissionOrder, permissions]);

  const optionalPermissionsDone = useMemo(() => {
    return permissionOrder
      .filter((id) => !permissionStories[id].required)
      .every((id) => permissions[id] === "granted" || skippedOptional[id]);
  }, [permissionOrder, permissions, skippedOptional]);

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

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollingRef.current || permissionPlatform === null) return;

    pollingRef.current = setInterval(async () => {
      try {
        if (permissionPlatform === "windows") {
          const microphoneGranted = await hasWindowsMicrophoneAccess();
          setPermissions((prev) => ({
            ...prev,
            microphone: microphoneGranted ? "granted" : prev.microphone,
          }));
          if (microphoneGranted) stopPolling();
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
          stopPolling();
        }
        errorCountRef.current = 0;
      } catch (error) {
        console.error("Error checking permissions:", error);
        errorCountRef.current += 1;
        if (errorCountRef.current >= MAX_POLLING_ERRORS) {
          stopPolling();
          toast.error(t("onboarding.permissions.errors.checkFailed"));
        }
      }
    }, 1000);
  }, [
    hasWindowsMicrophoneAccess,
    permissionPlatform,
    stopPolling,
    t,
  ]);

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

          setPermissions({
            accessibility: accessibilityGranted ? "granted" : "needed",
            microphone: microphoneGranted ? "granted" : "needed",
            inputMonitoring: inputMonitoringGranted ? "granted" : "needed",
            screenRecording: screenRecordingGranted ? "granted" : "needed",
          });
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

      try {
        const microphoneGranted = await hasWindowsMicrophoneAccess();
        setPermissions({
          accessibility: "granted",
          microphone: microphoneGranted ? "granted" : "needed",
          inputMonitoring: "granted",
          screenRecording: "granted",
        });
      } catch (error) {
        console.warn("Failed to check Windows microphone permissions:", error);
        setPermissions({
          accessibility: "granted",
          microphone: "granted",
          inputMonitoring: "granted",
          screenRecording: "granted",
        });
      }
    };

    checkInitial();
  }, [hasWindowsMicrophoneAccess, onComplete, t]);

  useEffect(() => {
    return () => {
      stopPolling();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [stopPolling]);

  useEffect(() => {
    if (
      permissionPlatform !== null &&
      !Object.values(permissions).includes("waiting")
    ) {
      stopPolling();
    }
  }, [permissionPlatform, permissions, stopPolling]);

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
      const result = await commands.changeScreenContextEnabledSetting(true);
      if (result.status !== "ok") {
        toast.error(result.error);
      }
      setPermissions((prev) => ({ ...prev, screenRecording: "waiting" }));
      setSkippedOptional((prev) => ({ ...prev, screenRecording: false }));
      startPolling();
    } catch (error) {
      console.error("Failed to request screen recording permission:", error);
      toast.error(t("onboarding.permissions.errors.requestFailed"));
    }
  };

  const grantHandlers: Record<PermissionId, () => Promise<void>> = {
    microphone: handleGrantMicrophone,
    accessibility: handleGrantAccessibility,
    inputMonitoring: handleGrantInputMonitoring,
    screenRecording: handleGrantScreenRecording,
  };

  const isChecking =
    permissionPlatform === null ||
    permissionOrder.some((id) => permissions[id] === "checking");

  const handleSkipOptional = async (id: PermissionId) => {
    if (permissionStories[id].required) return;
    if (id === "screenRecording") {
      const result = await commands.changeScreenContextEnabledSetting(false);
      if (result.status !== "ok") {
        toast.error(result.error);
        return;
      }
    }
    setSkippedOptional((prev) => ({ ...prev, [id]: true }));
  };

  const handlePrimaryAction = async (id: PermissionId) => {
    if (permissions[id] === "granted") return;
    await grantHandlers[id]();
  };

  const handleContinue = async () => {
    if (!requiredPermissionsGranted) return;

    if (isMacOS && permissions.screenRecording !== "granted") {
      const result = await commands.changeScreenContextEnabledSetting(false);
      if (result.status !== "ok") {
        toast.error(result.error);
        return;
      }
      setSkippedOptional((prev) => ({ ...prev, screenRecording: true }));
    }

    await completeOnboarding();
  };

  if (isChecking) {
    return (
      <OnboardingLayout
        currentStep="permissions"
        onBack={onBack}
        chromeVariant="story"
      >
        <div className="ob-story-loading">
          <Loader2
            className="ob-spinner"
            size={32}
            color="var(--ob-text-muted)"
          />
          <p>{t("onboarding.permissions.checking")}</p>
        </div>
      </OnboardingLayout>
    );
  }

  return (
    <OnboardingLayout
      currentStep="permissions"
      onBack={onBack}
      chromeVariant="story"
    >
      <div className="ob-permission-grid-screen">
        <header className="ob-permission-grid-header">
          <div className="ob-privacy-badge">
            <Eye size={18} aria-hidden />
            <span>{t("onboarding.permissions.privacyBadge")}</span>
          </div>
          <h1 className="ob-heading">
            {t("onboarding.permissions.heading")}
          </h1>
          <p className="ob-subtext">
            {t("onboarding.permissions.visualDescription")}
          </p>
        </header>

        <div className="ob-permission-grid">
          {permissionOrder.map((id) => {
            const story = permissionStories[id];
            const Icon = story.icon;
            const status = permissions[id];
            const isGranted = status === "granted";
            const isWaiting = status === "waiting";
            const isSkipped = Boolean(skippedOptional[id]);
            const statusLabel = story.required
              ? t("onboarding.permissions.required", {
                  defaultValue: "Required",
                })
              : t("onboarding.permissions.optional", {
                  defaultValue: "Optional",
                });

            return (
              <section
                key={id}
                className={`ob-permission-grid-card ${
                  isGranted ? "ob-permission-grid-card-granted" : ""
                } ${isSkipped ? "ob-permission-grid-card-skipped" : ""}`}
              >
                <div className="ob-permission-card-visual" aria-hidden>
                  <img src={story.visual} alt="" />
                </div>
                <div className="ob-permission-card-content">
                  <div className="ob-permission-card-topline">
                    <span className="ob-permission-card-icon" aria-hidden>
                      <Icon size={21} />
                    </span>
                    <span className="ob-permission-card-status">
                      {statusLabel}
                    </span>
                  </div>

                  <h2>{t(story.titleKey)}</h2>
                  <p>{t(story.descriptionKey)}</p>

                  <div className="ob-permission-card-privacy">
                    {t(story.privacyKey)}
                  </div>
                </div>

                <div className="ob-permission-card-actions">
                  {isGranted ? (
                    <span className="ob-perm-granted-badge">
                      <Check size={16} aria-hidden />
                      {t("onboarding.permissions.granted")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`ob-perm-allow-btn ${interactiveFocusRingClass}`}
                      onClick={() => void handlePrimaryAction(id)}
                      disabled={isWaiting}
                    >
                      {isWaiting ? (
                        <>
                          <Loader2
                            size={16}
                            className="ob-spinner"
                            aria-hidden
                          />
                          {t("onboarding.permissions.waiting")}
                        </>
                      ) : (
                        t(story.ctaKey)
                      )}
                    </button>
                  )}

                  {!story.required &&
                    !isGranted &&
                    !isSkipped &&
                    requiredPermissionsGranted && (
                      <button
                        type="button"
                        className={`ob-permission-skip-inline ${interactiveFocusRingClass}`}
                        onClick={() => void handleSkipOptional(id)}
                      >
                        {t("onboarding.permissions.skip")}
                      </button>
                    )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="ob-bottom-actions ob-permission-grid-actions">
          <div className="ob-permission-grid-summary" aria-live="polite">
            {requiredPermissionsGranted
              ? optionalPermissionsDone
                ? t("onboarding.permissions.allGranted")
                : t("onboarding.permissions.completeDescription")
              : t("onboarding.permissions.description")}
          </div>
          <div className="ob-permission-grid-action-buttons">
            <button
              type="button"
              className={`ob-btn-primary ${interactiveFocusRingClass}`}
              onClick={() => void handleContinue()}
              disabled={!requiredPermissionsGranted}
            >
              {t("onboarding.permissions.continue")}
            </button>
            {import.meta.env.DEV && isMacOS && !requiredPermissionsGranted && (
              <button
                type="button"
                className={`ob-btn-secondary ${interactiveFocusRingClass}`}
                onClick={completeOnboarding}
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
        </div>
      </div>
    </OnboardingLayout>
  );
};

export default PermissionsStep;
