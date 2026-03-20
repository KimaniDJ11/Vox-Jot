import React from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "../../ui/Alert";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ToggleSwitch } from "@/components/ui";
import { HistoryLimit } from "../HistoryLimit";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { useSettings } from "../../../hooks/useSettings";

export const DataPrivacySettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const localPrivacyMode = getSetting("local_privacy_mode") ?? false;

  return (
    <div className="w-full space-y-6">
      <Alert variant="info" contained={false}>
        <div className="space-y-2">
          <p className="font-semibold text-sm">
            {t("settings.dataPrivacy.introTitle")}
          </p>
          <p className="text-sm leading-relaxed">
            {t("settings.dataPrivacy.introBody")}
          </p>
        </div>
      </Alert>

      <SettingsGroup title={t("settings.dataPrivacy.groups.storage")}>
        <HistoryLimit descriptionMode="tooltip" grouped={true} />
        <RecordingRetentionPeriodSelector
          descriptionMode="tooltip"
          grouped={true}
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.dataPrivacy.groups.postProcessing")}>
        <ToggleSwitch
          checked={localPrivacyMode}
          onChange={(enabled) =>
            void updateSetting("local_privacy_mode", enabled)
          }
          isUpdating={isUpdating("local_privacy_mode")}
          label={t("settings.postProcessing.localPrivacy.label")}
          description={t("settings.postProcessing.localPrivacy.description")}
          descriptionMode="tooltip"
          grouped={true}
        />
        {localPrivacyMode && (
          <Alert variant="info" contained>
            {t("settings.postProcessing.localPrivacy.cloudDisabled")}
          </Alert>
        )}
      </SettingsGroup>
    </div>
  );
};
