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
  ChevronRight,
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

  const currentPermissionId = useMemo<PermissionId | null>(() => {
    return (
      permissionOrder.find((id) => {
        if (permissions[id] === "granted") return false;
        if (!permissionStories[id].required && skippedOptional[id]) return false;
        return true;
      }) ?? null
    );
  }, [permissionOrder, permissions, skippedOptional]);

  const currentPermission = currentPermissionId
    ? permissionStories[currentPermissionId]
    : null;
  const currentStatus = currentPermissionId
    ? permissions[currentPermissionId]
    : "granted";
  const currentIndex = currentPermissionId
    ? permissionOrder.indexOf(currentPermissionId)
    : permissionOrder.length;
  const totalPermissions = permissionOrder.length;

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
      setPermissions((prev) => ({ ...prev, screenRecording: "waiting" }));
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

  useEffect(() => {
    if (
      !isChecking &&
      permissionPlatform !== null &&
      permissionOrder.length > 0 &&
      !currentPermissionId
    ) {
      void completeOnboarding();
    }
  }, [
    completeOnboarding,
    currentPermissionId,
    isChecking,
    permissionOrder.length,
    permissionPlatform,
  ]);

  const handleSkipOptional = () => {
    if (!currentPermissionId || currentPermission?.required) return;
    setSkippedOptional((prev) => ({ ...prev, [currentPermissionId]: true }));
  };

  const handlePrimaryAction = async () => {
    if (!currentPermissionId) {
      await completeOnboarding();
      return;
    }

    if (currentStatus === "granted") return;
    await grantHandlers[currentPermissionId]();
  };

  const statusLabel = currentPermission?.required
    ? t("onboarding.permissions.required", { defaultValue: "Required" })
    : t("onboarding.permissions.optional", { defaultValue: "Optional" });

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

  if (!currentPermission) {
    return (
      <OnboardingLayout
        currentStep="permissions"
        onBack={onBack}
        chromeVariant="story"
      >
        <div className="ob-story-loading">
          <Check size={32} color="var(--success)" aria-hidden />
          <p>{t("onboarding.permissions.allGranted")}</p>
        </div>
      </OnboardingLayout>
    );
  }

  const Icon = currentPermission.icon;
  const bullets = t(currentPermission.bulletsKey, {
    returnObjects: true,
  }) as string[];
  const isWaiting = currentStatus === "waiting";

  return (
    <OnboardingLayout
      currentStep="permissions"
      onBack={onBack}
      chromeVariant="story"
    >
      <div className="ob-permission-story">
        <div className="ob-story-hero">
          <div className="ob-story-hero-bg" />
          <img
            className="ob-story-visual"
            src={currentPermission.visual}
            alt=""
            aria-hidden
          />
          <div className="ob-story-hero-vignette" />
          <div className="ob-story-nav">
            <div className="ob-story-progress">
              <span>
                {t("onboarding.permissions.stepProgress", {
                  current: Math.min(currentIndex + 1, totalPermissions),
                  total: totalPermissions,
                })}
              </span>
              <div className="ob-story-dots" aria-hidden>
                {permissionOrder.map((id) => (
                  <span
                    key={id}
                    className={
                      id === currentPermissionId
                        ? "ob-story-dot ob-story-dot-active"
                        : permissions[id] === "granted" || skippedOptional[id]
                          ? "ob-story-dot ob-story-dot-done"
                          : "ob-story-dot"
                    }
                  />
                ))}
              </div>
            </div>
            {!currentPermission.required && requiredPermissionsGranted && (
              <button
                type="button"
                className={`ob-story-skip ${interactiveFocusRingClass}`}
                onClick={handleSkipOptional}
              >
                {t("onboarding.permissions.skip")}
              </button>
            )}
          </div>
        </div>

        <div className="ob-story-body">
          <div className="ob-story-icon" aria-hidden>
            <Icon size={42} aria-hidden />
          </div>

          <div className="ob-story-copy">
            <div className="ob-story-eyebrow">
              <span>{t(currentPermission.eyebrowKey)}</span>
              <span>{statusLabel}</span>
            </div>
            <h1 className="ob-heading">{t(currentPermission.titleKey)}</h1>
            <p className="ob-subtext">
              {t(currentPermission.descriptionKey)}
            </p>

            <ul className="ob-story-bullets">
              {bullets.map((bullet) => (
                <li key={bullet}>
                  <ChevronRight size={16} aria-hidden />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="ob-story-privacy">
            <div className="ob-story-privacy-icon" aria-hidden>
              <Eye size={22} />
            </div>
            <p>{t(currentPermission.privacyKey)}</p>
          </div>

          <div className="ob-bottom-actions ob-story-actions">
            <button
              type="button"
              className={`ob-btn-primary ${interactiveFocusRingClass}`}
              onClick={handlePrimaryAction}
              disabled={isWaiting}
            >
              {isWaiting ? (
                <>
                  <Loader2 size={18} className="ob-spinner" aria-hidden />
                  {t("onboarding.permissions.waiting")}
                </>
              ) : (
                t(currentPermission.ctaKey)
              )}
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
