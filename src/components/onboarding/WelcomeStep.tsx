import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Cpu, Keyboard, Mic, Sparkles } from "lucide-react";
import OnboardingLayout from "./OnboardingLayout";

interface WelcomeStepProps {
  onContinue: () => void;
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ onContinue }) => {
  const { t } = useTranslation();

  return (
    <OnboardingLayout
      currentStep="welcome"
      footerActions={
        <button className="ob-btn-primary" onClick={onContinue}>
          {t("onboarding.welcome.cta")}
          <ArrowRight size={18} aria-hidden />
        </button>
      }
      leftContent={
        <>
          <p className="ob-eyebrow">
            {t("onboarding.welcome.eyebrow", {
              defaultValue: "Private Mac dictation",
            })}
          </p>
          <h1 className="ob-heading">{t("onboarding.welcome.title")}</h1>
          <p className="ob-subtext">{t("onboarding.welcome.description")}</p>

          <div
            className="ob-trust-strip"
            aria-label={t("onboarding.welcome.trustLabel", {
              defaultValue: "Vox Jot setup promises",
            })}
          >
            <span>
              {t("onboarding.welcome.trust.local", {
                defaultValue: "Local by default",
              })}
            </span>
            <span>
              {t("onboarding.welcome.trust.anyApp", {
                defaultValue: "Works across apps",
              })}
            </span>
            <span>
              {t("onboarding.welcome.trust.noAccount", {
                defaultValue: "No account needed",
              })}
            </span>
          </div>

          <div className="ob-feature-list ob-feature-list-spacious">
            {(
              t("onboarding.welcome.features", {
                returnObjects: true,
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
        <div
          className="ob-product-preview"
          aria-label={t("onboarding.welcome.previewLabel", {
            defaultValue: "Example of Vox Jot dictating into another Mac app",
          })}
        >
          <div className="ob-preview-window">
            <div className="ob-preview-titlebar" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <div className="ob-preview-compose">
              <div className="ob-preview-app-row">
                <div className="ob-preview-app-icon">
                  <Keyboard size={18} aria-hidden />
                </div>
                <div>
                  <p>
                    {t("onboarding.welcome.preview.app", {
                      defaultValue: "Focused text field",
                    })}
                  </p>
                  <span>
                    {t("onboarding.welcome.preview.destination", {
                      defaultValue: "Mail, Notes, Cursor, Slack, Safari",
                    })}
                  </span>
                </div>
              </div>
              <div className="ob-preview-text">
                {t("onboarding.welcome.preview.text", {
                  defaultValue:
                    "Hey Sam, quick update: the draft is ready for review. I cleaned up the rollout notes and added the risks section.",
                })}
              </div>
            </div>
            <div className="ob-preview-recorder">
              <span className="ob-preview-pulse" aria-hidden />
              <div>
                <p>
                  {t("onboarding.welcome.preview.recording", {
                    defaultValue: "Recording only while you start dictation",
                  })}
                </p>
                <span>
                  {t("onboarding.welcome.preview.shortcut", {
                    defaultValue: "Hold shortcut, speak, release",
                  })}
                </span>
              </div>
              <Mic size={18} aria-hidden />
            </div>
          </div>

          <div className="ob-stat-grid">
            <div className="ob-stat-card">
              <Cpu size={16} aria-hidden />
              <div>
                <div className="ob-stat-title">
                  {t("onboarding.welcome.highlights.local.title")}
                </div>
                <div className="ob-stat-copy">
                  {t("onboarding.welcome.highlights.local.description")}
                </div>
              </div>
            </div>
            <div className="ob-stat-card">
              <Mic size={16} aria-hidden />
              <div>
                <div className="ob-stat-title">
                  {t("onboarding.welcome.highlights.anywhere.title")}
                </div>
                <div className="ob-stat-copy">
                  {t("onboarding.welcome.highlights.anywhere.description")}
                </div>
              </div>
            </div>
            <div className="ob-stat-card">
              <Sparkles size={16} aria-hidden />
              <div>
                <div className="ob-stat-title">
                  {t("onboarding.welcome.highlights.polish.title")}
                </div>
                <div className="ob-stat-copy">
                  {t("onboarding.welcome.highlights.polish.description")}
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
};

export default WelcomeStep;
