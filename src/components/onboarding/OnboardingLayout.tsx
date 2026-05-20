import React from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./onboarding.css";

export type OnboardingStepName =
  | "welcome"
  | "permissions"
  | "setup"
  | "refine"
  | "learn";

interface OnboardingLayoutProps {
  currentStep: OnboardingStepName;
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  children?: React.ReactNode;
  onBack?: () => void;
  chromeVariant?: "split" | "story";
}

const OnboardingLayout: React.FC<OnboardingLayoutProps> = ({
  currentStep,
  leftContent,
  rightContent,
  children,
  onBack,
  chromeVariant = "split",
}) => {
  const { t } = useTranslation();
  const steps: { key: OnboardingStepName; label: string }[] = [
    { key: "welcome", label: t("onboarding.steps.welcome") },
    { key: "permissions", label: t("onboarding.steps.permissions") },
    { key: "setup", label: t("onboarding.steps.setup") },
    { key: "refine", label: t("onboarding.steps.refine") },
    { key: "learn", label: t("onboarding.steps.learn") },
  ];
  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className={`ob-root ob-root-${chromeVariant}`}>
      {/* Progress bar */}
      <nav
        className="ob-progress-bar"
        aria-label={t("onboarding.steps.progress", {
          defaultValue: "Onboarding progress",
        })}
      >
        {steps.map((step, i) => (
          <React.Fragment key={step.key}>
            <span
              className={`ob-progress-step ${
                i < currentIndex
                  ? "ob-step-done"
                  : i === currentIndex
                    ? "ob-step-active"
                    : "ob-step-upcoming"
              }`}
              aria-current={i === currentIndex ? "step" : undefined}
            >
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <ChevronRight
                className="ob-progress-chevron"
                size={14}
                aria-hidden
              />
            )}
          </React.Fragment>
        ))}
        {/* Progress line */}
        <div className="ob-progress-line" aria-hidden>
          <div
            className="ob-progress-fill"
            style={{ width: `${(currentIndex / (steps.length - 1)) * 100}%` }}
          />
        </div>
      </nav>

      {chromeVariant === "story" ? (
        <div className="ob-story-shell">
          {onBack && (
            <button onClick={onBack} className="ob-back-btn ob-story-back-btn">
              {t("onboarding.common.back")}
            </button>
          )}
          {children}
        </div>
      ) : (
        <div className="ob-split">
          <div className="ob-left">
            {onBack && (
              <button onClick={onBack} className="ob-back-btn">
                {t("onboarding.common.back")}
              </button>
            )}
            <div className="ob-left-content">{leftContent}</div>
          </div>

          <div className="ob-right">
            {rightContent ?? <div className="ob-right-placeholder" />}
          </div>
        </div>
      )}
    </div>
  );
};

export default OnboardingLayout;
