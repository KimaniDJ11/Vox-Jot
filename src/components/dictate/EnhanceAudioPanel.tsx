import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  AudioWaveform,
  FolderOpen,
  Layers,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";

import { ActionIconButton, Dropdown } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { AudioPlayer } from "@/components/ui/AudioPlayer";
import { ProviderIcon } from "@/components/ui/ProviderIcon";
import { openModelHub } from "@/components/model-hub/modelHubTabs";
import {
  getEnhanceModelMeta,
  loadEnhanceModel,
  subscribeEnhanceModel,
  type EnhanceModelId,
} from "@/lib/enhanceModels";

const AUDIO_VIDEO_EXTENSIONS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "oga",
  "opus",
  "wma",
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
  "3gp",
];

type EnhanceAudioFileResult = {
  output_path: string;
  sample_rate: number;
  duration_ms: number;
  model: string;
};

const OUTPUT_SAMPLE_RATES = [48_000, 44_100, 16_000] as const;

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function isAudioOrVideoPath(path: string): boolean {
  const lower = path.toLowerCase();
  return AUDIO_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function getDenoiseRuntimeInstalled(): Promise<boolean> {
  try {
    const status = await invoke<{ installed: boolean }>(
      "denoise_runtime_status",
    );
    return status.installed;
  } catch {
    return false;
  }
}

export const EnhanceAudioPanel: React.FC = () => {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [model, setModel] = useState<EnhanceModelId>(() => loadEnhanceModel());
  const [strength, setStrength] = useState(0.75);
  const [outputSampleRate, setOutputSampleRate] = useState<number>(48_000);
  const [isRunning, setIsRunning] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnhanceAudioFileResult | null>(null);
  const [runtimeInstalled, setRuntimeInstalled] = useState<boolean | null>(
    null,
  );

  const isRunningRef = useRef(false);
  isRunningRef.current = isRunning;

  const modelMeta = getEnhanceModelMeta(model);
  const modelName = t(modelMeta.nameKey, {
    defaultValue: modelMeta.nameDefault,
  });
  const strengthPercent = Math.round(strength * 100);

  useEffect(() => subscribeEnhanceModel(setModel), []);

  const checkRuntime = useCallback(async () => {
    setRuntimeInstalled(await getDenoiseRuntimeInstalled());
  }, []);

  useEffect(() => {
    if (model !== "deepfilternet") return;
    setRuntimeInstalled(null);
    void checkRuntime();
    const onFocus = () => void checkRuntime();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkRuntime, model]);

  const openEnhancementModels = useCallback(() => {
    void openModelHub("audio_cleanup", { scope: "audio_cleanup" });
  }, []);

  const runEnhance = useCallback(
    async (path: string) => {
      if (isRunningRef.current) return;

      if (model === "deepfilternet" && runtimeInstalled !== true) {
        const installed = await getDenoiseRuntimeInstalled();
        setRuntimeInstalled(installed);
        if (!installed) {
          setSelectedPath(path);
          setResult(null);
          setError(
            t("dictate.enhanceAudio.runtime.required", {
              defaultValue:
                "Set up DeepFilterNet in Noise removal models before enhancing with this engine.",
            }),
          );
          return;
        }
      }

      setSelectedPath(path);
      setError(null);
      setResult(null);
      setIsRunning(true);
      try {
        const enhanced = await invoke<EnhanceAudioFileResult>(
          "enhance_audio_file",
          {
            path,
            outputPath: null,
            options: {
              model,
              outputSampleRate,
              strength,
            },
          },
        );
        setResult(enhanced);
      } catch (err) {
        setError(
          typeof err === "string"
            ? err
            : t("dictate.enhanceAudio.errors.failed", {
                defaultValue: "Failed to enhance the audio.",
              }),
        );
      } finally {
        setIsRunning(false);
      }
    },
    [model, outputSampleRate, runtimeInstalled, strength, t],
  );

  const pickFile = useCallback(async () => {
    if (isRunningRef.current) return;
    const filePath = await open({
      multiple: false,
      filters: [
        {
          name: t("dictate.enhanceAudio.fileDialogLabel", {
            defaultValue: "Audio / Video",
          }),
          extensions: AUDIO_VIDEO_EXTENSIONS,
        },
      ],
    });
    if (!filePath || Array.isArray(filePath)) return;
    await runEnhance(filePath);
  }, [runEnhance, t]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const fn = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragOver(true);
        } else if (payload.type === "leave") {
          setIsDragOver(false);
        } else if (payload.type === "drop") {
          setIsDragOver(false);
          if (isRunningRef.current) return;
          const first = payload.paths?.[0];
          if (!first) return;
          if (!isAudioOrVideoPath(first)) {
            setError(
              t("dictate.enhanceAudio.errors.notMedia", {
                defaultValue: "Drop an audio or video file to enhance.",
              }),
            );
            return;
          }
          void runEnhance(first);
        }
      });
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [runEnhance, t]);

  const loadEnhancedAudio = useCallback(async () => {
    if (!result) return null;
    try {
      const data = await readFile(result.output_path);
      const blob = new Blob([data], { type: "audio/wav" });
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error("Failed to load enhanced audio:", err);
      return null;
    }
  }, [result]);

  const revealResult = useCallback(async () => {
    if (!result) return;
    try {
      await invoke("reveal_enhanced_audio", { path: result.output_path });
    } catch (err) {
      console.error("Failed to reveal enhanced audio:", err);
    }
  }, [result]);

  const reset = useCallback(() => {
    if (isRunningRef.current) return;
    setSelectedPath(null);
    setResult(null);
    setError(null);
  }, []);

  const isDeepFilterNetSelected = model === "deepfilternet";
  const isCheckingRuntime =
    isDeepFilterNetSelected && runtimeInstalled === null;
  const needsRuntimeSetup =
    isDeepFilterNetSelected && runtimeInstalled === false;

  return (
    <div className="space-y-6" aria-busy={isRunning}>
      <p className="text-sm text-[var(--muted)]">
        {t("dictate.enhanceAudio.subtitle", {
          defaultValue:
            "Remove background noise from audio or video files while preserving full-band quality.",
        })}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary-soft"
          onClick={pickFile}
          disabled={isRunning}
        >
          {t("dictate.enhanceAudio.addFile", { defaultValue: "Add file" })}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={openEnhancementModels}
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            {t("dictate.enhanceAudio.models", {
              defaultValue: "Noise removal models",
            })}
          </Button>
        </div>
      </div>

      <div className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="text-sm font-medium text-[var(--text)]">
              {t("dictate.enhanceAudio.quality.label", {
                defaultValue: "Output quality",
              })}
            </span>
            <Dropdown
              options={
                model === "deepfilternet"
                  ? [
                      {
                        value: "48000",
                        label: t("dictate.enhanceAudio.quality.fullBand", {
                          defaultValue: "48 kHz · Full band",
                        }),
                      },
                    ]
                  : OUTPUT_SAMPLE_RATES.map((rate) => ({
                      value: String(rate),
                      label:
                        rate === 48_000
                          ? t("dictate.enhanceAudio.quality.fullBand", {
                              defaultValue: "48 kHz · Full band",
                            })
                          : rate === 44_100
                            ? t("dictate.enhanceAudio.quality.cd", {
                                defaultValue: "44.1 kHz · CD",
                              })
                            : t("dictate.enhanceAudio.quality.voice", {
                                defaultValue: "16 kHz · Voice",
                              }),
                    }))
              }
              selectedValue={
                model === "deepfilternet" ? "48000" : String(outputSampleRate)
              }
              onSelect={(value) => setOutputSampleRate(Number(value))}
              disabled={model === "deepfilternet" || isRunning}
              ariaLabel={t("dictate.enhanceAudio.quality.label", {
                defaultValue: "Output quality",
              })}
            />
          </div>
          <div className="inline-flex min-w-0 items-center gap-2 self-end text-sm font-semibold text-[var(--text)] sm:self-start">
            <ProviderIcon providerId={modelMeta.providerId} size="sm" />
            <span className="truncate">{modelName}</span>
          </div>
        </div>

        {model === "spectral" ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--text)]">
              <span>
                {t("dictate.enhanceAudio.strength.label", {
                  defaultValue: "Noise reduction strength",
                })}
              </span>
              <span className="tabular-nums text-[var(--muted)]">
                {strengthPercent}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={strength}
              onChange={(event) => setStrength(Number(event.target.value))}
              aria-label={t("dictate.enhanceAudio.strength.label", {
                defaultValue: "Noise reduction strength",
              })}
              className="block h-11 w-full cursor-pointer appearance-none bg-transparent focus:outline-none"
              style={
                {
                  "--slider-bg": `linear-gradient(to right, color-mix(in srgb, var(--accent), var(--card) 52%) ${strengthPercent}%, var(--card) ${strengthPercent}%)`,
                } as React.CSSProperties
              }
            />
          </div>
        ) : null}

        {isCheckingRuntime ? (
          <div className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted,var(--bg))] px-4 py-10 text-center">
            <Loader2
              size={22}
              className="animate-spin text-[var(--accent)]"
              aria-hidden="true"
            />
            <div className="text-sm font-semibold text-[var(--text)]">
              {t("dictate.enhanceAudio.runtime.checking", {
                defaultValue: "Checking DeepFilterNet setup…",
              })}
            </div>
          </div>
        ) : needsRuntimeSetup ? (
          <div className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted,var(--bg))] px-4 py-10 text-center">
            <Sparkles
              size={22}
              className="text-[var(--accent)]"
              aria-hidden="true"
            />
            <div className="text-sm font-semibold text-[var(--text)]">
              {t("dictate.enhanceAudio.runtime.title", {
                defaultValue: "Set up DeepFilterNet",
              })}
            </div>
            <p className="max-w-sm text-[12px] leading-5 text-[var(--muted)]">
              {t("dictate.enhanceAudio.runtime.description", {
                defaultValue:
                  "A one-time download installs the neural noise removal engine (PyTorch + model). Set it up in Noise removal models, then drop a file here.",
              })}
            </p>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={openEnhancementModels}
              className="mt-1"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              {t("dictate.enhanceAudio.runtime.openHub", {
                defaultValue: "Open Noise removal models",
              })}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={pickFile}
            disabled={isRunning}
            className={[
              "flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed py-10 text-center transition-all duration-200",
              isDragOver
                ? "border-transparent bg-[var(--accent-soft)] shadow-[inset_0_0_0_2px_var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface-muted,var(--bg))] hover:border-[var(--accent)]",
              isRunning ? "cursor-not-allowed opacity-70" : "cursor-pointer",
            ].join(" ")}
          >
            {isRunning ? (
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
                <Loader2
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
                {t("dictate.enhanceAudio.working", {
                  defaultValue: "Enhancing {{name}}…",
                  name: selectedPath ? basename(selectedPath) : "",
                })}
              </div>
            ) : isDragOver ? (
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
                <Upload size={16} aria-hidden="true" />
                {t("dictate.enhanceAudio.dropRelease", {
                  defaultValue: "Release to enhance",
                })}
              </div>
            ) : (
              <>
                <AudioWaveform
                  size={22}
                  className="text-[var(--muted)]"
                  aria-hidden="true"
                />
                <div className="text-sm text-[var(--muted)]">
                  {t("dictate.enhanceAudio.dropHint", {
                    defaultValue:
                      "Drop audio or video to remove background noise",
                  })}
                </div>
                <div className="text-[11px] text-[var(--muted)]">
                  {t("dictate.enhanceAudio.orLabel", { defaultValue: "or" })}
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)]">
                  <FolderOpen size={14} aria-hidden="true" />
                  {t("dictate.enhanceAudio.pickFile", {
                    defaultValue: "Pick a file",
                  })}
                </span>
              </>
            )}
          </button>
        )}

        {error ? (
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted,var(--bg))] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
                <Sparkles
                  size={15}
                  className="text-[var(--accent)]"
                  aria-hidden="true"
                />
                {t("dictate.enhanceAudio.result.ready", {
                  defaultValue: "Enhanced audio ready",
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-[var(--input)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
                  {t("dictate.enhanceAudio.result.khz", {
                    defaultValue: "{{khz}} kHz",
                    khz: Math.round(result.sample_rate / 100) / 10,
                  })}
                </span>
                <span className="rounded-full bg-[var(--input)] px-2 py-0.5 text-[11px] font-semibold uppercase text-[var(--muted)]">
                  {result.model}
                </span>
                <span className="rounded-full bg-[var(--input)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--muted)]">
                  {formatDuration(result.duration_ms)}
                </span>
              </div>
            </div>

            <AudioPlayer
              key={result.output_path}
              onLoadRequest={loadEnhancedAudio}
              initialDuration={result.duration_ms / 1000}
              title={
                <span className="block min-w-0 truncate">
                  {basename(result.output_path)}
                </span>
              }
            />

            <div className="flex items-center gap-2">
              <ActionIconButton
                type="button"
                onClick={revealResult}
                title={t("dictate.enhanceAudio.result.reveal", {
                  defaultValue: "Show in Finder",
                })}
                aria-label={t("dictate.enhanceAudio.result.reveal", {
                  defaultValue: "Show in Finder",
                })}
              >
                <FolderOpen size={15} aria-hidden="true" />
              </ActionIconButton>
              <ActionIconButton
                type="button"
                onClick={reset}
                title={t("dictate.enhanceAudio.result.another", {
                  defaultValue: "Enhance another file",
                })}
                aria-label={t("dictate.enhanceAudio.result.another", {
                  defaultValue: "Enhance another file",
                })}
              >
                <RotateCcw size={15} aria-hidden="true" />
              </ActionIconButton>
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted)]">
                {result.output_path}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
