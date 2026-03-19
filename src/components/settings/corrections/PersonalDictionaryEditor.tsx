import React from "react";
import { useTranslation } from "react-i18next";
import type { DictionaryEntry } from "@/bindings";
import { useSettings } from "../../../hooks/useSettings";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { SettingContainer } from "../../ui/SettingContainer";

const emptyDictionaryEntry = (): DictionaryEntry => ({
  spoken: "",
  written: "",
  priority: 0,
  case_sensitive: false,
  exact_only: false,
});

interface PersonalDictionaryEditorProps {
  disabled?: boolean;
}

export const PersonalDictionaryEditor: React.FC<
  PersonalDictionaryEditorProps
> = ({ disabled = false }) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const entries = getSetting("personal_dictionary") || [];
  const duplicateSpokenForms = new Set<string>();
  const seenSpokenForms = new Set<string>();

  entries.forEach((entry) => {
    const key = entry.spoken.trim().toLowerCase();
    if (!key) return;
    if (seenSpokenForms.has(key)) {
      duplicateSpokenForms.add(key);
    } else {
      seenSpokenForms.add(key);
    }
  });

  const persistEntries = (nextEntries: DictionaryEntry[]) => {
    void updateSetting("personal_dictionary", nextEntries);
  };

  const updateEntry = (
    index: number,
    field: keyof DictionaryEntry,
    value: DictionaryEntry[keyof DictionaryEntry],
  ) => {
    const nextEntries = entries.map((entry, currentIndex) =>
      currentIndex === index ? { ...entry, [field]: value } : entry,
    );
    persistEntries(nextEntries);
  };

  return (
    <SettingContainer
      title={t("settings.postProcessing.dictionary.editor.title")}
      description={t("settings.postProcessing.dictionary.editor.description")}
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
      disabled={disabled}
    >
      <div className="space-y-3">
        {duplicateSpokenForms.size > 0 && (
          <Alert variant="warning" contained>
            {t("settings.postProcessing.dictionary.duplicateWarning")}
          </Alert>
        )}

        {entries.length === 0 && (
          <div className="rounded-md border border-mid-gray/20 bg-mid-gray/5 p-3 text-sm text-mid-gray">
            {t("settings.postProcessing.dictionary.empty")}
          </div>
        )}

        {entries.map((entry, index) => {
          const spokenKey = entry.spoken.trim().toLowerCase();
          const isDuplicate =
            spokenKey.length > 0 && duplicateSpokenForms.has(spokenKey);

          return (
            <div
              key={`${entry.spoken}-${entry.written}-${index}`}
              className="rounded-md border border-mid-gray/20 p-3 space-y-3"
            >
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-start">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-mid-gray">
                    {t("settings.postProcessing.dictionary.columns.spoken")}
                  </label>
                  <Input
                    value={entry.spoken}
                    onChange={(event) =>
                      updateEntry(index, "spoken", event.target.value)
                    }
                    placeholder={t(
                      "settings.postProcessing.dictionary.placeholders.spoken",
                    )}
                    disabled={disabled || isUpdating("personal_dictionary")}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-mid-gray">
                    {t("settings.postProcessing.dictionary.columns.written")}
                  </label>
                  <Input
                    value={entry.written}
                    onChange={(event) =>
                      updateEntry(index, "written", event.target.value)
                    }
                    placeholder={t(
                      "settings.postProcessing.dictionary.placeholders.written",
                    )}
                    disabled={disabled || isUpdating("personal_dictionary")}
                  />
                </div>

                <div className="flex items-end justify-end">
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    onClick={() =>
                      persistEntries(
                        entries.filter(
                          (_, currentIndex) => currentIndex !== index,
                        ),
                      )
                    }
                    disabled={disabled || isUpdating("personal_dictionary")}
                  >
                    {t("settings.postProcessing.dictionary.remove")}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.exact_only}
                    onChange={(event) =>
                      updateEntry(index, "exact_only", event.target.checked)
                    }
                    disabled={disabled || isUpdating("personal_dictionary")}
                  />
                  <span>
                    {t("settings.postProcessing.dictionary.columns.exactOnly")}
                  </span>
                </label>

                {isDuplicate && (
                  <span className="text-xs text-yellow-400">
                    {t("settings.postProcessing.dictionary.duplicateBadge")}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        <Button
          onClick={() => persistEntries([...entries, emptyDictionaryEntry()])}
          variant="primary-soft"
          size="md"
          disabled={disabled || isUpdating("personal_dictionary")}
        >
          {t("settings.postProcessing.dictionary.add")}
        </Button>
      </div>
    </SettingContainer>
  );
};
