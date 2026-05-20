import React, { useState, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { getLanguageDirection } from "@/lib/utils/rtl";
import { modal } from "@/motion/springs";

import WelcomeStep from "./WelcomeStep";
import PermissionsStep from "./PermissionsStep";
import ModelStep from "./ModelStep";
import RefineStep from "./RefineStep";
import TutorialStep from "./TutorialStep";

type WizardStep = "welcome" | "permissions" | "model" | "refine" | "tutorial";

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

  const goToPermissions = useCallback(() => setStep("permissions"), []);
  const goToModel = useCallback(() => setStep("model"), []);
  const goToRefine = useCallback(() => setStep("refine"), []);
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
          return "welcome";
        case "model":
          return "permissions";
        case "refine":
          return "model";
        case "tutorial":
          return "refine";
        default:
          return prev;
      }
    });
  }, []);

  const renderStep = () => {
    switch (step) {
      case "welcome":
        return <WelcomeStep onContinue={goToPermissions} />;
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
        return <RefineStep onComplete={goToTutorial} onBack={goBack} />;
      case "tutorial":
        return <TutorialStep onComplete={onComplete} onBack={goBack} />;
      default:
        return null;
    }
  };

  return (
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
  );
};

export default OnboardingWizard;
