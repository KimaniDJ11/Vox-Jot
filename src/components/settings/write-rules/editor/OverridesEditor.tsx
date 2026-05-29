// "What it changes" section of the profile editor.
//
// Old design: three tabs (Speech / Refine / Output) each containing
// every overrideable field with "Use global setting" as the default
// dropdown choice. That meant a fresh profile rendered ~10 rows of
// "Use global setting" — visual noise that grew with every override
// we added.
//
// New design: only fields the user has actively overridden are
// rendered, each as a single editor row. An "Add override" button
// opens a small grouped menu of inactive overrides; clicking one adds
// it with a sensible default value (see `defaultValueWhenAdded` in the
// override registry). Removing an override with the × restores the
// global setting.
//
// The "Use global setting" copy from the previous design lives on as
// the empty-state hint so the user knows what's happening.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  LLMPrompt,
  ModelInfo,
  ToneDefinition,
  WriteRuleOverrides,
} from "@/bindings";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { Button } from "@/components/ui/Button";
import { Dropdown } from "@/components/ui/Dropdown";
import { Input } from "@/components/ui/Input";
import {
  engineTypeToProviderId,
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import { Textarea } from "@/components/ui/Textarea";
import {
  countActiveOverrides,
  OVERRIDE_REGISTRY,
  type OverrideGroup,
  type OverrideSpec,
  resetAllOverrides,
} from "../lib/overrideRegistry";

interface OverridesEditorProps {
  overrides: WriteRuleOverrides;
  models: ModelInfo[];
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  onCreateTone?: (draft: {
    label: string;
    instruction: string;
  }) => Promise<ToneDefinition>;
  onChange: (overrides: WriteRuleOverrides) => void;
}

const GROUP_ORDER: OverrideGroup[] = ["speech", "refine", "output"];

const overrideLabelKey = (spec: OverrideSpec) =>
  `refine.writeRules.overrides.${spec.key}.label`;
const overrideDescriptionKey = (spec: OverrideSpec) =>
  `refine.writeRules.overrides.${spec.key}.description`;
const overrideGroupKey = (group: OverrideGroup) =>
  `refine.writeRules.overrideGroups.${group}`;
const overrideOptionKey = (spec: OverrideSpec, value: string) =>
  `refine.writeRules.overrideOptions.${spec.key}.${value}`;

export const OverridesEditor: React.FC<OverridesEditorProps> = ({
  overrides,
  models,
  tones,
  prompts,
  onCreateTone,
  onChange,
}) => {
  const { t } = useTranslation();
  const ctx = useMemo(
    () => ({ models, tones, prompts }),
    [models, tones, prompts],
  );
  const activeCount = countActiveOverrides(overrides);
  const activeSpecs = OVERRIDE_REGISTRY.filter((spec) =>
    spec.isActive(overrides),
  );
  const inactiveSpecs = OVERRIDE_REGISTRY.filter(
    (spec) => !spec.isActive(overrides) && spec.allowAdd !== false,
  );

  return (
    <div className="space-y-3">
      {activeCount === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          {t("refine.writeRules.overridesEditor.emptyHint")}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--ring-hairline)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--input)]/40">
          {activeSpecs.map((spec) => (
            <OverrideRow
              key={spec.key}
              spec={spec}
              overrides={overrides}
              context={ctx}
              onCreateTone={onCreateTone}
              onChange={onChange}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <AddOverrideMenu
          inactiveSpecs={inactiveSpecs}
          overrides={overrides}
          context={ctx}
          onChange={onChange}
        />
        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => onChange(resetAllOverrides(overrides))}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--danger)]"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t("refine.writeRules.overridesEditor.resetAll")}
          </button>
        ) : null}
      </div>
    </div>
  );
};

const OverrideRow: React.FC<{
  spec: OverrideSpec;
  overrides: WriteRuleOverrides;
  context: {
    models: ModelInfo[];
    tones: ToneDefinition[];
    prompts: LLMPrompt[];
  };
  onCreateTone?: (draft: {
    label: string;
    instruction: string;
  }) => Promise<ToneDefinition>;
  onChange: (overrides: WriteRuleOverrides) => void;
}> = ({ spec, overrides, context, onCreateTone, onChange }) => {
  const { t } = useTranslation();
  const [isCreatingCustomTone, setIsCreatingCustomTone] = useState(false);
  const modelById = useMemo(
    () => new Map(context.models.map((model) => [model.id, model])),
    [context.models],
  );
  const options = spec.options(context).map((option) => {
    const translated = t(overrideOptionKey(spec, option.value), {
      defaultValue: option.label,
    });
    const model = spec.key === "stt_model_id" ? modelById.get(option.value) : null;
    if (!model) return { ...option, label: translated };
    const providerId = resolveModelProviderId(
      `${model.name} ${model.id}`,
      engineTypeToProviderId(model.engine_type),
    );
    return {
      ...option,
      label: translated,
      icon: <ProviderIcon providerId={providerId} size="sm" />,
    };
  });
  const specLabel = t(overrideLabelKey(spec));
  const specDescription = t(overrideDescriptionKey(spec));
  return (
    <li className="px-3 py-2.5">
      <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text)]">
            {specLabel}
          </p>
          <p className="truncate text-[11px] text-[var(--muted)]">
            {t(overrideGroupKey(spec.group))}
            {spec.description ? ` · ${specDescription}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
          {spec.key === "tone_id" && isCreatingCustomTone ? null : (
            <Dropdown
              options={options}
              selectedValue={spec.readValue(overrides)}
              onSelect={(value) => onChange(spec.applyValue(overrides, value))}
              className="[&>button]:min-w-[160px] [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-sm [&>button]:shadow-none"
            />
          )}
          <ActionIconButton
            tone="danger"
            onClick={() => onChange(spec.reset(overrides))}
            aria-label={t(
              "refine.writeRules.overridesEditor.removeOverrideAria",
              {
                label: specLabel,
              },
            )}
            title={t("refine.writeRules.overridesEditor.removeOverride")}
          >
            <X aria-hidden />
          </ActionIconButton>
        </div>
      </div>
      {spec.key === "tone_id" && onCreateTone ? (
        <CustomToneCreator
          onCreateTone={onCreateTone}
          onCreated={(tone) => onChange({ ...overrides, tone_id: tone.id })}
          onOpenChange={setIsCreatingCustomTone}
        />
      ) : null}
    </li>
  );
};

const CustomToneCreator: React.FC<{
  onCreateTone: (draft: {
    label: string;
    instruction: string;
  }) => Promise<ToneDefinition>;
  onCreated: (tone: ToneDefinition) => void;
  onOpenChange?: (open: boolean) => void;
}> = ({ onCreateTone, onCreated, onOpenChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [instruction, setInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = label.trim().length > 0 && instruction.trim().length > 0;

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const tone = await onCreateTone({ label, instruction });
      onCreated(tone);
      setLabel("");
      setInstruction("");
      setOpen(false);
      onOpenChange?.(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("refine.writeRules.customTone.createFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onOpenChange?.(true);
        }}
        className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--accent-glow)]"
      >
        {t("refine.writeRules.customTone.open")}
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <label className="min-w-0 space-y-1">
          <span className="text-[11px] font-medium text-[var(--muted)]">
            {t("refine.writeRules.customTone.nameLabel")}
          </span>
          <Input
            value={label}
            placeholder="Founder voice"
            variant="compact"
            className="w-full"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="min-w-0 space-y-1">
          <span className="text-[11px] font-medium text-[var(--muted)]">
            {t("refine.writeRules.customTone.instructionLabel")}
          </span>
          <Textarea
            value={instruction}
            placeholder="Rewrite in a warm, concise voice. Preserve technical terms and avoid hype."
            variant="compact"
            onChange={(event) => setInstruction(event.target.value)}
            className="min-h-[72px] w-full"
          />
        </label>
      </div>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            onOpenChange?.(false);
            setError(null);
          }}
        >
          {t("common.cancel", { defaultValue: "Cancel" })}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!canSave || saving}
        >
          {saving
            ? t("common.saving", { defaultValue: "Saving..." })
            : t("refine.writeRules.customTone.save")}
        </Button>
      </div>
    </div>
  );
};

const AddOverrideMenu: React.FC<{
  inactiveSpecs: OverrideSpec[];
  overrides: WriteRuleOverrides;
  context: {
    models: ModelInfo[];
    tones: ToneDefinition[];
    prompts: LLMPrompt[];
  };
  onChange: (overrides: WriteRuleOverrides) => void;
}> = ({ inactiveSpecs, overrides, context, onChange }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const grouped = useMemo(() => {
    const byGroup: Record<OverrideGroup, OverrideSpec[]> = {
      speech: [],
      refine: [],
      output: [],
    };
    for (const spec of inactiveSpecs) byGroup[spec.group].push(spec);
    return byGroup;
  }, [inactiveSpecs]);

  if (inactiveSpecs.length === 0) {
    return (
      <p className="text-xs italic text-[var(--muted)]">
        {t("refine.writeRules.overridesEditor.noneRemaining")}
      </p>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen((prev) => !prev)}
      >
        {t("refine.writeRules.overridesEditor.addOverride")}
      </Button>
      {open ? (
        <div
          role="menu"
          // Anchored above the trigger because the trigger sits at the
          // bottom of the section inside a scrollable dialog body —
          // opening downward would clip under the footer with no way
          // to scroll to it (the popover is absolute and adds no flow
          // height).
          className="absolute bottom-full left-0 z-30 mb-1 max-h-[280px] w-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-[var(--shadow-md)]"
        >
          {GROUP_ORDER.map((group) => {
            const specs = grouped[group];
            if (specs.length === 0) return null;
            return (
              <div key={group} className="py-1">
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                  {t(overrideGroupKey(group))}
                </p>
                {specs.map((spec) => {
                  const next = spec.defaultValueWhenAdded(overrides, context);
                  const disabled = next === null;
                  const specLabel = t(overrideLabelKey(spec));
                  const specDescription = t(overrideDescriptionKey(spec));
                  return (
                    <button
                      key={spec.key}
                      type="button"
                      role="menuitem"
                      disabled={disabled}
                      onClick={() => {
                        if (!next) return;
                        onChange(next);
                        setOpen(false);
                      }}
                      className={[
                        "flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm",
                        disabled
                          ? "cursor-not-allowed text-[var(--muted)] opacity-50"
                          : "text-[var(--text)] hover:bg-[var(--input)]",
                      ].join(" ")}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{specLabel}</span>
                        {spec.description ? (
                          <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">
                            {specDescription}
                          </span>
                        ) : null}
                      </span>
                      {disabled ? (
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                          {t(
                            "refine.writeRules.overridesEditor.notAvailableShort",
                          )}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
