import React from "react";
import { useTranslation } from "react-i18next";
import { Mic, Sparkles, Cpu } from "lucide-react";
import OnboardingLayout from "./OnboardingLayout";

interface WelcomeStepProps {
  onContinue: () => void;
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ onContinue }) => {
  const { t } = useTranslation();

  return (
    <OnboardingLayout
      currentStep="welcome"
      leftContent={
        <>
          <h1 className="ob-heading">{t("onboarding.welcome.title")}</h1>
          <p className="ob-subtext">{t("onboarding.welcome.description")}</p>

          <div className="ob-feature-list">
            {(
              t("onboarding.welcome.features", {
                returnObjects: true,
              }) as string[]
            ).map((feature) => (
              <div key={feature} className="ob-feature-item">
                <span className="ob-feature-dot" />
                <span>{feature}</span>
              </div>
            ))}
          </div>

          <div className="ob-bottom-actions">
            <button className="ob-btn-primary" onClick={onContinue}>
              {t("onboarding.welcome.cta")}
            </button>
          </div>
        </>
      }
      rightContent={
        <div className="ob-visual-card ob-visual-stack">
          <div className="ob-hero-badge">
            <Mic size={36} color="var(--ob-primary)" />
          </div>
          <h3 className="ob-card-title">{t("onboarding.welcome.cardTitle")}</h3>
          <p className="ob-card-copy">
            {t("onboarding.welcome.cardDescription")}
          </p>

          <div className="ob-stat-grid">
            <div className="ob-stat-card">
              <Cpu size={16} color="var(--ob-primary)" />
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
              <Mic size={16} color="var(--ob-primary)" />
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
              <Sparkles size={16} color="var(--ob-primary)" />
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
