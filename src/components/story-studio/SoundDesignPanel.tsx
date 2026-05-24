import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Loader2,
  FileMusic,
  Music2,
  RefreshCw,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Textarea } from "@/components/ui/Textarea";
import { openModelHub } from "@/components/model-hub/modelHubTabs";

type StorySoundMode = "sfx" | "ambience" | "music" | "song" | "composition";

interface CreativeAudioModelDescriptor {
  id: string;
  label: string;
  provider: string;
  status_label: string;
  installed: boolean;
  runnable: boolean;
  downloadable: boolean;
  modes: StorySoundMode[];
}

interface CreativeAudioModelCatalog {
  install_root: string;
  models: CreativeAudioModelDescriptor[];
}

interface StoryAudioItem {
  id: string;
  title: string;
  output_path: string;
}

const modeDefaults: Record<
  StorySoundMode,
  { title: string; prompt: string; duration: number }
> = {
  sfx: {
    title: "Car horn outside",
    prompt:
      "single car horn outside a rain-soaked city street, short realistic sound effect",
    duration: 5,
  },
  ambience: {
    title: "Wet neon street",
    prompt:
      "quiet rainy city ambience at night, distant traffic, soft electrical hum, cinematic but subtle",
    duration: 20,
  },
  music: {
    title: "Tense underscore",
    prompt:
      "low cinematic tension bed, minimal synth pulse, no vocals, suspenseful story underscore",
    duration: 30,
  },
  song: {
    title: "Opening theme",
    prompt:
      "full cinematic pop song for an audio story intro, clear verse and chorus structure, uplifting but restrained, vocals optional",
    duration: 90,
  },
  composition: {
    title: "Piano motif",
    prompt:
      "expressive piano sketch in A minor, sparse left hand, clear four-bar motif with room for narration",
    duration: 45,
  },
};

export const SoundDesignPanel: React.FC = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<StorySoundMode>("sfx");
  const [title, setTitle] = useState(modeDefaults.sfx.title);
  const [prompt, setPrompt] = useState(modeDefaults.sfx.prompt);
  const [duration, setDuration] = useState(modeDefaults.sfx.duration);
  const [catalog, setCatalog] = useState<CreativeAudioModelCatalog | null>(
    null,
  );
  const [selectedModelId, setSelectedModelId] = useState("");
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<StoryAudioItem | null>(
    null,
  );
  const activeRenderIdRef = useRef<string | null>(null);

  const compatibleModels = useMemo(
    () => (catalog?.models ?? []).filter((model) => model.modes.includes(mode)),
    [catalog?.models, mode],
  );
  const selectedModel = useMemo(() => {
    return (
      compatibleModels.find((model) => model.id === selectedModelId) ??
      compatibleModels.find((model) => model.runnable) ??
      compatibleModels[0] ??
      null
    );
  }, [compatibleModels, selectedModelId]);
  const modeReady = Boolean(selectedModel?.runnable);

  const durationBounds =
    mode === "sfx"
      ? { min: 1, max: 15 }
      : mode === "song" || mode === "composition"
        ? { min: 10, max: 600 }
        : { min: 5, max: 60 };
  const setupActionAvailable = Boolean(selectedModel?.downloadable);

  const refreshCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    try {
      const next = await invoke<CreativeAudioModelCatalog>(
        "get_creative_audio_model_catalog",
      );
      setCatalog(next);
      const nextCompatible = next.models.filter((model) =>
        model.modes.includes(mode),
      );
      setSelectedModelId((current) =>
        nextCompatible.some((model) => model.id === current)
          ? current
          : ((
              nextCompatible.find((model) => model.runnable) ??
              nextCompatible[0]
            )?.id ?? ""),
      );
    } catch (error) {
      console.error("Failed to load creative audio catalog:", error);
      toast.error("Could not check creative audio models.");
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [mode]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const applyMode = useCallback((nextMode: StorySoundMode) => {
    setMode(nextMode);
    const nextDefaults = modeDefaults[nextMode];
    setTitle(nextDefaults.title);
    setPrompt(nextDefaults.prompt);
    setDuration(nextDefaults.duration);
    setLastGenerated(null);
  }, []);

  const generate = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || !modeReady || !selectedModel) return;

    const renderId = crypto.randomUUID();
    activeRenderIdRef.current = renderId;
    setIsGenerating(true);
    try {
      const item = await invoke<StoryAudioItem>("generate_story_sound", {
        request: {
          render_id: renderId,
          title: title.trim(),
          prompt: trimmedPrompt,
          model_id: selectedModel.id,
          mode,
          duration_seconds: clampDuration(
            duration,
            durationBounds.min,
            durationBounds.max,
          ),
          seed: null,
        },
      });
      setLastGenerated(item);
      toast.success("Sound saved to Generated Audio.");
    } catch (error) {
      const message = normalizeError(error, "Could not generate sound.");
      if (!message.toLowerCase().includes("cancelled")) {
        toast.error(message);
      }
    } finally {
      activeRenderIdRef.current = null;
      setIsGenerating(false);
    }
  }, [
    duration,
    durationBounds.max,
    durationBounds.min,
    mode,
    modeReady,
    prompt,
    selectedModel,
    title,
  ]);

  const cancel = useCallback(async () => {
    const renderId = activeRenderIdRef.current;
    if (!renderId) return;
    try {
      await invoke("cancel_story_sound_generation", { renderId });
    } catch (error) {
      console.error("Failed to cancel sound generation:", error);
    }
  }, []);

  const openCreativeAudioModels = useCallback(async () => {
    await openModelHub("creative_audio");
  }, []);

  const openGeneratedAudio = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("vox-jot:navigate", {
        detail: { view: "listen", section: "story-audio-history" },
      }),
    );
  }, []);

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-[var(--accent)]" aria-hidden />
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {t("storyStudio.sound.title", { defaultValue: "Sound Design" })}
            </h3>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {t("storyStudio.sound.description", {
              defaultValue:
                "Generate local sound effects, ambience, and music beds for scripts and stories.",
            })}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void refreshCatalog()}
          disabled={isLoadingCatalog || isGenerating}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("common.refresh")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<StorySoundMode>
          value={mode}
          onChange={applyMode}
          layoutId="story-studio-sound-mode"
          ariaLabel={t("storyStudio.sound.modeAriaLabel", {
            defaultValue: "Sound type",
          })}
          items={[
            {
              value: "sfx",
              label: t("storyStudio.sound.modes.sfx", { defaultValue: "SFX" }),
            },
            {
              value: "ambience",
              label: t("storyStudio.sound.modes.ambience", {
                defaultValue: "Ambience",
              }),
            },
            {
              value: "music",
              label: t("storyStudio.sound.modes.music", {
                defaultValue: "Music",
              }),
            },
            {
              value: "song",
              label: t("storyStudio.sound.modes.song", {
                defaultValue: "Song",
              }),
            },
            {
              value: "composition",
              label: t("storyStudio.sound.modes.composition", {
                defaultValue: "Composition",
              }),
            },
          ]}
        />
        <span
          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${
            modeReady
              ? "border-[color-mix(in_srgb,var(--success),transparent_70%)] bg-[var(--success-soft)] text-[var(--text)]"
              : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--muted)]"
          }`}
        >
          {isLoadingCatalog
            ? t("storyStudio.sound.loadingModels", {
                defaultValue: "Loading models",
              })
            : modeReady
              ? t("storyStudio.sound.ready", { defaultValue: "Ready" })
              : (selectedModel?.status_label ??
                t("storyStudio.sound.needsSetup", {
                  defaultValue: "Model needed",
                }))}
        </span>
      </div>

      <label className="block text-sm font-medium text-[var(--text)]">
        {t("storyStudio.sound.model", { defaultValue: "Model" })}
        <span className="relative mt-1 block">
          <select
            value={selectedModel?.id ?? ""}
            onChange={(event) => setSelectedModelId(event.target.value)}
            disabled={compatibleModels.length === 0 || isGenerating}
            className="h-10 w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 pe-9 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            {compatibleModels.length > 0 ? (
              compatibleModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                  {model.runnable ? "" : ` (${model.status_label})`}
                </option>
              ))
            ) : (
              <option value="">
                {t("storyStudio.sound.noCompatibleModels", {
                  defaultValue: "No compatible models",
                })}
              </option>
            )}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
            aria-hidden
          />
        </span>
      </label>

      {!modeReady ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--text)]">
            {setupActionAvailable
              ? t("storyStudio.sound.modelNeededTitle", {
                  defaultValue: "Download a creative audio model",
                })
              : t("storyStudio.sound.runtimePendingTitle", {
                  defaultValue: "Runtime pending",
                })}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {setupActionAvailable
              ? t("storyStudio.sound.modelNeededDescription", {
                  defaultValue:
                    "Creative audio models are managed in Model Hub so large downloads have a central progress and cleanup flow.",
                })
              : t("storyStudio.sound.runtimePendingDescription", {
                  defaultValue:
                    "This engine is tracked for Studio, but its app-managed runtime is not available in Vox Jot yet.",
                })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary-soft"
              size="sm"
              onClick={() => void openCreativeAudioModels()}
              disabled={isGenerating}
            >
              {setupActionAvailable ? (
                <Sparkles className="h-3.5 w-3.5" />
              ) : (
                <FileMusic className="h-3.5 w-3.5" />
              )}
              {t("storyStudio.sound.openModelHub", {
                defaultValue: "Open Creative Audio Models",
              })}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[1fr_9rem]">
        <label className="block text-sm font-medium text-[var(--text)]">
          {t("storyStudio.sound.soundTitle", { defaultValue: "Sound title" })}
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border-[var(--border)] bg-[var(--input)] text-[var(--text)]"
          />
        </label>
        <label className="block text-sm font-medium text-[var(--text)]">
          {t("storyStudio.sound.duration", { defaultValue: "Seconds" })}
          <input
            type="number"
            min={durationBounds.min}
            max={durationBounds.max}
            step={1}
            value={duration}
            onChange={(event) =>
              setDuration(
                clampDuration(
                  Number.parseInt(event.target.value, 10) || durationBounds.min,
                  durationBounds.min,
                  durationBounds.max,
                ),
              )
            }
            className="mt-1 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>

      <label className="block text-sm font-medium text-[var(--text)]">
        {mode === "song"
          ? t("storyStudio.sound.songPrompt", {
              defaultValue: "Prompt / lyrics",
            })
          : mode === "composition"
            ? t("storyStudio.sound.compositionPrompt", {
                defaultValue: "Prompt / structure",
              })
            : t("storyStudio.sound.prompt", { defaultValue: "Prompt" })}
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="mt-1 min-h-[108px] !rounded-xl text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs leading-5 text-[var(--muted)]">
          <span aria-live="polite">
            {selectedModel
              ? `${selectedModel.provider} - ${selectedModel.label} - ${selectedModel.status_label}`
              : t("storyStudio.sound.noModelSelected", {
                  defaultValue: "No model selected",
                })}
          </span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {lastGenerated ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={openGeneratedAudio}
            >
              <Music2 className="h-3.5 w-3.5" />
              {t("storyStudio.sound.openGenerated", {
                defaultValue: "Open Generated Audio",
              })}
            </Button>
          ) : null}
          {isGenerating ? (
            <Button
              type="button"
              variant="danger-ghost"
              size="sm"
              onClick={() => void cancel()}
            >
              <X className="h-3.5 w-3.5" />
              {t("common.cancel")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary-soft"
            size="sm"
            onClick={() => void generate()}
            disabled={!modeReady || !prompt.trim() || isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-[spin_1s_linear_infinite]" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {isGenerating
              ? t("storyStudio.sound.generating", {
                  defaultValue: "Generating",
                })
              : t("storyStudio.sound.generate", {
                  defaultValue: "Generate Sound",
                })}
          </Button>
        </div>
      </div>
    </div>
  );
};

function clampDuration(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function normalizeError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
