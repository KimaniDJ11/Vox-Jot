import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import { useOllamaStore } from "@/stores/ollamaStore";
import { Button } from "../ui/Button";

interface TitleBarOllamaReadyProps {
  /** When false, render nothing (e.g. not on LLM Models settings). */
  active: boolean;
}

/**
 * Green Ollama “running” indicator for the window title bar (trailing).
 * Mirrors the ready state shown in Ollama settings on small screens only.
 */
const TitleBarOllamaReady: React.FC<TitleBarOllamaReadyProps> = ({ active }) => {
  const { t } = useTranslation();
  const { status, checkStatus } = useOllamaStore();

  useEffect(() => {
    if (active) {
      void checkStatus();
    }
  }, [active, checkStatus]);

  if (!active) {
    return null;
  }

  const isInstalled = status?.installed ?? false;
  const isRunning = status?.running ?? false;

  if (!isInstalled || !isRunning) {
    return null;
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="border-transparent p-1.5 text-emerald-600 hover:!text-emerald-700 dark:text-emerald-400 dark:hover:!text-emerald-300"
      title={t("ollama.ready")}
      aria-label={t("ollama.ready")}
    >
      <CheckCircle2
        className="h-5 w-5 shrink-0"
        aria-hidden
        strokeWidth={2.5}
      />
    </Button>
  );
};

export default TitleBarOllamaReady;
