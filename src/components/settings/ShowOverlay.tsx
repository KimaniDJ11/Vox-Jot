import React from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import type { OverlayPosition, RecordingOverlayStyle } from "@/bindings";
import {
  SelectionDot,
  visualizationStateClass,
} from "@/components/settings/VisualizationCard";

interface ShowOverlayProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const ShowOverlay: React.FC<ShowOverlayProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const overlayOptions = [
      {
        value: "none" as const,
        label: t("settings.advanced.overlay.options.none"),
        description: t("settings.advanced.overlay.preview.none", {
          defaultValue: "No floating indicator.",
        }),
      },
      {
        value: "bottom" as const,
        label: t("settings.advanced.overlay.options.bottom"),
        description: t("settings.advanced.overlay.preview.bottom", {
          defaultValue: "Floats near the bottom edge.",
        }),
      },
      {
        value: "top" as const,
        label: t("settings.advanced.overlay.options.top"),
        description: t("settings.advanced.overlay.preview.top", {
          defaultValue: "Floats near the top edge.",
        }),
      },
    ];

    const styleOptions = [
      {
        value: "compact" as const,
        label: t("settings.advanced.overlay.style.compact"),
        description: t("settings.advanced.overlay.style.compactDescription", {
          defaultValue: "Small pill with live level bars.",
        }),
      },
      {
        value: "detailed" as const,
        label: t("settings.advanced.overlay.style.detailed"),
        description: t("settings.advanced.overlay.style.detailedDescription", {
          defaultValue: "Wider overlay with mic status and partial text.",
        }),
      },
      {
        value: "minimal" as const,
        label: t("settings.advanced.overlay.style.minimal", {
          defaultValue: "Minimal",
        }),
        description: t("settings.advanced.overlay.style.minimalDescription", {
          defaultValue: "Single dot — the smallest possible recording cue.",
        }),
      },
      {
        value: "notch" as const,
        label: t("settings.advanced.overlay.style.notch", {
          defaultValue: "Notch",
        }),
        description: t("settings.advanced.overlay.style.notchDescription", {
          defaultValue:
            "Hugs the camera notch on M-series MacBooks (top center).",
        }),
      },
    ];

    const selectedPosition = (getSetting("overlay_position") ||
      "bottom") as OverlayPosition;

    const selectedStyle = (getSetting("recording_overlay_style") ||
      "compact") as RecordingOverlayStyle;

    const isHidden = selectedPosition === "none";

    return (
      <>
        <SettingContainer
          title={t("settings.advanced.overlay.title")}
          description={t("settings.advanced.overlay.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
          layout="stacked"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {overlayOptions.map((option) => (
              <OverlayPositionPreview
                key={option.value}
                label={option.label}
                description={option.description}
                value={option.value}
                selected={selectedPosition === option.value}
                disabled={isUpdating("overlay_position")}
                onSelect={(value) =>
                  updateSetting("overlay_position", value as OverlayPosition)
                }
              />
            ))}
          </div>
        </SettingContainer>
        {!isHidden && (
          <SettingContainer
            title={t("settings.advanced.overlay.style.title")}
            description={t("settings.advanced.overlay.style.description")}
            descriptionMode={descriptionMode}
            grouped={grouped}
            layout="stacked"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {styleOptions.map((option) => (
                <OverlayStylePreview
                  key={option.value}
                  label={option.label}
                  description={option.description}
                  value={option.value}
                  selected={selectedStyle === option.value}
                  disabled={isUpdating("recording_overlay_style")}
                  onSelect={(value) =>
                    updateSetting(
                      "recording_overlay_style",
                      value as RecordingOverlayStyle,
                    )
                  }
                />
              ))}
            </div>
          </SettingContainer>
        )}
      </>
    );
  },
);

const OverlayPositionPreview: React.FC<{
  value: OverlayPosition;
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (value: OverlayPosition) => void;
}> = ({ value, label, description, selected, disabled, onSelect }) => {
  const overlayPositionClass =
    value === "top"
      ? "top-3"
      : value === "bottom"
        ? "bottom-3"
        : "top-1/2 -translate-y-1/2 opacity-0";

  return (
    <button
      type="button"
      className={visualizationStateClass(selected, disabled)}
      onClick={() => onSelect(value)}
      disabled={disabled}
      aria-pressed={selected}
    >
      <div className="relative mb-3 h-20 overflow-hidden rounded-xl border border-[var(--border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--bg),white_7%),var(--bg))]">
        <div className="absolute left-3 right-3 top-3 h-2 rounded-full bg-[color-mix(in_srgb,var(--text),transparent_91%)]" />
        <div className="absolute left-3 top-7 h-1.5 w-12 rounded-full bg-[color-mix(in_srgb,var(--text),transparent_94%)]" />
        <div className="absolute bottom-3 right-3 h-6 w-10 rounded-md bg-[color-mix(in_srgb,var(--text),transparent_95%)]" />
        {value === "none" ? (
          <div className="absolute inset-x-0 top-1/2 mx-auto flex w-fit -translate-y-1/2 items-center gap-1.5 rounded-full border border-dashed border-[var(--border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            {label}
          </div>
        ) : (
          <div
            className={`absolute left-1/2 h-4 w-16 -translate-x-1/2 rounded-full border border-[var(--overlay-border)] bg-[var(--overlay-bg)] shadow-[0_8px_18px_color-mix(in_srgb,var(--overlay-bg),transparent_78%)] ${overlayPositionClass}`}
          >
            <div className="flex h-full items-center justify-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-gold)]" />
              <span className="h-1 w-7 rounded-full bg-[var(--overlay-muted)]" />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text)]">{label}</p>
          <p className="mt-0.5 text-xs leading-4 text-[var(--muted)]">
            {description}
          </p>
        </div>
        <SelectionDot selected={selected} />
      </div>
    </button>
  );
};

const OverlayStylePreview: React.FC<{
  value: RecordingOverlayStyle;
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (value: RecordingOverlayStyle) => void;
}> = ({ value, label, description, selected, disabled, onSelect }) => {
  return (
    <button
      type="button"
      className={visualizationStateClass(selected, disabled)}
      onClick={() => onSelect(value)}
      disabled={disabled}
      aria-pressed={selected}
    >
      <div className="mb-3 flex h-20 items-center justify-center rounded-xl border border-[var(--border)] bg-[radial-gradient(circle_at_50%_25%,color-mix(in_srgb,var(--accent),transparent_88%),transparent_58%),linear-gradient(180deg,color-mix(in_srgb,var(--bg),white_6%),var(--bg))]">
        {value === "compact" ? <CompactOverlayMock /> : <DetailedOverlayMock />}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text)]">{label}</p>
          <p className="mt-0.5 text-xs leading-4 text-[var(--muted)]">
            {description}
          </p>
        </div>
        <SelectionDot selected={selected} />
      </div>
    </button>
  );
};

const CompactOverlayMock: React.FC = () => (
  <div className="flex h-7 w-20 items-center justify-center rounded-[10px] border border-[var(--overlay-border)] bg-[var(--overlay-bg)] px-2 shadow-[0_10px_24px_color-mix(in_srgb,var(--overlay-bg),transparent_72%)]">
    <LevelBars className="h-4 w-14" />
  </div>
);

const DetailedOverlayMock: React.FC = () => (
  <div className="grid h-11 w-56 grid-cols-[34px_1fr_32px] items-center gap-1 rounded-[14px] border border-[var(--overlay-border)] bg-[var(--overlay-bg)] p-1 shadow-[0_10px_24px_color-mix(in_srgb,var(--overlay-bg),transparent_72%)]">
    <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--accent-gold-soft)]">
      <span className="h-3.5 w-2.5 rounded-full bg-[var(--accent-2)]" />
    </div>
    <div className="min-w-0 space-y-1">
      <LevelBars className="h-3.5 w-full" />
      <div className="h-1.5 w-24 rounded-full bg-[var(--overlay-muted)] opacity-70" />
    </div>
    <div className="flex justify-center">
      <span className="relative h-3 w-3 before:absolute before:left-1/2 before:top-0 before:h-3 before:w-0.5 before:-translate-x-1/2 before:rotate-45 before:rounded-full before:bg-[var(--danger)] after:absolute after:left-1/2 after:top-0 after:h-3 after:w-0.5 after:-translate-x-1/2 after:-rotate-45 after:rounded-full after:bg-[var(--danger)]" />
    </div>
  </div>
);

const LevelBars: React.FC<{ className?: string }> = ({ className = "" }) => (
  <div className={`flex items-center justify-center gap-1 ${className}`}>
    {[45, 80, 58, 100, 40, 72, 52].map((height, index) => (
      <span
        key={`${height}-${index}`}
        className="w-1 rounded-full bg-[var(--accent-gold)]"
        style={{ height: `${height}%` }}
      />
    ))}
  </div>
);
