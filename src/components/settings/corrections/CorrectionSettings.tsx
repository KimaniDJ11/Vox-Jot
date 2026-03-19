import React from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "../../ui/Alert";
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
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">
          {t("settings.corrections.title")}
        </h1>
        <p className="text-sm text-text/60">
          {t("settings.corrections.description")}
        </p>
      </div>

      <SettingsGroup
        title={t("settings.corrections.tracking.title", {
          defaultValue: "Learning",
        })}
        description={t("settings.corrections.tracking.groupDescription", {
          defaultValue:
            "Let Vox Jot learn from edits you make after paste, then review or disable learned corrections here.",
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
        description={t("settings.corrections.manual.description", {
          defaultValue:
            "Add the phrases and spellings you want Vox Jot to prefer every time.",
        })}
      >
        <Alert variant="info" contained>
          {t("settings.corrections.manual.helper", {
            defaultValue:
              "Manual entries win over learned corrections when they target the same phrase.",
          })}
        </Alert>
        <PersonalDictionaryEditor />
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.corrections.boosts.title", {
          defaultValue: "Recognition boosts",
        })}
        description={t("settings.corrections.boosts.description", {
          defaultValue:
            "Keep a fuzzy shortlist for names, brands, and terms that speech recognition often mangles.",
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

      <SettingsGroup
        title={t("settings.corrections.dictionary.title")}
        description={t("settings.corrections.dictionary.description", {
          defaultValue:
            "Review the correction pairs Vox Jot has learned from your edits. You can adjust, disable, export, or remove them at any time.",
        })}
      >
        <CorrectionDictionaryView />
      </SettingsGroup>
    </div>
  );
};
