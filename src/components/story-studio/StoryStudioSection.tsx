import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
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
  createTtsVoicePreset,
  listTtsVoicePresets,
  type TtsVoicePreset,
} from "@/lib/ttsVoicePresets";
import { commands, type VoiceInfo } from "@/bindings";
import {
  buildCreateVoiceHubRows,
  type CreateVoiceHubVoiceRow,
} from "@/components/settings/general/listen/createVoiceVoiceHub";
import {
  defaultVoiceTuning,
  getTtsVoicesForSelection,
  isDraftVoiceModelAvailable,
} from "@/components/settings/general/listen/utils";
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
  project_id: string;
  title: string;
  cast: Array<{ character_name: string; preset_id: string }>;
  script_text: string;
  pause_ms_between_lines: number;
  line_instructions: Array<{ line_number: number; style_instructions: string }>;
  audio_effect: StoryAudioEffectPreset;
}

const storyStudioDraftStorageKey = "vox-jot-story-studio-draft-v1";

type StudioTool = "script" | "cast";
type StoryAudioEffectPreset = "clean" | "voice_polish" | "radio" | "warm_room";

interface StoryStudioDraft {
  projectId: string;
  title: string;
  cast: StoryCastMemberDraft[];
  scriptText: string;
  pauseMs: number;
  activeTool: StudioTool;
  lineInstructions: Record<string, string>;
  audioEffect: StoryAudioEffectPreset;
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

interface ExpressionPopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const defaultStudioDraft: StoryStudioDraft = {
  projectId: "",
  title: "",
  cast: [],
  scriptText: "",
  pauseMs: 500,
  activeTool: "script",
  lineInstructions: {},
  audioEffect: "clean",
};

export const StoryStudioSection: React.FC = () => {
  const { t } = useTranslation();
  const initialDraft = useMemo(readStoredStudioDraft, []);
  const [projectId] = useState(initialDraft.projectId || crypto.randomUUID());

  const [presets, setPresets] = useState<TtsVoicePreset[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(true);
  const [title, setTitle] = useState(
    initialDraft.title || t("storyStudio.defaultTitle"),
  );
  const [cast, setCast] = useState<StoryCastMemberDraft[]>(initialDraft.cast);
  const [scriptText, setScriptText] = useState(
    initialDraft.scriptText || t("storyStudio.defaultScript"),
  );
  const [pauseMs, setPauseMs] = useState(initialDraft.pauseMs);
  const [activeTool, setActiveTool] = useState<StudioTool>(
    initialDraft.activeTool,
  );
  const [lineInstructions, setLineInstructions] = useState(
    initialDraft.lineInstructions,
  );
  const [audioEffect, setAudioEffect] = useState<StoryAudioEffectPreset>(
    initialDraft.audioEffect,
  );
  const [expressionQuery, setExpressionQuery] = useState("");
  const [expressionPopoverOpen, setExpressionPopoverOpen] = useState(false);
  const [expressionPopoverPosition, setExpressionPopoverPosition] =
    useState<ExpressionPopoverPosition | null>(null);
  const [scriptSelection, setScriptSelection] = useState<ScriptTextSelection>({
    start: scriptText.length,
    end: scriptText.length,
    lineNumber: scriptText.split("\n").length,
  });
  const [ttsModels, setTtsModels] = useState<CatalogModelDescriptor[]>([]);
  const [isLoadingTtsModels, setIsLoadingTtsModels] = useState(true);
  const [voicesByModelKey, setVoicesByModelKey] = useState<
    Map<string, VoiceInfo[]>
  >(() => new Map());
  const [loadingVoiceKeys, setLoadingVoiceKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const loadingVoiceKeysRef = useRef(new Set<string>());
  const expressionAnchorRef = useRef<HTMLDivElement | null>(null);
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

  const updateExpressionPopoverPosition = useCallback(() => {
    const anchor = expressionAnchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const viewportWidth =
      document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight =
      document.documentElement.clientHeight || window.innerHeight;
    const margin = viewportWidth < 640 ? 12 : 24;
    const width = Math.min(448, viewportWidth - margin * 2);
    const left = Math.max(margin, viewportWidth - width - margin);
    const preferredTop = rect.bottom + 10;
    const minimumHeight = Math.min(280, viewportHeight - margin * 2);
    const availableBelow = viewportHeight - preferredTop - margin;
    const top =
      availableBelow >= minimumHeight
        ? preferredTop
        : Math.max(
            margin,
            Math.min(rect.top, viewportHeight - minimumHeight - margin),
          );
    const maxHeight = Math.max(180, viewportHeight - top - margin);

    setExpressionPopoverPosition({
      top,
      left,
      width,
      maxHeight,
    });
  }, []);

  const openExpressionPopover = useCallback(() => {
    updateExpressionPopoverPosition();
    setExpressionPopoverOpen(true);
  }, [updateExpressionPopoverPosition]);

  useEffect(() => {
    if (activeTool !== "script") {
      setExpressionPopoverOpen(false);
    }
  }, [activeTool]);

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
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingTtsModels(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const availableTtsModels = useMemo(
    () => ttsModels.filter(isDraftVoiceModelAvailable),
    [ttsModels],
  );

  // Lazy-load preset voices for each TTS model so they can populate the
  // Cast voice picker alongside saved presets.
  useEffect(() => {
    for (const model of availableTtsModels) {
      const key = `${model.provider_id}::${model.id}`;
      if (voicesByModelKey.has(key) || loadingVoiceKeysRef.current.has(key)) {
        continue;
      }
      loadingVoiceKeysRef.current.add(key);
      setLoadingVoiceKeys((current) => {
        const next = new Set(current);
        next.add(key);
        return next;
      });
      void getTtsVoicesForSelection(model.provider_id, model.id)
        .then((voices) => {
          setVoicesByModelKey((current) => {
            const next = new Map(current);
            next.set(key, voices);
            return next;
          });
        })
        .catch(() => {
          setVoicesByModelKey((current) => {
            const next = new Map(current);
            next.set(key, []);
            return next;
          });
        })
        .finally(() => {
          loadingVoiceKeysRef.current.delete(key);
          setLoadingVoiceKeys((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        });
    }
  }, [availableTtsModels, voicesByModelKey]);

  useEffect(() => {
    writeStoredStudioDraft({
      projectId,
      title,
      cast,
      scriptText,
      pauseMs,
      activeTool,
      lineInstructions,
      audioEffect,
    });
  }, [
    activeTool,
    audioEffect,
    cast,
    lineInstructions,
    pauseMs,
    projectId,
    scriptText,
    title,
  ]);

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

  useLayoutEffect(() => {
    if (!expressionPopoverOpen || !expressionEnabled) return;

    updateExpressionPopoverPosition();
    window.addEventListener("resize", updateExpressionPopoverPosition);
    window.addEventListener("scroll", updateExpressionPopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updateExpressionPopoverPosition);
      window.removeEventListener(
        "scroll",
        updateExpressionPopoverPosition,
        true,
      );
    };
  }, [
    expressionEnabled,
    expressionPopoverOpen,
    updateExpressionPopoverPosition,
  ]);

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

  const presetVoices = useMemo(
    () => buildCreateVoiceHubRows(availableTtsModels, voicesByModelKey),
    [availableTtsModels, voicesByModelKey],
  );
  const hasVoiceChoices = presets.length > 0 || presetVoices.length > 0;
  const isLoadingVoiceChoices = isLoadingTtsModels || loadingVoiceKeys.size > 0;

  // When the user picks a built-in preset voice in the Cast picker we
  // materialize it as a saved TtsVoicePreset so the rest of the pipeline
  // (validation, render request) can keep using presetId references.
  const handleCreatePresetFromVoice = useCallback(
    async (voice: CreateVoiceHubVoiceRow): Promise<string> => {
      const existingPreset = presets.find(
        (preset) =>
          preset.provider_id === voice.providerId &&
          preset.model_id === voice.modelId &&
          (preset.voice_id ?? null) === voice.voiceId &&
          (preset.voice_profile_id ?? null) === null,
      );
      if (existingPreset) {
        return existingPreset.id;
      }

      try {
        const created = await createTtsVoicePreset({
          label: voice.voiceId
            ? `${voice.modelLabel} - ${voice.voiceLabel}`
            : voice.modelLabel,
          provider_id: voice.providerId,
          model_id: voice.modelId,
          voice_id: voice.voiceId,
          voice_profile_id: null,
          voice_label_snapshot: voice.voiceId
            ? voice.voiceLabel
            : voice.modelLabel,
          locale_snapshot: voice.locale,
          tuning: defaultVoiceTuning(),
        });
        setPresets((current) => [...current, created]);
        return created.id;
      } catch (error) {
        console.error("Failed to save Story Studio preset voice:", error);
        toast.error(t("storyStudio.cast.createVoicePresetFailed"));
        throw error;
      }
    },
    [presets, t],
  );

  const handleRender = useCallback(async () => {
    if (!canRender) {
      return;
    }
    const renderId = crypto.randomUUID();
    setIsQueueingRender(true);

    const request: StoryRenderRequest = {
      render_id: renderId,
      project_id: projectId,
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
      audio_effect: audioEffect,
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
    audioEffect,
    cast,
    lineInstructions,
    pauseMs,
    projectId,
    scriptText,
    title,
    validation.lines,
  ]);
  const visibleValidationErrors = validation.errors.slice(0, 4);
  const hiddenValidationErrorCount =
    validation.errors.length - visibleValidationErrors.length;
  const renderReadinessPill = (
    <div
      className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
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
  );
  const expressionTagControl = (
    <div ref={expressionAnchorRef} className="relative w-[20rem] max-w-full">
      <label
        className="relative flex h-10 w-full items-center"
        aria-label={t("storyStudio.expressionTags")}
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
            openExpressionPopover();
          }}
          onFocus={() => {
            if (expressionEnabled) {
              openExpressionPopover();
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
              ? t("storyStudio.expressionTags")
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
            aria-label={t("storyStudio.clearExpressionSearch")}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </label>
      {expressionPopoverOpen &&
      expressionEnabled &&
      expressionPopoverPosition ? (
        <ExpressionPopover
          capability={expressionCapability}
          contextLabel={expressionContext.label}
          filter={expressionQuery}
          instruction={currentInstruction}
          position={expressionPopoverPosition}
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
  );

  if (!isLoadingPresets && !isLoadingVoiceChoices && !hasVoiceChoices) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10">
        <div className="max-w-md text-center">
          <Volume2 className="mx-auto mb-4 h-8 w-8 text-[var(--accent)]" />
          <h3 className="text-lg font-semibold text-[var(--text)]">
            {t("storyStudio.emptyVoicesTitle")}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {t("storyStudio.emptyVoicesDescription")}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("vox-jot:navigate", {
                    detail: { view: "listen", section: "create-voices" },
                  }),
                )
              }
            >
              {t("storyStudio.openMyVoices")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void refreshPresets()}
            >
              <RefreshCw className="h-4 w-4" />
              {t("common.refresh")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pb-5">
      <div className="flex w-full flex-col gap-4 pb-4">
        <div className="story-studio-toolbar flex flex-wrap items-center justify-between gap-3">
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
              {isQueueingRender || showQueuedAck
                ? t("storyStudio.queued")
                : t("storyStudio.generate")}
            </Button>

            <SegmentedControl<StudioTool>
              value={activeTool}
              onChange={setActiveTool}
              layoutId="story-studio-tool-toggle"
              ariaLabel={t("storyStudio.toolAriaLabel")}
              items={[
                { value: "script", label: t("storyStudio.tools.script") },
                { value: "cast", label: t("storyStudio.tools.cast") },
              ]}
            />
          </div>

          {activeTool === "script" ? (
            <div className="story-studio-toolbar__trailing ms-auto flex flex-wrap items-center justify-end gap-2">
              <div
                className="shrink-0"
                title="Apply an audio effect to the rendered story. Clean keeps the original voice. Voice Polish smooths artifacts. Radio adds vintage broadcast warmth. Warm Room adds natural reverb."
              >
                <SegmentedControl<StoryAudioEffectPreset>
                  value={audioEffect}
                  onChange={setAudioEffect}
                  layoutId="story-studio-audio-effect"
                  ariaLabel={t("storyStudio.audioEffectAriaLabel", {
                    defaultValue: "Story audio effect",
                  })}
                  items={[
                    {
                      value: "clean",
                      label: t("storyStudio.audioEffects.clean", {
                        defaultValue: "Clean",
                      }),
                    },
                    {
                      value: "voice_polish",
                      label: t("storyStudio.audioEffects.voicePolish", {
                        defaultValue: "Voice Polish",
                      }),
                    },
                    {
                      value: "radio",
                      label: t("storyStudio.audioEffects.radio", {
                        defaultValue: "Radio",
                      }),
                    },
                    {
                      value: "warm_room",
                      label: t("storyStudio.audioEffects.warmRoom", {
                        defaultValue: "Warm Room",
                      }),
                    },
                  ]}
                />
              </div>
            </div>
          ) : (
            <div className="ms-auto flex max-w-full justify-end">
              {renderReadinessPill}
            </div>
          )}
        </div>

        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {validation.errors.length > 0 ? (
            <div
              className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--text)]"
              role="alert"
            >
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertCircle className="h-4 w-4 text-[var(--danger)]" />
                {t("storyStudio.fixBeforeRendering")}
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
              <div className="mb-4 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[var(--text)]">
                    {t("storyStudio.storyTitle")}
                  </span>
                  <div className="shrink-0">
                    {renderReadinessPill}
                  </div>
                </div>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-label={t("storyStudio.storyTitle")}
                  className="h-10 w-full rounded-lg border-[var(--border)] bg-[var(--input)] text-[var(--text)]"
                />
              </div>
              <ScriptEditor
                ref={scriptEditorRef}
                value={scriptText}
                headerAction={expressionTagControl}
                onChange={setScriptText}
                onCursorChange={setScriptSelection}
              />
            </div>
          ) : (
            <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
              <CastBuilder
                cast={cast}
                presets={presets}
                presetVoices={presetVoices}
                isLoadingVoiceChoices={isLoadingVoiceChoices}
                disabled={isLoadingPresets}
                onAdd={addCharacter}
                onRemove={removeCharacter}
                onUpdate={updateCharacter}
                onCreatePresetFromVoice={handleCreatePresetFromVoice}
              />

              <label className="block text-sm font-medium text-[var(--text)]">
                {t("storyStudio.pauseBetweenLines")}
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={100}
                  value={pauseMs}
                  onChange={(event) =>
                    setPauseMs(
                      Math.min(
                        Math.max(
                          Number.parseInt(event.target.value, 10) || 0,
                          0,
                        ),
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
  position: ExpressionPopoverPosition;
  onClose: () => void;
  onInsertTag: (tag: string) => void;
  onInstructionChange: (value: string) => void;
}> = ({
  capability,
  contextLabel,
  filter,
  instruction,
  position,
  onClose,
  onInsertTag,
  onInstructionChange,
}) => {
  const { t } = useTranslation();
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

  return createPortal(
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-sm text-[var(--text)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
      role="dialog"
      aria-label={t("storyStudio.expressionControlsTitle")}
    >
      <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--text)]">
            {t("storyStudio.expressionControlsTitle")}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
            {contextLabel}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={onClose}
          aria-label={t("storyStudio.closeExpressionControls")}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
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
                {t("storyStudio.noExpressionTagMatches")}
              </p>
            )}

            {capability.allowCustomTags ? (
              <div className="flex gap-2 border-t border-[var(--border)] pt-3">
                <Input
                  value={customTag}
                  onChange={(event) => setCustomTag(event.target.value)}
                  placeholder={t("storyStudio.customTagPlaceholder")}
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
                  {t("common.add")}
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
              {t("storyStudio.lineInstruction")}
            </p>
            <Textarea
              value={instruction}
              onChange={(event) => onInstructionChange(event.target.value)}
              placeholder={t("storyStudio.lineInstructionPlaceholder")}
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
    </div>,
    document.body,
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
    projectId:
      typeof draft.projectId === "string" && draft.projectId.trim()
        ? draft.projectId
        : defaultStudioDraft.projectId,
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
    audioEffect: normalizeStoredAudioEffect(draft.audioEffect),
  };
}

function normalizeStoredAudioEffect(value: unknown): StoryAudioEffectPreset {
  return value === "voice_polish" || value === "radio" || value === "warm_room"
    ? value
    : "clean";
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
