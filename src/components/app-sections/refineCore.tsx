import React from "react";
import { useTranslation } from "react-i18next";

import { TranslationSettingsCard } from "@/components/settings/general/TranslationSettingsCard";
import { SnippetSettings } from "@/components/settings/snippets/SnippetSettings";
import { WriteRulesSettings } from "@/components/settings/write-rules/WriteRulesSettings";
import { SettingsGroup } from "@/components/ui";

export const RefineTranslationSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SettingsGroup
        title={t("appSections.sections.translationTitle")}
        description={t("appSections.sections.translationDescription")}
        showTitle={false}
      >
        <TranslationSettingsCard />
      </SettingsGroup>
    </div>
  );
};

export const RefinePhraseKeysSection: React.FC = () => (
  <SnippetSettings showEnabledToggle={false} />
);

export const RefineProfilesSection: React.FC = () => (
  <div className="space-y-6">
    <WriteRulesSettings />
  </div>
);
