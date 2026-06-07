import React, { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { getLanguageDirection } from "@/lib/utils/rtl";
import { modal } from "@/motion/springs";

import WelcomeStep from "./WelcomeStep";
import ThemeStep from "./ThemeStep";
import PermissionsStep from "./PermissionsStep";
import ModelStep from "./ModelStep";
import RefineStep from "./RefineStep";
import DictationModesStep from "./DictationModesStep";
import TutorialStep from "./TutorialStep";

type WizardStep =
  | "welcome"
  | "appearance"
  | "permissions"
  | "model"
  | "refine"
  | "modes"
  | "tutorial";

interface OnboardingWizardProps {
  /** Called when the user finishes the entire onboarding flow. */
  onComplete: () => void;
  /** If true, skip welcome & jump straight to permissions (returning user). */
  skipToPermissions?: boolean;
}

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  onComplete,
  skipToPermissions = false,
}) => {
  const { i18n, t } = useTranslation();
  const direction = getLanguageDirection(i18n.language);
  const enterOffset = direction === "rtl" ? -20 : 20;
  const exitOffset = direction === "rtl" ? 20 : -20;
  const [step, setStep] = useState<WizardStep>(
    skipToPermissions ? "permissions" : "welcome",
  );
  const stepRegionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const region = stepRegionRef.current;
    if (!region) return;

    const heading = region.querySelector<HTMLElement>(".ob-heading");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
      return;
    }

    region.focus();
  }, [step]);

  const goToAppearance = useCallback(() => setStep("appearance"), []);
  const goToPermissions = useCallback(() => setStep("permissions"), []);
  const goToModel = useCallback(() => setStep("model"), []);
  const goToRefine = useCallback(() => setStep("refine"), []);
  const goToModes = useCallback(() => setStep("modes"), []);
  const goToTutorial = useCallback(() => setStep("tutorial"), []);
  const handlePermissionsComplete = useCallback(() => {
    if (skipToPermissions) {
      onComplete();
      return;
    }
    goToModel();
  }, [goToModel, onComplete, skipToPermissions]);
  const goBack = useCallback(() => {
    setStep((prev) => {
      switch (prev) {
        case "permissions":
          return "appearance";
        case "appearance":
          return "welcome";
        case "model":
          return "permissions";
        case "refine":
          return "model";
        case "modes":
          return "refine";
        case "tutorial":
          return "modes";
        default:
          return prev;
      }
    });
  }, []);

  const renderStep = () => {
    switch (step) {
      case "welcome":
        return <WelcomeStep onContinue={goToAppearance} />;
      case "appearance":
        return <ThemeStep onContinue={goToPermissions} onBack={goBack} />;
      case "permissions":
        return (
          <PermissionsStep
            onComplete={handlePermissionsComplete}
            onBack={skipToPermissions ? undefined : goBack}
          />
        );
      case "model":
        return <ModelStep onModelSelected={goToRefine} onBack={goBack} />;
      case "refine":
        return <RefineStep onComplete={goToModes} onBack={goBack} />;
      case "modes":
        return <DictationModesStep onComplete={goToTutorial} onBack={goBack} />;
      case "tutorial":
        // Terminal step — intentionally no Back. Going back would land on
        // the optional setup screens, all of which are adjustable later from
        // Settings, so onboarding finishes forward-only.
        return <TutorialStep onComplete={onComplete} />;
      default:
        return null;
    }
  };

  // The onboarding window is transparent at the html/body/#root level (so
  // native vibrancy can show through the main app shell). Each step paints its
  // own opaque background via `.ob-root`, but that lives inside the
  // opacity-animated motion.div below — so during an AnimatePresence "wait"
  // transition the only opaque layer fades to 0 and the bare (transparent)
  // window flashes the desktop through. This stable backdrop keeps a solid
  // var(--bg) behind the steps so transitions cross-fade content over a
  // constant background instead of flashing a "clear" view.
  return (
    <div className="relative h-full w-full bg-[var(--bg)]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          ref={stepRegionRef}
          tabIndex={-1}
          role="group"
          aria-label={t(`onboarding.steps.${step}`, {
            defaultValue: step,
          })}
          aria-live="polite"
          dir={direction}
          initial={{ opacity: 0, x: enterOffset }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: exitOffset }}
          transition={modal}
          className="h-full w-full"
        >
          {renderStep()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default OnboardingWizard;
