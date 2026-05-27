import React from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import {
  SelectionDot,
  visualizationStateClass,
} from "@/components/settings/VisualizationCard";

interface ThemeSelectorProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const THEME_VALUES = [
  "light",
  "dark",
  "sepia",
  "ocean",
  "forest",
  "rose",
  "aurora",
  "lagoon",
  "daybreak",
  "ember",
  "galaxy",
  "slate",
  "solarized",
  "graphite",
  "system",
] as const;

type ThemeValue = (typeof THEME_VALUES)[number];

const themePreviewTokens: Record<
  ThemeValue,
  { bg: string; panel: string; text: string; accent: string; icon: typeof Sun }
> = {
  light: {
    bg: "#f8f5f0",
    panel: "#ffffff",
    text: "#2c2418",
    accent: "#27408b",
    icon: Sun,
  },
  dark: {
    bg: "#0a0b0d",
    panel: "#1c1d20",
    text: "#f7f8f8",
    accent: "#7b9ce8",
    icon: Moon,
  },
  sepia: {
    bg: "#f7efe3",
    panel: "#fffaf3",
    text: "#3b2d1d",
    accent: "#7c4c2e",
    icon: Palette,
  },
  ocean: {
    bg: "#eef5fb",
    panel: "#ffffff",
    text: "#183046",
    accent: "#1f5d8f",
    icon: Palette,
  },
  forest: {
    bg: "#eef5ef",
    panel: "#ffffff",
    text: "#1f3224",
    accent: "#2f6c4a",
    icon: Palette,
  },
  rose: {
    bg: "#fbf2f4",
    panel: "#ffffff",
    text: "#3a2430",
    accent: "#9a3f66",
    icon: Palette,
  },
  aurora: {
    bg: "linear-gradient(135deg,#0d111b 0%,#12312d 100%)",
    panel: "#1e2635",
    text: "#f4f8fb",
    accent: "#80d8ca",
    icon: Palette,
  },
  lagoon: {
    bg: "linear-gradient(135deg,#eafff8 0%,#edf3ff 100%)",
    panel: "#ffffff",
    text: "#183332",
    accent: "#14756f",
    icon: Palette,
  },
  daybreak: {
    bg: "linear-gradient(135deg,#fff0e6 0%,#eaf4ff 100%)",
    panel: "#fffdfb",
    text: "#2d2931",
    accent: "#27619d",
    icon: Palette,
  },
  ember: {
    bg: "linear-gradient(135deg,#17131d 0%,#2c2028 100%)",
    panel: "#2d222a",
    text: "#fff4f0",
    accent: "#f0a36a",
    icon: Palette,
  },
  galaxy: {
    bg: "linear-gradient(135deg,#120026 0%,#5b1aa8 55%,#ff4fd8 100%)",
    panel: "#26143f",
    text: "#fff7ff",
    accent: "#ff72df",
    icon: Palette,
  },
  slate: {
    bg: "#141922",
    panel: "#273448",
    text: "#eff5ff",
    accent: "#90aee6",
    icon: Palette,
  },
  solarized: {
    bg: "#fdf6e3",
    panel: "#fffaf0",
    text: "#073642",
    accent: "#268bd2",
    icon: Palette,
  },
  graphite: {
    bg: "#111317",
    panel: "#242b36",
    text: "#eef2f8",
    accent: "#87a5d8",
    icon: Palette,
  },
  system: {
    bg: "linear-gradient(135deg,#f8f5f0 0%,#f8f5f0 49%,#0a0b0d 50%,#0a0b0d 100%)",
    panel:
      "linear-gradient(135deg,#ffffff 0%,#ffffff 49%,#1c1d20 50%,#1c1d20 100%)",
    text: "#2c2418",
    accent: "#27408b",
    icon: Monitor,
  },
};

export const ThemeSelector: React.FC<ThemeSelectorProps> = (props) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const selectedTheme = (getSetting("app_theme") ?? "system") as ThemeValue;
  const disabled = isUpdating("app_theme");

  return (
    <SettingContainer
      title={t("settings.advanced.theme.title")}
      description={t("settings.advanced.theme.description")}
      layout="stacked"
      {...props}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {THEME_VALUES.map((value) => {
          const label = t(`settings.advanced.theme.options.${value}`);
          const selected = selectedTheme === value;
          const tokens = themePreviewTokens[value];
          const Icon = tokens.icon;

          return (
            <button
              key={value}
              type="button"
              className={visualizationStateClass(selected, disabled)}
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => void updateSetting("app_theme", value)}
            >
              <div
                className="mb-3 overflow-hidden rounded-md border border-[var(--border)] p-2"
                style={{ background: tokens.bg }}
              >
                <div
                  className="rounded-md p-2 shadow-sm"
                  style={{ background: tokens.panel }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: tokens.accent }}
                      />
                      <span
                        className="h-1.5 w-10 rounded-full"
                        style={{ background: tokens.text, opacity: 0.45 }}
                      />
                    </div>
                    <Icon
                      className="h-3.5 w-3.5"
                      style={{ color: tokens.accent }}
                      aria-hidden
                    />
                  </div>
                  <div className="space-y-1">
                    <span
                      className="block h-1.5 w-4/5 rounded-full"
                      style={{ background: tokens.text, opacity: 0.8 }}
                    />
                    <span
                      className="block h-1.5 w-3/5 rounded-full"
                      style={{ background: tokens.text, opacity: 0.36 }}
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-semibold text-[var(--text)]">
                  {label}
                </p>
                <SelectionDot selected={selected} />
              </div>
            </button>
          );
        })}
      </div>
    </SettingContainer>
  );
};
