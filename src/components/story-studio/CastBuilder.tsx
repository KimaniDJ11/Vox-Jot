import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { CatalogModelDescriptor } from "@/lib/modelPlatform";
import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import {
  voiceAvatarGradient,
  type CreateVoiceHubVoiceRow,
} from "@/components/settings/general/listen/createVoiceVoiceHub";
import { VoiceCapabilityChips } from "@/components/settings/general/listen/VoiceCapabilityChips";
import { voiceCapabilityFlagsForPreset } from "@/components/settings/general/listen/voiceCapabilities";
import type { StoryCastMemberDraft } from "./storyScript";

interface CastBuilderProps {
  cast: StoryCastMemberDraft[];
  presets: TtsVoicePreset[];
  presetVoices: CreateVoiceHubVoiceRow[];
  ttsModels?: CatalogModelDescriptor[];
  isLoadingVoiceChoices?: boolean;
  disabled?: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<StoryCastMemberDraft>) => void;
  onCreatePresetFromVoice: (voice: CreateVoiceHubVoiceRow) => Promise<string>;
}

function presetSeed(preset: TtsVoicePreset): string {
  return `${preset.provider_id}::${preset.model_id}::${preset.voice_id ?? "__model__"}`;
}

export const CastBuilder: React.FC<CastBuilderProps> = ({
  cast,
  presets,
  presetVoices,
  ttsModels = [],
  isLoadingVoiceChoices = false,
  disabled = false,
  onAdd,
  onRemove,
  onUpdate,
  onCreatePresetFromVoice,
}) => {
  const { t } = useTranslation();
  const myVoicesLabel = t("storyStudio.cast.myVoices");
  const presetVoicesLabel = t("storyStudio.cast.presetVoices");
  const loadingVoicesLabel = t("storyStudio.cast.loadingVoices");
  const placeholder = t("storyStudio.cast.chooseVoice");
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(
    null,
  );
  const hasVoiceChoices = presets.length > 0 || presetVoices.length > 0;
  const voicePickerDisabled =
    disabled || (!hasVoiceChoices && isLoadingVoiceChoices);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {t("storyStudio.cast.title")}
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t("storyStudio.cast.description")}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onAdd}
          disabled={voicePickerDisabled || !hasVoiceChoices}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t("storyStudio.cast.addCharacter")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
        <div className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_5.5rem] gap-2 border-b border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs font-semibold uppercase text-[var(--muted)]">
          <span>{t("storyStudio.cast.character")}</span>
          <span>{t("storyStudio.cast.voicePreset")}</span>
          <span className="sr-only">{t("storyStudio.cast.action")}</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {cast.map((member) => (
            <div
              key={member.id}
              className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_5.5rem] items-center gap-2 px-3 py-2"
            >
              <Input
                value={member.characterName}
                onChange={(event) =>
                  onUpdate(member.id, { characterName: event.target.value })
                }
                disabled={disabled}
                placeholder={t("storyStudio.cast.characterPlaceholder")}
                className="w-full rounded-lg border-[var(--border)] bg-[var(--input)] text-[var(--text)]"
              />
              <VoicePicker
                value={member.presetId}
                presets={presets}
                presetVoices={presetVoices}
                ttsModels={ttsModels}
                disabled={voicePickerDisabled}
                placeholder={placeholder}
                loadingLabel={loadingVoicesLabel}
                myVoicesLabel={myVoicesLabel}
                presetVoicesLabel={presetVoicesLabel}
                isLoading={isLoadingVoiceChoices && !hasVoiceChoices}
                onSelectPreset={(presetId) => onUpdate(member.id, { presetId })}
                onSelectPresetVoice={async (voice) => {
                  const newId = await onCreatePresetFromVoice(voice);
                  onUpdate(member.id, { presetId: newId });
                }}
              />
              <div className="flex justify-end gap-1">
                {confirmingRemoveId === member.id ? (
                  <>
                    <ActionIconButton
                      tone="confirm"
                      onClick={() => {
                        onRemove(member.id);
                        setConfirmingRemoveId(null);
                      }}
                      disabled={disabled || cast.length <= 1}
                      title={t("storyStudio.cast.removeCharacter")}
                      aria-label={t("storyStudio.cast.removeConfirm", {
                        name: member.characterName,
                      })}
                    >
                      <Trash2 aria-hidden />
                    </ActionIconButton>
                    <ActionIconButton
                      onClick={() => setConfirmingRemoveId(null)}
                      disabled={disabled}
                      title={t("common.cancel", { defaultValue: "Cancel" })}
                      aria-label={t("common.cancel", { defaultValue: "Cancel" })}
                    >
                      <X aria-hidden />
                    </ActionIconButton>
                  </>
                ) : (
                  <ActionIconButton
                    tone="danger"
                    onClick={() => setConfirmingRemoveId(member.id)}
                    disabled={disabled || cast.length <= 1}
                    title={t("storyStudio.cast.removeCharacter")}
                    aria-label={t("storyStudio.cast.removeCharacter")}
                  >
                    <Trash2 aria-hidden />
                  </ActionIconButton>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

interface VoicePickerProps {
  value: string;
  presets: TtsVoicePreset[];
  presetVoices: CreateVoiceHubVoiceRow[];
  ttsModels: CatalogModelDescriptor[];
  disabled?: boolean;
  placeholder: string;
  loadingLabel: string;
  myVoicesLabel: string;
  presetVoicesLabel: string;
  isLoading?: boolean;
  onSelectPreset: (presetId: string) => void;
  onSelectPresetVoice: (voice: CreateVoiceHubVoiceRow) => Promise<void>;
}

const VoicePicker: React.FC<VoicePickerProps> = ({
  value,
  presets,
  presetVoices,
  ttsModels,
  disabled = false,
  placeholder,
  loadingLabel,
  myVoicesLabel,
  presetVoicesLabel,
  isLoading = false,
  onSelectPreset,
  onSelectPresetVoice,
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [popoverRect, setPopoverRect] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const options = useMemo(
    () => [
      ...presets.map((preset) => ({
        id: preset.id,
        kind: "preset" as const,
      })),
      ...presetVoices.map((voice) => ({
        id: voice.id,
        kind: "voice" as const,
      })),
    ],
    [presetVoices, presets],
  );
  const modelByKey = useMemo(
    () =>
      new Map(
        ttsModels.map((model) => [`${model.provider_id}::${model.id}`, model]),
      ),
    [ttsModels],
  );

  const updatePopoverRect = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const gap = 4;
    const viewportPadding = 12;
    const preferredMaxHeight = 320;
    const availableBelow = viewportHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openAbove = availableBelow < 180 && availableAbove > availableBelow;
    const availableSpace = openAbove ? availableAbove : availableBelow;
    const maxHeight = Math.max(
      120,
      Math.min(preferredMaxHeight, availableSpace),
    );

    setPopoverRect({
      top: openAbove
        ? Math.max(viewportPadding, rect.top - maxHeight - gap)
        : rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverRect(null);
      return;
    }
    updatePopoverRect();
    const onScrollOrResize = () => updatePopoverRect();
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updatePopoverRect]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(
      0,
      options.findIndex(
        (option) => option.kind === "preset" && option.id === value,
      ),
    );
    window.requestAnimationFrame(() => {
      optionRefs.current[selectedIndex]?.focus();
    });
  }, [open, options, value]);

  const selectedPreset = presets.find((p) => p.id === value) ?? null;
  const selectedGradient = selectedPreset
    ? voiceAvatarGradient(presetSeed(selectedPreset))
    : null;
  const selectedLabel = selectedPreset?.label ?? placeholder;
  const isEmpty = presets.length === 0 && presetVoices.length === 0;
  const triggerLabel = isLoading ? loadingLabel : selectedLabel;

  const moveFocus = (delta: number) => {
    const currentIndex = optionRefs.current.findIndex(
      (element) => element === document.activeElement,
    );
    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + delta + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      optionRefs.current[options.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const popover =
    open && popoverRect ? (
      <div
        ref={popoverRef}
        role="listbox"
        aria-label={placeholder}
        onKeyDown={handleListKeyDown}
        className="fixed z-[200] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg"
        style={{
          top: popoverRect.top,
          left: popoverRect.left,
          width: popoverRect.width,
          maxHeight: popoverRect.maxHeight,
        }}
      >
        {presets.length > 0 && (
          <div className="p-1">
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {myVoicesLabel}
            </div>
            {presets.map((preset) => {
              const gradient = voiceAvatarGradient(presetSeed(preset));
              const isSelected = preset.id === value;
              const capabilities = voiceCapabilityFlagsForPreset(
                preset,
                modelByKey.get(`${preset.provider_id}::${preset.model_id}`),
              );
              return (
                <button
                  key={preset.id}
                  ref={(element) => {
                    optionRefs.current[
                      options.findIndex(
                        (option) =>
                          option.id === preset.id && option.kind === "preset",
                      )
                    ] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelectPreset(preset.id);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text),transparent_94%)] ${
                    isSelected
                      ? "bg-[color-mix(in_srgb,var(--accent),transparent_88%)]"
                      : ""
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-6 w-6 shrink-0 rounded-full"
                    style={{ background: gradient }}
                  />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-[var(--text)]">
                      {preset.label}
                    </span>
                    <VoiceCapabilityChips capabilities={capabilities} />
                  </span>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {presetVoices.length > 0 && (
          <div
            className={`p-1 ${presets.length > 0 ? "border-t border-[var(--border)]" : ""}`}
          >
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {presetVoicesLabel}
            </div>
            {presetVoices.map((voice) => (
              <button
                key={voice.id}
                ref={(element) => {
                  optionRefs.current[
                    options.findIndex(
                      (option) =>
                        option.id === voice.id && option.kind === "voice",
                    )
                  ] = element;
                }}
                type="button"
                role="option"
                aria-selected={false}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onSelectPresetVoice(voice);
                    setOpen(false);
                    triggerRef.current?.focus();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text),transparent_94%)] disabled:opacity-50 disabled:cursor-wait"
              >
                <span
                  aria-hidden="true"
                  className="h-6 w-6 shrink-0 rounded-full"
                  style={{ background: voice.avatarGradient }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--text)]">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                      <span className="truncate">{voice.voiceLabel}</span>
                      <VoiceCapabilityChips capabilities={voice.capabilities} />
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-[var(--muted)]">
                    {voice.modelLabel}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || isEmpty}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={isLoading}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-sm font-medium text-[var(--text)] outline-none transition-colors hover:border-[var(--accent)] focus:border-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {selectedGradient ? (
          <span
            aria-hidden="true"
            className="h-5 w-5 shrink-0 rounded-full"
            style={{ background: selectedGradient }}
          />
        ) : (
          <span
            aria-hidden="true"
            className="h-5 w-5 shrink-0 rounded-full border border-dashed border-[var(--border)]"
          />
        )}
        <span
          className={`flex-1 truncate text-start ${selectedPreset ? "" : "text-[var(--muted)]"}`}
        >
          {triggerLabel}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted)]" />
      </button>

      {typeof document !== "undefined" && popover
        ? createPortal(popover, document.body)
        : null}
    </div>
  );
};
