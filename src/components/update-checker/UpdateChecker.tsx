import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "../../hooks/useSettings";
import {
  checkForCustomUpdate,
  openUpdateDownloadUrl,
  type CustomUpdateResult,
} from "@/lib/utils/customUpdateChecker";

interface UpdateCheckerProps {
  className?: string;
}

const UpdateChecker: React.FC<UpdateCheckerProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  const [isChecking, setIsChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<CustomUpdateResult | null>(null);
  const [showUpToDate, setShowUpToDate] = useState(false);

  const { settings, isLoading } = useSettings();
  const settingsLoaded = !isLoading && settings !== null;
  const updateChecksEnabled = settings?.update_checks_enabled ?? false;

  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isManualCheckRef = useRef(false);

  useEffect(() => {
    // Wait for settings to load before doing anything
    if (!settingsLoaded) return;

    if (!updateChecksEnabled) {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      setIsChecking(false);
      setUpdateInfo(null);
      setShowUpToDate(false);
      return;
    }

    void checkForUpdates();

    // Listen for update check events
    const updateUnlisten = listen("check-for-updates", () => {
      handleManualUpdateCheck();
    });

    return () => {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      updateUnlisten.then((fn) => fn());
    };
  }, [settingsLoaded, updateChecksEnabled]);

  // Update checking functions
  const checkForUpdates = async () => {
    if (!updateChecksEnabled || isChecking) return;

    try {
      setIsChecking(true);
      const currentVersion = await getVersion();
      const result = await checkForCustomUpdate(currentVersion);

      if (result.available) {
        setUpdateInfo(result);
        setShowUpToDate(false);
      } else {
        setUpdateInfo(null);

        if (isManualCheckRef.current) {
          setShowUpToDate(true);
          if (upToDateTimeoutRef.current) {
            clearTimeout(upToDateTimeoutRef.current);
          }
          upToDateTimeoutRef.current = setTimeout(() => {
            setShowUpToDate(false);
          }, 3000);
        }
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    } finally {
      setIsChecking(false);
      isManualCheckRef.current = false;
    }
  };

  const handleManualUpdateCheck = () => {
    if (!updateChecksEnabled) return;
    isManualCheckRef.current = true;
    void checkForUpdates();
  };

  const openDownloadPage = async () => {
    if (!updateInfo?.downloadUrl) return;
    try {
      await openUpdateDownloadUrl(updateInfo.downloadUrl);
    } catch (error) {
      console.error("Failed to open update download URL:", error);
    }
  };

  // Update status functions
  const getUpdateStatusText = () => {
    if (!updateChecksEnabled) {
      return t("footer.updateCheckingDisabled");
    }
    if (isChecking) return t("footer.checkingUpdates");
    if (showUpToDate) return t("footer.upToDate");
    if (updateInfo?.available) return t("footer.updateAvailableShort");
    return t("footer.checkForUpdates");
  };

  const getUpdateStatusAction = () => {
    if (!updateChecksEnabled) return undefined;
    if (updateInfo?.available) return openDownloadPage;
    if (!isChecking) return handleManualUpdateCheck;
    return undefined;
  };

  const isUpdateDisabled = !updateChecksEnabled || isChecking;
  const isUpdateClickable =
    !isUpdateDisabled && (Boolean(updateInfo?.available) || !showUpToDate);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {isUpdateClickable ? (
        <button
          onClick={getUpdateStatusAction()}
          disabled={isUpdateDisabled}
          className={`rounded-md px-2 py-1 text-xs transition-colors tabular-nums disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-logo-primary),transparent_64%)] ${
            updateInfo?.available
              ? "font-semibold text-logo-primary hover:text-logo-primary/80"
              : "text-[color-mix(in_srgb,var(--color-text),transparent_35%)] hover:text-[color-mix(in_srgb,var(--color-text),transparent_15%)]"
          }`}
        >
          {getUpdateStatusText()}
        </button>
      ) : (
        <span className="px-2 py-1 text-xs text-[color-mix(in_srgb,var(--color-text),transparent_35%)] tabular-nums">
          {getUpdateStatusText()}
        </span>
      )}
    </div>
  );
};

export default UpdateChecker;
