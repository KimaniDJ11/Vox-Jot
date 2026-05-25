import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertCircle,
  Loader2,
  FileMusic,
  Pencil,
  Play,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Textarea } from "@/components/ui/Textarea";
import { openModelHub } from "@/components/model-hub/modelHubTabs";
import { useRefreshOnWindowFocus } from "@/hooks/useRefreshOnWindowFocus";
import { ProviderIcon } from "@/components/ui/ProviderIcon";

export type StorySoundMode =
  | "sfx"
  | "ambience"
  | "music"
  | "song"
  | "composition";

export type StoryAudioKind = "story_render" | "sound";

const allStorySoundModes: StorySoundMode[] = [
  "sfx",
  "ambience",
  "music",
  "song",
  "composition",
];
const projectSoundPreviewStartedEvent = "vox-jot:project-sound-preview-started";

interface CreativeAudioModelDescriptor {
  id: string;
  label: string;
  provider: string;
  provider_id: string;
  status_label: string;
  installed: boolean;
  runnable: boolean;
  selected: boolean;
  active: boolean;
  downloadable: boolean;
  modes: StorySoundMode[];
}

interface CreativeAudioModelCatalog {
  install_root: string;
  models: CreativeAudioModelDescriptor[];
}

export interface StorySoundItem {
  id: string;
  kind?: StoryAudioKind;
  project_id?: string | null;
  title: string;
  output_path: string;
  duration_ms: number;
  created_at_ms: number;
  sound_mode?: StorySoundMode | null;
  source_model_id?: string | null;
}

interface SoundDesignPanelProps {
  projectId: string;
  sounds: StorySoundItem[];
  onSoundsChanged: () => void;
}

type ProjectSoundGenerationStatus =
  | "queued"
  | "generating"
  | "failed"
  | "cancelled";

interface ProjectSoundGenerationJob {
  renderId: string;
  title: string;
  prompt: string;
  mode: StorySoundMode;
  durationSeconds: number;
  modelId: string;
  modelLabel: string;
  status: ProjectSoundGenerationStatus;
  queuedAtMs: number;
  startedAtMs?: number;
  error?: string;
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

export const SoundDesignPanel: React.FC<SoundDesignPanelProps> = ({
  projectId,
  sounds,
  onSoundsChanged,
}) => {
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
  const [soundJobs, setSoundJobs] = useState<ProjectSoundGenerationJob[]>([]);
  const soundJobsRef = useRef<ProjectSoundGenerationJob[]>([]);
  const soundGenerationWorkerRunningRef = useRef(false);

  const selectedModel = useMemo(() => {
    const models = catalog?.models ?? [];
    return (
      models.find((model) => model.id === selectedModelId) ??
      models.find((model) => model.active) ??
      models.find((model) => model.runnable) ??
      models[0] ??
      null
    );
  }, [catalog?.models, selectedModelId]);
  const selectedModelSupportsMode =
    selectedModel?.modes.includes(mode) ?? false;
  const modeReady = Boolean(
    selectedModel?.runnable && selectedModelSupportsMode,
  );
  const availableModes = useMemo(() => {
    return selectedModel?.modes.length
      ? selectedModel.modes
      : allStorySoundModes;
  }, [selectedModel]);
  const unsupportedModeTitle = selectedModel
    ? t("storyStudio.sound.unsupportedModeForModel", {
        defaultValue: "{{model}} does not support this sound type.",
        model: selectedModel.label,
      })
    : undefined;
  const modeItems = useMemo(
    () =>
      allStorySoundModes.map((value) => ({
        value,
        label: soundModeLabel(value, t),
        disabled: selectedModel ? !selectedModel.modes.includes(value) : false,
        title:
          selectedModel && !selectedModel.modes.includes(value)
            ? unsupportedModeTitle
            : undefined,
      })),
    [selectedModel, t, unsupportedModeTitle],
  );

  const durationBounds =
    mode === "sfx"
      ? { min: 1, max: 15 }
      : mode === "song" || mode === "composition"
        ? { min: 10, max: 600 }
        : { min: 5, max: 60 };
  const setupActionAvailable = Boolean(selectedModel?.downloadable);

  const refreshCatalog = useCallback(async (showError = true) => {
    setIsLoadingCatalog(true);
    try {
      const next = await invoke<CreativeAudioModelCatalog>(
        "get_creative_audio_model_catalog",
      );
      setCatalog(next);
      setSelectedModelId(
        (next.models.find((model) => model.active) ??
          next.models.find((model) => model.runnable) ??
          next.models[0])
          ?.id ?? "",
      );
    } catch (error) {
      console.error("Failed to load creative audio catalog:", error);
      if (showError) {
        toast.error("Could not check creative audio models.");
      }
    } finally {
      setIsLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen("creative-audio-selection-changed", () => {
        void refreshCatalog(false);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [refreshCatalog]);

  useRefreshOnWindowFocus(() => refreshCatalog(false), {
    minIntervalMs: 5000,
  });

  const applyMode = useCallback((nextMode: StorySoundMode) => {
    setMode(nextMode);
    const nextDefaults = modeDefaults[nextMode];
    setTitle(nextDefaults.title);
    setPrompt(nextDefaults.prompt);
    setDuration(nextDefaults.duration);
  }, []);

  useEffect(() => {
    if (availableModes.includes(mode)) return;
    applyMode(availableModes[0] ?? "sfx");
  }, [applyMode, availableModes, mode]);

  useEffect(() => {
    soundJobsRef.current = soundJobs;
  }, [soundJobs]);

  const startNextSoundJob = useCallback(() => {
    if (soundGenerationWorkerRunningRef.current) return;
    const nextJob = soundJobsRef.current.find((job) => job.status === "queued");
    if (!nextJob) return;

    soundGenerationWorkerRunningRef.current = true;
    const markGenerating = (
      jobs: ProjectSoundGenerationJob[],
    ): ProjectSoundGenerationJob[] =>
      jobs.map((job) =>
        job.renderId === nextJob.renderId
          ? { ...job, status: "generating", startedAtMs: Date.now() }
          : job,
      );
    soundJobsRef.current = markGenerating(soundJobsRef.current);
    setSoundJobs(markGenerating);

    void (async () => {
      try {
        await invoke<StorySoundItem>("generate_story_sound", {
          request: {
            render_id: nextJob.renderId,
            project_id: projectId,
            title: nextJob.title,
            prompt: nextJob.prompt,
            model_id: nextJob.modelId,
            mode: nextJob.mode,
            duration_seconds: nextJob.durationSeconds,
            seed: null,
          },
        });
        const removeCompleted = (jobs: ProjectSoundGenerationJob[]) =>
          jobs.filter((job) => job.renderId !== nextJob.renderId);
        soundJobsRef.current = removeCompleted(soundJobsRef.current);
        setSoundJobs(removeCompleted);
        onSoundsChanged();
        toast.success("Sound saved to this project.");
      } catch (error) {
        const message = normalizeError(error, "Could not generate sound.");
        const wasCancelled = message.toLowerCase().includes("cancelled");
        const markFinished = (
          jobs: ProjectSoundGenerationJob[],
        ): ProjectSoundGenerationJob[] =>
          jobs.map((job) =>
            job.renderId === nextJob.renderId
              ? {
                  ...job,
                  status: wasCancelled ? "cancelled" : "failed",
                  error: wasCancelled ? undefined : message,
                }
              : job,
          );
        soundJobsRef.current = markFinished(soundJobsRef.current);
        setSoundJobs(markFinished);
        if (!wasCancelled) {
          toast.error(message);
        }
      } finally {
        soundGenerationWorkerRunningRef.current = false;
        window.setTimeout(() => startNextSoundJob(), 0);
      }
    })();
  }, [onSoundsChanged, projectId]);

  useEffect(() => {
    startNextSoundJob();
  }, [soundJobs, startNextSoundJob]);

  const generate = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || !modeReady || !selectedModel) return;

    const renderId = crypto.randomUUID();
    const durationSeconds = clampDuration(
      duration,
      durationBounds.min,
      durationBounds.max,
    );
    const nextJob: ProjectSoundGenerationJob = {
      renderId,
      title: title.trim(),
      prompt: trimmedPrompt,
      mode,
      durationSeconds,
      modelId: selectedModel.id,
      modelLabel: selectedModel.label,
      status: "queued",
      queuedAtMs: Date.now(),
    };
    setSoundJobs((current) => {
      const next = [...current, nextJob];
      soundJobsRef.current = next;
      return next;
    });
    toast.message("Project sound queued.");
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

  const cancelSoundJob = useCallback(async (job: ProjectSoundGenerationJob) => {
    if (job.status === "queued") {
      const removeQueued = (jobs: ProjectSoundGenerationJob[]) =>
        jobs.filter((currentJob) => currentJob.renderId !== job.renderId);
      soundJobsRef.current = removeQueued(soundJobsRef.current);
      setSoundJobs(removeQueued);
      return;
    }
    const markCancelled = (
      jobs: ProjectSoundGenerationJob[],
    ): ProjectSoundGenerationJob[] =>
      jobs.map((currentJob) =>
        currentJob.renderId === job.renderId
          ? { ...currentJob, status: "cancelled", error: undefined }
          : currentJob,
      );
    soundJobsRef.current = markCancelled(soundJobsRef.current);
    setSoundJobs(markCancelled);
    try {
      await invoke("cancel_story_sound_generation", { renderId: job.renderId });
    } catch (error) {
      console.error("Failed to cancel sound generation:", error);
    }
  }, []);

  const dismissSoundJob = useCallback((job: ProjectSoundGenerationJob) => {
    const removeJob = (jobs: ProjectSoundGenerationJob[]) =>
      jobs.filter((currentJob) => currentJob.renderId !== job.renderId);
    soundJobsRef.current = removeJob(soundJobsRef.current);
    setSoundJobs(removeJob);
  }, []);

  const openCreativeAudioModels = useCallback(async () => {
    await openModelHub("creative_audio", { scope: "creative_audio" });
  }, []);
  const visibleSoundJobs = soundJobs;
  const totalProjectSoundCount = sounds.length + visibleSoundJobs.length;

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
        {selectedModel ? (
          <button
            type="button"
            className="inline-flex max-w-full shrink-0 items-center gap-2 px-1 py-1 text-left text-sm font-semibold text-[var(--text)] transition-colors hover:text-[var(--accent)] focus:outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            onClick={() => void openCreativeAudioModels()}
            title={`${selectedModel.provider} - ${selectedModel.label}`}
            aria-label={t("storyStudio.sound.selectedModelAriaLabel", {
              defaultValue: "Selected creative audio model: {{model}}",
              model: selectedModel.label,
            })}
          >
            <ProviderIcon providerId={selectedModel.provider_id} size="sm" />
            <span className="min-w-0 truncate">{selectedModel.label}</span>
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary-soft"
          size="sm"
          onClick={() => void generate()}
          disabled={!modeReady || !prompt.trim()}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("storyStudio.sound.generate", {
            defaultValue: "Generate Sound",
          })}
        </Button>
        <SegmentedControl<StorySoundMode>
          value={mode}
          onChange={applyMode}
          layoutId="story-studio-sound-mode"
          ariaLabel={t("storyStudio.sound.modeAriaLabel", {
            defaultValue: "Sound type",
          })}
          items={modeItems}
        />
        {!modeReady ? (
          <span className="inline-flex min-h-9 items-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-xs font-semibold text-[var(--muted)]">
            {isLoadingCatalog
              ? t("storyStudio.sound.loadingModels", {
                  defaultValue: "Loading models",
                })
              : (selectedModel?.status_label ??
                t("storyStudio.sound.needsSetup", {
                  defaultValue: "Model needed",
                }))}
          </span>
        ) : null}
      </div>

      {!modeReady ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--text)]">
            {setupActionAvailable
              ? t("storyStudio.sound.modelNeededTitle", {
                  defaultValue: "Download a creative audio model",
                })
              : t("storyStudio.sound.runtimePendingTitle", {
                  defaultValue: "Download required",
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
                    "Open Model Hub to install the app-managed runtime and model files before generating audio.",
                })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary-soft"
              size="sm"
              onClick={() => void openCreativeAudioModels()}
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

      <div className="border-t border-[var(--border)] pt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text)]">
              {t("storyStudio.sound.libraryTitle", {
                defaultValue: "Project sounds",
              })}
            </h4>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {t("storyStudio.sound.libraryDescription", {
                defaultValue:
                  "Generated sounds stay here so the script can reference them as cues.",
              })}
            </p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--muted)]">
            {totalProjectSoundCount}
          </span>
        </div>
        {visibleSoundJobs.length > 0 || sounds.length > 0 ? (
          <div className="space-y-2">
            {visibleSoundJobs.map((job) => (
              <ProjectSoundJobRow
                key={job.renderId}
                job={job}
                t={t}
                queuePosition={queuePositionForProjectSoundJob(
                  visibleSoundJobs,
                  job,
                )}
                onCancel={cancelSoundJob}
                onDismiss={dismissSoundJob}
              />
            ))}
            {sounds.map((sound) => (
              <ProjectSoundRow
                key={sound.id}
                sound={sound}
                t={t}
                onSoundsChanged={onSoundsChanged}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-4 py-6 text-center text-sm text-[var(--muted)]">
            {t("storyStudio.sound.emptyLibrary", {
              defaultValue:
                "Generate a sound to add it to this project's sound list.",
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const ProjectSoundJobRow: React.FC<{
  job: ProjectSoundGenerationJob;
  t: TFunction;
  queuePosition: number | null;
  onCancel: (job: ProjectSoundGenerationJob) => void | Promise<void>;
  onDismiss: (job: ProjectSoundGenerationJob) => void;
}> = ({ job, t, queuePosition, onCancel, onDismiss }) => {
  const isLive = job.status === "queued" || job.status === "generating";
  const isFailed = job.status === "failed";
  const isCancelled = job.status === "cancelled";
  const progress = projectSoundJobProgress(job);
  const statusLabel = projectSoundJobStatusLabel(job, queuePosition, t);

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 ${
        isFailed
          ? "border-[var(--danger)] bg-[var(--danger-soft)]"
          : "border-[var(--border)] bg-[var(--panel-bg)]"
      }`}
    >
      <div
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
          isFailed
            ? "border-[var(--danger)] text-[var(--danger)]"
            : isCancelled
              ? "border-[var(--border)] text-[var(--muted)]"
              : "border-[var(--accent)] text-[var(--accent)]"
        }`}
        aria-hidden
      >
        {isFailed ? (
          <AlertCircle className="h-4 w-4" />
        ) : isLive ? (
          <Loader2 className="h-4 w-4 animate-[spin_1s_linear_infinite]" />
        ) : (
          <X className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold text-[var(--text)]">
            {soundModeLabel(job.mode, t)} - {job.title || job.prompt}
          </p>
          <span className="ml-auto shrink-0 text-[11px] font-semibold tabular-nums text-[var(--muted)]">
            {Math.round(progress)}%
          </span>
        </div>
        <div
          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--muted),transparent_80%)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ${
              job.status === "generating" ? "animate-pulse" : ""
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p
          className={`mt-1 truncate text-xs leading-5 ${
            isFailed ? "text-[var(--danger)]" : "text-[var(--muted)]"
          }`}
        >
          <span className="font-semibold text-[var(--text)]">
            {statusLabel}
          </span>
          <span aria-hidden> · </span>
          <span>{job.modelLabel}</span>
          {job.error ? (
            <>
              <span aria-hidden> · </span>
              <span>{job.error}</span>
            </>
          ) : null}
        </p>
      </div>
      {isLive ? (
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => void onCancel(job)}
          aria-label={t("common.cancel")}
          title={t("common.cancel")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => onDismiss(job)}
          aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
          title={t("common.dismiss", { defaultValue: "Dismiss" })}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
};

const ProjectSoundRow: React.FC<{
  sound: StorySoundItem;
  t: TFunction;
  onSoundsChanged: () => void;
}> = ({ sound, t, onSoundsChanged }) => {
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackRunIdRef = useRef(0);
  const expectedStopRef = useRef(false);

  useEffect(() => {
    const stopIfDifferentSoundStarted = (event: Event) => {
      const startedSoundId = (event as CustomEvent<string>).detail;
      if (startedSoundId === sound.id) return;
      expectedStopRef.current = true;
      playbackRunIdRef.current += 1;
      setIsLoadingPreview(false);
      setIsPlaying(false);
    };
    window.addEventListener(
      projectSoundPreviewStartedEvent,
      stopIfDifferentSoundStarted,
    );
    return () => {
      window.removeEventListener(
        projectSoundPreviewStartedEvent,
        stopIfDifferentSoundStarted,
      );
    };
  }, [sound.id]);

  useEffect(() => {
    return () => {
      expectedStopRef.current = true;
      playbackRunIdRef.current += 1;
    };
  }, []);

  const togglePreview = useCallback(async () => {
    if (isLoadingPreview) return;
    if (isPlaying) {
      expectedStopRef.current = true;
      playbackRunIdRef.current += 1;
      setIsPlaying(false);
      try {
        await invoke("stop_story_audio");
      } catch (error) {
        console.error("Failed to stop project sound preview:", error);
      }
      return;
    }

    const runId = playbackRunIdRef.current + 1;
    playbackRunIdRef.current = runId;
    expectedStopRef.current = false;
    window.dispatchEvent(
      new CustomEvent(projectSoundPreviewStartedEvent, { detail: sound.id }),
    );
    setIsLoadingPreview(true);
    setIsPlaying(true);
    try {
      setIsLoadingPreview(false);
      await invoke("play_story_audio", { path: sound.output_path });
    } catch (error) {
      if (!expectedStopRef.current) {
        console.error("Failed to preview project sound:", error);
        toast.error("Could not preview sound.");
      }
    } finally {
      if (playbackRunIdRef.current === runId) {
        setIsLoadingPreview(false);
        setIsPlaying(false);
        expectedStopRef.current = false;
      }
    }
  }, [isLoadingPreview, isPlaying, sound.id, sound.output_path]);

  const rename = useCallback(async () => {
    const nextTitle = window.prompt("Rename sound", sound.title)?.trim();
    if (!nextTitle || nextTitle === sound.title) return;
    setIsBusy(true);
    try {
      await invoke("rename_story_audio", { id: sound.id, title: nextTitle });
      onSoundsChanged();
    } catch (error) {
      console.error("Failed to rename project sound:", error);
      toast.error("Could not rename sound.");
    } finally {
      setIsBusy(false);
    }
  }, [onSoundsChanged, sound.id, sound.title]);

  const remove = useCallback(async () => {
    if (!window.confirm(`Delete "${sound.title}" from this project?`)) return;
    setIsBusy(true);
    try {
      await invoke("delete_story_audio", { id: sound.id });
      onSoundsChanged();
      toast.message("Sound deleted.");
    } catch (error) {
      console.error("Failed to delete project sound:", error);
      toast.error("Could not delete sound.");
    } finally {
      setIsBusy(false);
    }
  }, [onSoundsChanged, sound.id, sound.title]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
      <button
        type="button"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        onClick={() => void togglePreview()}
        aria-label={isPlaying ? t("common.stop") : t("common.play")}
        title={isPlaying ? t("common.stop") : t("common.play")}
      >
        {isLoadingPreview ? (
          <Loader2
            className="h-4 w-4 animate-[spin_1s_linear_infinite]"
            aria-hidden
          />
        ) : isPlaying ? (
          <Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
        ) : (
          <Play className="h-4 w-4" aria-hidden />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--text)]">
          {sound.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
          <span>{soundModeLabel(sound.sound_mode ?? "sfx", t)}</span>
          <span aria-hidden>·</span>
          <span>{formatDuration(sound.duration_ms)}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void rename()}
          disabled={isBusy}
          aria-label="Rename sound"
          title="Rename sound"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void remove()}
          disabled={isBusy}
          aria-label="Delete sound"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
};

function clampDuration(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function queuePositionForProjectSoundJob(
  jobs: ProjectSoundGenerationJob[],
  job: ProjectSoundGenerationJob,
): number | null {
  if (job.status !== "queued") return null;
  const index = jobs
    .filter((current) => current.status === "queued")
    .findIndex((current) => current.renderId === job.renderId);
  return index >= 0 ? index + 1 : null;
}

function projectSoundJobProgress(job: ProjectSoundGenerationJob): number {
  if (job.status === "queued") return 8;
  if (job.status === "generating") return 55;
  if (job.status === "cancelled") return 8;
  return 12;
}

function projectSoundJobStatusLabel(
  job: ProjectSoundGenerationJob,
  queuePosition: number | null,
  t: TFunction,
): string {
  if (job.status === "queued") {
    return queuePosition && queuePosition > 1
      ? t("storyStudio.sound.queuedAtPosition", {
          defaultValue: "Queued at position {{position}}",
          position: queuePosition,
        })
      : t("storyStudio.sound.queued", { defaultValue: "Queued" });
  }
  if (job.status === "failed") {
    return t("storyStudio.sound.failed", { defaultValue: "Failed" });
  }
  if (job.status === "cancelled") {
    return t("storyStudio.sound.cancelled", { defaultValue: "Cancelled" });
  }
  return t("storyStudio.sound.generating", { defaultValue: "Generating" });
}

function soundModeLabel(mode: StorySoundMode, t: TFunction) {
  if (mode === "sfx") {
    return t("storyStudio.sound.modes.sfx", { defaultValue: "SFX" });
  }
  if (mode === "ambience") {
    return t("storyStudio.sound.modes.ambience", {
      defaultValue: "Ambience",
    });
  }
  if (mode === "music") {
    return t("storyStudio.sound.modes.music", { defaultValue: "Music" });
  }
  if (mode === "song") {
    return t("storyStudio.sound.modes.song", { defaultValue: "Song" });
  }
  return t("storyStudio.sound.modes.composition", {
    defaultValue: "Composition",
  });
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function normalizeError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
