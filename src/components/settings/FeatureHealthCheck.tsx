import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Clipboard,
  Info,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { commands } from "@/bindings";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import {
  formatFeatureHealthReport,
  summarizeFeatureHealth,
  type FeatureHealthCheck,
  type FeatureHealthStatus,
} from "@/lib/featureHealth";

type ProbeResult = {
  status: FeatureHealthStatus;
  detail: string;
  error?: string;
};

type ProbeDefinition = {
  id: string;
  label: string;
  run: () => Promise<ProbeResult>;
};

type CommandResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

const ok = (detail: string): ProbeResult => ({ status: "ok", detail });
const warning = (detail: string): ProbeResult => ({
  status: "warning",
  detail,
});

function commandResult<T>(
  result: CommandResult<T>,
  failedDetail: string,
  detail: (data: T) => ProbeResult,
): ProbeResult {
  if (result.status === "error") {
    return {
      status: "error",
      detail: failedDetail,
      error: result.error,
    };
  }
  return detail(result.data);
}

async function runProbe(
  probe: ProbeDefinition,
  unexpectedDetail: string,
): Promise<FeatureHealthCheck> {
  const started = performance.now();
  try {
    const result = await probe.run();
    return {
      id: probe.id,
      label: probe.label,
      elapsedMs: Math.round(performance.now() - started),
      ...result,
    };
  } catch (error) {
    return {
      id: probe.id,
      label: probe.label,
      status: "error",
      detail: unexpectedDetail,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Math.round(performance.now() - started),
    };
  }
}

export const FeatureHealthCheckPanel: React.FC = () => {
  const { t } = useTranslation();
  const [checks, setChecks] = useState<FeatureHealthCheck[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const commandFailed = t(
    "settings.diagnostics.featureHealth.details.commandFailed",
  );

  const probes = useMemo<ProbeDefinition[]>(
    () => [
      {
        id: "settings",
        label: t("settings.diagnostics.featureHealth.features.settings"),
        run: async () =>
          commandResult(await commands.getAppSettings(), commandFailed, () =>
            ok(t("settings.diagnostics.featureHealth.details.settings")),
          ),
      },
      {
        id: "app_directories",
        label: t("settings.diagnostics.featureHealth.features.appDirectories"),
        run: async () => {
          const appDir = await commands.getAppDirPath();
          if (appDir.status === "error") {
            return {
              status: "error",
              detail: t(
                "settings.diagnostics.featureHealth.details.appDirectoryFailed",
              ),
              error: appDir.error,
            };
          }
          const logDir = await commands.getLogDirPath();
          if (logDir.status === "error") {
            return {
              status: "error",
              detail: t(
                "settings.diagnostics.featureHealth.details.logDirectoryFailed",
              ),
              error: logDir.error,
            };
          }
          return ok(
            t("settings.diagnostics.featureHealth.details.appDirectories"),
          );
        },
      },
      {
        id: "microphones",
        label: t("settings.diagnostics.featureHealth.features.microphones"),
        run: async () =>
          commandResult(
            await commands.getAvailableMicrophones(),
            commandFailed,
            (devices) =>
              devices.length > 0
                ? ok(
                    t(
                      "settings.diagnostics.featureHealth.details.microphones",
                      {
                        count: devices.length,
                      },
                    ),
                  )
                : warning(
                    t(
                      "settings.diagnostics.featureHealth.details.noMicrophones",
                    ),
                  ),
          ),
      },
      {
        id: "output_devices",
        label: t("settings.diagnostics.featureHealth.features.outputDevices"),
        run: async () =>
          commandResult(
            await commands.getAvailableOutputDevices(),
            commandFailed,
            (devices) =>
              devices.length > 0
                ? ok(
                    t(
                      "settings.diagnostics.featureHealth.details.outputDevices",
                      {
                        count: devices.length,
                      },
                    ),
                  )
                : warning(
                    t(
                      "settings.diagnostics.featureHealth.details.noOutputDevices",
                    ),
                  ),
          ),
      },
      {
        id: "dictation_model",
        label: t("settings.diagnostics.featureHealth.features.dictationModel"),
        run: async () =>
          commandResult(
            await commands.getTranscriptionModelStatus(),
            commandFailed,
            (model) =>
              model
                ? ok(
                    t(
                      "settings.diagnostics.featureHealth.details.dictationModel",
                      {
                        model,
                      },
                    ),
                  )
                : warning(
                    t(
                      "settings.diagnostics.featureHealth.details.noDictationModel",
                    ),
                  ),
          ),
      },
      {
        id: "model_catalogs",
        label: t("settings.diagnostics.featureHealth.features.modelCatalogs"),
        run: async () =>
          commandResult(
            await commands.getModelPlatformOverview(),
            commandFailed,
            (overview) =>
              ok(
                t("settings.diagnostics.featureHealth.details.modelCatalogs", {
                  stt: overview.stt.models.length,
                  llm: overview.llm.models.length,
                  tts: overview.tts.models.length,
                }),
              ),
          ),
      },
      {
        id: "refine_models",
        label: t("settings.diagnostics.featureHealth.features.refineModels"),
        run: async () =>
          commandResult(
            await commands.getRefineModelCatalog(),
            commandFailed,
            (catalog) =>
              ok(
                t("settings.diagnostics.featureHealth.details.refineModels", {
                  count: catalog.providers.length,
                }),
              ),
          ),
      },
      {
        id: "screen_ocr_models",
        label: t("settings.diagnostics.featureHealth.features.screenOcr"),
        run: async () =>
          commandResult(
            await commands.getOcrModelCatalog(),
            commandFailed,
            (catalog) =>
              ok(
                t("settings.diagnostics.featureHealth.details.screenOcr", {
                  count: catalog.models.length,
                }),
              ),
          ),
      },
      {
        id: "speech_analysis",
        label: t("settings.diagnostics.featureHealth.features.speechAnalysis"),
        run: async () =>
          commandResult(
            await commands.getSpeechAnalysisCatalog(),
            commandFailed,
            (catalog) =>
              ok(
                t("settings.diagnostics.featureHealth.details.speechAnalysis", {
                  count: catalog.models.length,
                }),
              ),
          ),
      },
      {
        id: "tts_voices",
        label: t("settings.diagnostics.featureHealth.features.ttsVoices"),
        run: async () =>
          commandResult(
            await commands.getAvailableTtsVoices(),
            commandFailed,
            (voices) =>
              voices.length > 0
                ? ok(
                    t("settings.diagnostics.featureHealth.details.ttsVoices", {
                      count: voices.length,
                    }),
                  )
                : warning(
                    t("settings.diagnostics.featureHealth.details.noTtsVoices"),
                  ),
          ),
      },
      {
        id: "tts_profiles",
        label: t("settings.diagnostics.featureHealth.features.ttsProfiles"),
        run: async () =>
          commandResult(
            await commands.listTtsVoiceProfiles(),
            commandFailed,
            (profiles) =>
              ok(
                t("settings.diagnostics.featureHealth.details.ttsProfiles", {
                  count: profiles.length,
                }),
              ),
          ),
      },
      {
        id: "history",
        label: t("settings.diagnostics.featureHealth.features.history"),
        run: async () =>
          commandResult(
            await commands.getHistoryEntriesPage(0, 1),
            commandFailed,
            (page) =>
              ok(
                t("settings.diagnostics.featureHealth.details.history", {
                  count: page.total,
                }),
              ),
          ),
      },
      {
        id: "write_rules",
        label: t("settings.diagnostics.featureHealth.features.writeRules"),
        run: async () =>
          commandResult(
            await commands.listWriteRules(),
            commandFailed,
            (rules) =>
              ok(
                t("settings.diagnostics.featureHealth.details.writeRules", {
                  count: rules.length,
                }),
              ),
          ),
      },
      {
        id: "story_studio",
        label: t("settings.diagnostics.featureHealth.features.storyStudio"),
        run: async () => {
          const jobs = await commands.listStoryRenderJobs();
          if (jobs.status === "error") {
            return {
              status: "error",
              detail: t(
                "settings.diagnostics.featureHealth.details.storyJobsFailed",
              ),
              error: jobs.error,
            };
          }
          const audio = await commands.listStoryAudio();
          if (audio.status === "error") {
            return {
              status: "error",
              detail: t(
                "settings.diagnostics.featureHealth.details.storyAudioFailed",
              ),
              error: audio.error,
            };
          }
          return ok(
            t("settings.diagnostics.featureHealth.details.storyStudio", {
              jobs: jobs.data.length,
              audio: audio.data.length,
            }),
          );
        },
      },
      {
        id: "local_api",
        label: t("settings.diagnostics.featureHealth.features.localApi"),
        run: async () =>
          commandResult(
            await commands.getHttpApiStatus(),
            commandFailed,
            (status) =>
              status.token_available
                ? ok(
                    t("settings.diagnostics.featureHealth.details.localApi", {
                      port: status.port,
                    }),
                  )
                : warning(
                    t(
                      "settings.diagnostics.featureHealth.details.localApiNoToken",
                    ),
                  ),
          ),
      },
      {
        id: "installed_apps",
        label: t("settings.diagnostics.featureHealth.features.installedApps"),
        run: async () =>
          commandResult(
            await commands.listInstalledApps(),
            commandFailed,
            (apps) =>
              apps.length > 0
                ? ok(
                    t(
                      "settings.diagnostics.featureHealth.details.installedApps",
                      {
                        count: apps.length,
                      },
                    ),
                  )
                : warning(
                    t(
                      "settings.diagnostics.featureHealth.details.noInstalledApps",
                    ),
                  ),
          ),
      },
    ],
    [commandFailed, t],
  );

  const summary = summarizeFeatureHealth(checks);

  const runChecks = async () => {
    setRunning(true);
    setCopied(false);
    const results = await Promise.all(
      probes.map((probe) =>
        runProbe(
          probe,
          t("settings.diagnostics.featureHealth.details.unexpectedFailure"),
        ),
      ),
    );
    setChecks(results);
    setLastRunAt(new Date());
    setRunning(false);
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(formatFeatureHealthReport(checks));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const overallLabel =
    summary.overall === "healthy"
      ? t("settings.diagnostics.featureHealth.overall.healthy")
      : summary.overall === "warning"
        ? t("settings.diagnostics.featureHealth.overall.warning")
        : t("settings.diagnostics.featureHealth.overall.error");

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--text)]">
            {t("settings.diagnostics.featureHealth.title")}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {t("settings.diagnostics.featureHealth.description")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void runChecks()} disabled={running}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
            {running
              ? t("settings.diagnostics.featureHealth.running")
              : t("settings.diagnostics.featureHealth.run")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void copyReport()}
            disabled={checks.length === 0}
          >
            <Clipboard className="mr-1 h-3.5 w-3.5" aria-hidden />
            {copied
              ? t("settings.diagnostics.featureHealth.copied")
              : t("settings.diagnostics.featureHealth.copy")}
          </Button>
        </div>
      </div>

      {checks.length > 0 ? (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--ring-hairline)] bg-[var(--card)] px-3 py-2">
              <div className="text-[11px] text-[var(--muted)]">
                {t("settings.diagnostics.featureHealth.summary.overall")}
              </div>
              <div className="text-sm font-semibold text-[var(--text)]">
                {overallLabel}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--ring-hairline)] bg-[var(--card)] px-3 py-2">
              <div className="text-[11px] text-[var(--muted)]">
                {t("settings.diagnostics.featureHealth.summary.ok")}
              </div>
              <div className="text-sm font-semibold text-[var(--success)]">
                {summary.ok}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--ring-hairline)] bg-[var(--card)] px-3 py-2">
              <div className="text-[11px] text-[var(--muted)]">
                {t("settings.diagnostics.featureHealth.summary.warnings")}
              </div>
              <div className="text-sm font-semibold text-[var(--warning)]">
                {summary.warnings}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--ring-hairline)] bg-[var(--card)] px-3 py-2">
              <div className="text-[11px] text-[var(--muted)]">
                {t("settings.diagnostics.featureHealth.summary.errors")}
              </div>
              <div className="text-sm font-semibold text-[var(--danger)]">
                {summary.errors}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {checks.map((check) => {
              const Icon =
                check.status === "ok"
                  ? CheckCircle2
                  : check.status === "warning"
                    ? Info
                    : XCircle;
              const iconClass =
                check.status === "ok"
                  ? "text-[var(--success)]"
                  : check.status === "warning"
                    ? "text-[var(--warning)]"
                    : "text-[var(--danger)]";

              return (
                <div
                  key={check.id}
                  className="rounded-lg border border-[var(--ring-hairline)] bg-[var(--card)] px-3 py-2"
                >
                  <div className="flex items-start gap-2">
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[12px] font-semibold text-[var(--text)]">
                          {check.label}
                        </span>
                        <span className="font-mono-token text-[11px] text-[var(--muted)]">
                          {t("settings.diagnostics.featureHealth.elapsedMs", {
                            ms: check.elapsedMs,
                          })}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">
                        {check.detail}
                      </p>
                      {check.error ? (
                        <p className="mt-1 break-words font-mono-token text-[11px] leading-4 text-[var(--danger)]">
                          {check.error}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {lastRunAt ? (
            <p className="text-[11px] text-[var(--muted)]">
              {t("settings.diagnostics.featureHealth.lastRun", {
                time: lastRunAt.toLocaleString(),
              })}
            </p>
          ) : null}
        </>
      ) : (
        <Alert variant="info">
          {t("settings.diagnostics.featureHealth.empty")}
        </Alert>
      )}
    </div>
  );
};
