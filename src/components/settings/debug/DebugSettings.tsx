import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { type } from "@tauri-apps/plugin-os";
import { invoke } from "@tauri-apps/api/core";
import { WordCorrectionThreshold } from "./WordCorrectionThreshold";
import { LogLevelSelector } from "./LogLevelSelector";
import { PasteDelay } from "./PasteDelay";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { Button } from "../../ui/Button";
import { AlwaysOnMicrophone } from "../AlwaysOnMicrophone";
import { SoundPicker } from "../SoundPicker";
import { ClamshellMicrophoneSelector } from "../ClamshellMicrophoneSelector";
import { ShortcutInput } from "../ShortcutInput";
import { UpdateChecksToggle } from "../UpdateChecksToggle";
import { useSettings } from "../../../hooks/useSettings";

interface RouteDebugResult {
  route: "pass1" | "pass2" | "command";
  word_count: number;
  has_correction_cue: boolean;
  has_list_cue: boolean;
  has_paragraph_cue: boolean;
  has_transform_cue: boolean;
  has_technical_tokens: boolean;
  looks_incomplete: boolean;
  score: number;
}

export const DebugSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const pushToTalk = getSetting("push_to_talk");
  const isLinux = type() === "linux";
  const [routeInput, setRouteInput] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<RouteDebugResult | null>(null);

  const analyzeRoute = async () => {
    const text = routeInput.trim();
    if (!text) {
      setRouteError(t("settings.debug.routeDebugger.enterText"));
      setRouteResult(null);
      return;
    }

    setRouteLoading(true);
    setRouteError(null);
    try {
      const result = await invoke<RouteDebugResult>(
        "debug_analyze_post_process_route",
        { text },
      );
      setRouteResult(result);
    } catch (error) {
      setRouteError(
        error instanceof Error ? error.message : t("settings.debug.routeDebugger.analysisFailed"),
      );
      setRouteResult(null);
    } finally {
      setRouteLoading(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <SettingsGroup title={t("settings.debug.title")}>
        <LogLevelSelector grouped={true} />
        <UpdateChecksToggle descriptionMode="tooltip" grouped={true} />
        <SoundPicker
          label={t("settings.debug.soundTheme.label")}
          description={t("settings.debug.soundTheme.description")}
        />
        <WordCorrectionThreshold descriptionMode="tooltip" grouped={true} />
        <PasteDelay descriptionMode="tooltip" grouped={true} />
        <AlwaysOnMicrophone descriptionMode="tooltip" grouped={true} />
        <ClamshellMicrophoneSelector descriptionMode="tooltip" grouped={true} />
        {/* Cancel shortcut is disabled on Linux due to instability with dynamic shortcut registration */}
        {!isLinux && (
          <ShortcutInput
            shortcutId="cancel"
            grouped={true}
            disabled={pushToTalk}
          />
        )}
      </SettingsGroup>

      <SettingsGroup title={t("settings.debug.routeDebugger.title")}>
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-[var(--muted)]">
            {t("settings.debug.routeDebugger.description")}
          </p>
          <textarea
            data-testid="route-debugger-input"
            value={routeInput}
            onChange={(event) => setRouteInput(event.target.value)}
            rows={4}
            className="w-full rounded-md border border-mid-gray/30 bg-background px-3 py-2 text-sm text-text focus:border-logo-primary focus:outline-none"
            placeholder={t("settings.debug.routeDebugger.placeholder")}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={analyzeRoute}
              disabled={routeLoading}
              data-testid="route-debugger-analyze"
            >
              {routeLoading ? t("settings.debug.routeDebugger.analyzing") : t("settings.debug.routeDebugger.analyzeRoute")}
            </Button>
            {routeResult && (
              <span className="text-sm text-[var(--muted)]" data-testid="route-debugger-result">
                {t("settings.debug.routeDebugger.routeLabel")}{" "}
                <strong className="text-[var(--accent)]">{routeResult.route}</strong>
              </span>
            )}
          </div>
          {routeError && <p className="text-sm text-[var(--danger)]">{routeError}</p>}
          {routeResult && (
            <div
              className="rounded-md border border-mid-gray/25 bg-background px-3 py-3 text-xs text-[var(--text)]"
              data-testid="route-debugger-metrics"
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-md border border-mid-gray/25 px-2 py-1">
                  <p className="text-xs uppercase text-[var(--muted)]">{t("settings.debug.routeDebugger.words")}</p>
                  <p className="text-sm font-semibold text-text">{routeResult.word_count}</p>
                </div>
                <div className="rounded-md border border-mid-gray/25 px-2 py-1">
                  <p className="text-xs uppercase text-[var(--muted)]">{t("settings.debug.routeDebugger.score")}</p>
                  <p className="text-sm font-semibold text-text">{routeResult.score}</p>
                </div>
                <div className="rounded-md border border-mid-gray/25 px-2 py-1">
                  <p className="text-xs uppercase text-[var(--muted)]">{t("settings.debug.routeDebugger.route")}</p>
                  <p className="text-sm font-semibold text-[var(--accent)]">{routeResult.route}</p>
                </div>
                <div className="rounded-md border border-mid-gray/25 px-2 py-1">
                  <p className="text-xs uppercase text-[var(--muted)]">{t("settings.debug.routeDebugger.incomplete")}</p>
                  <p className="text-sm font-semibold text-text">
                    {routeResult.looks_incomplete ? t("common.yes") : t("common.no")}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
                <p>{t("settings.debug.routeDebugger.hasCorrectionCue")} {String(routeResult.has_correction_cue)}</p>
                <p>{t("settings.debug.routeDebugger.hasListCue")} {String(routeResult.has_list_cue)}</p>
                <p>{t("settings.debug.routeDebugger.hasParagraphCue")} {String(routeResult.has_paragraph_cue)}</p>
                <p>{t("settings.debug.routeDebugger.hasTransformCue")} {String(routeResult.has_transform_cue)}</p>
                <p>{t("settings.debug.routeDebugger.hasTechnicalTokens")} {String(routeResult.has_technical_tokens)}</p>
                <p>{t("settings.debug.routeDebugger.looksIncomplete")} {String(routeResult.looks_incomplete)}</p>
              </div>
            </div>
          )}
        </div>
      </SettingsGroup>
    </div>
  );
};
