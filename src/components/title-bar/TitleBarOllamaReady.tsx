import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";
import { useOllamaStore } from "@/stores/ollamaStore";
import { Button } from "../ui/Button";

const POLL_MS = 45_000;

/**
 * Ollama status glyph for the window title bar (always visible).
 * Color reflects installed / running / unreachable state.
 */
const TitleBarOllamaReady: React.FC = () => {
  const { t } = useTranslation();
  const { status, statusCheckFailed, isChecking, checkStatus } =
    useOllamaStore();

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void checkStatus();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [checkStatus]);

  const loading = isChecking || status === null;

  let title: string;
  let iconClass: string;
  let Icon: typeof CheckCircle2;

  if (loading) {
    title = t("ollama.checking");
    iconClass =
      "text-[var(--muted)] animate-spin dark:text-[var(--muted)]";
    Icon = Loader2;
  } else if (statusCheckFailed) {
    title = t("ollama.titleBarStatusCheckFailed");
    iconClass =
      "text-amber-600 hover:!text-amber-700 dark:text-amber-400 dark:hover:!text-amber-300";
    Icon = AlertTriangle;
  } else if (!status.installed) {
    title = t("ollama.notInstalled");
    iconClass =
      "text-red-600 hover:!text-red-700 dark:text-red-400 dark:hover:!text-red-300";
    Icon = XCircle;
  } else if (!status.running) {
    title = t("ollama.notRunning");
    iconClass =
      "text-amber-600 hover:!text-amber-700 dark:text-amber-400 dark:hover:!text-amber-300";
    Icon = AlertCircle;
  } else {
    title = t("ollama.ready");
    iconClass =
      "text-emerald-600 hover:!text-emerald-700 dark:text-emerald-400 dark:hover:!text-emerald-300";
    Icon = CheckCircle2;
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={`border-transparent p-1.5 ${iconClass}`}
      title={title}
      aria-label={title}
    >
      <Icon
        className="h-5 w-5 shrink-0"
        aria-hidden
        strokeWidth={2.5}
      />
    </Button>
  );
};

export default TitleBarOllamaReady;
