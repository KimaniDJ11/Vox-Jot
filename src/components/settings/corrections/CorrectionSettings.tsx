import React from "react";
import { useTranslation } from "react-i18next";
import { BooleanSetting } from "../../ui/BooleanSetting";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { CustomWords } from "../CustomWords";
import { CorrectionTrackingToggle } from "../CorrectionTrackingToggle";

export const CorrectionSettings: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="w-full space-y-6">
      <SettingsGroup
        title={t("settings.corrections.tracking.title", {
          defaultValue: "Learning",
        })}
      >
        <CorrectionTrackingToggle descriptionMode="tooltip" grouped={true} />
      </SettingsGroup>
      <SettingsGroup
        title={t(
          "settings.corrections.fileTranscriptionDictionary.sectionTitle",
          {
            defaultValue: "File transcription",
          },
        )}
      >
        <BooleanSetting
          settingKey="file_transcription_apply_dictionary"
          labelKey="settings.corrections.fileTranscriptionDictionary.label"
          descriptionKey="settings.corrections.fileTranscriptionDictionary.description"
          descriptionMode="inline"
          grouped
          defaultValue={true}
        />
      </SettingsGroup>
      <SettingsGroup>
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
    </div>
  );
};
