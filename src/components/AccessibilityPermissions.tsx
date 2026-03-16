import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import {
  checkAccessibilityPermission,
  requestAccessibilityPermission,
} from "tauri-plugin-macos-permissions-api";

// Define permission state type
type PermissionState = "request" | "verify" | "granted";

// Define button configuration type
interface ButtonConfig {
  text: string;
  className: string;
}

const AccessibilityPermissions: React.FC = () => {
  const { t } = useTranslation();
  const [hasAccessibility, setHasAccessibility] = useState<boolean>(false);
  const [permissionState, setPermissionState] =
    useState<PermissionState>("request");

  // Accessibility permissions are only required on macOS
  const isMacOS = type() === "macos";

  // Check permissions without requesting
  const checkPermissions = async (): Promise<boolean> => {
    const hasPermissions: boolean = await checkAccessibilityPermission();
    setHasAccessibility(hasPermissions);
    setPermissionState(hasPermissions ? "granted" : "verify");
    return hasPermissions;
  };

  // Handle the unified button action based on current state
  const handleButtonClick = async (): Promise<void> => {
    if (permissionState === "request") {
      try {
        await requestAccessibilityPermission();
        // After system prompt, transition to verification state
        setPermissionState("verify");
      } catch (error) {
        console.error("Error requesting permissions:", error);
        setPermissionState("verify");
      }
    } else if (permissionState === "verify") {
      // State is "verify" - check if permission was granted
      await checkPermissions();
    }
  };

  // On app boot - check permissions (only on macOS)
  useEffect(() => {
    if (!isMacOS) return;

    const initialSetup = async (): Promise<void> => {
      const hasPermissions: boolean = await checkAccessibilityPermission();
      setHasAccessibility(hasPermissions);
      setPermissionState(hasPermissions ? "granted" : "request");
    };

    initialSetup();
  }, [isMacOS]);

  // Skip rendering on non-macOS platforms or if permission is already granted
  if (!isMacOS || hasAccessibility) {
    return null;
  }

  // Configure button text and style based on state
  const buttonConfig: Record<PermissionState, ButtonConfig | null> = {
    request: {
      text: t("accessibility.openSettings"),
      className:
        "rounded-lg border border-[color-mix(in_srgb,var(--color-logo-primary),transparent_56%)] bg-[color-mix(in_srgb,var(--glass-bg-elevated),white_8%)] px-3 py-2 text-sm font-semibold text-[var(--color-logo-primary)] transition hover:bg-[color-mix(in_srgb,var(--glass-bg-elevated),white_18%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-logo-primary),transparent_62%)]",
    },
    verify: {
      text: t("accessibility.openSettings"),
      className:
        "rounded-lg border border-[color-mix(in_srgb,var(--color-logo-primary),transparent_62%)] bg-transparent px-3 py-2 text-sm font-medium text-[color-mix(in_srgb,var(--color-text),transparent_10%)] transition hover:bg-[color-mix(in_srgb,var(--glass-bg),white_8%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-logo-primary),transparent_62%)]",
    },
    granted: null,
  };

  const config = buttonConfig[permissionState] as ButtonConfig;

  return (
    <div className="glass-panel w-full rounded-2xl p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold">
            {t("accessibility.permissionsDescription")}
          </p>
        </div>
        <button
          onClick={handleButtonClick}
          className={`min-h-10 whitespace-nowrap ${config.className}`}
        >
          {config.text}
        </button>
      </div>
    </div>
  );
};

export default AccessibilityPermissions;
