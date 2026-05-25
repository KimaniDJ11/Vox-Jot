import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Keyboard, Mic, Sparkles } from "lucide-react";
import OnboardingLayout from "./OnboardingLayout";
import { useSettings } from "../../hooks/useSettings";

interface TutorialStepProps {
  onComplete: () => void;
  onBack?: () => void;
}

const formatShortcut = (binding: string | undefined): string => {
  if (!binding) {
    return "Not set";
  }

  return binding
    .split("+")
    .map((part) => {
      const normalized = part.trim().toLowerCase();
      switch (normalized) {
        case "cmd":
        case "command":
          return "Cmd";
        case "ctrl":
          return "Ctrl";
        case "option":
        case "opt":
        case "alt":
          return "Option";
        case "shift":
          return "Shift";
        case "space":
          return "Space";
        default:
          return normalized.length === 1
            ? normalized.toUpperCase()
            : normalized.charAt(0).toUpperCase() + normalized.slice(1);
      }
    })
    .join(" + ");
};

const TutorialStep: React.FC<TutorialStepProps> = ({ onComplete, onBack }) => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const bindings = getSetting("bindings");
  const postProcessEnabled = getSetting("post_process_enabled") ?? false;

  const dictationShortcut = formatShortcut(
    bindings?.transcribe?.current_binding ||
      bindings?.transcribe?.default_binding,
  );
  const postProcessShortcut = formatShortcut(
    bindings?.transcribe_with_post_process?.current_binding ||
      bindings?.transcribe_with_post_process?.default_binding,
  );

  return (
    <OnboardingLayout
      currentStep="learn"
      onBack={onBack}
      leftContent={
        <>
          <p className="ob-eyebrow">
            {t("onboarding.firstDictation.eyebrow", {
              defaultValue: "First success",
            })}
          </p>
          <h1 className="ob-heading">{t("onboarding.firstDictation.title")}</h1>
          <p className="ob-subtext">
            {t("onboarding.firstDictation.description")}
          </p>

          <div className="ob-step-list">
            {(
              t("onboarding.firstDictation.steps", {
                returnObjects: true,
              }) as string[]
            ).map((step, index) => (
              <div key={step} className="ob-step-item">
                <span className="ob-step-number">{index + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>

          <div className="ob-note-card">
            <div className="ob-note-title">
              {postProcessEnabled
                ? t("onboarding.firstDictation.postProcessReady.title")
                : t("onboarding.firstDictation.postProcessLater.title")}
            </div>
            <p className="ob-note-copy">
              {postProcessEnabled
                ? t("onboarding.firstDictation.postProcessReady.description")
                : t("onboarding.firstDictation.postProcessLater.description")}
            </p>
          </div>

          <div className="ob-bottom-actions">
            <button className="ob-btn-primary" onClick={onComplete}>
              {t("onboarding.firstDictation.cta")}
              <ArrowRight size={18} aria-hidden />
            </button>
          </div>
        </>
      }
      rightContent={
        <div className="ob-first-run-panel">
          <div className="ob-first-run-card ob-first-run-card-primary">
            <div className="ob-first-run-header">
              <div className="ob-card-icon">
                <Mic size={18} aria-hidden />
              </div>
              <div>
                <div className="ob-stat-title">
                  {t("onboarding.firstDictation.shortcuts.dictation.label")}
                </div>
                <div className="ob-card-copy">
                  {t(
                    "onboarding.firstDictation.shortcuts.dictation.description",
                  )}
                </div>
              </div>
            </div>
            <kbd className="ob-kbd ob-kbd-large">{dictationShortcut}</kbd>
            <div className="ob-try-saying">
              <span>
                {t("onboarding.firstDictation.trySayingLabel", {
                  defaultValue: "Try saying",
                })}
              </span>
              <p>
                {t("onboarding.firstDictation.trySayingText", {
                  defaultValue:
                    "Write a quick note that says I am testing Vox Jot and the first dictation is working.",
                })}
              </p>
            </div>
          </div>

          <div className="ob-card-row ob-first-run-card">
            <div className="ob-card-icon">
              <Sparkles size={18} aria-hidden />
            </div>
            <div>
              <div className="ob-stat-title">
                {t("onboarding.firstDictation.shortcuts.postProcess.label")}
              </div>
              <div className="ob-card-copy">
                {postProcessEnabled
                  ? t(
                      "onboarding.firstDictation.shortcuts.postProcess.descriptionEnabled",
                    )
                  : t(
                      "onboarding.firstDictation.shortcuts.postProcess.descriptionDisabled",
                    )}
              </div>
              <kbd className="ob-kbd">{postProcessShortcut}</kbd>
            </div>
          </div>

          <div className="ob-card-row ob-first-run-card">
            <div className="ob-card-icon">
              <Keyboard size={18} aria-hidden />
            </div>
            <div>
              <div className="ob-stat-title">
                {t("onboarding.firstDictation.tip.title")}
              </div>
              <div className="ob-card-copy">
                {t("onboarding.firstDictation.tip.description")}
              </div>
            </div>
          </div>

          <div className="ob-first-run-checklist">
            {(
              t("onboarding.firstDictation.readyChecks", {
                returnObjects: true,
                defaultValue: [
                  "Microphone and text insertion are ready.",
                  "The shortcut works from other Mac apps.",
                  "You can tune models and cleanup later.",
                ],
              }) as string[]
            ).map((item) => (
              <div key={item}>
                <Check size={15} aria-hidden />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      }
    />
  );
};

export default TutorialStep;
