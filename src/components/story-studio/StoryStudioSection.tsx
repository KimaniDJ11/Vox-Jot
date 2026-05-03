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
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  listTtsVoicePresets,
  type TtsVoicePreset,
} from "@/lib/ttsVoicePresets";
import { commands } from "@/bindings";
import { CastBuilder } from "./CastBuilder";
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
const fixBeforeRenderingLabel = "Fix before rendering";
const generateLabel = "Generate";
const cancelLabel = "Cancel";
const studioToolAriaLabel = "Studio tools";
const searchScriptLabel = "Search script";
const clearSearchLabel = "Clear script search";
const generatedAudioNotice = "Generated audio will appear in Generated Audio.";
const pauseBetweenLinesLabel = "Pause between lines";

type StudioTool = "script" | "cast";

export const StoryStudioSection: React.FC = () => {
  const [presets, setPresets] = useState<TtsVoicePreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [title, setTitle] = useState("Untitled Story");
  const [cast, setCast] = useState<StoryCastMemberDraft[]>([]);
  const [scriptText, setScriptText] = useState(defaultScript);
  const [pauseMs, setPauseMs] = useState(500);
  const [activeTool, setActiveTool] = useState<StudioTool>("script");
  const [scriptSearchQuery, setScriptSearchQuery] = useState("");
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState<StoryRenderProgress | null>(null);
  const activeRenderIdRef = useRef<string | null>(null);

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
    presets.length > 0 &&
    validation.errors.length === 0;
  const readySummary =
    validation.errors.length > 0
      ? `${validation.errors.length} issue${validation.errors.length === 1 ? "" : "s"} to fix`
      : `Ready to render: ${validation.lines.length} script line${validation.lines.length === 1 ? "" : "s"} and ${cast.length} cast member${cast.length === 1 ? "" : "s"}.`;
  const scriptSearchMatchCount = useMemo(
    () => countScriptSearchMatches(scriptText, scriptSearchQuery),
    [scriptSearchQuery, scriptText],
  );

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
      toast.success(
        `Story audio rendered. Open Generated Audio to play ${result.line_count} line${result.line_count === 1 ? "" : "s"}.`,
      );
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
    <div className="px-6 pb-5">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="primary-soft"
              size="sm"
              onClick={() => {
                if (isRendering) {
                  void handleCancel();
                  return;
                }
                void handleRender();
              }}
              disabled={!isRendering && !canRender}
            >
              {isRendering ? (
                <Loader2 className="h-3.5 w-3.5 animate-[spin_1s_linear_infinite]" />
              ) : (
                <WandSparkles className="h-3.5 w-3.5" />
              )}
              {isRendering ? cancelLabel : generateLabel}
            </Button>

            <SegmentedControl<StudioTool>
              value={activeTool}
              onChange={setActiveTool}
              layoutId="story-studio-tool-toggle"
              ariaLabel={studioToolAriaLabel}
              items={[
                { value: "script", label: "Script" },
                { value: "cast", label: "Cast" },
              ]}
            />
          </div>

          {activeTool === "script" ? (
            <div className="ms-auto flex min-w-[min(100%,20rem)] flex-wrap items-center justify-end gap-2">
              <label
                className="relative flex h-10 w-[min(20rem,100%)] min-w-[12rem] items-center"
                aria-label={searchScriptLabel}
              >
                <Search
                  className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--muted)]"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={scriptSearchQuery}
                  onChange={(event) => setScriptSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && scriptSearchQuery) {
                      setScriptSearchQuery("");
                      event.preventDefault();
                    }
                  }}
                  placeholder={searchScriptLabel}
                  className="h-10 w-full pl-9 pr-9 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
                />
                {scriptSearchQuery ? (
                  <button
                    type="button"
                    className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    onClick={() => setScriptSearchQuery("")}
                    aria-label={clearSearchLabel}
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                ) : null}
              </label>
              {scriptSearchQuery ? (
                <span className="text-xs font-medium text-[var(--muted)]">
                  {formatScriptSearchMatchCount(scriptSearchMatchCount)}
                </span>
              ) : null}
            </div>
          ) : (
            <div
              className={`ms-auto inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
                validation.errors.length > 0
                  ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--text)]"
                  : "border-[color-mix(in_srgb,var(--success),transparent_70%)] bg-[var(--success-soft)] text-[var(--text)]"
              }`}
              aria-live="polite"
            >
              {validation.errors.length > 0 ? (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
              )}
              <span className="truncate">{readySummary}</span>
            </div>
          )}
        </div>

        {isRendering ? (
          <div
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-sm)]"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-[var(--text)]">
                {progressLabel ?? "Preparing story render..."}
              </span>
              <span className="shrink-0 text-xs font-medium text-[var(--muted)]">
                {generatedAudioNotice}
              </span>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel-bg)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={getProgressPercent(progress)}
            >
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                style={{ width: `${getProgressPercent(progress)}%` }}
              />
            </div>
          </div>
        ) : null}

        {validation.errors.length > 0 ? (
          <div
            className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--text)]"
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

        {activeTool === "script" ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
            <label className="mb-4 block text-sm font-medium text-[var(--text)]">
              {storyTitleLabel}
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={isRendering}
                className="mt-1 h-10 w-full rounded-lg border-[var(--border)] bg-[var(--input)] text-[var(--text)]"
              />
            </label>
            <ScriptEditor
              value={scriptText}
              onChange={setScriptText}
              disabled={isRendering}
            />
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
            <CastBuilder
              cast={cast}
              presets={presets}
              disabled={isRendering || isLoadingPresets}
              onAdd={addCharacter}
              onRemove={removeCharacter}
              onUpdate={updateCharacter}
            />

            <label className="block text-sm font-medium text-[var(--text)]">
              {pauseBetweenLinesLabel}
              <input
                type="number"
                min={0}
                max={10000}
                step={100}
                value={pauseMs}
                onChange={(event) =>
                  setPauseMs(
                    Math.min(
                      Math.max(Number.parseInt(event.target.value, 10) || 0, 0),
                      10000,
                    ),
                  )
                }
                disabled={isRendering}
                className="mt-1 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>
        )}
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

function countScriptSearchMatches(scriptText: string, query: string): number {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  let count = 0;
  let index = 0;
  const normalizedScript = scriptText.toLocaleLowerCase();

  while (index < normalizedScript.length) {
    const nextIndex = normalizedScript.indexOf(normalizedQuery, index);
    if (nextIndex === -1) {
      break;
    }
    count += 1;
    index = nextIndex + normalizedQuery.length;
  }

  return count;
}

function formatScriptSearchMatchCount(count: number): string {
  return `${count} match${count === 1 ? "" : "es"}`;
}

function getProgressPercent(progress: StoryRenderProgress | null): number {
  if (!progress) {
    return 8;
  }
  if (progress.status === "assembling") {
    return 92;
  }
  if (progress.status === "complete") {
    return 100;
  }
  if (progress.status === "validating" || progress.status === "queued") {
    return 8;
  }
  if (progress.total_lines <= 0) {
    return 8;
  }
  return Math.min(
    90,
    Math.max(8, Math.round((progress.current_line / progress.total_lines) * 90)),
  );
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
