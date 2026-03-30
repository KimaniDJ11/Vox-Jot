import React, { useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface GlobalLanguageSyncProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const GlobalLanguageSync: React.FC<GlobalLanguageSyncProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const {
      settings,
      updateSetting,
      applyGlobalLanguageSync,
      isUpdating,
    } = useSettings();
    const [isSyncing, setIsSyncing] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const syncEnabled = settings?.global_language_sync_enabled ?? true;
    const currentAppLanguage = settings?.app_language ?? "en";

    const handleToggleChange = async (checked: boolean) => {
      await updateSetting("global_language_sync_enabled", checked);
      setStatusMessage(
        checked
          ? "App language changes will also align speech settings."
          : "App language changes will stay separate from speech settings.",
      );
    };

    const handleSyncNow = async () => {
      setIsSyncing(true);
      try {
        const result = await applyGlobalLanguageSync(
          currentAppLanguage,
          "manual",
        );
        setStatusMessage(result.message);
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Language sync failed.",
        );
      } finally {
        setIsSyncing(false);
      }
    };

    return (
      <SettingContainer
        title="Global Language Sync"
        description="Keep the interface language, speech recognition language, and speech output selection aligned from one place."
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
              onChange={(event) => void handleToggleChange(event.target.checked)}
            />
            <span className="text-sm font-medium text-[var(--text)]">
              Sync future app-language changes automatically
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
              {isSyncing ? "Syncing..." : "Sync now"}
            </Button>
            <p className="text-xs leading-5 text-[var(--muted)]">
              {statusMessage ??
                "Use this when you want the whole app to re-align with the current app language."}
            </p>
          </div>
        </div>
      </SettingContainer>
    );
  },
);

GlobalLanguageSync.displayName = "GlobalLanguageSync";
