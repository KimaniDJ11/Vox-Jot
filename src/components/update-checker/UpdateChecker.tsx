import React, { useCallback, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Check, Download, RefreshCw } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import { openUpdateDownloadUrl } from "@/lib/utils/customUpdateChecker";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";
import { useUpdateStore } from "@/stores/updateStore";

interface UpdateCheckerProps {
  className?: string;
  iconOnly?: boolean;
}

const UpdateChecker: React.FC<UpdateCheckerProps> = ({
  className = "",
  iconOnly = false,
}) => {
  const { t } = useTranslation();
  const updateInfo = useUpdateStore((store) => store.updateInfo);
  const isChecking = useUpdateStore((store) => store.isChecking);
  const runUpdateCheck = useUpdateStore((store) => store.checkForUpdates);
  const clearUpdate = useUpdateStore((store) => store.clearUpdate);
  const [showUpToDate, setShowUpToDate] = useState(false);

  const { settings, isLoading } = useSettings();
  const settingsLoaded = !isLoading && settings !== null;
  const updateChecksEnabled = settings?.update_checks_enabled ?? false;

  const upToDateTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isManualCheckRef = useRef(false);

  const checkForUpdates = useCallback(async () => {
    if (!updateChecksEnabled) return;

    try {
      const result = await runUpdateCheck();

      if (result.available) {
        setShowUpToDate(false);
      } else if (isManualCheckRef.current) {
        setShowUpToDate(true);
        if (upToDateTimeoutRef.current) {
          clearTimeout(upToDateTimeoutRef.current);
        }
        upToDateTimeoutRef.current = setTimeout(() => {
          setShowUpToDate(false);
        }, 3000);
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    } finally {
      isManualCheckRef.current = false;
    }
  }, [runUpdateCheck, updateChecksEnabled]);

  const handleManualUpdateCheck = useCallback(() => {
    if (!updateChecksEnabled) return;
    isManualCheckRef.current = true;
    void checkForUpdates();
  }, [checkForUpdates, updateChecksEnabled]);

  useEffect(() => {
    // Wait for settings to load before doing anything
    if (!settingsLoaded) return;

    if (!updateChecksEnabled) {
      if (upToDateTimeoutRef.current) {
        clearTimeout(upToDateTimeoutRef.current);
      }
      clearUpdate();
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
  }, [
    checkForUpdates,
    clearUpdate,
    handleManualUpdateCheck,
    settingsLoaded,
    updateChecksEnabled,
  ]);

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

  const iconTitle = getUpdateStatusText();

  if (iconOnly) {
    const Icon = isChecking
      ? RefreshCw
      : updateInfo?.available
        ? Download
        : showUpToDate
          ? Check
          : RefreshCw;

    const iconClassName = isChecking
      ? "animate-spin"
      : updateInfo?.available
        ? "text-[var(--accent)]"
        : "";

    return (
      <div className={`flex items-center ${className}`}>
        {isUpdateClickable ? (
          <button
            onClick={getUpdateStatusAction()}
            disabled={isUpdateDisabled}
            className={`inline-flex items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50 ${interactiveFocusRingClass} ${minTapTargetHeightClass} min-w-[44px] p-2`}
            title={iconTitle}
            aria-label={iconTitle}
          >
            <Icon className={`h-3.5 w-3.5 ${iconClassName}`} />
          </button>
        ) : (
          <span
            className="rounded-md p-1.5 text-[var(--muted)]"
            title={iconTitle}
            aria-label={iconTitle}
          >
            <Icon className={`h-3.5 w-3.5 ${iconClassName}`} />
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {isUpdateClickable ? (
        <button
          onClick={getUpdateStatusAction()}
          disabled={isUpdateDisabled}
          className={`rounded-md px-3 text-xs transition-colors tabular-nums disabled:opacity-50 ${interactiveFocusRingClass} ${minTapTargetHeightClass} inline-flex items-center justify-center ${
            updateInfo?.available
              ? "font-semibold text-[var(--accent)] hover:text-[var(--accent)]"
              : "text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          {getUpdateStatusText()}
        </button>
      ) : (
        <span className="px-2 py-1 text-xs text-[var(--muted)] tabular-nums">
          {getUpdateStatusText()}
        </span>
      )}
    </div>
  );
};

export default UpdateChecker;
