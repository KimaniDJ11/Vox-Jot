import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  FileAudio,
  Keyboard,
  Loader2,
  Mic,
  Square,
  WandSparkles,
} from "lucide-react";

import { commands } from "@/bindings";
import { convertVoiceRecording, convertVoiceSample } from "@/lib/voiceChanger";
import { Button } from "@/components/ui/Button";
import { AudioPlayer } from "@/components/ui/AudioPlayer";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import type { ListenSpeechState } from "../useListenSpeechState";
import { WorkflowStatusStrip } from "../sharedComponents";

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

async function audioPathToBlobUrl(path: string): Promise<string> {
  const data = await readFile(path);
  const blob = new Blob([data], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

function errorToMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

type WaitPhase = "download" | "prepare" | "finalize" | "convert" | "loadOutput";

export const VoiceChangerSection: React.FC<{
  speech: ListenSpeechState;
  showTitle?: boolean;
}> = ({ speech, showTitle = true }) => {
  const { t } = useTranslation();
  const readyProfiles = useMemo(
    () => speech.profiles.filter((profile) => profile.ready),
    [speech.profiles],
  );
  const openVoicePack = speech.packs.find((pack) => pack.id === "openvoice");
  const openVoiceModel = speech.allModels.find(
    (model) => model.provider_id === "openvoice" && model.id === "openvoice",
  );
  const openVoiceInstalled = Boolean(
    openVoicePack?.installed ||
    openVoiceModel?.installed ||
    openVoiceModel?.runnable,
  );
  const [sourcePath, setSourcePath] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [tau, setTau] = useState(0.3);
  const [isConverting, setIsConverting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [waitPhase, setWaitPhase] = useState<WaitPhase | null>(null);
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    if (
      selectedProfileId &&
      readyProfiles.some((profile) => profile.id === selectedProfileId)
    ) {
      return;
    }
    setSelectedProfileId(readyProfiles[0]?.id ?? "");
  }, [readyProfiles, selectedProfileId]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (!waitPhase || waitStartedAt === null) return;
    const updateElapsed = () => {
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - waitStartedAt) / 1000)),
      );
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [waitPhase, waitStartedAt]);

  useEffect(() => {
    return () => {
      if (outputUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(outputUrl);
      }
    };
  }, [outputUrl]);

  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        void commands.convoStopAudioCapture();
      }
    };
  }, []);

  const beginWait = useCallback((phase: WaitPhase, message: string) => {
    setWaitPhase(phase);
    setWaitStartedAt(Date.now());
    setElapsedSeconds(0);
    setStatus(message);
  }, []);

  const finishWait = useCallback(() => {
    setWaitPhase(null);
    setWaitStartedAt(null);
    setElapsedSeconds(0);
  }, []);

  const clearOutput = useCallback(() => {
    setOutputPath(null);
    setOutputUrl((current) => {
      if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
      return null;
    });
  }, []);

  const applyConversionResult = useCallback(
    async (result: Awaited<ReturnType<typeof convertVoiceSample>>) => {
      const nextUrl = await audioPathToBlobUrl(result.output_path);
      setSourcePath(result.source_path);
      setOutputPath(result.output_path);
      setOutputUrl((current) => {
        if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setStatus(
        t("listen.voiceChanger.convertedWith", {
          defaultValue: "Converted with {{profileLabel}}.",
          profileLabel: result.target_profile_label,
        }),
      );
      finishWait();
    },
    [finishWait, t],
  );

  const pickSourceAudio = useCallback(async () => {
    if (isRecording) return;
    const filePath = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "WAV audio", extensions: ["wav"] }],
    });
    if (typeof filePath !== "string") return;
    setSourcePath(filePath);
    clearOutput();
    setStatus(null);
  }, [clearOutput, isRecording]);

  const ensureOpenVoice = useCallback(async () => {
    if (openVoiceInstalled) return;
    beginWait(
      "download",
      t("listen.voiceChanger.downloadingOpenVoice", {
        defaultValue: "Preparing OpenVoice for offline voice changing.",
      }),
    );
    const result = await commands.downloadTtsPack("openvoice");
    if (result.status === "error") {
      throw new Error(result.error);
    }
    await speech.refreshAll();
    throw new Error(
      t("listen.voiceChanger.openVoiceDownloadStarted", {
        defaultValue:
          "OpenVoice download started. Try the conversion again after it finishes.",
      }),
    );
  }, [beginWait, openVoiceInstalled, speech, t]);

  const runConversion = useCallback(async () => {
    if (!sourcePath || !selectedProfileId || isConverting || isRecording)
      return;
    setIsConverting(true);
    beginWait(
      "prepare",
      t("listen.voiceChanger.preparing", {
        defaultValue: "Preparing offline voice changer.",
      }),
    );
    try {
      await ensureOpenVoice();
      beginWait(
        "convert",
        t("listen.voiceChanger.converting", {
          defaultValue: "Converting voice.",
        }),
      );
      const result = await convertVoiceSample(
        sourcePath,
        selectedProfileId,
        tau,
      );
      beginWait(
        "loadOutput",
        t("listen.voiceChanger.loadingOutput", {
          defaultValue: "Loading converted audio.",
        }),
      );
      await applyConversionResult(result);
    } catch (error) {
      finishWait();
      setStatus(
        errorToMessage(
          error,
          t("listen.voiceChanger.failed", {
            defaultValue: "Voice conversion failed.",
          }),
        ),
      );
    } finally {
      setIsConverting(false);
    }
  }, [
    applyConversionResult,
    beginWait,
    ensureOpenVoice,
    finishWait,
    isConverting,
    isRecording,
    selectedProfileId,
    sourcePath,
    t,
    tau,
  ]);

  const startMicCapture = useCallback(async () => {
    if (!selectedProfileId || isConverting || isRecording) return;
    try {
      clearOutput();
      setSourcePath("");
      setStatus(
        t("listen.voiceChanger.listening", {
          defaultValue: "Listening. Tap stop when you are done speaking.",
        }),
      );
      const result = await commands.convoStartAudioCapture();
      if (result.status === "error") {
        throw new Error(result.error);
      }
      setIsRecording(true);
    } catch (error) {
      setStatus(
        errorToMessage(
          error,
          t("listen.voiceChanger.recordingFailed", {
            defaultValue: "Could not start microphone recording.",
          }),
        ),
      );
    }
  }, [clearOutput, isConverting, isRecording, selectedProfileId, t]);

  const stopMicCaptureAndConvert = useCallback(async () => {
    if (!isRecording || isConverting) return;
    setIsRecording(false);
    setIsConverting(true);
    beginWait(
      "finalize",
      t("listen.voiceChanger.finalizingRecording", {
        defaultValue: "Finalizing microphone recording.",
      }),
    );
    try {
      const captureResult = await commands.convoStopAudioCapture();
      if (captureResult.status === "error") {
        throw new Error(captureResult.error);
      }
      if (captureResult.data.length === 0) {
        throw new Error(
          t("listen.voiceChanger.noMicAudio", {
            defaultValue: "No microphone audio was captured.",
          }),
        );
      }
      await ensureOpenVoice();
      beginWait(
        "convert",
        t("listen.voiceChanger.converting", {
          defaultValue: "Converting voice.",
        }),
      );
      const result = await convertVoiceRecording(
        captureResult.data,
        selectedProfileId,
        tau,
      );
      beginWait(
        "loadOutput",
        t("listen.voiceChanger.loadingOutput", {
          defaultValue: "Loading converted audio.",
        }),
      );
      await applyConversionResult(result);
    } catch (error) {
      finishWait();
      setStatus(
        errorToMessage(
          error,
          t("listen.voiceChanger.failed", {
            defaultValue: "Voice conversion failed.",
          }),
        ),
      );
    } finally {
      setIsConverting(false);
    }
  }, [
    applyConversionResult,
    beginWait,
    ensureOpenVoice,
    finishWait,
    isConverting,
    isRecording,
    selectedProfileId,
    t,
    tau,
  ]);

  const toggleMicCapture = useCallback(async () => {
    if (isRecording) {
      await stopMicCaptureAndConvert();
      return;
    }
    await startMicCapture();
  }, [isRecording, startMicCapture, stopMicCaptureAndConvert]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key.toLowerCase() !== "r" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target &&
        ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      ) {
        return;
      }

      event.preventDefault();
      void toggleMicCapture();
    },
    [toggleMicCapture],
  );

  const canConvert = Boolean(
    sourcePath && selectedProfileId && !isConverting && !isRecording,
  );
  const canRecord = Boolean(selectedProfileId && !isConverting);
  const waitDetail = useMemo(() => {
    if (!waitPhase) return null;
    if (waitPhase === "download") {
      return elapsedSeconds < 8
        ? t("listen.voiceChanger.wait.downloadStarting", {
            defaultValue:
              "Checking the local speech pack and installing any missing runtime pieces.",
          })
        : t("listen.voiceChanger.wait.downloadStillWorking", {
            defaultValue:
              "Still preparing OpenVoice. First setup can take a while.",
          });
    }
    if (waitPhase === "prepare") {
      return t("listen.voiceChanger.wait.prepare", {
        defaultValue:
          "Starting the offline speech runtime and checking the selected target voice.",
      });
    }
    if (waitPhase === "finalize") {
      return t("listen.voiceChanger.wait.finalize", {
        defaultValue: "Saving your microphone take as a clean WAV source.",
      });
    }
    if (waitPhase === "loadOutput") {
      return t("listen.voiceChanger.wait.loadOutput", {
        defaultValue: "Reading the converted WAV and preparing playback.",
      });
    }
    if (elapsedSeconds < 4) {
      return t("listen.voiceChanger.wait.convertWarmup", {
        defaultValue: "Loading OpenVoice and warming up the converter.",
      });
    }
    if (elapsedSeconds < 10) {
      return t("listen.voiceChanger.wait.convertExtracting", {
        defaultValue:
          "Extracting tone color from your source and target profile.",
      });
    }
    if (elapsedSeconds < 20) {
      return t("listen.voiceChanger.wait.convertMapping", {
        defaultValue: "Mapping your delivery into the selected voice.",
      });
    }
    return t("listen.voiceChanger.wait.convertStillWorking", {
      defaultValue:
        "Still working. Longer clips and first runs can take extra time.",
    });
  }, [elapsedSeconds, t, waitPhase]);
  const voiceChangerWorkflowSteps = [
    {
      id: "runtime",
      label: t("listen.voiceChanger.workflow.runtime", {
        defaultValue: "Runtime",
      }),
      detail: waitPhase
        ? (status ?? null)
        : openVoiceInstalled
          ? t("listen.voiceChanger.workflow.runtimeReady", {
              defaultValue: "OpenVoice ready",
            })
          : t("listen.voiceChanger.workflow.runtimeWillInstall", {
              defaultValue: "Installs on first convert",
            }),
      tone: waitPhase
        ? ("active" as const)
        : openVoiceInstalled
          ? ("ready" as const)
          : ("pending" as const),
    },
    {
      id: "source",
      label: t("listen.voiceChanger.workflow.source", {
        defaultValue: "Source",
      }),
      detail: sourcePath
        ? basename(sourcePath)
        : isRecording
          ? t("listen.voiceChanger.workflow.recording", {
              defaultValue: "Recording microphone",
            })
          : t("listen.voiceChanger.workflow.needsSource", {
              defaultValue: "Record mic or choose WAV",
            }),
      tone:
        sourcePath || isRecording ? ("ready" as const) : ("pending" as const),
    },
    {
      id: "target",
      label: t("listen.voiceChanger.workflow.target", {
        defaultValue: "Target profile",
      }),
      detail:
        readyProfiles.find((profile) => profile.id === selectedProfileId)
          ?.label ??
        t("listen.voiceChanger.noReadyProfiles", {
          defaultValue: "No ready profiles",
        }),
      tone: selectedProfileId ? ("ready" as const) : ("warning" as const),
    },
  ];

  const content = (
    <div
      className={`space-y-4 ${showTitle ? "px-4 py-3" : ""} outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={t("listen.voiceChanger.panelAriaLabel", {
        defaultValue: "Voice Changer controls",
      })}
    >
      {status ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 font-medium text-[var(--text)]">
                {waitPhase ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                <span>{status}</span>
              </div>
              {waitDetail ? <p>{waitDetail}</p> : null}
            </div>
            {waitPhase ? (
              <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 text-xs text-[var(--muted)]">
                {t("listen.voiceChanger.wait.elapsed", {
                  defaultValue: "{{seconds}}s",
                  seconds: elapsedSeconds,
                })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <WorkflowStatusStrip
        steps={voiceChangerWorkflowSteps}
        ariaLabel={t("listen.voiceChanger.workflow.statusAriaLabel", {
          defaultValue: "Voice Changer workflow status",
        })}
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.7fr)]">
        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text)]">
                {t("listen.voiceChanger.source", { defaultValue: "Source" })}
              </p>
              <p className="truncate text-xs text-[var(--muted)]">
                {sourcePath
                  ? basename(sourcePath)
                  : t("listen.voiceChanger.noAudioSelected", {
                      defaultValue: "No audio selected",
                    })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={isRecording ? "danger" : "primary-soft"}
                size="sm"
                onClick={() => void toggleMicCapture()}
                disabled={!canRecord && !isRecording}
                className="inline-flex items-center gap-1.5"
              >
                {isRecording ? (
                  <Square className="h-3.5 w-3.5" />
                ) : (
                  <Mic className="h-3.5 w-3.5" />
                )}
                {isRecording
                  ? t("listen.voiceChanger.stopAndConvert", {
                      defaultValue: "Stop & Convert",
                    })
                  : t("listen.voiceChanger.recordMic", {
                      defaultValue: "Record Mic",
                    })}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void pickSourceAudio()}
                disabled={isRecording || isConverting}
                className="inline-flex items-center gap-1.5"
              >
                <FileAudio className="h-3.5 w-3.5" />
                {t("listen.voiceChanger.chooseWav", {
                  defaultValue: "Choose WAV",
                })}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-xs text-[var(--muted)]">
            <Keyboard className="h-3.5 w-3.5 shrink-0" />
            <span>
              {t("listen.voiceChanger.recordShortcutHint", {
                defaultValue:
                  "Focus this panel and press R to start or stop mic capture.",
              })}
            </span>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-[var(--text)]">
              {t("listen.voiceChanger.targetProfile", {
                defaultValue: "Target profile",
              })}
            </span>
            <select
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-sm text-[var(--text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              disabled={
                readyProfiles.length === 0 || isConverting || isRecording
              }
            >
              {readyProfiles.length > 0 ? (
                readyProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))
              ) : (
                <option value="">
                  {t("listen.voiceChanger.noReadyProfiles", {
                    defaultValue: "No ready profiles",
                  })}
                </option>
              )}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-[var(--text)]">
              {t("listen.voiceChanger.toneBlend", {
                defaultValue: "Tone blend",
              })}
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={tau}
              onChange={(event) => setTau(Number(event.target.value))}
              disabled={isConverting || isRecording}
              className="w-full accent-[var(--accent)]"
            />
            <span className="block text-xs text-[var(--muted)]">
              {tau.toFixed(2)}
            </span>
          </label>

          <Button
            type="button"
            variant="primary-soft"
            onClick={() => void runConversion()}
            disabled={!canConvert}
            className="inline-flex items-center gap-1.5"
          >
            {isConverting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <WandSparkles className="h-4 w-4" />
            )}
            {t("listen.voiceChanger.convert", { defaultValue: "Convert" })}
          </Button>
        </div>

        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">
              {t("listen.voiceChanger.output", { defaultValue: "Output" })}
            </p>
            <p className="truncate text-xs text-[var(--muted)]">
              {outputPath
                ? basename(outputPath)
                : t("listen.voiceChanger.noConvertedAudio", {
                    defaultValue: "No converted audio yet",
                  })}
            </p>
          </div>
          {outputUrl ? (
            <AudioPlayer
              src={outputUrl}
              title={t("listen.voiceChanger.outputTitle", {
                defaultValue: "Voice Changer output",
              })}
              meta={outputPath ?? undefined}
              autoPlay
            />
          ) : (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] px-4 text-center text-sm text-[var(--muted)]">
              {t("listen.voiceChanger.outputPlaceholder", {
                defaultValue: "Converted audio appears here.",
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (!showTitle) {
    return content;
  }

  return (
    <SettingsGroup
      title={t("listen.voiceChanger.title", { defaultValue: "Voice Changer" })}
    >
      {content}
    </SettingsGroup>
  );
};
