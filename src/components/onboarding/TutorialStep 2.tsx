import React, { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import OnboardingLayout from "./OnboardingLayout";

interface TutorialStepProps {
  onComplete: () => void;
  onBack?: () => void;
}

const TutorialStep: React.FC<TutorialStepProps> = ({ onComplete, onBack }) => {
  const { t } = useTranslation();
  const [hasSpoken, setHasSpoken] = useState(false);
  const [dummyText, setDummyText] = useState("");

  // Simulate detecting a dictation input
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDummyText(val);
    if (val.trim().length > 10 && !hasSpoken) {
      setHasSpoken(true);
    }
  };

  const tabKeys = [
    "onboarding.tutorial.tabs.message",
    "onboarding.tutorial.tabs.email",
    "onboarding.tutorial.tabs.whisperNote",
  ] as const;

  return (
    <OnboardingLayout
      currentStep="learn"
      onBack={onBack}
      leftContent={
        <>
          <h1 className="ob-heading">
            <Trans i18nKey="onboarding.tutorial.heading">
              Try <em style={{ fontStyle: "italic" }}>Smart Formatting</em>
            </Trans>
          </h1>
          <p className="ob-subtext">
            <Trans i18nKey="onboarding.tutorial.holdInstruction">
              Hold down on the{" "}
              <kbd
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  border: "1px solid var(--ob-border)",
                  borderRadius: 4,
                  fontSize: 13,
                  fontFamily: "monospace",
                  background: "#f5f2ec",
                }}
              >
                fn
              </kbd>{" "}
              key, speak, and let go to insert spoken text.
            </Trans>
          </p>
          <p
            style={{
              fontSize: 14,
              color: "var(--ob-text-muted)",
              margin: "0 0 24px",
              lineHeight: 1.6,
            }}
          >
            {t("onboarding.tutorial.autoFormat")}
          </p>

          <div className="ob-bottom-actions">
            <button className="ob-btn-primary" onClick={onComplete}>
              {t("onboarding.tutorial.continue")}
            </button>
            <button className="ob-btn-secondary" onClick={onComplete}>
              {t("onboarding.tutorial.skip")}
            </button>
          </div>
        </>
      }
      rightContent={
        <div className="ob-visual-card">
          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: 24,
              borderBottom: "2px solid var(--ob-border)",
              paddingBottom: 12,
              marginBottom: 20,
            }}
          >
            {tabKeys.map((tabKey, i) => (
              <span
                key={tabKey}
                style={{
                  fontSize: 14,
                  fontWeight: i === 0 ? 600 : 400,
                  color: i === 0 ? "var(--ob-text)" : "var(--ob-text-muted)",
                  cursor: "pointer",
                  borderBottom:
                    i === 0 ? "2px solid var(--ob-primary)" : "none",
                  paddingBottom: 14,
                  marginBottom: -14,
                }}
              >
                {i === 0 && "✓ "}
                {t(tabKey)}
              </span>
            ))}
          </div>

          {/* Simulated text input */}
          <div style={{ marginBottom: 16 }}>
            <span
              style={{
                display: "inline-block",
                background: "#e6f7e9",
                color: "#16a34a",
                fontSize: 13,
                fontWeight: 500,
                padding: "4px 12px",
                borderRadius: 6,
                marginBottom: 12,
              }}
            >
              {t("onboarding.tutorial.trySaying")}
            </span>
          </div>

          <textarea
            value={dummyText}
            onChange={handleTextChange}
            placeholder={t("onboarding.tutorial.placeholder")}
            style={{
              width: "100%",
              minHeight: 100,
              border: "1px solid var(--ob-border)",
              borderRadius: 8,
              padding: 12,
              fontSize: 14,
              fontFamily: "inherit",
              color: "var(--ob-text)",
              resize: "none",
              background: "transparent",
              outline: "none",
            }}
          />

          {hasSpoken && (
            <div
              className="ob-celebrate"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 12,
                color: "var(--ob-success)",
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              <CheckCircle2 size={18} />
              {t("onboarding.tutorial.greatJob")}
            </div>
          )}
        </div>
      }
    />
  );
};

export default TutorialStep;
