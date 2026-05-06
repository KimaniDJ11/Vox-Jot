import React from "react";
import {
  ArrowRightLeft,
  Clipboard,
  Cloud,
  Columns2,
  Cpu,
  Eye,
  FileText,
  Globe2,
  HardDrive,
  Languages,
  NotebookText,
  Replace,
  Wand2,
  Zap,
} from "lucide-react";
import type {
  SelectionTranslationDestinationMode,
  TranslationBilingualLayout,
  TranslationDestinationMode,
  TranslationOutputMode,
  TranslationRoutePreference,
} from "../../../bindings";
import { SettingContainer } from "../../ui/SettingContainer";
import { useSettings } from "../../../hooks/useSettings";
import { LANGUAGES } from "../../../lib/constants/languages";
import {
  SelectionDot,
  visualizationStateClass,
} from "@/components/settings/VisualizationCard";

const TARGET_LANGUAGES = LANGUAGES.filter(
  (language) => language.value !== "auto",
);

const detectedSourceLabel = "Detected source";
const targetOutputLabel = "Target output";

type ChoiceOption<T extends string> = {
  value: T;
  title: string;
  description: string;
  icon: React.ReactNode;
  preview: React.ReactNode;
};

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

function ChoiceGrid<T extends string>({
  options,
  value,
  disabled = false,
  columns = "lg:grid-cols-3",
  onChange,
}: {
  options: Array<ChoiceOption<T>>;
  value: T;
  disabled?: boolean;
  columns?: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className={`grid gap-2 sm:grid-cols-2 ${columns}`}>
      {options.map((option) => (
        <VisualChoiceCard
          key={option.value}
          option={option}
          selected={value === option.value}
          disabled={disabled}
          onSelect={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

function VisualChoiceCard<T extends string>({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: ChoiceOption<T>;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={visualizationStateClass(selected, disabled)}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="mb-3 overflow-hidden rounded-md border border-[var(--border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--bg),white_6%),var(--bg))] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
            {option.icon}
          </span>
          <span className="h-1.5 w-11 rounded-full bg-[color-mix(in_srgb,var(--text),transparent_88%)]" />
        </div>
        {option.preview}
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text)]">
            {option.title}
          </p>
          <p className="mt-0.5 text-xs leading-4 text-[var(--muted)]">
            {option.description}
          </p>
        </div>
        <SelectionDot selected={selected} />
      </div>
    </button>
  );
}

const TextLinePreview: React.FC<{
  primary?: boolean;
  widths?: string[];
}> = ({ primary = false, widths = ["w-full", "w-4/5", "w-2/3"] }) => (
  <div className="space-y-1.5">
    {widths.map((width, index) => (
      <span
        key={`${width}-${index}`}
        className={`block h-1.5 rounded-full ${
          primary
            ? "bg-[var(--accent)]"
            : "bg-[color-mix(in_srgb,var(--text),transparent_84%)]"
        } ${width}`}
      />
    ))}
  </div>
);

const OutputPreview: React.FC<{ mode: TranslationOutputMode }> = ({ mode }) => {
  if (mode === "bilingual") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-[var(--card)] p-2">
          <TextLinePreview primary widths={["w-5/6", "w-3/5"]} />
        </div>
        <div className="rounded-md bg-[var(--card)] p-2">
          <TextLinePreview widths={["w-4/5", "w-1/2"]} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md bg-[var(--card)] p-2.5">
      <TextLinePreview
        primary={mode === "translated"}
        widths={mode === "source" ? ["w-5/6", "w-2/3"] : ["w-full", "w-3/4"]}
      />
    </div>
  );
};

const RoutePreview: React.FC<{ route: TranslationRoutePreference }> = ({
  route,
}) => {
  const showCloud = route === "remote_ai" || route === "auto";
  const showLocal =
    route === "local_ai" ||
    route === "whisper_english" ||
    route === "offline_pack" ||
    route === "auto";

  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-8 flex-1 items-center justify-center rounded-md border ${
          showLocal
            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
            : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
        }`}
      >
        <Cpu className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="h-px w-5 bg-[var(--border)]" />
      <span
        className={`flex h-8 flex-1 items-center justify-center rounded-md border ${
          showCloud
            ? "border-[var(--accent-teal)] bg-[var(--accent-teal-soft)] text-[var(--accent-teal)]"
            : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
        }`}
      >
        <Cloud className="h-3.5 w-3.5" aria-hidden />
      </span>
    </div>
  );
};

const DeliveryPreview: React.FC<{
  kind:
    | TranslationDestinationMode
    | SelectionTranslationDestinationMode
    | TranslationBilingualLayout;
}> = ({ kind }) => {
  if (
    kind === "translation_then_source" ||
    kind === "source_then_translation"
  ) {
    const translationFirst = kind === "translation_then_source";
    return (
      <div className="space-y-1.5">
        <div
          className={`h-5 rounded-md ${
            translationFirst
              ? "bg-[var(--accent-soft)]"
              : "bg-[color-mix(in_srgb,var(--text),transparent_90%)]"
          }`}
        />
        <div
          className={`h-5 rounded-md ${
            translationFirst
              ? "bg-[color-mix(in_srgb,var(--text),transparent_90%)]"
              : "bg-[var(--accent-soft)]"
          }`}
        />
      </div>
    );
  }

  if (kind === "preview_then_paste" || kind === "preview_then_replace") {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-2">
        <div className="mb-2 h-2 w-12 rounded-full bg-[var(--accent)]" />
        <TextLinePreview widths={["w-full", "w-3/5"]} />
      </div>
    );
  }

  if (kind === "open_in_jot_pad") {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-2">
        <div className="mb-2 flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-gold)]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-teal)]" />
        </div>
        <TextLinePreview primary widths={["w-5/6", "w-1/2"]} />
      </div>
    );
  }

  if (kind === "replace_selection") {
    return (
      <div className="rounded-md bg-[var(--card)] p-2">
        <div className="mb-1.5 h-4 rounded-sm bg-[var(--accent-soft)] ring-1 ring-[var(--accent-glow)]" />
        <TextLinePreview primary widths={["w-2/3"]} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-[var(--card)] p-2">
      <span className="h-6 flex-1 rounded bg-[var(--accent-soft)]" />
      <span className="h-2 w-4 rounded-full bg-[var(--accent)]" />
    </div>
  );
};

export const TranslationSettingsCard: React.FC = () => {
  const { settings, updateSetting, isUpdating } = useSettings();

  if (!settings) {
    return null;
  }

  const translationMode = settings.translation_output_mode ?? "source";
  const isTranslatedMode = translationMode !== "source";
  const targetLanguage =
    TARGET_LANGUAGES.find(
      (language) => language.value === settings.translation_target_language,
    ) ?? TARGET_LANGUAGES.find((language) => language.value === "en");

  const outputOptions: Array<ChoiceOption<TranslationOutputMode>> = [
    {
      value: "source",
      title: "Source only",
      description: "Keep dictated text in the detected language.",
      icon: <FileText className="h-4 w-4" aria-hidden />,
      preview: <OutputPreview mode="source" />,
    },
    {
      value: "translated",
      title: "Translated only",
      description: "Paste just the translated result.",
      icon: <Languages className="h-4 w-4" aria-hidden />,
      preview: <OutputPreview mode="translated" />,
    },
    {
      value: "bilingual",
      title: "Bilingual",
      description: "Show the translation and original together.",
      icon: <Columns2 className="h-4 w-4" aria-hidden />,
      preview: <OutputPreview mode="bilingual" />,
    },
  ];

  const routeOptions: Array<ChoiceOption<TranslationRoutePreference>> = [
    {
      value: "auto",
      title: "Automatic",
      description: "Pick the best available route for this language.",
      icon: <Wand2 className="h-4 w-4" aria-hidden />,
      preview: <RoutePreview route="auto" />,
    },
    {
      value: "whisper_english",
      title: "Fast on-device",
      description: "Use Whisper's local English translation path.",
      icon: <Zap className="h-4 w-4" aria-hidden />,
      preview: <RoutePreview route="whisper_english" />,
    },
    {
      value: "local_ai",
      title: "Local AI",
      description: "Use an on-device model when configured.",
      icon: <Cpu className="h-4 w-4" aria-hidden />,
      preview: <RoutePreview route="local_ai" />,
    },
    {
      value: "remote_ai",
      title: "Online AI",
      description: "Use the selected cloud provider.",
      icon: <Cloud className="h-4 w-4" aria-hidden />,
      preview: <RoutePreview route="remote_ai" />,
    },
    {
      value: "offline_pack",
      title: "Offline pack",
      description: "Use an installed language pack.",
      icon: <HardDrive className="h-4 w-4" aria-hidden />,
      preview: <RoutePreview route="offline_pack" />,
    },
  ];

  const bilingualLayoutOptions: Array<
    ChoiceOption<TranslationBilingualLayout>
  > = [
    {
      value: "translation_then_source",
      title: "Translation first",
      description: "Lead with the translated block.",
      icon: <Languages className="h-4 w-4" aria-hidden />,
      preview: <DeliveryPreview kind="translation_then_source" />,
    },
    {
      value: "source_then_translation",
      title: "Source first",
      description: "Lead with the original dictated block.",
      icon: <FileText className="h-4 w-4" aria-hidden />,
      preview: <DeliveryPreview kind="source_then_translation" />,
    },
  ];

  const destinationOptions: Array<ChoiceOption<TranslationDestinationMode>> = [
    {
      value: "paste_in_place",
      title: "Paste in place",
      description: "Send translated dictation to the focused app.",
      icon: <Clipboard className="h-4 w-4" aria-hidden />,
      preview: <DeliveryPreview kind="paste_in_place" />,
    },
    {
      value: "preview_then_paste",
      title: "Preview first",
      description: "Confirm the translation before pasting.",
      icon: <Eye className="h-4 w-4" aria-hidden />,
      preview: <DeliveryPreview kind="preview_then_paste" />,
    },
    {
      value: "open_in_jot_pad",
      title: "Open in Jot Pad",
      description: "Route the translated text to the scratchpad.",
      icon: <NotebookText className="h-4 w-4" aria-hidden />,
      preview: <DeliveryPreview kind="open_in_jot_pad" />,
    },
  ];

  const selectionDestinationOptions: Array<
    ChoiceOption<SelectionTranslationDestinationMode>
  > = [
    {
      value: "replace_selection",
      title: "Replace selection",
      description: "Swap highlighted text with the translation.",
      icon: <Replace className="h-4 w-4" aria-hidden />,
      preview: <DeliveryPreview kind="replace_selection" />,
    },
    {
      value: "preview_then_replace",
      title: "Preview first",
      description: "Review before replacing selected text.",
      icon: <Eye className="h-4 w-4" aria-hidden />,
      preview: <DeliveryPreview kind="preview_then_replace" />,
    },
    {
      value: "open_in_jot_pad",
      title: "Open in Jot Pad",
      description: "Send the translated selection to the scratchpad.",
      icon: <NotebookText className="h-4 w-4" aria-hidden />,
      preview: <DeliveryPreview kind="open_in_jot_pad" />,
    },
  ];

  return (
    <>
      <SettingContainer
        title="Selection Translation"
        description="Choose how highlighted text translation is delivered."
        descriptionMode="inline"
        layout="stacked"
      >
        <ChoiceGrid
          options={selectionDestinationOptions}
          value={
            settings.selection_translation_destination_mode ??
            "replace_selection"
          }
          onChange={(value) =>
            void updateSetting("selection_translation_destination_mode", value)
          }
          disabled={isUpdating("selection_translation_destination_mode")}
        />
      </SettingContainer>

      <SettingContainer
        title="Translation Output"
        description="Choose whether dictation stays in the source language, is translated, or shows both source and translation."
        descriptionMode="inline"
        layout="stacked"
      >
        <ChoiceGrid
          options={outputOptions}
          value={translationMode}
          onChange={(value) =>
            void updateSetting("translation_output_mode", value)
          }
          disabled={isUpdating("translation_output_mode")}
        />
      </SettingContainer>

      <SettingContainer
        title="Target Language"
        description="Choose the language Vox Jot should translate into."
        descriptionMode="inline"
        layout="stacked"
        disabled={!isTranslatedMode}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <Globe2 className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text)]">
                  {targetLanguage?.label ?? "English"}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
                  <span>{detectedSourceLabel}</span>
                  <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
                  <span>{targetOutputLabel}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center lg:justify-end">
            <SelectField
              value={settings.translation_target_language ?? "en"}
              onChange={(value) =>
                void updateSetting("translation_target_language", value)
              }
              disabled={
                !isTranslatedMode || isUpdating("translation_target_language")
              }
              options={TARGET_LANGUAGES}
            />
          </div>
        </div>
      </SettingContainer>

      <SettingContainer
        title="Translation Method"
        description="Automatic works for most people. Choose a specific method only if you need one."
        descriptionMode="inline"
        layout="stacked"
        disabled={!isTranslatedMode}
      >
        <ChoiceGrid
          options={routeOptions}
          value={settings.translation_route_preference ?? "auto"}
          onChange={(value) =>
            void updateSetting("translation_route_preference", value)
          }
          disabled={
            !isTranslatedMode || isUpdating("translation_route_preference")
          }
          columns="lg:grid-cols-5"
        />
      </SettingContainer>

      {translationMode === "bilingual" && (
        <SettingContainer
          title="Bilingual Layout"
          description="Choose which block appears first when both source and translation are shown."
          descriptionMode="inline"
          layout="stacked"
        >
          <ChoiceGrid
            options={bilingualLayoutOptions}
            value={
              settings.translation_bilingual_layout ?? "translation_then_source"
            }
            onChange={(value) =>
              void updateSetting("translation_bilingual_layout", value)
            }
            disabled={isUpdating("translation_bilingual_layout")}
            columns="lg:grid-cols-2"
          />
        </SettingContainer>
      )}

      <SettingContainer
        title="Dictation Destination"
        description="Choose whether translated dictation pastes directly, opens a preview first, or goes to Jot Pad."
        descriptionMode="inline"
        layout="stacked"
        disabled={!isTranslatedMode}
      >
        <ChoiceGrid
          options={destinationOptions}
          value={settings.translation_destination_mode ?? "paste_in_place"}
          onChange={(value) =>
            void updateSetting("translation_destination_mode", value)
          }
          disabled={
            !isTranslatedMode || isUpdating("translation_destination_mode")
          }
        />
      </SettingContainer>
    </>
  );
};
