import React from "react";
import { SettingContainer } from "../../ui/SettingContainer";
import { useSettings } from "../../../hooks/useSettings";
import { LANGUAGES } from "../../../lib/constants/languages";

const TARGET_LANGUAGES = LANGUAGES.filter(
  (language) => language.value !== "auto",
);

function SelectField({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-flex">
      <select
        className="min-w-[220px] appearance-none rounded-full border border-[var(--border)] bg-[var(--bg)] py-2 pe-9 ps-4 text-sm font-semibold shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </div>
  );
}

export const TranslationSettingsCard: React.FC = () => {
  const { settings, updateSetting, isUpdating } = useSettings();

  if (!settings) {
    return null;
  }

  const translationMode = settings.translation_output_mode ?? "source";
  const isTranslatedMode = translationMode !== "source";

  return (
    <>
      <SettingContainer
        title="Translation Output"
        description="Choose whether dictation stays in the source language, is translated, or shows both source and translation."
        descriptionMode="tooltip"
        grouped={true}
      >
        <SelectField
          value={translationMode}
          onChange={(value) =>
            void updateSetting("translation_output_mode", value as any)
          }
          disabled={isUpdating("translation_output_mode")}
          options={[
            { value: "source", label: "Source only" },
            { value: "translated", label: "Translated only" },
            { value: "bilingual", label: "Bilingual" },
          ]}
        />
      </SettingContainer>

      <SettingContainer
        title="Target Language"
        description="Choose the language Vox Jot should translate into."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!isTranslatedMode}
      >
        <SelectField
          value={settings.translation_target_language ?? "en"}
          onChange={(value) =>
            void updateSetting("translation_target_language", value as any)
          }
          disabled={
            !isTranslatedMode || isUpdating("translation_target_language")
          }
          options={TARGET_LANGUAGES}
        />
      </SettingContainer>

      <SettingContainer
        title="Translation Route"
        description="Auto prefers local routes first. Whisper English is only used for direct dictation-to-English output."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!isTranslatedMode}
      >
        <SelectField
          value={settings.translation_route_preference ?? "auto"}
          onChange={(value) =>
            void updateSetting("translation_route_preference", value as any)
          }
          disabled={
            !isTranslatedMode || isUpdating("translation_route_preference")
          }
          options={[
            { value: "auto", label: "Auto" },
            { value: "whisper_english", label: "Whisper English" },
            { value: "local_ai", label: "Local AI" },
            { value: "remote_ai", label: "Remote AI" },
            { value: "offline_pack", label: "Offline pack" },
          ]}
        />
      </SettingContainer>

      {translationMode === "bilingual" && (
        <SettingContainer
          title="Bilingual Layout"
          description="Choose which block appears first when both source and translation are shown."
          descriptionMode="tooltip"
          grouped={true}
        >
          <SelectField
            value={
              settings.translation_bilingual_layout ?? "translation_then_source"
            }
            onChange={(value) =>
              void updateSetting("translation_bilingual_layout", value as any)
            }
            disabled={isUpdating("translation_bilingual_layout")}
            options={[
              {
                value: "translation_then_source",
                label: "Translation then source",
              },
              {
                value: "source_then_translation",
                label: "Source then translation",
              },
            ]}
          />
        </SettingContainer>
      )}

      <SettingContainer
        title="Dictation Destination"
        description="Choose whether translated dictation pastes directly, opens a preview first, or goes to Jot Pad."
        descriptionMode="tooltip"
        grouped={true}
        disabled={!isTranslatedMode}
      >
        <SelectField
          value={settings.translation_destination_mode ?? "paste_in_place"}
          onChange={(value) =>
            void updateSetting("translation_destination_mode", value as any)
          }
          disabled={
            !isTranslatedMode || isUpdating("translation_destination_mode")
          }
          options={[
            { value: "paste_in_place", label: "Paste in place" },
            { value: "preview_then_paste", label: "Preview then paste" },
            { value: "open_in_jot_pad", label: "Open in Jot Pad" },
          ]}
        />
      </SettingContainer>

      <SettingContainer
        title="Selection Translation"
        description="Choose how highlighted text translation is delivered."
        descriptionMode="tooltip"
        grouped={true}
      >
        <SelectField
          value={
            settings.selection_translation_destination_mode ??
            "replace_selection"
          }
          onChange={(value) =>
            void updateSetting(
              "selection_translation_destination_mode",
              value as any,
            )
          }
          disabled={isUpdating("selection_translation_destination_mode")}
          options={[
            { value: "replace_selection", label: "Replace selection" },
            { value: "preview_then_replace", label: "Preview then replace" },
            { value: "open_in_jot_pad", label: "Open in Jot Pad" },
          ]}
        />
      </SettingContainer>
    </>
  );
};
