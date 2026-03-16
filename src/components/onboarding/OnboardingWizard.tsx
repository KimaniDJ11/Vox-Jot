import React, { useState, useCallback } from "react";
import WelcomeStep from "./WelcomeStep";
import PermissionsStep from "./PermissionsStep";
import ModelStep from "./ModelStep";
import TutorialStep from "./TutorialStep";

type WizardStep = "welcome" | "permissions" | "model" | "tutorial";

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
  const goToTutorial = useCallback(() => setStep("tutorial"), []);
  const goBack = useCallback(() => {
    setStep((prev) => {
      switch (prev) {
        case "permissions":
          return "welcome";
        case "model":
          return "permissions";
        case "tutorial":
          return "model";
        default:
          return prev;
      }
    });
  }, []);

  switch (step) {
    case "welcome":
      return <WelcomeStep onContinue={goToPermissions} />;
    case "permissions":
      return (
        <PermissionsStep
          onComplete={goToModel}
          onBack={skipToPermissions ? undefined : goBack}
        />
      );
    case "model":
      return <ModelStep onModelSelected={goToTutorial} onBack={goBack} />;
    case "tutorial":
      return <TutorialStep onComplete={onComplete} onBack={goBack} />;
    default:
      return null;
  }
};

export default OnboardingWizard;
