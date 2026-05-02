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
import { AlertCircle, CheckCircle2, RefreshCw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  listTtsVoicePresets,
  type TtsVoicePreset,
} from "@/lib/ttsVoicePresets";
import { commands } from "@/bindings";
import { CastBuilder } from "./CastBuilder";
import { RenderControls } from "./RenderControls";
import { ScriptEditor } from "./ScriptEditor";
import { validateStoryDraft, type StoryCastMemberDraft } from "./storyScript";

interface StoryRenderProgress {
  render_id: string;
  current_line: number;
  total_lines: number;
  speaker: string | null;
  status: string;
}

interface StoryRenderResult {
  render_id: string;
  output_path: string;
  duration_ms: number;
  line_count: number;
}

interface StoryRenderRequest {
  render_id: string;
  title: string;
  cast: Array<{ character_name: string; preset_id: string }>;
  script_text: string;
  pause_ms_between_lines: number;
}

const defaultScript =
  "Narrator: The city lights flickered awake.\nHero: I know that voice.\nGuide: Then follow it.";
const emptyVoicesTitle = "Save a voice before building a story";
const emptyVoicesDescription =
  "Story Studio uses Listen/My Voices presets as the cast. Create or save at least one voice preset, then come back here to assign characters.";
const openMyVoicesLabel = "Open My Voices";
const refreshLabel = "Refresh";
const storyTitleLabel = "Story title";
const scriptLinesLabel = "Script lines";
const fixBeforeRenderingLabel = "Fix before rendering";

export const StoryStudioSection: React.FC = () => {
  const [presets, setPresets] = useState<TtsVoicePreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [title, setTitle] = useState("Untitled Story");
  const [cast, setCast] = useState<StoryCastMemberDraft[]>([]);
  const [scriptText, setScriptText] = useState(defaultScript);
  const [pauseMs, setPauseMs] = useState(500);
  const [isRendering, setIsRendering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState<StoryRenderProgress | null>(null);
  const [lastResult, setLastResult] = useState<StoryRenderResult | null>(null);
  const activeRenderIdRef = useRef<string | null>(null);
  const activePlaybackIdRef = useRef<string | null>(null);

  const refreshPresets = useCallback(async () => {
    setIsLoadingPresets(true);
    try {
      const nextPresets = await listTtsVoicePresets();
      setPresets(nextPresets);
      setCast((currentCast) =>
        reconcileCastWithPresets(currentCast, nextPresets),
      );
    } catch (error) {
      console.error("Failed to load voice presets:", error);
      toast.error("Could not load saved voice presets.");
    } finally {
      setIsLoadingPresets(false);
    }
  }, []);

  useEffect(() => {
    void refreshPresets();
  }, [refreshPresets]);

  useEffect(() => {
    const unlisten = listen<StoryRenderProgress>(
      "story-render-progress",
      (event) => {
        if (event.payload.render_id === activeRenderIdRef.current) {
          setProgress(event.payload);
        }
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const validation = useMemo(
    () => validateStoryDraft(cast, scriptText, presets),
    [cast, presets, scriptText],
  );
  const canRender =
    !isLoadingPresets &&
    !isRendering &&
    !isPlaying &&
    presets.length > 0 &&
    validation.errors.length === 0;

  const addCharacter = useCallback(() => {
    setCast((currentCast) => [
      ...currentCast,
      {
        id: crypto.randomUUID(),
        characterName: nextCharacterName(currentCast.length),
        presetId: presets[0]?.id ?? "",
      },
    ]);
  }, [presets]);

  const updateCharacter = useCallback(
    (id: string, patch: Partial<StoryCastMemberDraft>) => {
      setCast((currentCast) =>
        currentCast.map((member) =>
          member.id === id ? { ...member, ...patch } : member,
        ),
      );
    },
    [],
  );

  const removeCharacter = useCallback((id: string) => {
    setCast((currentCast) => currentCast.filter((member) => member.id !== id));
  }, []);

  const handleRender = useCallback(async () => {
    if (!canRender) {
      return;
    }
    const renderId = crypto.randomUUID();
    activeRenderIdRef.current = renderId;
    setIsRendering(true);
    setProgress({
      render_id: renderId,
      current_line: 0,
      total_lines: validation.lines.length,
      speaker: null,
      status: "queued",
    });

    const request: StoryRenderRequest = {
      render_id: renderId,
      title,
      cast: cast.map((member) => ({
        character_name: member.characterName.trim(),
        preset_id: member.presetId,
      })),
      script_text: scriptText,
      pause_ms_between_lines: pauseMs,
    };

    try {
      const result = await invoke<StoryRenderResult>("render_story_audio", {
        request,
      });
      setLastResult(result);
      toast.success("Story audio rendered.");
    } catch (error) {
      const message = normalizeError(error, "Story render failed.");
      if (!message.toLocaleLowerCase().includes("cancelled")) {
        toast.error(message);
      }
    } finally {
      activeRenderIdRef.current = null;
      setIsRendering(false);
    }
  }, [canRender, cast, pauseMs, scriptText, title, validation.lines.length]);

  const handleCancel = useCallback(async () => {
    const renderId = activeRenderIdRef.current;
    if (!renderId) {
      return;
    }
    try {
      await invoke("cancel_story_render", { renderId });
      toast.message("Story render cancelled.");
    } catch (error) {
      toast.error(normalizeError(error, "Could not cancel story render."));
    }
  }, []);

  const handlePlay = useCallback(async () => {
    if (!lastResult || isPlaying) {
      return;
    }
    const playbackId = crypto.randomUUID();
    activePlaybackIdRef.current = playbackId;
    setIsPlaying(true);
    try {
      await invoke("play_story_audio", { path: lastResult.output_path });
    } catch (error) {
      toast.error(normalizeError(error, "Could not play story audio."));
    } finally {
      if (activePlaybackIdRef.current === playbackId) {
        activePlaybackIdRef.current = null;
        setIsPlaying(false);
      }
    }
  }, [isPlaying, lastResult]);

  const handleStop = useCallback(async () => {
    activePlaybackIdRef.current = null;
    setIsPlaying(false);
    try {
      await invoke("stop_story_audio");
    } catch (error) {
      toast.error(normalizeError(error, "Could not stop story audio."));
    }
  }, []);

  const progressLabel = progress ? formatProgress(progress) : null;
  const visibleValidationErrors = validation.errors.slice(0, 4);
  const hiddenValidationErrorCount =
    validation.errors.length - visibleValidationErrors.length;

  if (!isLoadingPresets && presets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10">
        <div className="max-w-md text-center">
          <Volume2 className="mx-auto mb-4 h-8 w-8 text-[var(--accent)]" />
          <h3 className="text-lg font-semibold text-[var(--text)]">
            {emptyVoicesTitle}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {emptyVoicesDescription}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => void commands.showDetailView("my-voices")}
            >
              {openMyVoicesLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void refreshPresets()}
            >
              <RefreshCw className="h-4 w-4" />
              {refreshLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <label className="text-sm font-medium text-[var(--text)]">
            {storyTitleLabel}
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={isRendering}
              className="mt-1 h-10 w-full rounded-lg border-[var(--border)] bg-[var(--input)] text-[var(--text)]"
            />
          </label>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
            <div className="text-xs font-semibold uppercase text-[var(--muted)]">
              {scriptLinesLabel}
            </div>
            <div className="mt-1 text-2xl font-semibold text-[var(--text)]">
              {validation.lines.length}
            </div>
          </div>
        </div>

        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            validation.errors.length > 0
              ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--text)]"
              : "border-[color-mix(in_srgb,var(--success),transparent_70%)] bg-[var(--success-soft)] text-[var(--text)]"
          }`}
        >
          {validation.errors.length > 0 ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
          )}
          <div>
            <div className="font-semibold">
              {validation.errors.length > 0
                ? "Review needed before rendering"
                : "Ready to render"}
            </div>
            <div className="mt-0.5 text-[var(--muted)]">
              {validation.errors.length > 0
                ? "Fix the listed cast or script issues, then generate the WAV."
                : `${validation.lines.length} script line${validation.lines.length === 1 ? "" : "s"} and ${cast.length} cast member${cast.length === 1 ? "" : "s"} are ready.`}
            </div>
          </div>
        </div>

        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="min-w-0 space-y-4">
            <CastBuilder
              cast={cast}
              presets={presets}
              disabled={isRendering || isLoadingPresets}
              onAdd={addCharacter}
              onRemove={removeCharacter}
              onUpdate={updateCharacter}
            />

            <ScriptEditor
              value={scriptText}
              onChange={setScriptText}
              disabled={isRendering}
            />

            {validation.errors.length > 0 ? (
              <div
                className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--text)]"
                role="alert"
              >
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <AlertCircle className="h-4 w-4 text-[var(--danger)]" />
                  {fixBeforeRenderingLabel}
                </div>
                <ul className="space-y-1 pl-6">
                  {visibleValidationErrors.map((error) => (
                    <li key={error} className="list-disc">
                      {error}
                    </li>
                  ))}
                  {hiddenValidationErrorCount > 0 ? (
                    <li className="list-disc">
                      {formatHiddenIssueCount(hiddenValidationErrorCount)}
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>

          <RenderControls
            canRender={canRender}
            isRendering={isRendering}
            isPlaying={isPlaying}
            progressLabel={progressLabel}
            validationErrorCount={validation.errors.length}
            outputPath={lastResult?.output_path ?? null}
            durationMs={lastResult?.duration_ms ?? null}
            lineCount={lastResult?.line_count ?? validation.lines.length}
            pauseMs={pauseMs}
            onPauseChange={(value) =>
              setPauseMs(Math.min(Math.max(value, 0), 10000))
            }
            onRender={handleRender}
            onCancel={handleCancel}
            onPlay={handlePlay}
            onStop={handleStop}
            className="lg:sticky lg:top-0"
          />
        </div>
      </div>
    </div>
  );
};

function reconcileCastWithPresets(
  currentCast: StoryCastMemberDraft[],
  presets: TtsVoicePreset[],
): StoryCastMemberDraft[] {
  if (presets.length === 0) {
    return [];
  }
  if (currentCast.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        characterName: "Narrator",
        presetId: presets[0].id,
      },
      {
        id: crypto.randomUUID(),
        characterName: "Hero",
        presetId: presets[1]?.id ?? presets[0].id,
      },
      {
        id: crypto.randomUUID(),
        characterName: "Guide",
        presetId: presets[2]?.id ?? presets[1]?.id ?? presets[0].id,
      },
    ];
  }
  const presetIds = new Set(presets.map((preset) => preset.id));
  return currentCast.map((member) => ({
    ...member,
    presetId: presetIds.has(member.presetId) ? member.presetId : presets[0].id,
  }));
}

function nextCharacterName(index: number): string {
  if (index === 0) return "Narrator";
  if (index === 1) return "Hero";
  if (index === 2) return "Guide";
  return `Character ${index + 1}`;
}

function formatProgress(progress: StoryRenderProgress): string {
  if (progress.status === "assembling") {
    return "Assembling final WAV file...";
  }
  if (progress.status === "complete") {
    return "Story audio rendered.";
  }
  if (progress.status === "validating" || progress.status === "queued") {
    return "Preparing story render...";
  }
  const speaker = progress.speaker ? ` (${progress.speaker})` : "";
  return `Rendering line ${progress.current_line} of ${progress.total_lines}${speaker}...`;
}

function formatHiddenIssueCount(count: number): string {
  return `${count} more issue${count === 1 ? "" : "s"}.`;
}

function normalizeError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
