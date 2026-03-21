import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { CorrectionDictionaryView } from "./CorrectionDictionaryView";
import { PersonalDictionaryEditor } from "./PersonalDictionaryEditor";
import { CustomWords } from "../CustomWords";
import { CorrectionTrackingToggle } from "../CorrectionTrackingToggle";

interface CorrectionSettingsProps {
  showTrackingToggle?: boolean;
}

export const CorrectionSettings: React.FC<CorrectionSettingsProps> = ({
  showTrackingToggle = true,
}) => {
  const { t } = useTranslation();

  return (
    <div className="w-full space-y-6">
      {showTrackingToggle && (
        <SettingsGroup
          title={t("settings.corrections.tracking.title", {
            defaultValue: "Learning",
          })}
        >
          <CorrectionTrackingToggle descriptionMode="tooltip" grouped={true} />
        </SettingsGroup>
      )}

      <SettingsGroup>
        <PersonalDictionaryEditor />
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

      <CorrectionDictionaryView
        sectionTitle={t("settings.corrections.dictionary.title")}
      />
    </div>
  );
};
