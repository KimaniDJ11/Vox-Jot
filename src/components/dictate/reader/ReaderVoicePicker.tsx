import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  Loader2,
  Search,
} from "lucide-react";

import type { TtsVoicePreset } from "@/lib/ttsVoicePresets";
import {
  voiceAvatarGradient,
  type CreateVoiceHubVoiceRow,
} from "@/components/settings/general/listen/createVoiceVoiceHub";

function presetSeed(preset: TtsVoicePreset): string {
  return `${preset.provider_id}::${preset.model_id}::${preset.voice_id ?? "__model__"}`;
}

function presetLabel(preset: TtsVoicePreset): string {
  return (
    preset.label?.trim() ||
    preset.voice_label_snapshot?.trim() ||
    preset.model_id ||
    preset.id
  );
}

export type ReaderVoicePickerProps = {
  /** Selected preset id, or null = the reader's default voice. */
  value: string | null;
  presets: TtsVoicePreset[];
  presetVoices: CreateVoiceHubVoiceRow[];
  onSelectPreset: (presetId: string) => void;
  onSelectDefault: () => void;
  onCreatePresetFromVoice: (voice: CreateVoiceHubVoiceRow) => Promise<string>;
  /** Show the "Default voice" option (used by per-section pickers). */
  allowDefault?: boolean;
  defaultLabel?: string;
  defaultPresetId?: string | null;
  disabled?: boolean;
  className?: string;
};

const Dot: React.FC<{ gradient: string }> = ({ gradient }) => (
  <span
    className="h-3.5 w-3.5 shrink-0 rounded-full"
    style={{ background: gradient }}
    aria-hidden="true"
  />
);

export const ReaderVoicePicker: React.FC<ReaderVoicePickerProps> = ({
  value,
  presets,
  presetVoices,
  onSelectPreset,
  onSelectDefault,
  onCreatePresetFromVoice,
  allowDefault = true,
  defaultLabel,
  defaultPresetId,
  disabled = false,
  className = "",
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busyVoiceId, setBusyVoiceId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === value) ?? null,
    [presets, value],
  );

  const dotPreset = useMemo(
    () =>
      selectedPreset ??
      (defaultPresetId
        ? presets.find((preset) => preset.id === defaultPresetId) ?? null
        : null),
    [presets, selectedPreset, defaultPresetId],
  );

  const defaultVoiceLabel =
    defaultLabel ??
    t("dictate.reader.sections.defaultVoice", {
      defaultValue: "Default voice",
    });
  const currentLabel = selectedPreset
    ? presetLabel(selectedPreset)
    : defaultVoiceLabel;

  const voiceName = useMemo(
    () => (dotPreset ? presetLabel(dotPreset) : ""),
    [dotPreset],
  );

  const defaultLabelParts = useMemo(() => {
    if (!defaultVoiceLabel || !voiceName) {
      return { prefix: defaultVoiceLabel, voice: "" };
    }
    const idx = defaultVoiceLabel.lastIndexOf(voiceName);
    if (idx !== -1) {
      return {
        prefix: defaultVoiceLabel.slice(0, idx).trimEnd(),
        voice: defaultVoiceLabel.slice(idx),
      };
    }
    return { prefix: defaultVoiceLabel, voice: "" };
  }, [defaultVoiceLabel, voiceName]);

  const hasSplitDefaultLabel = value === null && defaultLabelParts.voice !== "";

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth =
      document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight =
      document.documentElement.clientHeight || window.innerHeight;
    const margin = 12;
    const gap = 4;
    const width = Math.min(
      Math.max(rect.width, 240),
      Math.max(180, viewportWidth - margin * 2),
    );
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, viewportWidth - width - margin),
    );
    const preferredMaxHeight = 320;
    const availableBelow = viewportHeight - rect.bottom - margin;
    const availableAbove = rect.top - margin;
    const openAbove = availableBelow < 180 && availableAbove > availableBelow;
    const availableSpace = openAbove ? availableAbove : availableBelow;
    const maxHeight = Math.max(
      160,
      Math.min(preferredMaxHeight, availableSpace),
    );
    setPosition({
      top: openAbove
        ? Math.max(margin, rect.top - maxHeight - gap)
        : rect.bottom + gap,
      left,
      width,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      setQuery("");
      setError("");
      setBusyVoiceId(null);
      return;
    }
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredPresets = presets.filter(
    (preset) =>
      !normalizedQuery ||
      presetLabel(preset).toLowerCase().includes(normalizedQuery),
  );
  const filteredVoices = presetVoices.filter(
    (voice) => !normalizedQuery || voice.searchText.includes(normalizedQuery),
  );
  const showDefaultOption =
    allowDefault &&
    (!normalizedQuery ||
      defaultVoiceLabel.toLowerCase().includes(normalizedQuery));
  const hasResults =
    showDefaultOption ||
    filteredPresets.length > 0 ||
    filteredVoices.length > 0;

  const choose = (action: () => void) => {
    action();
    setOpen(false);
    setQuery("");
  };

  const chooseVoice = async (voice: CreateVoiceHubVoiceRow) => {
    if (busyVoiceId) return;
    setBusyVoiceId(voice.id);
    setError("");
    try {
      const presetId = await onCreatePresetFromVoice(voice);
      onSelectPreset(presetId);
      setOpen(false);
      buttonRef.current?.focus();
    } catch (err) {
      console.error("Failed to create Reader voice preset:", err);
      setError(
        t("dictate.reader.sections.createVoicePresetFailed", {
          defaultValue: "Could not save that voice. Try again.",
        }),
      );
    } finally {
      setBusyVoiceId(null);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
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
        title={currentLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={[
          "flex h-7 w-full items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 text-left text-[11px] text-[var(--text)] outline-none transition-colors hover:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        ].join(" ")}
      >
        {hasSplitDefaultLabel ? (
          <span className="min-w-0 flex-1 truncate flex items-center gap-1.5">
            <span className="shrink-0">{defaultLabelParts.prefix}</span>
            {dotPreset ? (
              <Dot gradient={voiceAvatarGradient(presetSeed(dotPreset))} />
            ) : null}
            <span className="truncate">{defaultLabelParts.voice}</span>
          </span>
        ) : (
          <>
            {dotPreset ? (
              <Dot gradient={voiceAvatarGradient(presetSeed(dotPreset))} />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{currentLabel}</span>
          </>
        )}
        <ChevronsUpDown
          size={12}
          className="shrink-0 text-[var(--muted)]"
          aria-hidden="true"
        />
      </button>

      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                width: position.width,
                maxHeight: position.maxHeight,
                zIndex: 200,
              }}
              className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg,var(--bg))] shadow-[var(--popover-shadow)]"
            >
              <div className="relative border-b border-[var(--border)] p-2">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
                  aria-hidden="true"
                />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setOpen(false);
                      buttonRef.current?.focus();
                    }
                  }}
                  placeholder={t("dictate.reader.sections.searchVoices", {
                    defaultValue: "Search voices",
                  })}
                  className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--input)] pl-7 pr-2 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:ring-1 focus:ring-[var(--accent-glow)]"
                />
              </div>

              <div
                id={listboxId}
                role="listbox"
                aria-label={t("dictate.reader.voice", {
                  defaultValue: "Voice",
                })}
                className="overflow-y-auto py-1"
                style={{ maxHeight: Math.max(96, position.maxHeight - 48) }}
              >
                {showDefaultOption ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === null}
                    onClick={() => choose(onSelectDefault)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--accent-soft)]"
                  >
                    {hasSplitDefaultLabel ? (
                      <span className="min-w-0 flex-1 truncate flex items-center gap-1.5">
                        <span className="shrink-0">{defaultLabelParts.prefix}</span>
                        {dotPreset ? (
                          <Dot gradient={voiceAvatarGradient(presetSeed(dotPreset))} />
                        ) : null}
                        <span className="truncate">{defaultLabelParts.voice}</span>
                      </span>
                    ) : (
                      <>
                        {dotPreset ? (
                          <Dot gradient={voiceAvatarGradient(presetSeed(dotPreset))} />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">
                          {defaultVoiceLabel}
                        </span>
                      </>
                    )}
                    {value === null ? (
                      <Check
                        size={13}
                        className="text-[var(--accent)]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                ) : null}

                {filteredPresets.length > 0 ? (
                  <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {t("dictate.reader.sections.myVoices", {
                      defaultValue: "My Voices",
                    })}
                  </div>
                ) : null}
                {filteredPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="option"
                    aria-selected={preset.id === value}
                    onClick={() => choose(() => onSelectPreset(preset.id))}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--accent-soft)]"
                  >
                    <Dot gradient={voiceAvatarGradient(presetSeed(preset))} />
                    <span className="min-w-0 flex-1 truncate">
                      {presetLabel(preset)}
                    </span>
                    {preset.id === value ? (
                      <Check
                        size={13}
                        className="text-[var(--accent)]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                ))}

                {filteredVoices.length > 0 ? (
                  <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    {t("dictate.reader.sections.presetVoices", {
                      defaultValue: "Preset voices",
                    })}
                  </div>
                ) : null}
                {filteredVoices.map((voice) => (
                  <button
                    key={voice.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={busyVoiceId !== null}
                    onClick={() => void chooseVoice(voice)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--accent-soft)] disabled:cursor-wait disabled:opacity-50"
                  >
                    <Dot gradient={voice.avatarGradient} />
                    <span className="min-w-0 flex-1 truncate">
                      {voice.voiceId
                        ? voice.modelLabel === "System Voices"
                          ? voice.voiceLabel
                          : `${voice.modelLabel} · ${voice.voiceLabel}`
                        : voice.modelLabel}
                    </span>
                    {voice.countryFlag ? (
                      <span className="shrink-0 text-xs">
                        {voice.countryFlag}
                      </span>
                    ) : null}
                    {busyVoiceId === voice.id ? (
                      <Loader2
                        size={13}
                        className="shrink-0 animate-spin text-[var(--accent)]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                ))}

                {!hasResults ? (
                  <div className="px-3 py-3 text-center text-xs text-[var(--muted)]">
                    {t("dictate.reader.sections.noVoices", {
                      defaultValue: "No voices found.",
                    })}
                  </div>
                ) : null}
              </div>

              {error ? (
                <div
                  role="alert"
                  className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--danger)]"
                >
                  <AlertCircle size={13} className="shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{error}</span>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
