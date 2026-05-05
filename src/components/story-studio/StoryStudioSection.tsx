import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Textarea } from "@/components/ui/Textarea";
import {
  getModelPlatformOverview,
  type CatalogModelDescriptor,
} from "@/lib/modelPlatform";
import {
  expressionCapabilityForModel,
  INSTRUCTION_PRESETS,
  supportsExpressionControls,
  type TtsExpressionCapability,
  type TtsExpressionTag,
} from "@/lib/ttsExpressionControls";
import {
  listTtsVoicePresets,
  type TtsVoicePreset,
} from "@/lib/ttsVoicePresets";
import { commands } from "@/bindings";
import { CastBuilder } from "./CastBuilder";
import {
  ScriptEditor,
  type ScriptEditorHandle,
  type ScriptTextSelection,
} from "./ScriptEditor";
import { validateStoryDraft, type StoryCastMemberDraft } from "./storyScript";

interface StoryRenderEnqueueResult {
  render_id: string;
  queue_position: number;
}

interface StoryRenderRequest {
  render_id: string;
  title: string;
  cast: Array<{ character_name: string; preset_id: string }>;
  script_text: string;
  pause_ms_between_lines: number;
  line_instructions: Array<{ line_number: number; style_instructions: string }>;
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
const queuedLabel = "Queued";
const studioToolAriaLabel = "Studio tools";
const expressionTagsLabel = "Expression tags";
const clearExpressionSearchLabel = "Clear expression tag search";
const expressionControlsTitle = "Expression controls";
const noExpressionTagMatchesLabel = "No expression tags match this search.";
const customTagPlaceholder = "Custom tag";
const addCustomTagLabel = "Add";
const lineInstructionLabel = "Line instruction";
const lineInstructionPlaceholder =
  "Describe how this line should be performed.";
const closeExpressionControlsLabel = "Close expression controls";
const pauseBetweenLinesLabel = "Pause between lines";
const storyStudioDraftStorageKey = "vox-jot-story-studio-draft-v1";

type StudioTool = "script" | "cast";

interface StoryStudioDraft {
  title: string;
  cast: StoryCastMemberDraft[];
  scriptText: string;
  pauseMs: number;
  activeTool: StudioTool;
  lineInstructions: Record<string, string>;
}

interface ExpressionContext {
  line: { speaker: string; text: string; lineNumber: number } | null;
  preset: TtsVoicePreset | null;
  model: Pick<
    CatalogModelDescriptor,
    "id" | "provider_id" | "label" | "capabilities"
  > | null;
  capability: TtsExpressionCapability;
  label: string;
}

const defaultStudioDraft: StoryStudioDraft = {
  title: "Untitled Story",
  cast: [],
  scriptText: defaultScript,
  pauseMs: 500,
  activeTool: "script",
  lineInstructions: {},
};

export const StoryStudioSection: React.FC = () => {
  const initialDraft = useMemo(readStoredStudioDraft, []);

  const [presets, setPresets] = useState<TtsVoicePreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [title, setTitle] = useState(initialDraft.title);
  const [cast, setCast] = useState<StoryCastMemberDraft[]>(initialDraft.cast);
  const [scriptText, setScriptText] = useState(initialDraft.scriptText);
  const [pauseMs, setPauseMs] = useState(initialDraft.pauseMs);
  const [activeTool, setActiveTool] = useState<StudioTool>(
    initialDraft.activeTool,
  );
  const [lineInstructions, setLineInstructions] = useState(
    initialDraft.lineInstructions,
  );
  const [expressionQuery, setExpressionQuery] = useState("");
  const [expressionPopoverOpen, setExpressionPopoverOpen] = useState(false);
  const [scriptSelection, setScriptSelection] = useState<ScriptTextSelection>({
    start: scriptText.length,
    end: scriptText.length,
    lineNumber: scriptText.split("\n").length,
  });
  const [ttsModels, setTtsModels] = useState<CatalogModelDescriptor[]>([]);
  const scriptEditorRef = useRef<ScriptEditorHandle | null>(null);
  const [isQueueingRender, setIsQueueingRender] = useState(false);
  const [showQueuedAck, setShowQueuedAck] = useState(false);
  const queuedAckTimerRef = useRef<number | null>(null);

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
    let cancelled = false;
    void getModelPlatformOverview()
      .then((overview) => {
        if (!cancelled) {
          setTtsModels(overview.tts.models);
        }
      })
      .catch((error) => {
        console.error(
          "Failed to load Story Studio expression metadata:",
          error,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeStoredStudioDraft({
      title,
      cast,
      scriptText,
      pauseMs,
      activeTool,
      lineInstructions,
    });
  }, [activeTool, cast, lineInstructions, pauseMs, scriptText, title]);

  useEffect(() => {
    return () => {
      if (queuedAckTimerRef.current !== null) {
        window.clearTimeout(queuedAckTimerRef.current);
      }
    };
  }, []);

  const validation = useMemo(
    () => validateStoryDraft(cast, scriptText, presets),
    [cast, presets, scriptText],
  );
  const canRender =
    !isLoadingPresets &&
    !isQueueingRender &&
    presets.length > 0 &&
    validation.errors.length === 0;
  const readySummary =
    validation.errors.length > 0
      ? `${validation.errors.length} issue${validation.errors.length === 1 ? "" : "s"} to fix`
      : `Ready to render: ${validation.lines.length} script line${validation.lines.length === 1 ? "" : "s"} and ${cast.length} cast member${cast.length === 1 ? "" : "s"}.`;
  const expressionContext = useMemo(
    () =>
      resolveExpressionContext({
        cast,
        lineNumber: scriptSelection.lineNumber,
        presets,
        ttsModels,
        validationLines: validation.lines,
      }),
    [cast, presets, scriptSelection.lineNumber, ttsModels, validation.lines],
  );
  const expressionCapability = expressionContext.capability;
  const expressionEnabled = supportsExpressionControls(expressionCapability);
  const currentInstructionKey = expressionContext.line?.lineNumber
    ? String(expressionContext.line.lineNumber)
    : null;
  const currentInstruction = currentInstructionKey
    ? (lineInstructions[currentInstructionKey] ?? "")
    : "";

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
    setIsQueueingRender(true);

    const request: StoryRenderRequest = {
      render_id: renderId,
      title,
      cast: cast.map((member) => ({
        character_name: member.characterName.trim(),
        preset_id: member.presetId,
      })),
      script_text: scriptText,
      pause_ms_between_lines: pauseMs,
      line_instructions: buildLineInstructions(
        validation.lines,
        lineInstructions,
      ),
    };

    try {
      const result = await invoke<StoryRenderEnqueueResult>(
        "render_story_audio",
        {
          request,
        },
      );
      setShowQueuedAck(true);
      if (queuedAckTimerRef.current !== null) {
        window.clearTimeout(queuedAckTimerRef.current);
      }
      queuedAckTimerRef.current = window.setTimeout(() => {
        setShowQueuedAck(false);
        queuedAckTimerRef.current = null;
      }, 1000);
      toast.message(
        `Story audio queued${result.queue_position > 1 ? ` at position ${result.queue_position}` : ""}. Open Generated Audio to track it.`,
      );
    } catch (error) {
      const message = normalizeError(error, "Story render failed.");
      if (!message.toLocaleLowerCase().includes("cancelled")) {
        toast.error(message);
      }
    } finally {
      setIsQueueingRender(false);
    }
  }, [
    canRender,
    cast,
    lineInstructions,
    pauseMs,
    scriptText,
    title,
    validation.lines,
  ]);
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
              onClick={() => void handleRender()}
              disabled={!canRender}
            >
              {isQueueingRender || showQueuedAck ? (
                <Loader2 className="h-3.5 w-3.5 animate-[spin_1s_linear_infinite]" />
              ) : (
                <WandSparkles className="h-3.5 w-3.5" />
              )}
              {isQueueingRender || showQueuedAck ? queuedLabel : generateLabel}
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
              <div className="relative">
                <label
                  className="relative flex h-10 w-[min(20rem,100%)] min-w-[12rem] items-center"
                  aria-label={expressionTagsLabel}
                >
                  <Sparkles
                    className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--muted)]"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    value={expressionQuery}
                    onChange={(event) => {
                      setExpressionQuery(event.target.value);
                      setExpressionPopoverOpen(true);
                    }}
                    onFocus={() => {
                      if (expressionEnabled) {
                        setExpressionPopoverOpen(true);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setExpressionPopoverOpen(false);
                        setExpressionQuery("");
                        event.preventDefault();
                      }
                    }}
                    placeholder={
                      expressionEnabled
                        ? expressionTagsLabel
                        : expressionCapability.emptyLabel
                    }
                    disabled={!expressionEnabled}
                    aria-haspopup="listbox"
                    aria-expanded={expressionPopoverOpen}
                    className="h-10 w-full pl-9 pr-9 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
                  />
                  {expressionQuery ? (
                    <button
                      type="button"
                      className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      onClick={() => setExpressionQuery("")}
                      aria-label={clearExpressionSearchLabel}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </label>
                {expressionPopoverOpen && expressionEnabled ? (
                  <ExpressionPopover
                    capability={expressionCapability}
                    contextLabel={expressionContext.label}
                    filter={expressionQuery}
                    instruction={currentInstruction}
                    onClose={() => setExpressionPopoverOpen(false)}
                    onInsertTag={(tag) => {
                      scriptEditorRef.current?.insertText(tag);
                      setExpressionPopoverOpen(true);
                    }}
                    onInstructionChange={(value) => {
                      if (!currentInstructionKey) return;
                      setLineInstructions((current) => {
                        const next = { ...current };
                        if (value.trim()) {
                          next[currentInstructionKey] = value;
                        } else {
                          delete next[currentInstructionKey];
                        }
                        return next;
                      });
                    }}
                  />
                ) : null}
              </div>
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
                className="mt-1 h-10 w-full rounded-lg border-[var(--border)] bg-[var(--input)] text-[var(--text)]"
              />
            </label>
            <ScriptEditor
              ref={scriptEditorRef}
              value={scriptText}
              onChange={setScriptText}
              onCursorChange={setScriptSelection}
            />
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
            <CastBuilder
              cast={cast}
              presets={presets}
              disabled={isLoadingPresets}
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
    return currentCast;
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

const ExpressionPopover: React.FC<{
  capability: TtsExpressionCapability;
  contextLabel: string;
  filter: string;
  instruction: string;
  onClose: () => void;
  onInsertTag: (tag: string) => void;
  onInstructionChange: (value: string) => void;
}> = ({
  capability,
  contextLabel,
  filter,
  instruction,
  onClose,
  onInsertTag,
  onInstructionChange,
}) => {
  const [customTag, setCustomTag] = useState("");
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const filteredTags = capability.tags.filter(
    (tag) =>
      !normalizedFilter ||
      tag.label.toLocaleLowerCase().includes(normalizedFilter) ||
      tag.value.toLocaleLowerCase().includes(normalizedFilter) ||
      tag.group.toLocaleLowerCase().includes(normalizedFilter),
  );
  const groupedTags = groupExpressionTags(filteredTags);
  const showTags =
    capability.kind === "fixed_inline_tags" ||
    capability.kind === "freeform_inline_tags" ||
    capability.kind === "both";
  const showInstructions =
    capability.kind === "instruction_prompt" || capability.kind === "both";

  return (
    <div
      className="absolute right-0 z-30 mt-2 w-[min(26rem,calc(100vw-3rem))] rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-sm text-[var(--text)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
      role="dialog"
      aria-label={expressionControlsTitle}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--text)]">
            {expressionControlsTitle}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
            {contextLabel}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={onClose}
          aria-label={closeExpressionControlsLabel}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {showTags ? (
        <div className="space-y-3">
          {groupedTags.length > 0 ? (
            groupedTags.map(([group, tags]) => (
              <div key={group} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                  {group}
                </p>
                <div className="flex flex-wrap gap-1.5" role="listbox">
                  {tags.map((tag) => (
                    <button
                      key={tag.value}
                      type="button"
                      className="min-h-9 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      onClick={() => onInsertTag(tag.value)}
                    >
                      {tag.value}
                    </button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted)]">
              {noExpressionTagMatchesLabel}
            </p>
          )}

          {capability.allowCustomTags ? (
            <div className="flex gap-2 border-t border-[var(--border)] pt-3">
              <Input
                value={customTag}
                onChange={(event) => setCustomTag(event.target.value)}
                placeholder={customTagPlaceholder}
                className="h-10 min-w-0 flex-1 rounded-lg text-sm"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!customTag.trim()}
                onClick={() => {
                  const value = customTag.trim();
                  if (!value) return;
                  onInsertTag(value.startsWith("[") ? value : `[${value}]`);
                  setCustomTag("");
                }}
              >
                {addCustomTagLabel}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showInstructions ? (
        <div
          className={`${showTags ? "mt-4 border-t border-[var(--border)] pt-3" : ""} space-y-2`}
        >
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
            {lineInstructionLabel}
          </p>
          <Textarea
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            placeholder={lineInstructionPlaceholder}
            className="min-h-[84px] !rounded-xl text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {INSTRUCTION_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="min-h-8 rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs font-medium text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                onClick={() => onInstructionChange(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

function resolveExpressionContext({
  cast,
  lineNumber,
  presets,
  ttsModels,
  validationLines,
}: {
  cast: StoryCastMemberDraft[];
  lineNumber: number;
  presets: TtsVoicePreset[];
  ttsModels: CatalogModelDescriptor[];
  validationLines: Array<{ speaker: string; text: string; lineNumber: number }>;
}): ExpressionContext {
  const line =
    validationLines.find((candidate) => candidate.lineNumber === lineNumber) ??
    null;
  const member = line
    ? cast.find(
        (candidate) =>
          normalizeStoryName(candidate.characterName) ===
          normalizeStoryName(line.speaker),
      )
    : null;
  const preset = member
    ? (presets.find((candidate) => candidate.id === member.presetId) ?? null)
    : null;
  const model = preset
    ? (ttsModels.find(
        (candidate) =>
          candidate.provider_id === preset.provider_id &&
          candidate.id === preset.model_id,
      ) ?? fallbackExpressionModel(preset))
    : null;
  const capability = expressionCapabilityForModel(model);
  const label = line
    ? `${line.speaker} · ${model?.label ?? preset?.label ?? "Unknown voice"} · line ${line.lineNumber}`
    : "Move the cursor to a Character: dialogue line";

  return { line, preset, model, capability, label };
}

function fallbackExpressionModel(
  preset: TtsVoicePreset,
): Pick<
  CatalogModelDescriptor,
  "id" | "provider_id" | "label" | "capabilities"
> {
  const modelId = preset.model_id.toLowerCase();
  const providerId = preset.provider_id.toLowerCase();
  const supportsInstructionPrompt =
    providerId.includes("qwen") ||
    modelId.includes("qwen") ||
    modelId.includes("ming-omni") ||
    modelId.includes("lfm2-5-audio");
  const supportsInlineTags =
    modelId.includes("fish-audio-s2-pro") ||
    modelId.includes("chatterbox-turbo") ||
    modelId === "dia-1.6b" ||
    modelId === "bark-small";

  return {
    id: preset.model_id,
    provider_id: preset.provider_id,
    label: preset.voice_label_snapshot ?? preset.model_id,
    capabilities: {
      downloadable: false,
      loadable: true,
      local_only: true,
      supports_translation: false,
      supports_streaming: false,
      supports_voice_cloning: false,
      supports_instruction_prompt: supportsInstructionPrompt,
      supports_inline_tags: supportsInlineTags,
      coming_soon: false,
    },
  };
}

function groupExpressionTags(tags: TtsExpressionTag[]) {
  const groups = new Map<string, TtsExpressionTag[]>();
  for (const tag of tags) {
    const current = groups.get(tag.group) ?? [];
    current.push(tag);
    groups.set(tag.group, current);
  }
  return Array.from(groups.entries());
}

function buildLineInstructions(
  lines: Array<{ lineNumber: number }>,
  lineInstructions: Record<string, string>,
) {
  const validLineNumbers = new Set(
    lines.map((line) => String(line.lineNumber)),
  );
  return Object.entries(lineInstructions)
    .filter(([lineNumber, instruction]) => {
      return validLineNumbers.has(lineNumber) && instruction.trim().length > 0;
    })
    .map(([lineNumber, instruction]) => ({
      line_number: Number.parseInt(lineNumber, 10),
      style_instructions: instruction.trim(),
    }));
}

function readStoredStudioDraft(): StoryStudioDraft {
  if (typeof window === "undefined") {
    return defaultStudioDraft;
  }

  try {
    const rawDraft = window.localStorage.getItem(storyStudioDraftStorageKey);
    if (!rawDraft) {
      return defaultStudioDraft;
    }

    const parsed = JSON.parse(rawDraft) as Partial<StoryStudioDraft>;
    return normalizeStoredStudioDraft(parsed);
  } catch (error) {
    console.warn("Failed to read Story Studio draft:", error);
    return defaultStudioDraft;
  }
}

function writeStoredStudioDraft(draft: StoryStudioDraft) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      storyStudioDraftStorageKey,
      JSON.stringify(normalizeStoredStudioDraft(draft)),
    );
  } catch (error) {
    console.warn("Failed to store Story Studio draft:", error);
  }
}

function normalizeStoredStudioDraft(
  draft: Partial<StoryStudioDraft>,
): StoryStudioDraft {
  return {
    title:
      typeof draft.title === "string" ? draft.title : defaultStudioDraft.title,
    cast: Array.isArray(draft.cast)
      ? draft.cast
          .map(normalizeStoredCastMember)
          .filter((member): member is StoryCastMemberDraft => member !== null)
      : defaultStudioDraft.cast,
    scriptText:
      typeof draft.scriptText === "string"
        ? draft.scriptText
        : defaultStudioDraft.scriptText,
    pauseMs:
      typeof draft.pauseMs === "number" && Number.isFinite(draft.pauseMs)
        ? Math.min(Math.max(Math.round(draft.pauseMs), 0), 10_000)
        : defaultStudioDraft.pauseMs,
    activeTool: draft.activeTool === "cast" ? "cast" : "script",
    lineInstructions: normalizeStoredLineInstructions(draft.lineInstructions),
  };
}

function normalizeStoredLineInstructions(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([lineNumber, instruction]) => {
      return /^\d+$/.test(lineNumber) && typeof instruction === "string";
    })
    .map(([lineNumber, instruction]) => [lineNumber, instruction as string]);
  return Object.fromEntries(entries);
}

function normalizeStoredCastMember(
  member: unknown,
): StoryCastMemberDraft | null {
  if (!member || typeof member !== "object") {
    return null;
  }

  const candidate = member as Partial<StoryCastMemberDraft>;
  if (
    typeof candidate.characterName !== "string" ||
    typeof candidate.presetId !== "string"
  ) {
    return null;
  }

  return {
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : crypto.randomUUID(),
    characterName: candidate.characterName,
    presetId: candidate.presetId,
  };
}

function nextCharacterName(index: number): string {
  if (index === 0) return "Narrator";
  if (index === 1) return "Hero";
  if (index === 2) return "Guide";
  return `Character ${index + 1}`;
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

function normalizeStoryName(value: string): string {
  return value.trim().toLocaleLowerCase();
}
