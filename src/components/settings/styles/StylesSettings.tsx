import React, { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppToneMapping, ToneDefinition } from "@/bindings";

import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { Input } from "../../ui/Input";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Textarea } from "../../ui/Textarea";
import { useSettings } from "../../../hooks/useSettings";
import { AppAwareWriteProfilesToggle } from "../AppAwareWriteProfilesToggle";

interface StylesSettingsProps {
  showEnabledToggle?: boolean;
}

const DEFAULT_STYLE_PRESETS: ToneDefinition[] = [
  {
    id: "casual",
    label: "Casual",
    instruction:
      "Use a casual, conversational tone suitable for quick chat messages while preserving meaning.",
  },
  {
    id: "professional",
    label: "Professional",
    instruction:
      "Use a polished, professional tone suitable for email or documents while preserving meaning.",
  },
  {
    id: "neutral",
    label: "Neutral",
    instruction:
      "Keep the tone neutral and close to the speaker's original wording.",
  },
];

const DEFAULT_STYLE_ORDER = DEFAULT_STYLE_PRESETS.map((tone) => tone.id);
const DEFAULT_STYLE_IDS = new Set(DEFAULT_STYLE_ORDER);

const normalizeToneId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const sortToneDefinitions = (tones: ToneDefinition[]): ToneDefinition[] => {
  return [...tones].sort((left, right) => {
    const leftIndex = DEFAULT_STYLE_ORDER.indexOf(left.id);
    const rightIndex = DEFAULT_STYLE_ORDER.indexOf(right.id);

    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }

    return (left.label || left.id).localeCompare(right.label || right.id);
  });
};

interface ToneCardProps {
  tone: ToneDefinition;
  mappedApps: AppToneMapping[];
  disabled: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

const ToneCard: React.FC<ToneCardProps> = ({
  tone,
  mappedApps,
  disabled,
  canDelete,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation();
  const badgeLabel = canDelete
    ? t("settings.styles.tones.customBadge")
    : t("settings.styles.tones.starterBadge");

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4 shadow-sm transition-colors hover:border-[var(--accent-soft)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {tone.label || tone.id}
            </h3>
            <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
              {badgeLabel}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {tone.instruction}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:text-[var(--text)] disabled:opacity-40"
            title={t("common.edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled}
              className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:text-red-500 disabled:opacity-40"
              title={t("common.delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {mappedApps.length > 0 ? (
          <>
            {mappedApps.slice(0, 4).map((mapping) => (
              <span
                key={`${mapping.bundle_id}-${mapping.app_name}`}
                className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1 text-xs text-[var(--text)]"
              >
                {mapping.app_name || mapping.bundle_id}
              </span>
            ))}
            {mappedApps.length > 4 && (
              <span className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1 text-xs text-[var(--muted)]">
                +{mappedApps.length - 4}
              </span>
            )}
          </>
        ) : (
          <span className="rounded-full border border-dashed border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">
            {t("settings.styles.tones.unused")}
          </span>
        )}
      </div>
    </div>
  );
};

interface ToneEditorProps {
  initial?: ToneDefinition;
  existingIds: string[];
  onSave: (tone: ToneDefinition) => void;
  onCancel: () => void;
}

const ToneEditor: React.FC<ToneEditorProps> = ({
  initial,
  existingIds,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [instruction, setInstruction] = useState(initial?.instruction ?? "");
  const [customId, setCustomId] = useState(initial?.id ?? "");
  const [showIdField, setShowIdField] = useState(
    initial ? !DEFAULT_STYLE_IDS.has(initial.id) : false,
  );

  const isStarterStyle = initial ? DEFAULT_STYLE_IDS.has(initial.id) : false;
  const resolvedId =
    isStarterStyle && initial
      ? initial.id
      : showIdField
        ? normalizeToneId(customId || label)
        : (initial?.id ?? normalizeToneId(label));
  const duplicateId =
    !resolvedId ||
    existingIds.some(
      (candidate) => candidate === resolvedId && candidate !== initial?.id,
    );
  const canSave = Boolean(label.trim() && instruction.trim() && !duplicateId);

  return (
    <div className="rounded-2xl border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent),transparent_95%)] p-4">
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">
              {t("settings.styles.tones.columns.label")}
            </label>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("settings.styles.tones.placeholders.label")}
            />
          </div>
          {!isStarterStyle && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-[var(--muted)]">
                  {t("settings.styles.tones.columns.id")}
                </label>
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
                  onClick={() => {
                    if (!showIdField && !customId) {
                      setCustomId(initial?.id ?? normalizeToneId(label));
                    }
                    setShowIdField((current) => !current);
                  }}
                >
                  {t("settings.styles.tones.editId")}
                </button>
              </div>
              {showIdField ? (
                <Input
                  value={customId}
                  onChange={(event) => setCustomId(event.target.value)}
                  placeholder={t("settings.styles.tones.placeholders.id")}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
                  {resolvedId || t("settings.styles.tones.placeholders.id")}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">
            {t("settings.styles.tones.columns.instruction")}
          </label>
          <Textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={t("settings.styles.tones.placeholders.instruction")}
            rows={3}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="mr-1 h-3.5 w-3.5" />
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              onSave({
                id: resolvedId,
                label: label.trim(),
                instruction: instruction.trim(),
              })
            }
            disabled={!canSave}
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
};

interface MappingRowProps {
  mapping: AppToneMapping;
  toneOptions: { value: string; label: string }[];
  disabled: boolean;
  onUpdate: (field: keyof AppToneMapping, value: string) => void;
  onDelete: () => void;
}

const MappingRow: React.FC<MappingRowProps> = ({
  mapping,
  toneOptions,
  disabled,
  onUpdate,
  onDelete,
}) => {
  const { t } = useTranslation();

  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_auto] md:items-center">
      <Input
        value={mapping.app_name}
        onChange={(event) => onUpdate("app_name", event.target.value)}
        placeholder={t("settings.styles.mappings.placeholders.appName")}
        disabled={disabled}
      />
      <Input
        value={mapping.bundle_id}
        onChange={(event) => onUpdate("bundle_id", event.target.value)}
        placeholder={t("settings.styles.mappings.placeholders.bundleId")}
        disabled={disabled}
      />
      <Dropdown
        selectedValue={mapping.tone_id}
        onSelect={(value) => onUpdate("tone_id", value)}
        options={toneOptions}
        disabled={disabled || toneOptions.length === 0}
        placeholder={t("settings.styles.mappings.selectTone")}
        className="w-full"
      />
      <div className="flex items-center justify-end md:justify-center">
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:text-red-500 disabled:opacity-40"
          title={t("common.delete")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export const StylesSettings: React.FC<StylesSettingsProps> = ({
  showEnabledToggle = true,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  const enabled = getSetting("app_aware_tone_enabled") ?? false;
  const toneDefinitions = getSetting("tone_definitions") ?? [];
  const appToneMappings = getSetting("app_tone_mappings") ?? [];

  const [editingToneId, setEditingToneId] = useState<string | null>(null);
  const [addingTone, setAddingTone] = useState(false);
  const [mappingsExpanded, setMappingsExpanded] = useState(
    appToneMappings.length > 0,
  );

  const toneControlsDisabled =
    !enabled ||
    isUpdating("app_aware_tone_enabled") ||
    isUpdating("tone_definitions");
  const mappingControlsDisabled =
    !enabled ||
    isUpdating("app_aware_tone_enabled") ||
    isUpdating("app_tone_mappings");

  const sortedToneDefinitions = useMemo(
    () => sortToneDefinitions(toneDefinitions),
    [toneDefinitions],
  );

  const toneOptions = sortedToneDefinitions.map((tone) => ({
    value: tone.id,
    label: tone.label || tone.id,
  }));

  const mappedAppsByToneId = useMemo(() => {
    return appToneMappings.reduce<Record<string, AppToneMapping[]>>(
      (accumulator, mapping) => {
        if (!mapping.tone_id) {
          return accumulator;
        }

        accumulator[mapping.tone_id] = accumulator[mapping.tone_id] || [];
        accumulator[mapping.tone_id].push(mapping);
        return accumulator;
      },
      {},
    );
  }, [appToneMappings]);

  const editingTone = editingToneId
    ? sortedToneDefinitions.find((tone) => tone.id === editingToneId)
    : undefined;

  const starterStylesChanged = DEFAULT_STYLE_PRESETS.some((preset) => {
    const existing = toneDefinitions.find((tone) => tone.id === preset.id);
    return (
      !existing ||
      existing.label !== preset.label ||
      existing.instruction !== preset.instruction
    );
  });

  const persistTones = (next: ToneDefinition[]) => {
    void updateSetting("tone_definitions", next);
  };

  const persistMappings = (next: AppToneMapping[]) => {
    void updateSetting("app_tone_mappings", next);
  };

  const handleSaveTone = (tone: ToneDefinition) => {
    if (editingToneId) {
      const nextTones = toneDefinitions.map((current) =>
        current.id === editingToneId ? tone : current,
      );
      persistTones(nextTones);

      if (editingToneId !== tone.id) {
        persistMappings(
          appToneMappings.map((mapping) =>
            mapping.tone_id === editingToneId
              ? { ...mapping, tone_id: tone.id }
              : mapping,
          ),
        );
      }

      setEditingToneId(null);
      return;
    }

    persistTones([...toneDefinitions, tone]);
    setAddingTone(false);
  };

  const handleDeleteTone = (id: string) => {
    persistTones(toneDefinitions.filter((tone) => tone.id !== id));
    persistMappings(
      appToneMappings.map((mapping) =>
        mapping.tone_id === id ? { ...mapping, tone_id: "" } : mapping,
      ),
    );
  };

  const restoreStarterStyles = () => {
    const customStyles = toneDefinitions.filter(
      (tone) => !DEFAULT_STYLE_IDS.has(tone.id),
    );
    persistTones([...DEFAULT_STYLE_PRESETS, ...customStyles]);
  };

  const updateMapping = (
    index: number,
    field: keyof AppToneMapping,
    value: string,
  ) => {
    persistMappings(
      appToneMappings.map((mapping, currentIndex) =>
        currentIndex === index ? { ...mapping, [field]: value } : mapping,
      ),
    );
  };

  const addMapping = () => {
    persistMappings([
      ...appToneMappings,
      {
        app_name: "",
        bundle_id: "",
        tone_id: sortedToneDefinitions[0]?.id ?? "",
      },
    ]);
    setMappingsExpanded(true);
  };

  const deleteMapping = (index: number) => {
    persistMappings(
      appToneMappings.filter((_, currentIndex) => currentIndex !== index),
    );
  };

  return (
    <div className="w-full space-y-6">
      {showEnabledToggle && (
        <SettingsGroup title={t("settings.styles.title")}>
          <AppAwareWriteProfilesToggle
            descriptionMode="tooltip"
            grouped={true}
          />
        </SettingsGroup>
      )}

      <Alert variant="info" contained>
        {enabled
          ? t("settings.styles.description")
          : t("settings.styles.disabledMessage")}
      </Alert>

      <SettingsGroup
        title={t("settings.styles.tones.title")}
        description={t("settings.styles.tones.description")}
      >
        <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-[var(--muted)]">
            {t("settings.styles.tones.helper")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={restoreStarterStyles}
            disabled={toneControlsDisabled || !starterStylesChanged}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            {t("settings.styles.tones.restore")}
          </Button>
        </div>

        <div className="px-5 py-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedToneDefinitions.map((tone) => (
              <ToneCard
                key={tone.id}
                tone={tone}
                mappedApps={mappedAppsByToneId[tone.id] || []}
                disabled={toneControlsDisabled}
                canDelete={!DEFAULT_STYLE_IDS.has(tone.id)}
                onEdit={() => {
                  setAddingTone(false);
                  setEditingToneId(tone.id);
                }}
                onDelete={() => handleDeleteTone(tone.id)}
              />
            ))}
          </div>

          {(editingTone || addingTone) && (
            <div className="mt-4">
              <ToneEditor
                initial={editingTone}
                existingIds={toneDefinitions.map((tone) => tone.id)}
                onSave={handleSaveTone}
                onCancel={() => {
                  setEditingToneId(null);
                  setAddingTone(false);
                }}
              />
            </div>
          )}

          {!editingTone && !addingTone && (
            <div className="mt-4">
              <Button
                variant="primary-soft"
                size="sm"
                onClick={() => {
                  setEditingToneId(null);
                  setAddingTone(true);
                }}
                disabled={toneControlsDisabled}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("settings.styles.tones.add")}
              </Button>
            </div>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.styles.mappings.title")}
        description={t("settings.styles.mappings.description")}
      >
        <button
          type="button"
          onClick={() => setMappingsExpanded((current) => !current)}
          className="flex w-full items-center justify-between px-5 py-4 text-sm text-[var(--muted)] transition-colors hover:text-[var(--text)]"
        >
          <span>{t("settings.styles.mappings.description")}</span>
          {mappingsExpanded ? (
            <ChevronUp className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )}
        </button>

        {mappingsExpanded && (
          <div className="space-y-4 px-5 py-4">
            {appToneMappings.length > 0 ? (
              <div className="hidden text-xs font-medium text-[var(--muted)] md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px_auto] md:items-center md:gap-2">
                <div>{t("settings.styles.mappings.columns.appName")}</div>
                <div>{t("settings.styles.mappings.columns.bundleId")}</div>
                <div>{t("settings.styles.mappings.columns.tone")}</div>
                <div />
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                {t("settings.styles.mappings.empty")}
              </p>
            )}

            <div className="space-y-3">
              {appToneMappings.map((mapping, index) => (
                <MappingRow
                  key={`${mapping.bundle_id}-${mapping.app_name}-${index}`}
                  mapping={mapping}
                  toneOptions={toneOptions}
                  disabled={mappingControlsDisabled}
                  onUpdate={(field, value) =>
                    updateMapping(index, field, value)
                  }
                  onDelete={() => deleteMapping(index)}
                />
              ))}
            </div>

            <Button
              variant="primary-soft"
              size="sm"
              onClick={addMapping}
              disabled={mappingControlsDisabled}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("settings.styles.mappings.add")}
            </Button>
          </div>
        )}
      </SettingsGroup>
    </div>
  );
};
