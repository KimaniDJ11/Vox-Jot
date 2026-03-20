import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ExperimentalToggle } from "../ExperimentalToggle";
import { KeyboardImplementationSelector } from "../debug/KeyboardImplementationSelector";
import { useSettings } from "../../../hooks/useSettings";

export const ExperimentalSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const experimentalEnabled = getSetting("experimental_enabled") || false;

  return (
    <div className="w-full space-y-6">
      <SettingsGroup title={t("settings.experimental.title")}>
        <ExperimentalToggle descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>

      {experimentalEnabled && (
        <SettingsGroup title={t("settings.advanced.groups.experimental")}>
          <KeyboardImplementationSelector
            descriptionMode="tooltip"
            grouped={true}
          />
        </SettingsGroup>
      )}
    </div>
  );
};
