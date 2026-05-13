import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface GlobalLanguageSyncProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const GlobalLanguageSync: React.FC<GlobalLanguageSyncProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { settings, updateSetting, applyGlobalLanguageSync, isUpdating } =
      useSettings();
    const [isSyncing, setIsSyncing] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const syncEnabled = settings?.global_language_sync_enabled ?? true;
    const currentAppLanguage = settings?.app_language ?? "en";

    const handleToggleChange = async (checked: boolean) => {
      await updateSetting("global_language_sync_enabled", checked);
      setStatusMessage(
        checked
          ? t("settings.globalLanguageSync.enabledStatus")
          : t("settings.globalLanguageSync.disabledStatus"),
      );
    };

    const handleSyncNow = async () => {
      setIsSyncing(true);
      try {
        await applyGlobalLanguageSync(currentAppLanguage, "manual");
        setStatusMessage(t("settings.globalLanguageSync.done"));
      } catch (error) {
        console.error("Language sync failed:", error);
        setStatusMessage(t("settings.globalLanguageSync.failed"));
      } finally {
        setIsSyncing(false);
      }
    };

    return (
      <SettingContainer
        title={t("settings.globalLanguageSync.title")}
        description={t("settings.globalLanguageSync.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
        layout="stacked"
      >
        <div className="space-y-3">
          <label className="inline-flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent-glow)]"
              checked={syncEnabled}
              disabled={isUpdating("global_language_sync_enabled")}
              onChange={(event) =>
                void handleToggleChange(event.target.checked)
              }
            />
            <span className="text-sm font-medium text-[var(--text)]">
              {t("settings.globalLanguageSync.syncAutomatically")}
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleSyncNow()}
              disabled={isSyncing}
            >
              {isSyncing
                ? t("settings.globalLanguageSync.syncing")
                : t("settings.globalLanguageSync.syncNow")}
            </Button>
            <p className="text-xs leading-5 text-[var(--muted)]">
              {statusMessage ?? t("settings.globalLanguageSync.defaultStatus")}
            </p>
          </div>
        </div>
      </SettingContainer>
    );
  },
);

GlobalLanguageSync.displayName = "GlobalLanguageSync";
