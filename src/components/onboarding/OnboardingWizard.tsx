import React, { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { modal } from "@/motion/springs";

import WelcomeStep from "./WelcomeStep";
import PermissionsStep from "./PermissionsStep";
import ModelStep from "./ModelStep";
import RefineStep from "./RefineStep";
import TutorialStep from "./TutorialStep";

type WizardStep =
  | "welcome"
  | "permissions"
  | "model"
  | "refine"
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
  const [step, setStep] = useState<WizardStep>(
    skipToPermissions ? "permissions" : "welcome",
  );

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
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={modal}
        className="h-full w-full"
      >
        {renderStep()}
      </motion.div>
    </AnimatePresence>
  );
};

export default OnboardingWizard;
