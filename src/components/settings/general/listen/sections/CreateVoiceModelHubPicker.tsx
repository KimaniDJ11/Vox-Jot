import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Check,
  Loader2,
  Mars,
  Play,
  Plus,
  Search,
  Sparkles,
  UserRound,
  Venus,
  X,
} from "lucide-react";
import { commands, type VoiceInfo } from "@/bindings";
import ModelListControls from "@/components/model-hub/ModelListControls";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import type { ModelSortMode, ModelSortOption } from "@/lib/modelListOrdering";
import type {
  CatalogModelDescriptor,
  ProviderDescriptor,
} from "@/lib/modelPlatform";
import { modal } from "@/motion/springs";
import {
  buildCreateVoiceHubRows,
  orderCreateVoiceHubRows,
  voiceAvatarGradient,
  type CreateVoiceHubVoiceRow,
  type InferredVoiceGender,
} from "../createVoiceVoiceHub";
import type { ListenSpeechState } from "../useListenSpeechState";
import { speechLibraryCardClassName } from "../styles";
import {
  defaultVoiceTuning,
  getTtsVoicesForSelection,
  ttsPreviewSampleForLocale,
} from "../utils";
import { DraftVoiceModelLibraryCard } from "../sharedComponents";

type PickerView = "voices" | "my-voices" | "models";

const VOICE_INVENTORY_LOAD_CONCURRENCY = 2;
const PREVIEW_RUNNING_DELAY_MS = 1500;

interface FilterOption {
  value: string;
  label: string;
}

interface CreateVoiceModelHubPickerProps {
  open: boolean;
  speech: ListenSpeechState;
  models: CatalogModelDescriptor[];
  providers: ProviderDescriptor[];
  selectedProviderId: string;
  selectedModelId: string;
  selectedVoiceId: string;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  providerFilter: string;
  providerOptions: FilterOption[];
  selectedProviderLabel: string;
  onProviderFilterChange: (value: string) => void;
  languageFilter: string;
  languageOptions: FilterOption[];
  selectedLanguageLabel: string;
  onLanguageFilterChange: (value: string) => void;
  sortMode: ModelSortMode;
  sortOptions: ModelSortOption[];
  selectedSortLabel: string;
  onSortModeChange: (value: ModelSortMode) => void;
  orderedModels: CatalogModelDescriptor[];
  filteredModelCount: number;
  onSelectVoice: (selection: {
    model: CatalogModelDescriptor;
    voiceId: string | null;
    voiceLabel: string | null;
    locale: string | null;
  }) => void;
  selectedVoiceProfileId?: string | null;
  onSelectPreset: (preset: TtsVoicePreset) => void;
  onClose: () => void;
}

const VoiceFilterSelect: React.FC<{
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  label: string;
  ariaLabel: string;
  show?: boolean;
}> = ({ value, options, onChange, label, ariaLabel, show = true }) => {
  if (!show) return null;
  const active = value !== "all";
  const optionsWithCurrent = options.some((option) => option.value === value)
    ? options
    : [{ value, label: label || value }, ...options];
  return (
    <label
      className={[
        "relative inline-flex h-10 shrink-0 items-center rounded-full border px-3 text-sm font-semibold shadow-[var(--shadow-sm)] transition-colors",
        active
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:border-[var(--accent)]",
      ].join(" ")}
      aria-label={ariaLabel}
      title={label}
    >
      <Plus className="me-2 h-4 w-4" aria-hidden />
      <span className="max-w-[9rem] truncate">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"
      >
        {optionsWithCurrent.map((option) => (
          <option
            key={option.value}
            value={option.value}
            style={{ color: "var(--text)", backgroundColor: "var(--card)" }}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
};

const VoiceRow: React.FC<{
  row: CreateVoiceHubVoiceRow;
  selected: boolean;
  previewStatus: "idle" | "preparing" | "running";
  femaleVoiceLabel: string;
  maleVoiceLabel: string;
  selectedVoiceLabel: string;
  preparingPreviewLabel: string;
  runningPreviewLabel: string;
  previewLabel: string;
  stopPreviewLabel: string;
  onSelect: () => void;
  onTogglePreview: () => void;
}> = ({
  row,
  selected,
  previewStatus,
  femaleVoiceLabel,
  maleVoiceLabel,
  selectedVoiceLabel,
  preparingPreviewLabel,
  runningPreviewLabel,
  previewLabel,
  stopPreviewLabel,
  onSelect,
  onTogglePreview,
}) =>
  (() => {
    const previewing = previewStatus !== "idle";
    const previewStatusLabel =
      previewStatus === "running"
        ? runningPreviewLabel
        : previewStatus === "preparing"
          ? preparingPreviewLabel
          : null;

    return (
      <div
        className={[
          "group/voice-row flex w-full min-w-0 items-center gap-3 rounded-2xl border px-3 py-3 text-start transition-colors",
          selected
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-transparent bg-[var(--card)] hover:border-[var(--border)] hover:bg-[var(--panel-bg)]",
        ].join(" ")}
      >
        <span className="relative h-12 w-12 shrink-0">
          <span
            className="block h-12 w-12 rounded-full shadow-inner"
            style={{ background: row.avatarGradient }}
            aria-hidden
          />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePreview();
            }}
            aria-label={previewing ? stopPreviewLabel : previewLabel}
            title={previewing ? stopPreviewLabel : previewLabel}
            className={[
              "absolute inset-0 inline-flex items-center justify-center rounded-full bg-[rgba(22,43,32,0.78)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5),0_6px_16px_rgba(0,0,0,0.22)] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
              previewing
                ? "opacity-100"
                : "opacity-0 group-hover/voice-row:opacity-100 group-focus-within/voice-row:opacity-100",
            ].join(" ")}
          >
            {previewing ? (
              <Loader2
                className="h-5 w-5 animate-[spin_1s_linear_infinite]"
                aria-hidden
              />
            ) : (
              <Play className="h-5 w-5 fill-current" aria-hidden />
            )}
          </button>
        </span>
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
        >
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-[var(--text)]">
                {row.voiceLabel}
              </span>
              {row.gender === "female" ? (
                <Venus
                  className="h-4 w-4 shrink-0 text-[var(--voice)]"
                  aria-label={femaleVoiceLabel}
                />
              ) : row.gender === "male" ? (
                <Mars
                  className="h-4 w-4 shrink-0 text-[var(--accent)]"
                  aria-label={maleVoiceLabel}
                />
              ) : null}
            </span>
            <span className="mt-1 block truncate text-sm leading-5 text-[var(--muted)]">
              {row.description}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {previewStatusLabel ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)] shadow-[var(--shadow-sm)]"
                aria-live="polite"
                role="status"
              >
                <Loader2
                  className="h-3.5 w-3.5 animate-[spin_1s_linear_infinite]"
                  aria-hidden
                />
                <span>{previewStatusLabel}</span>
              </span>
            ) : null}
            {selected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-white shadow-[var(--shadow-sm)]">
                <Check className="h-3.5 w-3.5" aria-hidden />
                <span>{selectedVoiceLabel}</span>
              </span>
            ) : null}
            <span className="text-2xl" aria-hidden>
              {row.countryFlag ?? null}
            </span>
          </span>
        </button>
      </div>
    );
  })();

const MyVoiceRow: React.FC<{
  preset: TtsVoicePreset;
  selected: boolean;
  disabled: boolean;
  previewStatus: "idle" | "preparing" | "running";
  selectedLabel: string;
  cloneLabel: string;
  tunedLabel: string;
  unavailableLabel: string;
  previewLabel: string;
  stopPreviewLabel: string;
  preparingPreviewLabel: string;
  runningPreviewLabel: string;
  onSelect: () => void;
  onTogglePreview: () => void;
}> = ({
  preset,
  selected,
  disabled,
  previewStatus,
  selectedLabel,
  cloneLabel,
  tunedLabel,
  unavailableLabel,
  previewLabel,
  stopPreviewLabel,
  preparingPreviewLabel,
  runningPreviewLabel,
  onSelect,
  onTogglePreview,
}) => {
  const previewing = previewStatus !== "idle";
  const previewStatusLabel =
    previewStatus === "running"
      ? runningPreviewLabel
      : previewStatus === "preparing"
        ? preparingPreviewLabel
        : null;
  const voiceLabel =
    preset.voice_label_snapshot ?? preset.voice_id ?? preset.model_id;
  const isClone = Boolean(preset.voice_profile_id);
  const isTuned =
    JSON.stringify(preset.tuning) !== JSON.stringify(defaultVoiceTuning());
  const description = [
    preset.model_id,
    voiceLabel,
    isClone ? cloneLabel : null,
    isTuned ? tunedLabel : null,
    disabled ? unavailableLabel : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const avatarGradient = voiceAvatarGradient(
    [
      preset.provider_id,
      preset.model_id,
      preset.voice_id ?? preset.voice_profile_id ?? preset.id,
    ].join("::"),
  );

  return (
    <div
      className={[
        "group/my-voice-row flex w-full min-w-0 items-center gap-3 rounded-2xl border px-3 py-3 text-start transition-colors",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-transparent bg-[var(--card)] hover:border-[var(--border)] hover:bg-[var(--panel-bg)]",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      <span className="relative h-12 w-12 shrink-0">
        <span
          className="block h-12 w-12 rounded-full shadow-inner"
          style={{ background: avatarGradient }}
          aria-hidden
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onTogglePreview();
          }}
          aria-label={previewing ? stopPreviewLabel : previewLabel}
          title={previewing ? stopPreviewLabel : previewLabel}
          className={[
            "absolute inset-0 inline-flex items-center justify-center rounded-full bg-[rgba(22,43,32,0.78)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5),0_6px_16px_rgba(0,0,0,0.22)] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
            previewing
              ? "opacity-100"
              : "opacity-0 group-hover/my-voice-row:opacity-100 group-focus-within/my-voice-row:opacity-100",
          ].join(" ")}
        >
          {previewing ? (
            <Loader2
              className="h-5 w-5 animate-[spin_1s_linear_infinite]"
              aria-hidden
            />
          ) : (
            <Play className="h-5 w-5 fill-current" aria-hidden />
          )}
        </button>
      </span>

      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--text)]">
              {preset.label}
            </span>
          </span>
          <span className="mt-1 block truncate text-sm leading-5 text-[var(--muted)]">
            {description}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {previewStatusLabel ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)] shadow-[var(--shadow-sm)]"
              aria-live="polite"
              role="status"
            >
              <Loader2
                className="h-3.5 w-3.5 animate-[spin_1s_linear_infinite]"
                aria-hidden
              />
              <span>{previewStatusLabel}</span>
            </span>
          ) : null}
          {selected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-white shadow-[var(--shadow-sm)]">
              <Check className="h-3.5 w-3.5" aria-hidden />
              <span>{selectedLabel}</span>
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
};

export const CreateVoiceModelHubPicker: React.FC<
  CreateVoiceModelHubPickerProps
> = ({
  open,
  speech,
  models,
  providers,
  selectedProviderId,
  selectedModelId,
  selectedVoiceId,
  searchQuery,
  onSearchQueryChange,
  providerFilter,
  providerOptions,
  selectedProviderLabel,
  onProviderFilterChange,
  languageFilter,
  languageOptions,
  selectedLanguageLabel,
  onLanguageFilterChange,
  sortMode,
  sortOptions,
  selectedSortLabel,
  onSortModeChange,
  orderedModels,
  filteredModelCount,
  onSelectVoice,
  selectedVoiceProfileId,
  onSelectPreset,
  onClose,
}) => {
  const { t } = useTranslation();
  const [view, setView] = useState<PickerView>("voices");
  const [selectedModelFilterKey, setSelectedModelFilterKey] = useState<
    string | null
  >(null);
  const [voiceGenderFilter, setVoiceGenderFilter] = useState("all");
  const [voiceAccentFilter, setVoiceAccentFilter] = useState("all");
  const [previewingVoiceRowId, setPreviewingVoiceRowId] = useState<
    string | null
  >(null);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [voicesByModelKey, setVoicesByModelKey] = useState<
    Map<string, VoiceInfo[]>
  >(() => new Map());
  const [loadingVoiceKeys, setLoadingVoiceKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const loadingVoiceKeysRef = useRef(new Set<string>());

  useEffect(() => {
    if (!open) {
      setView("voices");
      setSelectedModelFilterKey(null);
      setVoiceGenderFilter("all");
      setVoiceAccentFilter("all");
      setPreviewingVoiceRowId(null);
      setPreviewRunning(false);
      loadingVoiceKeysRef.current.clear();
      setLoadingVoiceKeys(new Set());
    }
  }, [open]);

  useEffect(() => {
    setPreviewRunning(false);
    if (!previewingVoiceRowId) return;

    const timeoutId = window.setTimeout(() => {
      setPreviewRunning(true);
    }, PREVIEW_RUNNING_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [previewingVoiceRowId]);

  useEffect(() => {
    setPreviewRunning(false);
    if (!speech.previewingPresetId || speech.previewingPresetId === "__draft__")
      return;

    const timeoutId = window.setTimeout(() => {
      setPreviewRunning(true);
    }, PREVIEW_RUNNING_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [speech.previewingPresetId]);

  useEffect(() => {
    if (
      selectedModelFilterKey &&
      !models.some(
        (model) =>
          `${model.provider_id}::${model.id}` === selectedModelFilterKey,
      )
    ) {
      setSelectedModelFilterKey(null);
    }
  }, [models, selectedModelFilterKey]);

  useEffect(() => {
    if (!open || view !== "voices") return;

    const pendingModels = models.filter((model) => {
      const key = `${model.provider_id}::${model.id}`;
      return (
        !voicesByModelKey.has(key) && !loadingVoiceKeysRef.current.has(key)
      );
    });

    if (pendingModels.length === 0) return;

    let cancelled = false;
    const scheduledKeys = pendingModels.map(
      (model) => `${model.provider_id}::${model.id}`,
    );
    for (const model of pendingModels) {
      const key = `${model.provider_id}::${model.id}`;
      loadingVoiceKeysRef.current.add(key);
      setLoadingVoiceKeys((current) => new Set(current).add(key));
    }

    const loadModelVoices = async (model: CatalogModelDescriptor) => {
      const key = `${model.provider_id}::${model.id}`;
      try {
        const voices = await getTtsVoicesForSelection(
          model.provider_id,
          model.id,
        );
        if (cancelled) return;
        setVoicesByModelKey((current) => {
          const next = new Map(current);
          next.set(key, voices);
          return next;
        });
      } catch {
        if (cancelled) return;
        setVoicesByModelKey((current) => {
          const next = new Map(current);
          next.set(key, []);
          return next;
        });
      } finally {
        loadingVoiceKeysRef.current.delete(key);
        setLoadingVoiceKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    };

    void (async () => {
      for (
        let index = 0;
        index < pendingModels.length && !cancelled;
        index += VOICE_INVENTORY_LOAD_CONCURRENCY
      ) {
        await Promise.all(
          pendingModels
            .slice(index, index + VOICE_INVENTORY_LOAD_CONCURRENCY)
            .map(loadModelVoices),
        );
      }
    })();

    return () => {
      cancelled = true;
      for (const key of scheduledKeys) {
        loadingVoiceKeysRef.current.delete(key);
      }
      setLoadingVoiceKeys((current) => {
        const next = new Set(current);
        for (const key of scheduledKeys) {
          next.delete(key);
        }
        return next;
      });
    };
  }, [models, open, view, voicesByModelKey]);

  const handleToggleVoicePreview = async (
    row: CreateVoiceHubVoiceRow,
    model: CatalogModelDescriptor,
  ) => {
    if (previewingVoiceRowId === row.id) {
      const result = await commands.ttsStop();
      if (result.status === "error") {
        speech.setStatusMessage(result.error);
      }
      setPreviewingVoiceRowId(null);
      setPreviewRunning(false);
      return;
    }

    setPreviewingVoiceRowId(row.id);
    setPreviewRunning(false);
    try {
      await speech.previewPresetDraft(
        {
          provider_id: row.providerId,
          model_id: row.modelId,
          voice_id: row.voiceId,
          voice_profile_id: null,
          voice_label_snapshot: row.voiceId
            ? row.voiceLabel
            : (model.label ?? row.modelLabel),
          locale_snapshot: row.locale,
          tuning: defaultVoiceTuning(),
        },
        ttsPreviewSampleForLocale(row.locale),
      );
    } finally {
      setPreviewingVoiceRowId((current) =>
        current === row.id ? null : current,
      );
      setPreviewRunning(false);
    }
  };

  const handleTogglePresetPreview = async (preset: TtsVoicePreset) => {
    if (speech.previewingPresetId === preset.id) {
      const result = await commands.ttsStop();
      if (result.status === "error") {
        speech.setStatusMessage(result.error);
      }
      setPreviewRunning(false);
      return;
    }

    setPreviewRunning(false);
    await speech.previewPreset(
      preset.id,
      ttsPreviewSampleForLocale(preset.locale_snapshot),
    );
  };

  const voiceRows = useMemo(
    () => buildCreateVoiceHubRows(models, voicesByModelKey),
    [models, voicesByModelKey],
  );
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const voiceLanguageOptions = useMemo(() => {
    const values = new Map<string, string>([
      [
        "all",
        t("listen.createVoices.voiceLanguage", {
          defaultValue: "Language",
        }),
      ],
    ]);
    for (const row of voiceRows) {
      if (!row.language) continue;
      const matching = languageOptions.find(
        (option) => option.value === row.language,
      );
      values.set(row.language, matching?.label ?? row.language.toUpperCase());
    }
    return Array.from(values, ([value, label]) => ({ value, label }));
  }, [languageOptions, t, voiceRows]);
  const voiceGenderOptions = useMemo(() => {
    const genders = new Set(
      voiceRows
        .map((row) => row.gender)
        .filter((gender): gender is InferredVoiceGender => Boolean(gender)),
    );
    return [
      {
        value: "all",
        label: t("listen.createVoices.voiceGender", {
          defaultValue: "Gender",
        }),
      },
      ...Array.from(genders).map((gender) => ({
        value: gender,
        label:
          gender === "female"
            ? t("listen.createVoices.voiceGenderFemale", {
                defaultValue: "Female",
              })
            : t("listen.createVoices.voiceGenderMale", {
                defaultValue: "Male",
              }),
      })),
    ];
  }, [t, voiceRows]);
  const voiceAccentOptions = useMemo(() => {
    const accents = Array.from(
      new Set(
        voiceRows
          .map((row) => row.accent)
          .filter((accent): accent is string => Boolean(accent)),
      ),
    ).sort();
    return [
      {
        value: "all",
        label: t("listen.createVoices.voiceAccent", {
          defaultValue: "Accent",
        }),
      },
      ...accents.map((accent) => ({ value: accent, label: accent })),
    ];
  }, [t, voiceRows]);
  const selectedVoiceLanguageLabel =
    voiceLanguageOptions.find((option) => option.value === languageFilter)
      ?.label ??
    t("listen.createVoices.voiceLanguage", {
      defaultValue: "Language",
    });
  const selectedVoiceGenderLabel =
    voiceGenderOptions.find((option) => option.value === voiceGenderFilter)
      ?.label ??
    t("listen.createVoices.voiceGender", {
      defaultValue: "Gender",
    });
  const selectedVoiceAccentLabel =
    voiceAccentOptions.find((option) => option.value === voiceAccentFilter)
      ?.label ??
    t("listen.createVoices.voiceAccent", {
      defaultValue: "Accent",
    });
  const isSelectedVoiceRow = (row: CreateVoiceHubVoiceRow) =>
    row.providerId === selectedProviderId &&
    row.modelId === selectedModelId &&
    (row.voiceId ?? "__auto__") === selectedVoiceId;
  const filteredVoiceRows = orderCreateVoiceHubRows(
    voiceRows.filter((row) => {
      if (
        selectedModelFilterKey &&
        `${row.providerId}::${row.modelId}` !== selectedModelFilterKey
      ) {
        return false;
      }
      if (providerFilter !== "all" && row.providerId !== providerFilter) {
        return false;
      }
      if (languageFilter !== "all" && row.language !== languageFilter) {
        return false;
      }
      if (voiceGenderFilter !== "all" && row.gender !== voiceGenderFilter) {
        return false;
      }
      if (voiceAccentFilter !== "all" && row.accent !== voiceAccentFilter) {
        return false;
      }
      return !normalizedQuery || row.searchText.includes(normalizedQuery);
    }),
  ).sort(
    (left, right) =>
      Number(isSelectedVoiceRow(right)) - Number(isSelectedVoiceRow(left)),
  );
  const modelByKey = useMemo(
    () =>
      new Map(
        models.map((model) => [`${model.provider_id}::${model.id}`, model]),
      ),
    [models],
  );
  const loadingVoices = loadingVoiceKeys.size > 0;
  const presetModelKeys = useMemo(
    () => new Set(models.map((model) => `${model.provider_id}::${model.id}`)),
    [models],
  );
  const isSelectedPreset = (preset: TtsVoicePreset) =>
    preset.provider_id === selectedProviderId &&
    preset.model_id === selectedModelId &&
    (preset.voice_id ?? "__auto__") === selectedVoiceId &&
    (preset.voice_profile_id ?? null) === selectedVoiceProfileId;
  const filteredSavedPresets = speech.presets.filter((preset) => {
    if (!normalizedQuery) return true;
    return [
      preset.label,
      preset.provider_id,
      preset.model_id,
      preset.voice_id,
      preset.voice_profile_id,
      preset.voice_label_snapshot,
      preset.locale_snapshot,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const displayedModels = useMemo(() => {
    if (!selectedModelFilterKey) return orderedModels;
    return [...orderedModels].sort((left, right) => {
      const leftSelected =
        `${left.provider_id}::${left.id}` === selectedModelFilterKey;
      const rightSelected =
        `${right.provider_id}::${right.id}` === selectedModelFilterKey;
      return Number(rightSelected) - Number(leftSelected);
    });
  }, [orderedModels, selectedModelFilterKey]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={onClose}
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-voice-model-title"
            className="relative flex h-[min(88vh,920px)] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.38)]"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={modal}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div className="min-w-0">
                <h3
                  id="create-voice-model-title"
                  className="truncate text-sm font-semibold text-[var(--text)]"
                >
                  {view === "voices"
                    ? t("listen.createVoices.voices", {
                        defaultValue: "Voices",
                      })
                    : view === "my-voices"
                      ? t("listen.createVoices.myVoices", {
                          defaultValue: "My Voices",
                        })
                      : t("listen.createVoices.models", {
                          defaultValue: "Models",
                        })}
                </h3>
                <p className="truncate text-xs text-[var(--muted)]">
                  {view === "voices"
                    ? t("listen.createVoices.draftVoicePickerDetail", {
                        defaultValue:
                          "Choose a voice for this draft without changing the active app voice.",
                      })
                    : view === "my-voices"
                      ? t("listen.createVoices.draftMyVoicesPickerDetail", {
                          defaultValue:
                            "Reuse a saved or tuned voice profile for this draft.",
                        })
                      : t("listen.createVoices.draftModelPickerDetail", {
                          defaultValue:
                            "Choose a model to filter available voices for this draft.",
                        })}
                </p>
              </div>
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
            </div>

            <div className="space-y-3 border-b border-[var(--border)] px-4 py-3">
              <label
                className="relative flex h-10 min-w-[220px] flex-1 items-center"
                aria-label={
                  view === "voices"
                    ? t("listen.createVoices.searchVoicesAriaLabel", {
                        defaultValue: "Search voices",
                      })
                    : view === "my-voices"
                      ? t("listen.createVoices.searchMyVoicesAriaLabel", {
                          defaultValue: "Search my voices",
                        })
                      : t("listen.createVoices.searchModelsAriaLabel", {
                          defaultValue: "Search voice models",
                        })
                }
              >
                <Search
                  className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--muted)]"
                  aria-hidden
                />
                <Input
                  type="text"
                  role="searchbox"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(event) => onSearchQueryChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && searchQuery) {
                      onSearchQueryChange("");
                      event.preventDefault();
                    }
                  }}
                  placeholder={
                    view === "voices"
                      ? t("listen.createVoices.searchVoices", {
                          defaultValue: "Search voices",
                        })
                      : view === "my-voices"
                        ? t("listen.createVoices.searchMyVoices", {
                            defaultValue: "Search my voices",
                          })
                        : t("listen.createVoices.searchModels", {
                            defaultValue: "Search TTS models",
                          })
                  }
                  className="h-10 w-full pl-9 pr-9 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    onClick={() => onSearchQueryChange("")}
                    aria-label={
                      view === "voices"
                        ? t("listen.createVoices.clearVoiceSearch", {
                            defaultValue: "Clear voice search",
                          })
                        : view === "my-voices"
                          ? t("listen.createVoices.clearMyVoicesSearch", {
                              defaultValue: "Clear my voices search",
                            })
                          : t("listen.createVoices.clearModelSearch", {
                              defaultValue: "Clear model search",
                            })
                    }
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                ) : null}
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <SegmentedControl<PickerView>
                  value={view}
                  onChange={setView}
                  layoutId="create-voice-model-hub-toggle"
                  ariaLabel={t("listen.createVoices.modelHubView", {
                    defaultValue: "Model hub view",
                  })}
                  items={[
                    {
                      value: "voices",
                      label: t("listen.createVoices.voices", {
                        defaultValue: "Voices",
                      }),
                    },
                    {
                      value: "my-voices",
                      label: t("listen.createVoices.myVoices", {
                        defaultValue: "My Voices",
                      }),
                    },
                    {
                      value: "models",
                      label: t("listen.createVoices.models", {
                        defaultValue: "Models",
                      }),
                    },
                  ]}
                />

                {view === "models" ? (
                  <ModelListControls
                    provider={{
                      value: providerFilter,
                      options: providerOptions,
                      onChange: onProviderFilterChange,
                      label: selectedProviderLabel,
                      show: providerOptions.length > 2,
                    }}
                    language={{
                      value: languageFilter,
                      options: languageOptions,
                      onChange: onLanguageFilterChange,
                      label: selectedLanguageLabel,
                      show: true,
                    }}
                    sort={{
                      value: sortMode,
                      options: sortOptions,
                      onChange: onSortModeChange,
                      label: selectedSortLabel,
                    }}
                  />
                ) : view === "voices" ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <VoiceFilterSelect
                      value={languageFilter}
                      options={voiceLanguageOptions}
                      onChange={onLanguageFilterChange}
                      label={selectedVoiceLanguageLabel}
                      ariaLabel={t(
                        "listen.createVoices.filterVoicesByLanguage",
                        {
                          label: selectedVoiceLanguageLabel,
                          defaultValue: "Filter voices by language: {{label}}",
                        },
                      )}
                      show={voiceLanguageOptions.length > 1}
                    />
                    <VoiceFilterSelect
                      value={voiceGenderFilter}
                      options={voiceGenderOptions}
                      onChange={setVoiceGenderFilter}
                      label={selectedVoiceGenderLabel}
                      ariaLabel={t("listen.createVoices.filterVoicesByGender", {
                        label: selectedVoiceGenderLabel,
                        defaultValue: "Filter voices by gender: {{label}}",
                      })}
                      show={voiceGenderOptions.length > 1}
                    />
                    <VoiceFilterSelect
                      value={voiceAccentFilter}
                      options={voiceAccentOptions}
                      onChange={setVoiceAccentFilter}
                      label={selectedVoiceAccentLabel}
                      ariaLabel={t("listen.createVoices.filterVoicesByAccent", {
                        label: selectedVoiceAccentLabel,
                        defaultValue: "Filter voices by accent: {{label}}",
                      })}
                      show={voiceAccentOptions.length > 1}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {view === "my-voices" ? (
                filteredSavedPresets.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {filteredSavedPresets.map((preset) => {
                      const modelAvailable = presetModelKeys.has(
                        `${preset.provider_id}::${preset.model_id}`,
                      );
                      const selected = isSelectedPreset(preset);
                      return (
                        <MyVoiceRow
                          key={preset.id}
                          preset={preset}
                          selected={selected}
                          disabled={!modelAvailable || !speech.ttsEnabled}
                          previewStatus={
                            speech.previewingPresetId === preset.id
                              ? previewRunning
                                ? "running"
                                : "preparing"
                              : "idle"
                          }
                          selectedLabel={t(
                            "listen.createVoices.selectedVoiceBadge",
                            {
                              defaultValue: "Selected voice",
                            },
                          )}
                          cloneLabel={t("listen.myVoices.clone", {
                            defaultValue: "Clone",
                          })}
                          tunedLabel={t("listen.createVoices.tunedVoice", {
                            defaultValue: "Tuned",
                          })}
                          unavailableLabel={t(
                            "listen.createVoices.unavailableVoiceModel",
                            {
                              defaultValue: "Model unavailable",
                            },
                          )}
                          previewLabel={t("listen.createVoices.previewVoice", {
                            voice: preset.label,
                            defaultValue: "Preview {{voice}}",
                          })}
                          stopPreviewLabel={t(
                            "listen.createVoices.stopVoicePreview",
                            {
                              voice: preset.label,
                              defaultValue: "Stop {{voice}} preview",
                            },
                          )}
                          preparingPreviewLabel={t(
                            "listen.createVoices.preparingPreview",
                            {
                              defaultValue: "Preparing preview",
                            },
                          )}
                          runningPreviewLabel={t(
                            "listen.createVoices.previewRunning",
                            {
                              defaultValue: "Preview running",
                            },
                          )}
                          onSelect={() => onSelectPreset(preset)}
                          onTogglePreview={() =>
                            void handleTogglePresetPreview(preset)
                          }
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className={speechLibraryCardClassName}>
                    <div className="flex items-start gap-3">
                      <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />
                      <p className="text-sm leading-6 text-[var(--muted)]">
                        {searchQuery
                          ? t("listen.createVoices.noMyVoiceSearchResults", {
                              defaultValue:
                                "No saved voices match that search.",
                            })
                          : t("listen.createVoices.noMyVoices", {
                              defaultValue:
                                "Save a tuned voice first, then reuse it here.",
                            })}
                      </p>
                    </div>
                  </div>
                )
              ) : view === "models" ? (
                filteredModelCount > 0 ? (
                  <div className="flex flex-col gap-3">
                    {displayedModels.map((model) => {
                      const modelKey = `${model.provider_id}::${model.id}`;
                      return (
                        <DraftVoiceModelLibraryCard
                          key={modelKey}
                          model={model}
                          provider={
                            providers.find(
                              (provider) => provider.id === model.provider_id,
                            ) ?? null
                          }
                          selected={modelKey === selectedModelFilterKey}
                          selectedBadgeLabel={t(
                            "listen.createVoices.voiceFilterModel",
                            { defaultValue: "Selected" },
                          )}
                          selectedBadgeDetail={t(
                            "listen.createVoices.voiceFilterModelDetail",
                            {
                              defaultValue:
                                "The Voices view is filtered to this model. Select it again to show all voices.",
                            },
                          )}
                          disabled={!speech.ttsEnabled}
                          onSelect={() =>
                            setSelectedModelFilterKey((current) =>
                              current === modelKey ? null : modelKey,
                            )
                          }
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className={speechLibraryCardClassName}>
                    <p className="text-sm leading-6 text-[var(--muted)]">
                      {searchQuery
                        ? t("listen.createVoices.noModelSearchResults", {
                            defaultValue:
                              "No downloaded, runnable TTS models match that search.",
                          })
                        : t("listen.createVoices.noModels", {
                            defaultValue:
                              "No downloaded, runnable TTS models are available.",
                          })}
                    </p>
                  </div>
                )
              ) : filteredVoiceRows.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {filteredVoiceRows.map((row) => {
                    const model = modelByKey.get(
                      `${row.providerId}::${row.modelId}`,
                    );
                    if (!model) return null;
                    return (
                      <VoiceRow
                        key={row.id}
                        row={row}
                        selected={
                          row.providerId === selectedProviderId &&
                          row.modelId === selectedModelId &&
                          (row.voiceId ?? "__auto__") === selectedVoiceId
                        }
                        previewStatus={
                          previewingVoiceRowId === row.id
                            ? previewRunning
                              ? "running"
                              : "preparing"
                            : "idle"
                        }
                        femaleVoiceLabel={t("listen.createVoices.femaleVoice", {
                          defaultValue: "Female voice",
                        })}
                        maleVoiceLabel={t("listen.createVoices.maleVoice", {
                          defaultValue: "Male voice",
                        })}
                        selectedVoiceLabel={t(
                          "listen.createVoices.selectedVoiceBadge",
                          {
                            defaultValue: "Selected voice",
                          },
                        )}
                        preparingPreviewLabel={t(
                          "listen.createVoices.preparingPreview",
                          {
                            defaultValue: "Preparing preview",
                          },
                        )}
                        runningPreviewLabel={t(
                          "listen.createVoices.previewRunning",
                          {
                            defaultValue: "Preview running",
                          },
                        )}
                        previewLabel={t("listen.createVoices.previewVoice", {
                          voice: row.voiceLabel,
                          defaultValue: "Preview {{voice}}",
                        })}
                        stopPreviewLabel={t(
                          "listen.createVoices.stopVoicePreview",
                          {
                            voice: row.voiceLabel,
                            defaultValue: "Stop {{voice}} preview",
                          },
                        )}
                        onSelect={() =>
                          onSelectVoice({
                            model,
                            voiceId: row.voiceId,
                            voiceLabel: row.voiceId ? row.voiceLabel : null,
                            locale: row.locale,
                          })
                        }
                        onTogglePreview={() =>
                          void handleToggleVoicePreview(row, model)
                        }
                      />
                    );
                  })}
                </div>
              ) : (
                <div className={speechLibraryCardClassName}>
                  <div className="flex items-start gap-3">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />
                    <p className="text-sm leading-6 text-[var(--muted)]">
                      {loadingVoices
                        ? t("listen.createVoices.loadingVoices", {
                            defaultValue: "Loading available voices...",
                          })
                        : t("listen.createVoices.noVoiceSearchResults", {
                            defaultValue:
                              "No installed voice presets match those filters.",
                          })}
                    </p>
                  </div>
                </div>
              )}
            </div>
            {speech.statusMessage ? (
              <div className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-3">
                <div className="flex items-start gap-2 text-sm leading-5 text-[var(--muted)]">
                  <Sparkles
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                    aria-hidden
                  />
                  <p>{speech.statusMessage}</p>
                </div>
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
};

export default CreateVoiceModelHubPicker;
