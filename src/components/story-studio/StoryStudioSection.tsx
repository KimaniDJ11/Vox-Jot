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
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Layers,
  Loader2,
  Music2,
  RefreshCw,
  Sparkles,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
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
import { openModelHub } from "@/components/model-hub/modelHubTabs";
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
import { SoundDesignPanel, type StorySoundItem } from "./SoundDesignPanel";
import {
  buildCastNameSet,
  generateStoryTitleFromScript,
  validateStoryDraft,
  type StoryCastMemberDraft,
} from "./storyScript";

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

type StudioTool = "script" | "cast" | "sound";
type StoryAudioEffectPreset = "clean" | "voice_polish" | "radio" | "warm_room";
type StorySoundCueMode = "insert" | "overlay";

interface StoryStudioDraft {
  projectId: string;
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
  const soundAnchorRef = useRef<HTMLDivElement | null>(null);
  const soundPopoverRef = useRef<HTMLDivElement | null>(null);
  const scriptEditorRef = useRef<ScriptEditorHandle | null>(null);
  const [isQueueingRender, setIsQueueingRender] = useState(false);
  const [showQueuedAck, setShowQueuedAck] = useState(false);
  const [projectSounds, setProjectSounds] = useState<StorySoundItem[]>([]);
  const [isLoadingProjectSounds, setIsLoadingProjectSounds] = useState(true);
  const [soundPopoverOpen, setSoundPopoverOpen] = useState(false);
  const [soundPopoverPosition, setSoundPopoverPosition] =
    useState<ExpressionPopoverPosition | null>(null);
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

  const updateSoundPopoverPosition = useCallback(() => {
    const anchor = soundAnchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const viewportWidth =
      document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight =
      document.documentElement.clientHeight || window.innerHeight;
    const margin = viewportWidth < 640 ? 12 : 24;
    const width = Math.min(384, viewportWidth - margin * 2);
    const left = Math.max(
      margin,
      Math.min(rect.right - width, viewportWidth - width - margin),
    );
    const gap = 8;
    const preferredTop = rect.bottom + gap;
    const minimumHeight = Math.min(288, viewportHeight - margin * 2);
    const availableBelow = viewportHeight - preferredTop - margin;
    const availableAbove = rect.top - margin - gap;
    const openBelow =
      availableBelow >= minimumHeight || availableBelow >= availableAbove;
    const top = openBelow
      ? preferredTop
      : Math.max(margin, rect.top - gap - minimumHeight);
    const maxHeight = Math.max(
      180,
      openBelow
        ? viewportHeight - top - margin
        : Math.min(minimumHeight, rect.top - margin - gap),
    );

    setSoundPopoverPosition({
      top,
      left,
      width,
      maxHeight,
    });
  }, []);

  const openSoundPopover = useCallback(() => {
    updateSoundPopoverPosition();
    setSoundPopoverOpen(true);
  }, [updateSoundPopoverPosition]);

  useEffect(() => {
    if (activeTool !== "script") {
      setExpressionPopoverOpen(false);
      setSoundPopoverOpen(false);
    }
  }, [activeTool]);

  const loadProjectSounds = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setIsLoadingProjectSounds(true);
      }
      try {
        const items = await invoke<StorySoundItem[]>("list_story_audio");
        setProjectSounds(
          items
            .filter(
              (item) => item.kind === "sound" && item.project_id === projectId,
            )
            .sort((left, right) => right.created_at_ms - left.created_at_ms),
        );
      } catch (error) {
        console.error("Failed to load project sounds:", error);
        toast.error("Could not load project sounds.");
      } finally {
        if (showLoading) {
          setIsLoadingProjectSounds(false);
        }
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadProjectSounds();
  }, [loadProjectSounds]);

  useEffect(() => {
    const unlisten = listen("story-audio-updated", () => {
      void loadProjectSounds(false);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadProjectSounds]);

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
  ]);

  useEffect(() => {
    return () => {
      if (queuedAckTimerRef.current !== null) {
        window.clearTimeout(queuedAckTimerRef.current);
      }
    };
  }, []);

  const validation = useMemo(
    () => validateStoryDraft(cast, scriptText, presets, projectSounds),
    [cast, presets, projectSounds, scriptText],
  );
  const castNameSet = useMemo(() => buildCastNameSet(cast), [cast]);
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
  const soundTagControl = (
    <div ref={soundAnchorRef} className="relative shrink-0">
      <button
        type="button"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--input)] text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => {
          if (soundPopoverOpen) {
            setSoundPopoverOpen(false);
            return;
          }
          openSoundPopover();
        }}
        disabled={isLoadingProjectSounds}
        aria-label={t("storyStudio.soundTags")}
        aria-haspopup="dialog"
        aria-expanded={soundPopoverOpen}
      >
        <Music2 className="h-4 w-4 text-[var(--accent)]" aria-hidden />
      </button>
      {soundPopoverOpen && soundPopoverPosition ? (
        <SoundTagPopover
          ref={soundPopoverRef}
          position={soundPopoverPosition}
          sounds={projectSounds}
          isLoading={isLoadingProjectSounds}
          onClose={() => setSoundPopoverOpen(false)}
          onOpenSoundTab={() => {
            setActiveTool("sound");
            setSoundPopoverOpen(false);
          }}
          onInsert={(sound, mode) => {
            scriptEditorRef.current?.insertText(
              `${formatSoundCueTag(sound, mode)} `,
            );
            setSoundPopoverOpen(false);
          }}
        />
      ) : null}
    </div>
  );
  useLayoutEffect(() => {
    if (!soundPopoverOpen) return;

    updateSoundPopoverPosition();
    window.addEventListener("resize", updateSoundPopoverPosition);
    window.addEventListener("scroll", updateSoundPopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updateSoundPopoverPosition);
      window.removeEventListener("scroll", updateSoundPopoverPosition, true);
    };
  }, [soundPopoverOpen, updateSoundPopoverPosition]);

  useEffect(() => {
    if (!soundPopoverOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (soundAnchorRef.current?.contains(target)) return;
      if (soundPopoverRef.current?.contains(target)) return;
      setSoundPopoverOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSoundPopoverOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [soundPopoverOpen]);

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
      title: generateStoryTitleFromScript(
        scriptText,
        t("storyStudio.defaultTitle"),
      ),
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
    t,
    validation.lines,
  ]);
  const openCreativeAudioModels = useCallback(async () => {
    await openModelHub("creative_audio", { scope: "creative_audio" });
  }, []);
  const visibleValidationErrors = validation.errors.slice(0, 4);
  const hiddenValidationErrorCount =
    validation.errors.length - visibleValidationErrors.length;
  const renderReadinessPill =
    validation.errors.length > 0 ? (
      <div
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--text)]"
        aria-live="polite"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />
        <span className="truncate">{readySummary}</span>
      </div>
    ) : null;
  const expressionTagControl = (
    <div
      ref={expressionAnchorRef}
      className="relative w-[min(20rem,100%)] max-w-[20rem] shrink-0"
    >
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
  return (
    <div className="px-6 pb-5">
      <div className="flex w-full flex-col gap-4 pb-4">
        <div className="story-studio-toolbar flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
          <Button
            type="button"
            variant="primary-soft"
            size="sm"
            className="shrink-0"
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
            className="shrink-0"
            items={[
              { value: "script", label: t("storyStudio.tools.script") },
              { value: "cast", label: t("storyStudio.tools.cast") },
              {
                value: "sound",
                label: t("storyStudio.tools.sound", {
                  defaultValue: "Sound",
                }),
              },
            ]}
          />

          {activeTool === "script" ? (
            <>
              {expressionTagControl}
              {soundTagControl}
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
            </>
          ) : null}

          {activeTool === "cast" ? (
            <div className="story-studio-toolbar__trailing ms-auto flex shrink-0 justify-end">
              {renderReadinessPill}
            </div>
          ) : null}

          {activeTool === "script" && validation.errors.length > 0 ? (
            <div className="shrink-0">{renderReadinessPill}</div>
          ) : null}

          {activeTool === "sound" ? (
            <div className="story-studio-toolbar__trailing ms-auto flex shrink-0 justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void openCreativeAudioModels()}
              >
                <Layers className="h-3.5 w-3.5" />
                {t("listen.createVoices.models", { defaultValue: "Models" })}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {activeTool !== "sound" && validation.errors.length > 0 ? (
            <div
              id="story-studio-validation-errors"
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

          {!isLoadingPresets &&
          !isLoadingVoiceChoices &&
          !hasVoiceChoices &&
          activeTool !== "sound" ? (
            <EmptyStoryVoices
              onOpenMyVoices={() =>
                window.dispatchEvent(
                  new CustomEvent("vox-jot:navigate", {
                    detail: { view: "listen", section: "voice-design" },
                  }),
                )
              }
              onRefresh={() => void refreshPresets()}
            />
          ) : activeTool === "script" ? (
            <ScriptEditor
              ref={scriptEditorRef}
              value={scriptText}
              castNames={castNameSet}
              onChange={setScriptText}
              onCursorChange={setScriptSelection}
              ariaInvalid={validation.errors.length > 0}
              ariaDescribedBy={
                validation.errors.length > 0
                  ? "story-studio-validation-errors"
                  : undefined
              }
            />
          ) : activeTool === "cast" ? (
            <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
              <CastBuilder
                cast={cast}
                presets={presets}
                presetVoices={presetVoices}
                ttsModels={ttsModels}
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
          ) : (
            <SoundDesignPanel
              projectId={projectId}
              sounds={projectSounds}
              onSoundsChanged={() => void loadProjectSounds(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const EmptyStoryVoices: React.FC<{
  onOpenMyVoices: () => void;
  onRefresh: () => void;
}> = ({ onOpenMyVoices, onRefresh }) => {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[28rem] items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-10 shadow-[var(--shadow-sm)]">
      <div className="max-w-md text-center">
        <Volume2 className="mx-auto mb-4 h-8 w-8 text-[var(--accent)]" />
        <h3 className="text-lg font-semibold text-[var(--text)]">
          {t("storyStudio.emptyVoicesTitle")}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {t("storyStudio.emptyVoicesDescription")}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button type="button" variant="primary" onClick={onOpenMyVoices}>
            {t("storyStudio.openMyVoices")}
          </Button>
          <Button type="button" variant="secondary" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>
    </div>
  );
};

const SoundTagPopover = React.forwardRef<
  HTMLDivElement,
  {
    position: ExpressionPopoverPosition;
    sounds: StorySoundItem[];
    isLoading: boolean;
    onClose: () => void;
    onOpenSoundTab: () => void;
    onInsert: (sound: StorySoundItem, mode: StorySoundCueMode) => void;
  }
>(function SoundTagPopover(
  { position, sounds, isLoading, onClose, onOpenSoundTab, onInsert },
  ref,
) {
  const { t } = useTranslation();

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-sm text-[var(--text)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
      role="dialog"
      aria-label={t("storyStudio.soundTags")}
    >
      <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--text)]">
            {t("storyStudio.soundTags")}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {t("storyStudio.soundTagsDescription")}
          </p>
        </div>
        <ActionIconButton
          type="button"
          onClick={onClose}
          aria-label={t("common.close", { defaultValue: "Close" })}
        >
          <X aria-hidden />
        </ActionIconButton>
      </div>
      <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
        {isLoading ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted)]">
            {t("common.loading", { defaultValue: "Loading..." })}
          </p>
        ) : sounds.length > 0 ? (
          sounds.map((sound) => (
            <SoundTagPickerRow
              key={sound.id}
              sound={sound}
              onInsert={(mode) => onInsert(sound, mode)}
            />
          ))
        ) : (
          <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3">
            <p className="text-xs text-[var(--muted)]">
              {t("storyStudio.noProjectSoundsForTags")}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={onOpenSoundTab}>
              {t("storyStudio.openSoundTab")}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
});

const SoundTagPickerRow: React.FC<{
  sound: StorySoundItem;
  onInsert: (mode: StorySoundCueMode) => void;
}> = ({ sound, onInsert }) => {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
      <p className="truncate text-sm font-semibold text-[var(--text)]">
        {sound.title}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          className="min-h-8 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 text-xs font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => onInsert("insert")}
        >
          {t("storyStudio.insertSoundTimeline", {
            defaultValue: "Insert in timeline",
          })}
        </button>
        <button
          type="button"
          className="min-h-8 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 text-xs font-semibold text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => onInsert("overlay")}
        >
          {t("storyStudio.overlaySoundUnderVoice", {
            defaultValue: "Overlay under voice",
          })}
        </button>
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
        <ActionIconButton
          type="button"
          onClick={onClose}
          aria-label={t("storyStudio.closeExpressionControls")}
        >
          <X aria-hidden />
        </ActionIconButton>
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
    activeTool:
      draft.activeTool === "cast" || draft.activeTool === "sound"
        ? draft.activeTool
        : "script",
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

function formatSoundCueTag(
  sound: StorySoundItem,
  mode: StorySoundCueMode,
): string {
  return `[sound id="${escapeSoundTagAttribute(sound.id)}" mode="${mode}" title="${escapeSoundTagAttribute(sound.title)}"]`;
}

function escapeSoundTagAttribute(value: string): string {
  return value
    .replace(/"/g, "'")
    .replace(/[\r\n]+/g, " ")
    .trim();
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
