import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useOllamaStore } from "@/stores/ollamaStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import OnboardingLayout from "./OnboardingLayout";

const FALLBACK_REFINE_MODEL_ID = "smollm2:135m";

interface RefineStepProps {
  onComplete: () => void;
  onBack?: () => void;
}

type Phase = "checking" | "idle" | "installing" | "pulling" | "ready";

const RefineStep: React.FC<RefineStepProps> = ({ onComplete, onBack }) => {
  const { t } = useTranslation();
  const {
    status,
    isChecking,
    isInstalling,
    installProgress,
    pullProgress,
    pullingModels,
    checkStatus,
    installOllama,
    pullModel,
    startServe,
    loadRecommendedModels,
    recommendedModels,
  } = useOllamaStore();
  const { setPostProcessProvider } = useSettingsStore();

  const [error, setError] = useState<string | null>(null);
  const autoFinishedRef = useRef(false);
  const installInFlightRef = useRef(false);

  useEffect(() => {
    checkStatus().then(() => loadRecommendedModels());
  }, []);

  const installedModels = status?.models ?? [];
  const preferredRefineModelId = useMemo(
    () =>
      recommendedModels.find((model) => model.id === FALLBACK_REFINE_MODEL_ID)
        ?.id ??
      recommendedModels[0]?.id ??
      FALLBACK_REFINE_MODEL_ID,
    [recommendedModels],
  );
  const installedRefineModelId = installedModels[0] ?? null;
  const refineModelId = installedRefineModelId ?? preferredRefineModelId;
  const hasRefineModel = installedModels.length > 0;
  const isPullingRefineModel = pullingModels.has(refineModelId);
  const refinePullPercent = pullProgress[refineModelId] ?? 0;

  const phase: Phase = useMemo(() => {
    if (!status || isChecking) return "checking";
    if (isInstalling) return "installing";
    if (isPullingRefineModel) return "pulling";
    if (status?.installed && status.running && hasRefineModel) return "ready";
    return "idle";
  }, [status, isChecking, isInstalling, isPullingRefineModel, hasRefineModel]);

  const finalizeAndContinue = async (modelId: string) => {
    if (autoFinishedRef.current) return;
    autoFinishedRef.current = true;
    try {
      await setPostProcessProvider("ollama");
      await invoke("change_post_process_model_setting", {
        providerId: "ollama",
        model: modelId,
      });
    } catch (e) {
      console.error("Failed to set default Refine provider/model:", e);
    }
    onComplete();
  };

  const handleInstall = async () => {
    if (installInFlightRef.current) return;
    installInFlightRef.current = true;
    setError(null);
    try {
      const installed = await installOllama();
      if (!installed) {
        setError(t("onboarding.refine.errors.installFailed"));
        return;
      }
      // Ensure Ollama is serving before pulling.
      const latest = await checkStatus();
      if (latest.installed && !latest.running) {
        const started = await startServe();
        if (!started) {
          setError(t("onboarding.refine.errors.startFailed"));
          return;
        }
      }
      await loadRecommendedModels();

      const refreshed = await checkStatus();
      const installedModelId = refreshed.models[0] ?? null;
      if (installedModelId) {
        await finalizeAndContinue(installedModelId);
        return;
      }

      const pulled = await pullModel(refineModelId);
      if (!pulled) {
        setError(t("onboarding.refine.errors.pullFailed"));
        return;
      }
      await finalizeAndContinue(refineModelId);
    } catch (e) {
      console.error("Refine onboarding install failed:", e);
      toast.error(t("onboarding.refine.errors.installFailed"));
      setError(t("onboarding.refine.errors.installFailed"));
    } finally {
      installInFlightRef.current = false;
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  // When the user enters the step with Ollama already installed + running +
  // the default model already pulled, just continue. Don't auto-write the
  // provider in that case — they may already have a different one set up.
  useEffect(() => {
    if (phase === "ready" && !autoFinishedRef.current) {
      autoFinishedRef.current = true;
      onComplete();
    }
  }, [phase, onComplete]);

  // ─── Left content ──────────────────────────────────────────────────────────

  let leftContent: React.ReactNode;

  if (phase === "checking") {
    leftContent = (
      <>
        <h1 className="ob-heading">{t("onboarding.refine.title")}</h1>
        <p className="ob-subtext" role="status" aria-live="polite">
          {t("onboarding.refine.checking")}
        </p>
      </>
    );
  } else if (phase === "installing") {
    leftContent = (
      <>
        <h1 className="ob-heading">
          {t("onboarding.refine.installing.title")}
        </h1>
        <p className="ob-subtext" role="status" aria-live="polite">
          {installProgress || t("onboarding.refine.installing.description")}
        </p>
      </>
    );
  } else if (phase === "pulling") {
    leftContent = (
      <>
        <h1 className="ob-heading">{t("onboarding.refine.pulling.title")}</h1>
        <p className="ob-subtext">
          {t("onboarding.refine.pulling.description", {
            model: refineModelId,
          })}
        </p>
        <div className="mt-4">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--ob-track,rgba(125,125,125,0.25))]"
            role="progressbar"
            aria-label={t("onboarding.refine.pulling.progressLabel", {
              defaultValue: "Refine model download progress",
            })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={refinePullPercent}
          >
            <div
              className="h-full rounded-full bg-[var(--ob-primary)] transition-all"
              style={{ width: `${refinePullPercent}%` }}
            />
          </div>
          <p className="ob-footnote mt-2" role="status" aria-live="polite">
            {refinePullPercent}%
          </p>
        </div>
      </>
    );
  } else {
    leftContent = (
      <>
        <h1 className="ob-heading">{t("onboarding.refine.title")}</h1>
        <p className="ob-subtext">{t("onboarding.refine.description")}</p>

        <ul className="ob-step-list mt-2">
          <li className="ob-step-item">
            <span className="ob-step-number">1</span>
            <span>{t("onboarding.refine.bullets.local")}</span>
          </li>
          <li className="ob-step-item">
            <span className="ob-step-number">2</span>
            <span>{t("onboarding.refine.bullets.tiny")}</span>
          </li>
          <li className="ob-step-item">
            <span className="ob-step-number">3</span>
            <span>{t("onboarding.refine.bullets.optional")}</span>
          </li>
        </ul>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger)]"
          >
            {error}
          </p>
        )}

        <div className="ob-bottom-actions">
          <button
            type="button"
            className="ob-btn-primary"
            onClick={handleInstall}
            disabled={isInstalling}
          >
            {t("onboarding.refine.installCta")}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            className={`mt-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-transparent px-2 py-1 text-sm text-[var(--ob-text-muted)] transition-colors hover:text-[var(--ob-text)] ${interactiveFocusRingClass}`}
          >
            {t("onboarding.refine.skipCta")}
          </button>
        </div>

        <p className="ob-footnote">{t("onboarding.refine.footnote")}</p>
      </>
    );
  }

  // ─── Right visual ──────────────────────────────────────────────────────────

  let rightVisual: React.ReactNode;

  if (phase === "installing" || phase === "pulling" || phase === "checking") {
    rightVisual = (
      <div className="ob-visual-card ob-visual-center ob-visual-stack">
        <Loader2
          size={48}
          className="ob-spinner mx-auto mb-4"
          color="var(--ob-primary)"
        />
        <h3 className="ob-card-title">
          {phase === "pulling"
            ? t("onboarding.refine.pulling.title")
            : phase === "installing"
              ? t("onboarding.refine.installing.title")
              : t("onboarding.refine.checking")}
        </h3>
        <p className="ob-card-copy">
          {phase === "pulling"
            ? t("onboarding.refine.pulling.description", {
                model: refineModelId,
              })
            : phase === "installing"
              ? installProgress || t("onboarding.refine.installing.description")
              : t("onboarding.refine.checkingDescription")}
        </p>
      </div>
    );
  } else if (phase === "ready") {
    rightVisual = (
      <div className="ob-visual-card ob-visual-center ob-visual-stack">
        <div className="ob-hero-badge ob-hero-badge-sm">
          <Check size={28} color="var(--ob-primary)" />
        </div>
        <h3 className="ob-card-title">{t("onboarding.refine.ready.title")}</h3>
        <p className="ob-card-copy">
          {t("onboarding.refine.ready.description")}
        </p>
      </div>
    );
  } else {
    rightVisual = (
      <div className="ob-visual-card ob-visual-center ob-visual-stack">
        <div className="ob-hero-badge ob-hero-badge-sm">
          <Sparkles size={28} color="var(--ob-primary)" />
        </div>
        <h3 className="ob-card-title">{t("onboarding.refine.cardTitle")}</h3>
        <p className="ob-card-copy">{t("onboarding.refine.cardDescription")}</p>
      </div>
    );
  }

  return (
    <OnboardingLayout
      currentStep="refine"
      onBack={isInstalling || isPullingRefineModel ? undefined : onBack}
      leftContent={leftContent}
      rightContent={rightVisual}
    />
  );
};

export default RefineStep;
