import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { useSettings } from "../../../hooks/useSettings";
import { CorrectionDictionaryView } from "./CorrectionDictionaryView";
import { PersonalDictionaryEditor } from "./PersonalDictionaryEditor";
import { CustomWords } from "../CustomWords";

export const CorrectionSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const trackingEnabled = getSetting("correction_tracking_enabled") || false;

  return (
    <div className="w-full space-y-6">
      <SettingsGroup
        title={t("settings.corrections.tracking.title", {
          defaultValue: "Learning",
        })}
      >
        <ToggleSwitch
          checked={trackingEnabled}
          onChange={(enabled) =>
            updateSetting("correction_tracking_enabled", enabled)
          }
          isUpdating={isUpdating("correction_tracking_enabled")}
          label={t("settings.corrections.tracking.label")}
          description={t("settings.corrections.tracking.description")}
          descriptionMode="tooltip"
          grouped={true}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.corrections.manual.title", {
          defaultValue: "Preferred spellings",
        })}
      >
        <PersonalDictionaryEditor />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.corrections.boosts.title", {
          defaultValue: "Recognition boosts",
        })}
      >
        <CustomWords
          descriptionMode="tooltip"
          grouped={true}
          title={t("settings.corrections.boosts.editorTitle", {
            defaultValue: "Recognition boosts",
          })}
          description={t("settings.corrections.boosts.editorDescription", {
            defaultValue:
              "These entries use fuzzy matching to rescue difficult names and product terms during transcription.",
          })}
          placeholder={t("settings.corrections.boosts.placeholder", {
            defaultValue: "Add a name or term",
          })}
          addLabel={t("settings.corrections.boosts.add", {
            defaultValue: "Add boost",
          })}
          formatDuplicateMessage={(word) =>
            t("settings.corrections.boosts.duplicate", {
              word,
              defaultValue: '"{{word}}" is already in your boosts',
            })
          }
          formatRemoveLabel={(word) =>
            t("settings.corrections.boosts.remove", {
              word,
              defaultValue: "Remove {{word}} boost",
            })
          }
        />
      </SettingsGroup>

      <CorrectionDictionaryView
        sectionTitle={t("settings.corrections.dictionary.title")}
      />
    </div>
  );
};
