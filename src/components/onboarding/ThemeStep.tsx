import React, { useEffect, useState } from "react";
import { ArrowRight, Check, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  SelectionDot,
  visualizationStateClass,
} from "@/components/settings/VisualizationCard";
import {
  THEME_VALUES,
  themePreviewTokens,
  type ThemeValue,
} from "@/components/settings/ThemeSelector";
import { useSetting, useUpdateSetting } from "@/hooks/useSettings";

import OnboardingLayout from "./OnboardingLayout";

interface ThemeStepProps {
  onContinue: () => void;
  onBack?: () => void;
}

const DEFAULT_ONBOARDING_THEME: ThemeValue = "galaxy";

const ThemeStep: React.FC<ThemeStepProps> = ({ onContinue, onBack }) => {
  const { t } = useTranslation();
  const appTheme =
    (useSetting("app_theme") as ThemeValue | undefined) ??
    DEFAULT_ONBOARDING_THEME;
  const [selectedTheme, setSelectedTheme] = useState<ThemeValue>(appTheme);
  const updateSetting = useUpdateSetting();

  useEffect(() => {
    setSelectedTheme(appTheme);
  }, [appTheme]);

  const handleSelectTheme = (theme: ThemeValue) => {
    setSelectedTheme(theme);
    void updateSetting("app_theme", theme);
  };

  return (
    <OnboardingLayout
      currentStep="appearance"
      onBack={onBack}
      footerActions={
        <button className="ob-btn-primary" onClick={onContinue}>
          {t("onboarding.appearance.cta")}
          <ArrowRight size={18} aria-hidden />
        </button>
      }
      leftContent={
        <>
          <p className="ob-eyebrow">
            {t("onboarding.appearance.eyebrow", {
              defaultValue: "Make it yours",
            })}
          </p>
          <h1 className="ob-heading">{t("onboarding.appearance.title")}</h1>
          <p className="ob-subtext">{t("onboarding.appearance.description")}</p>

          <div className="ob-feature-list ob-feature-list-spacious">
            {(
              t("onboarding.appearance.features", {
                returnObjects: true,
                defaultValue: [
                  "Galaxy is selected by default for new installs.",
                  "Your choice applies immediately across Vox Jot.",
                  "You can switch themes later from Settings.",
                ],
              }) as string[]
            ).map((feature) => (
              <div key={feature} className="ob-feature-item">
                <Check size={16} className="ob-feature-check" aria-hidden />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </>
      }
      rightContent={
        <div className="ob-theme-panel">
          <div className="ob-card-row ob-theme-panel-header">
            <div className="ob-card-icon">
              <Palette size={18} aria-hidden />
            </div>
            <div>
              <h2 className="ob-card-title">
                {t("onboarding.appearance.cardTitle")}
              </h2>
              <p className="ob-card-copy">
                {t("onboarding.appearance.cardDescription")}
              </p>
            </div>
          </div>

          <div className="ob-theme-grid">
            {THEME_VALUES.map((theme) => {
              const label = t(`settings.advanced.theme.options.${theme}`);
              const selected = selectedTheme === theme;
              const tokens = themePreviewTokens[theme];
              const Icon = tokens.icon;

              return (
                <button
                  key={theme}
                  type="button"
                  className={`ob-theme-option ${visualizationStateClass(selected)}`}
                  aria-pressed={selected}
                  aria-label={t("onboarding.appearance.chooseTheme", {
                    theme: label,
                    defaultValue: "Choose {{theme}} theme",
                  })}
                  onClick={() => handleSelectTheme(theme)}
                >
                  <div
                    className="ob-theme-swatch"
                    style={{ background: tokens.bg }}
                    aria-hidden
                  >
                    <div
                      className="ob-theme-swatch-panel"
                      style={{ background: tokens.panel }}
                    >
                      <div className="ob-theme-swatch-top">
                        <span style={{ background: tokens.accent }} />
                        <Icon
                          className="ob-theme-swatch-icon"
                          style={{ color: tokens.accent }}
                          aria-hidden
                        />
                      </div>
                      <div className="ob-theme-lines">
                        <span
                          style={{ background: tokens.text, opacity: 0.8 }}
                        />
                        <span
                          style={{ background: tokens.text, opacity: 0.4 }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="ob-theme-label-row">
                    <span>{label}</span>
                    <SelectionDot selected={selected} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      }
    />
  );
};

export default ThemeStep;
