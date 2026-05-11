import React from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Check,
  Cloud,
  Dna,
  Globe,
  HardDrive,
  Monitor,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Slider } from "@/components/ui/Slider";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { type CompactBadgeItem } from "@/components/ui/CompactOverflow";
import HubModelCard from "@/components/model-hub/HubModelCard";
import { resolveModelProviderId } from "@/components/ui/ProviderIcon";
import type {
  CatalogModelDescriptor,
  ProviderDescriptor,
  TtsAdvancedControlDescriptor,
} from "@/lib/modelPlatform";
import type {
  TtsVoicePreset,
  TtsVoicePresetInput,
} from "@/lib/ttsVoicePresets";
import type { TtsVoicePresetPatch } from "./types";
import {
  workflowCardClassName,
  workflowFieldLabelClassName,
  workflowHintClassName,
} from "./styles";
import {
  formatLanguageCoverage,
  getModelLanguageItems,
  sourceKindLabel,
  ttsStorageSizeLabel,
} from "./utils";
import {
  DIRECT_TUNING_CONTROL_IDS,
  modelHasTuningControls,
  tuningDescription,
  tuningFallbackDefault,
  tuningFormatValue,
  tuningNumberDefault,
  tuningNumberLabel,
  tuningNumberPatch,
  tuningNumberValue,
  tuningRangeHint,
} from "./tuningControls";

export function SelectField({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
}) {
  return (
    <div className="relative w-full">
      <select
        className="w-full min-w-0 appearance-none rounded-full border border-[var(--border)] bg-[var(--bg)] py-2 pe-9 ps-4 text-sm font-semibold shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
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

export const InlineCueHint: React.FC<{ modelLabel?: string | null }> = ({
  modelLabel,
}) => {
  const label = modelLabel?.trim();
  const { t } = useTranslation();
  return (
    <p className="flex items-start gap-1.5 text-xs leading-5 text-[var(--muted)]">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--voice)]" />
      <Trans
        i18nKey="listen.inlineCueHint"
        values={{
          subject:
            label ??
            t("listen.inlineCueHintFallbackSubject", {
              defaultValue: "This model",
            }),
        }}
        components={{
          cueLaughs: <span className="font-medium" />,
          cueSighs: <span className="font-medium" />,
          cueWhispers: <span className="font-medium" />,
        }}
        defaults="{{subject}} supports inline cues in the spoken text, such as <cueLaughs>[laughs]</cueLaughs>, <cueSighs>[sighs]</cueSighs>, or <cueWhispers>[whispers]</cueWhispers>. Exact cue behavior varies by model."
      />
    </p>
  );
};

export const WorkflowField: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div className="space-y-2">
    <div className="space-y-1">
      <p className={workflowFieldLabelClassName}>{label}</p>
      {hint ? <p className={workflowHintClassName}>{hint}</p> : null}
    </div>
    {children}
  </div>
);

export const DraftVoiceModelLibraryCard: React.FC<{
  model: CatalogModelDescriptor;
  provider: ProviderDescriptor | null;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}> = ({ model, provider, selected, disabled, onSelect }) => {
  const { t } = useTranslation();
  const isLocal = model.capabilities.local_only || provider?.local_only;
  const languageCoverage = formatLanguageCoverage(model);
  const supportsStyle = modelHasTuningControls(model);
  const availabilityLabel = model.installed
    ? t("modelHub.tts.downloaded", { defaultValue: "Downloaded" })
    : model.downloadable
      ? t("listen.createVoices.downloadRequired", {
          defaultValue: "Download needed",
        })
      : t("listen.createVoices.available", { defaultValue: "Available" });

  const headerBadges: CompactBadgeItem[] = [
    selected
      ? {
          id: "draft",
          label: t("listen.createVoices.draft", { defaultValue: "Draft" }),
          variant: "primary",
          icon: <Check className="h-3.5 w-3.5" />,
          detail: t("listen.createVoices.draftModelDetail", {
            defaultValue:
              "Selected for the Create Voices draft only. The active app voice is unchanged.",
          }),
        }
      : null,
    {
      id: model.installed ? "downloaded" : "availability",
      label: availabilityLabel,
      variant: "secondary",
      detail: model.installed
        ? t("modelHub.tts.downloadedDetail", {
            defaultValue: "Voice pack is installed locally.",
          })
        : t("listen.createVoices.downloadRequiredDetail", {
            defaultValue:
              "Preview can download this model before generating audio.",
          }),
    },
  ].filter(Boolean) as CompactBadgeItem[];

  const sublineParts = [
    provider?.label,
    sourceKindLabel(model.source_kind),
  ].filter((part): part is string => Boolean(part));
  const capabilityChips: CompactBadgeItem[] = [
    {
      id: "capability-deployment",
      label: isLocal
        ? t("modelHub.chips.local", { defaultValue: "Local" })
        : t("modelHub.chips.cloud", { defaultValue: "Cloud" }),
      variant: "secondary",
      icon: isLocal ? (
        <Monitor className="h-3 w-3" />
      ) : (
        <Cloud className="h-3 w-3" />
      ),
      detail: isLocal
        ? t("modelHub.chips.localDetail", {
            defaultValue: "Runs on this Mac or through a local runtime.",
          })
        : t("modelHub.chips.cloudDetail", {
            defaultValue: "Uses a configured network provider.",
          }),
    },
    {
      id: "capability-size",
      label: ttsStorageSizeLabel(model, t),
      variant: "secondary",
      icon: <HardDrive className="h-3 w-3" />,
      detail: t("modelHub.chips.storageSizeDetail", {
        defaultValue: "Approximate model storage footprint.",
      }),
    },
    languageCoverage
      ? {
          id: "capability-languages",
          label: languageCoverage,
          variant: "secondary",
          icon: <Globe className="h-3 w-3" />,
          detail: getModelLanguageItems(model).join(" · "),
        }
      : null,
    model.capabilities.supports_voice_cloning
      ? {
          id: "capability-cloning",
          label: t("modelHub.chips.cloning", { defaultValue: "Cloning" }),
          variant: "secondary",
          icon: <Dna className="h-3 w-3" />,
          detail: t("modelHub.chips.cloningDetail", {
            defaultValue:
              "Supports voice cloning or profile-conditioned speech.",
          }),
        }
      : null,
    supportsStyle
      ? {
          id: "capability-style",
          label: t("modelHub.chips.style", { defaultValue: "Style" }),
          variant: "secondary",
          icon: <SlidersHorizontal className="h-3 w-3" />,
          detail: t("modelHub.chips.styleDetail", {
            defaultValue: "Supports expressive style or delivery controls.",
          }),
        }
      : null,
  ].filter(Boolean) as CompactBadgeItem[];

  return (
    <HubModelCard
      title={model.label}
      providerId={resolveModelProviderId(
        `${model.label} ${model.id}`,
        model.provider_id,
      )}
      subline={sublineParts.join(" · ") || undefined}
      headerBadges={headerBadges}
      description={model.description}
      capabilityChips={capabilityChips}
      footerMetaItems={[provider?.runtime.label ?? model.runtime.label]}
      footerMetaMaxVisible={4}
      footerMetaIcon={<Globe className="h-3.5 w-3.5" />}
      footerOverflowLabel={t("listen.createVoices.modelDetails", {
        modelName: model.label,
        defaultValue: "{{modelName}} details",
      })}
      onClick={onSelect}
      disabled={disabled}
      active={selected}
    />
  );
};

const TuningGroup: React.FC<{
  label: string;
  count?: number;
  children: React.ReactNode;
}> = ({ label, count, children }) => (
  <section className="space-y-1.5">
    <div className="flex items-center gap-2">
      <p className={workflowFieldLabelClassName}>{label}</p>
      {typeof count === "number" ? (
        <span className="text-[10px] font-semibold tabular-nums text-[var(--text-subtle,var(--muted))]">
          {count}
        </span>
      ) : null}
    </div>
    {children}
  </section>
);

export const VoiceTuningCard: React.FC<{
  preset: TtsVoicePreset | TtsVoicePresetInput;
  onUpdatePreset: (patch: TtsVoicePresetPatch) => void;
  ttsEnabled: boolean;
  controls: TtsAdvancedControlDescriptor[];
  supportsExpressiveness: boolean;
  title: string;
  embedded?: boolean;
  surfaceClassName?: string;
  modelLabel?: string | null;
  onResetAll?: () => void;
  onClose?: () => void;
  footerSlot?: React.ReactNode;
}> = ({
  preset,
  onUpdatePreset,
  ttsEnabled,
  controls,
  supportsExpressiveness,
  title,
  embedded = false,
  surfaceClassName = workflowCardClassName,
  modelLabel,
  onResetAll,
  onClose,
  footerSlot,
}) => {
  const { t } = useTranslation();
  const visibleSliderControls = controls.filter(
    (control) =>
      control.kind === "slider" && control.id !== "style_instructions",
  );
  const controlsByGroup = {
    delivery: visibleSliderControls.filter(
      (control) =>
        control.group === "tempo" ||
        control.id === "tempo_rate" ||
        control.id === "speed" ||
        control.id === "expressiveness",
    ),
    style: visibleSliderControls.filter(
      (control) =>
        control.group === "style" &&
        control.id !== "tempo_rate" &&
        control.id !== "speed" &&
        control.id !== "expressiveness",
    ),
    sampler: visibleSliderControls.filter(
      (control) => control.group === "sampler",
    ),
    guidance: visibleSliderControls.filter(
      (control) => control.group === "guidance",
    ),
    other: visibleSliderControls.filter(
      (control) =>
        !["tempo", "style", "sampler", "guidance"].includes(control.group) &&
        !DIRECT_TUNING_CONTROL_IDS.has(control.id),
    ),
  };
  if (
    supportsExpressiveness &&
    !visibleSliderControls.some((control) => control.id === "expressiveness")
  ) {
    controlsByGroup.delivery.push({
      id: "expressiveness",
      group: "style",
      label: "Expressiveness",
      description:
        "Overall energy and liveliness. Lower is calm and even, higher is animated.",
      kind: "slider",
      min: 0,
      max: 1,
      step: 0.05,
      unit: null,
      options: [],
      default_value: { kind: "number", value: 0.5 },
    });
  }
  const controlIds = new Set(controls.map((control) => control.id));
  const has = (id: string) => controlIds.has(id);
  const trimmedModelLabel = modelLabel?.trim();

  const deliveryCount = controlsByGroup.delivery.length;
  const styleCount = controlsByGroup.style.length;
  const samplerCount = controlsByGroup.sampler.length;
  const guidanceCount = controlsByGroup.guidance.length;
  const otherCount = controlsByGroup.other.length;
  const hasAnyOptionalControl =
    deliveryCount > 0 ||
    styleCount > 0 ||
    samplerCount > 0 ||
    guidanceCount > 0 ||
    otherCount > 0 ||
    has("style_instructions");
  const renderSliderControl = (control: TtsAdvancedControlDescriptor) => {
    const fallbackDefault = tuningFallbackDefault(control);
    const defaultValue = tuningNumberDefault(control, fallbackDefault);
    return (
      <Slider
        key={control.id}
        value={tuningNumberValue(preset.tuning, control)}
        onChange={(value) =>
          onUpdatePreset({
            tuning: tuningNumberPatch(preset.tuning, control, value),
          })
        }
        min={control.min ?? 0}
        max={control.max ?? 1}
        step={control.step ?? 0.05}
        label={tuningNumberLabel(control, control.id)}
        description={tuningDescription(
          control,
          "Model-specific generation control.",
        )}
        descriptionMode="tooltip"
        grouped
        layout="compact"
        formatValue={tuningFormatValue(control)}
        defaultValue={defaultValue}
        rangeHint={tuningRangeHint(control)}
        disabled={!ttsEnabled}
      />
    );
  };

  return (
    <div className={embedded ? "space-y-4" : surfaceClassName}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-[var(--text)]">
            {title}
          </h3>
          {trimmedModelLabel ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-[var(--ring-hairline)] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]"
              title={t("listen.tuning.appliedTo", {
                defaultValue: "Tuning applies to {{model}}",
                model: trimmedModelLabel,
              })}
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
                aria-hidden
              />
              {trimmedModelLabel}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {onResetAll ? (
            <button
              type="button"
              onClick={onResetAll}
              disabled={!ttsEnabled}
              className="inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]"
              title={t("listen.tuning.resetAllHint", {
                defaultValue: "Reset every parameter to its default value",
              })}
            >
              {t("listen.tuning.resetAll", { defaultValue: "Reset all" })}
            </button>
          ) : null}
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={t("common.close", { defaultValue: "Close" })}
              title={t("common.close", { defaultValue: "Close" })}
            >
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      {deliveryCount > 0 ? (
        <TuningGroup
          label={t("listen.tuning.groups.delivery", {
            defaultValue: "Delivery",
          })}
          count={deliveryCount}
        >
          <div className="grid gap-x-5 gap-y-1 md:grid-cols-2">
            {controlsByGroup.delivery.map(renderSliderControl)}
          </div>
        </TuningGroup>
      ) : null}

      {styleCount > 0 ? (
        <TuningGroup
          label={t("listen.tuning.groups.style", { defaultValue: "Style" })}
          count={styleCount}
        >
          <div className="grid gap-x-5 gap-y-1 md:grid-cols-2">
            {controlsByGroup.style.map(renderSliderControl)}
          </div>
        </TuningGroup>
      ) : null}

      {samplerCount > 0 ? (
        <TuningGroup
          label={t("listen.tuning.groups.sampler", { defaultValue: "Sampler" })}
          count={samplerCount}
        >
          <div className="grid gap-x-5 gap-y-1 md:grid-cols-2">
            {controlsByGroup.sampler.map(renderSliderControl)}
          </div>
        </TuningGroup>
      ) : null}

      {guidanceCount > 0 ? (
        <TuningGroup
          label={t("listen.tuning.groups.guidance", {
            defaultValue: "Guidance",
          })}
          count={guidanceCount}
        >
          <div className="grid gap-x-5 gap-y-1 md:grid-cols-2">
            {controlsByGroup.guidance.map(renderSliderControl)}
          </div>
        </TuningGroup>
      ) : null}

      {otherCount > 0 ? (
        <TuningGroup
          label={t("listen.tuning.groups.advanced", {
            defaultValue: "Advanced",
          })}
          count={otherCount}
        >
          <div className="grid gap-x-5 gap-y-1 md:grid-cols-2">
            {controlsByGroup.other.map(renderSliderControl)}
          </div>
        </TuningGroup>
      ) : null}

      {has("style_instructions") ? (
        <TuningGroup
          label={t("listen.tuning.styleInstructions", {
            defaultValue: "Style notes",
          })}
        >
          <Textarea
            value={preset.tuning.style_instructions ?? ""}
            onChange={(event) =>
              onUpdatePreset({
                tuning: {
                  style_instructions: event.target.value || null,
                },
              })
            }
            disabled={!ttsEnabled}
            className="min-h-[84px] !rounded-2xl"
            placeholder={t("listen.placeholders.styleInstructions")}
          />
        </TuningGroup>
      ) : null}

      {!hasAnyOptionalControl ? (
        <p className="rounded-lg border border-dashed border-[var(--ring-hairline)] bg-[var(--card)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
          {t("listen.tuning.noExtraControls", {
            defaultValue:
              "No verified generation controls are available for this model in Vox Jot yet.",
          })}
        </p>
      ) : null}

      {footerSlot}
    </div>
  );
};
