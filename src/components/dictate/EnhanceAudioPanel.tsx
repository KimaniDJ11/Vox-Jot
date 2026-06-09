import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  AudioWaveform,
  FolderOpen,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";

import { ActionIconButton, SegmentedControl } from "@/components/ui";
import { AudioPlayer } from "@/components/ui/AudioPlayer";

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

type EnhanceModel = "rnnoise" | "spectral" | "deepfilternet";

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

export const EnhanceAudioPanel: React.FC = () => {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [model, setModel] = useState<EnhanceModel>("rnnoise");
  const [strength, setStrength] = useState(0.75);
  const [outputSampleRate, setOutputSampleRate] = useState<number>(48_000);
  const [isRunning, setIsRunning] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnhanceAudioFileResult | null>(null);
  // DeepFilterNet runs through a Python sidecar installed on demand.
  const [runtimeInstalled, setRuntimeInstalled] = useState<boolean | null>(
    null,
  );
  const [isPreparingRuntime, setIsPreparingRuntime] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const isRunningRef = useRef(false);
  isRunningRef.current = isRunning;

  const runEnhance = useCallback(
    async (path: string) => {
      if (isRunningRef.current) return;
      if (model === "deepfilternet" && runtimeInstalled !== true) {
        setSelectedPath(path);
        setResult(null);
        setError(
          t("dictate.enhanceAudio.runtime.required", {
            defaultValue:
              "Set up DeepFilterNet before enhancing with this engine.",
          }),
        );
        return;
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

  // Check whether the DeepFilterNet runtime is installed the first time the
  // engine is selected.
  useEffect(() => {
    if (model !== "deepfilternet" || runtimeInstalled !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await invoke<{ installed: boolean }>(
          "denoise_runtime_status",
        );
        if (!cancelled) setRuntimeInstalled(status.installed);
      } catch {
        if (!cancelled) setRuntimeInstalled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model, runtimeInstalled]);

  const prepareRuntime = useCallback(async () => {
    if (isPreparingRuntime) return;
    setIsPreparingRuntime(true);
    setRuntimeError(null);
    try {
      await invoke("prepare_denoise_runtime");
      setRuntimeInstalled(true);
    } catch (err) {
      setRuntimeError(
        typeof err === "string"
          ? err
          : t("dictate.enhanceAudio.runtime.failed", {
              defaultValue: "Failed to set up the DeepFilterNet runtime.",
            }),
      );
      setRuntimeInstalled(false);
    } finally {
      setIsPreparingRuntime(false);
    }
  }, [isPreparingRuntime, t]);

  const isDeepFilterNetSelected = model === "deepfilternet";
  const isCheckingRuntime =
    isDeepFilterNetSelected && runtimeInstalled === null;
  const needsRuntimeSetup =
    isDeepFilterNetSelected && runtimeInstalled === false;

  const engineHint = useMemo(() => {
    if (model === "deepfilternet") {
      return t("dictate.enhanceAudio.engine.deepfilternetHint", {
        defaultValue:
          "DeepFilterNet — state-of-the-art neural denoiser, full-band 48 kHz. First use downloads a one-time runtime.",
      });
    }
    if (model === "spectral") {
      return t("dictate.enhanceAudio.engine.spectralHint", {
        defaultValue:
          "Spectral subtraction — adjustable strength, best for steady hiss, hum, and fan noise.",
      });
    }
    return t("dictate.enhanceAudio.engine.rnnoiseHint", {
      defaultValue:
        "RNNoise — a voice-tuned neural denoiser. Great default for speech.",
    });
  }, [model, t]);

  const strengthPercent = Math.round(strength * 100);

  return (
    <div className="space-y-6" aria-busy={isRunning}>
      <p className="text-sm text-[var(--muted)]">
        {t("dictate.enhanceAudio.subtitle", {
          defaultValue:
            "Remove background noise from any audio or video and keep a full-band, high-quality file.",
        })}
      </p>

      <div className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)]">
        {/* Engine + output controls */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <div className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
              {t("dictate.enhanceAudio.engine.label", {
                defaultValue: "Engine",
              })}
            </div>
            <SegmentedControl<EnhanceModel>
              value={model}
              onChange={setModel}
              ariaLabel={t("dictate.enhanceAudio.engine.label", {
                defaultValue: "Engine",
              })}
              items={[
                {
                  value: "rnnoise",
                  label: t("dictate.enhanceAudio.engine.rnnoise", {
                    defaultValue: "RNNoise",
                  }),
                },
                {
                  value: "spectral",
                  label: t("dictate.enhanceAudio.engine.spectral", {
                    defaultValue: "Spectral",
                  }),
                },
                {
                  value: "deepfilternet",
                  label: t("dictate.enhanceAudio.engine.deepfilternet", {
                    defaultValue: "DeepFilterNet",
                  }),
                },
              ]}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="enhance-output-rate"
              className="block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]"
            >
              {t("dictate.enhanceAudio.quality.label", {
                defaultValue: "Output quality",
              })}
            </label>
            {model === "deepfilternet" ? (
              <div className="flex h-9 items-center rounded-full border border-[var(--border)] bg-[var(--input)] px-3 text-sm font-medium text-[var(--muted)]">
                {t("dictate.enhanceAudio.quality.fullBand", {
                  defaultValue: "48 kHz · Full band",
                })}
              </div>
            ) : (
              <select
                id="enhance-output-rate"
                value={String(outputSampleRate)}
                onChange={(event) =>
                  setOutputSampleRate(Number(event.target.value))
                }
                className="h-9 rounded-full border border-[var(--border)] bg-[var(--input)] px-3 text-sm font-medium text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--accent-glow)]"
              >
                {OUTPUT_SAMPLE_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate === 48_000
                      ? t("dictate.enhanceAudio.quality.fullBand", {
                          defaultValue: "48 kHz · Full band",
                        })
                      : rate === 44_100
                        ? t("dictate.enhanceAudio.quality.cd", {
                            defaultValue: "44.1 kHz · CD",
                          })
                        : t("dictate.enhanceAudio.quality.voice", {
                            defaultValue: "16 kHz · Voice",
                          })}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <p className="text-[12px] leading-5 text-[var(--muted)]">
          {engineHint}
        </p>

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

        {/* One-time DeepFilterNet runtime setup */}
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
            <p className="max-w-sm text-[12px] leading-5 text-[var(--muted)]">
              {t("dictate.enhanceAudio.runtime.checkingDescription", {
                defaultValue:
                  "This engine needs the app-managed neural denoiser runtime before it can process files.",
              })}
            </p>
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
                  "A one-time download installs the neural denoiser (PyTorch + model). It can take a few minutes and needs an internet connection.",
              })}
            </p>
            <button
              type="button"
              onClick={prepareRuntime}
              disabled={isPreparingRuntime}
              className="mt-1 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPreparingRuntime ? (
                <>
                  <Loader2
                    size={15}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                  {t("dictate.enhanceAudio.runtime.installing", {
                    defaultValue: "Setting up… (one-time)",
                  })}
                </>
              ) : (
                t("dictate.enhanceAudio.runtime.install", {
                  defaultValue: "Set up DeepFilterNet",
                })
              )}
            </button>
            {runtimeError ? (
              <p className="max-w-sm text-[12px] leading-5 text-[var(--danger)]">
                {runtimeError}
              </p>
            ) : null}
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

        {/* Result */}
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
