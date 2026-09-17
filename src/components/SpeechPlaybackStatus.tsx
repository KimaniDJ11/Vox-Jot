import React from "react";
import { AlertCircle, Loader2, Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TtsPlaybackStatusEvent } from "@/lib/types/events";
import { Button } from "@/components/ui/Button";

export const SpeechPlaybackStatus: React.FC<{
  status: TtsPlaybackStatusEvent;
  onStop: () => void;
}> = ({ status, onStop }) => {
  const { t } = useTranslation();
  const isSpeaking = status.phase === "speaking";
  const isFailed = status.phase === "failed";

  const phaseLabel =
    status.phase === "preparing"
      ? t("listen.preparingSpeech", { defaultValue: "Preparing speech…" })
      : status.phase === "speaking"
        ? t("listen.speaking", { defaultValue: "Speaking…" })
        : status.phase === "failed"
          ? t("listen.speechFailed", { defaultValue: "Speech failed" })
          : t("listen.stoppingSpeech", { defaultValue: "Stopping…" });

  return (
    <aside
      className="pointer-events-auto flex min-h-12 max-w-[min(26rem,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--accent),transparent_58%)] bg-[var(--panel-bg)] px-3 py-2 text-sm text-[var(--text)] shadow-[var(--floating-panel-shadow)]"
      data-testid="tts-playback-status"
      data-phase={status.phase}
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isFailed
            ? "bg-[color-mix(in_srgb,var(--destructive),transparent_82%)] text-[var(--destructive)]"
            : "bg-[var(--accent-soft)] text-[var(--accent)]"
        }`}
        aria-hidden
      >
        {isFailed ? (
          <AlertCircle className="h-4 w-4" />
        ) : isSpeaking ? (
          <Volume2 className="h-4 w-4" />
        ) : (
          <Loader2 className="h-4 w-4 animate-[spin_1s_linear_infinite]" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {t("listen.createVoices.textToSpeech", {
            defaultValue: "Text to Speech",
          })}
        </span>
        <span className="block truncate text-xs text-[var(--muted)]">
          {phaseLabel}
        </span>
      </span>
      {!isFailed && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 px-2.5"
          onClick={onStop}
          aria-label={t("common.stop", { defaultValue: "Stop" })}
          title={t("common.stop", { defaultValue: "Stop" })}
        >
          <Square className="h-3.5 w-3.5" aria-hidden />
          {t("common.stop", { defaultValue: "Stop" })}
        </Button>
      )}
    </aside>
  );
};
