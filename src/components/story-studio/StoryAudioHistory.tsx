import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  AlertCircle,
  Check,
  Copy,
  FolderOpen,
  Forward,
  Loader2,
  Music2,
  Pause,
  Play,
  Rewind,
  Save,
  SkipBack,
  SkipForward,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AudioPlayer } from "@/components/ui/AudioPlayer";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useRefreshOnWindowFocus } from "@/hooks/useRefreshOnWindowFocus";

export interface StoryAudioItem {
  id: string;
  project_id?: string | null;
  title: string;
  script_text: string;
  output_path: string;
  clips_path?: string | null;
  created_at_ms: number;
  duration_ms: number;
  line_count: number;
  cast_count?: number;
  generation_time_ms?: number;
  sample_rate_hz?: number;
  expression_tags_used?: boolean;
  inline_prompt_used?: boolean;
  audio_effect?: StoryAudioEffectPreset;
  starred: boolean;
}

type StoryAudioEffectPreset =
  | "clean"
  | "voice_polish"
  | "radio"
  | "warm_room";

interface StoryClipMetadata {
  id: string;
  line_number: number;
  speaker: string;
  text: string;
  hash: string;
  file_path: string;
  duration_ms: number;
  offset_ms: number;
  waveform_peaks: number[];
}

interface StoryProjectMetadata {
  project_id: string;
  render_id: string;
  title: string;
  output_path: string;
  pause_ms_between_lines: number;
  audio_effect: StoryAudioEffectPreset;
  sample_rate_hz: number;
  clips: StoryClipMetadata[];
}

type StoryRenderJobStatus =
  | "queued"
  | "rendering"
  | "assembling"
  | "completed"
  | "failed"
  | "cancelled";

interface StoryRenderJobSummary {
  render_id: string;
  title: string;
  status: StoryRenderJobStatus;
  created_at_ms: number;
  queued_at_ms: number;
  started_at_ms?: number | null;
  current_line: number;
  total_lines: number;
  speaker?: string | null;
  error?: string | null;
  queue_position?: number | null;
}

interface StoryAudioHistoryProps {
  items: StoryAudioItem[];
  jobs: StoryRenderJobSummary[];
  nowMs: number;
  isLoading: boolean;
  view: StoryAudioView;
  selectedAudioId: string | null;
  onViewChange: (view: StoryAudioView) => void;
  onSelectAudio: (item: StoryAudioItem, openPlayer?: boolean) => void;
  onReveal: (item: StoryAudioItem) => void;
  onToggleStarred: (item: StoryAudioItem) => void;
  onRename: (item: StoryAudioItem, title: string) => Promise<void>;
  onDelete: (item: StoryAudioItem) => void;
  onCancelJob: (job: StoryRenderJobSummary) => void;
  onCreateProcessed: (
    item: StoryAudioItem,
    playbackRate: number,
    sampleRateHz: number,
    audioEffect: StoryAudioEffectPreset,
  ) => Promise<void>;
}

type StoryAudioView = "timeline" | "player";

const historyActionButtonClassName =
  "inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]";

const historyDangerActionButtonClassName =
  "inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]";
const historyConfirmDeleteButtonClassName =
  "inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger-soft)_70%,var(--danger)_30%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]";

const storyChipClassName =
  "inline-flex max-w-full min-w-0 items-center rounded-full border border-mid-gray/20 px-2.5 py-1 text-xs font-semibold leading-4 text-[var(--muted)]";

const storyMetaSeparatorClassName =
  "shrink-0 text-[color-mix(in_srgb,var(--muted),transparent_50%)]";

const playbackRateOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
const fixedSampleRateOptions = [16_000, 24_000, 44_100, 48_000];
const storyAudioEffectOptions: StoryAudioEffectPreset[] = [
  "clean",
  "voice_polish",
  "radio",
  "warm_room",
];
const storyExpressionTokenPattern = /(\[[^\]\n]{1,80}\]|\([^()\n]{1,80}\))/g;

export const StoryAudioHistory: React.FC<StoryAudioHistoryProps> = ({
  items,
  jobs,
  nowMs,
  isLoading,
  view,
  selectedAudioId,
  onViewChange,
  onSelectAudio,
  onReveal,
  onToggleStarred,
  onRename,
  onDelete,
  onCancelJob,
  onCreateProcessed,
}) => {
  const { t, i18n } = useTranslation();
  const storyAudioViewItems = useMemo(
    () =>
      [
        { value: "timeline", label: t("storyAudio.tabs.timeline") },
        { value: "player", label: t("storyAudio.tabs.player") },
      ] satisfies Array<{ value: StoryAudioView; label: string }>,
    [t],
  );
  const sortedItems = sortStoryAudioItems(items);
  const groupedItems = groupStoryAudioItems(
    sortedItems,
    t,
    i18n.resolvedLanguage,
  );
  const selectedItem =
    sortedItems.find((item) => item.id === selectedAudioId) ??
    sortedItems[0] ??
    null;
  const selectedIndex = selectedItem
    ? sortedItems.findIndex((item) => item.id === selectedItem.id)
    : -1;
  const previousItem =
    selectedIndex > 0 ? sortedItems[selectedIndex - 1] : null;
  const nextItem =
    selectedIndex >= 0 && selectedIndex + 1 < sortedItems.length
      ? sortedItems[selectedIndex + 1]
      : null;

  return (
    <section
      className="space-y-3"
      aria-label={t("storyAudio.generatedAudioAriaLabel")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<StoryAudioView>
          items={storyAudioViewItems}
          value={view}
          onChange={onViewChange}
          ariaLabel={t("storyAudio.viewAriaLabel")}
          layoutId="generated-audio-view"
        />
        {selectedItem && view === "player" ? (
          <p className="min-w-0 truncate text-xs font-medium text-[var(--muted)]">
            {t("storyAudio.position", {
              current: selectedIndex + 1,
              total: sortedItems.length,
            })}
          </p>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flat-card overflow-visible px-5 py-8 text-center">
          <p className="text-sm font-semibold text-[var(--text)]">
            {t("storyAudio.loading")}
          </p>
        </div>
      ) : groupedItems.length === 0 && jobs.length === 0 ? (
        <div className="flat-card overflow-visible px-5 py-8 text-center">
          <p className="text-sm font-semibold text-[var(--text)]">
            {t("storyAudio.emptyTitle")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {t("storyAudio.emptyDescription")}
          </p>
        </div>
      ) : view === "player" ? (
        <StoryAudioPlayerView
          item={selectedItem}
          previousItem={previousItem}
          nextItem={nextItem}
          onSelectAudio={onSelectAudio}
          onReveal={onReveal}
          onRename={onRename}
          onCreateProcessed={onCreateProcessed}
        />
      ) : (
        <div className="space-y-5 py-4">
          {jobs.length > 0 ? (
            <section className="space-y-2.5">
              <div className="sticky top-0 z-10 -mx-1 px-1 py-1 backdrop-blur-md">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  {t("storyAudio.status.rendering")}
                </p>
              </div>
              <div className="space-y-3">
                {jobs.map((job) => (
                  <StoryRenderJobCard
                    key={job.render_id}
                    job={job}
                    nowMs={nowMs}
                    onCancel={onCancelJob}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {groupedItems.map((group) => (
            <section key={group.key} className="space-y-2.5">
              <div className="sticky top-0 z-10 -mx-1 px-1 py-1 backdrop-blur-md">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  {group.label}
                </p>
              </div>
              <div className="space-y-3">
                {group.items.map((item) => (
                  <StoryAudioHistoryCard
                    key={item.id}
                    item={item}
                    selected={item.id === selectedItem?.id}
                    onSelect={onSelectAudio}
                    onReveal={onReveal}
                    onToggleStarred={onToggleStarred}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
};

export const StoryAudioSidebar: React.FC = () => {
  const [items, setItems] = useState<StoryAudioItem[]>([]);
  const [jobs, setJobs] = useState<StoryRenderJobSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [view, setView] = useState<StoryAudioView>("timeline");
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);

  const loadItems = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setIsLoading(true);
    }
    try {
      const nextItems = await invoke<StoryAudioItem[]>("list_story_audio");
      const sortedItems = sortStoryAudioItems(nextItems);
      setItems(sortedItems);
      setSelectedAudioId((current) =>
        current && sortedItems.some((item) => item.id === current)
          ? current
          : (sortedItems[0]?.id ?? null),
      );
    } catch (error) {
      console.error("Failed to load generated story audio:", error);
      toast.error("Could not load generated story audio.");
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useRefreshOnWindowFocus(() => loadItems(false));

  const loadJobs = useCallback(async () => {
    try {
      const nextJobs = await invoke<StoryRenderJobSummary[]>(
        "list_story_render_jobs",
      );
      setJobs(sortStoryRenderJobs(nextJobs));
    } catch (error) {
      console.error("Failed to load story render jobs:", error);
      toast.error("Could not load story render queue.");
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    const unlisten = listen("story-audio-updated", () => {
      void loadItems();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadItems]);

  useEffect(() => {
    const unlisten = listen<StoryRenderJobSummary[]>(
      "story-render-queue-updated",
      (event) => {
        setJobs(sortStoryRenderJobs(event.payload));
        setNowMs(Date.now());
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!jobs.some(isLiveStoryRenderJob)) {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  useEffect(() => {
    if (items.length === 0) {
      if (selectedAudioId !== null) {
        setSelectedAudioId(null);
      }
      return;
    }
    if (
      !selectedAudioId ||
      !items.some((item) => item.id === selectedAudioId)
    ) {
      setSelectedAudioId(items[0].id);
    }
  }, [items, selectedAudioId]);

  const handleSelectAudio = useCallback(
    (item: StoryAudioItem, openPlayer = true) => {
      setSelectedAudioId(item.id);
      if (openPlayer) {
        setView("player");
      }
    },
    [],
  );

  const handleReveal = useCallback(async (item: StoryAudioItem) => {
    try {
      await invoke("reveal_story_audio", { path: item.output_path });
    } catch (error) {
      console.error("Failed to reveal story audio:", error);
      toast.error("Could not reveal story audio.");
    }
  }, []);

  const handleToggleStarred = useCallback(async (item: StoryAudioItem) => {
    try {
      const updated = await invoke<StoryAudioItem>(
        "toggle_story_audio_starred",
        {
          id: item.id,
        },
      );
      setItems((current) =>
        sortStoryAudioItems(
          current.map((currentItem) =>
            currentItem.id === updated.id ? updated : currentItem,
          ),
        ),
      );
    } catch (error) {
      console.error("Failed to update story audio:", error);
      toast.error("Could not update story audio.");
    }
  }, []);

  const handleRename = useCallback(
    async (item: StoryAudioItem, title: string) => {
      try {
        const updated = await invoke<StoryAudioItem>("rename_story_audio", {
          id: item.id,
          title,
        });
        setItems((current) =>
          sortStoryAudioItems(
            current.map((currentItem) =>
              currentItem.id === updated.id ? updated : currentItem,
            ),
          ),
        );
      } catch (error) {
        console.error("Failed to rename story audio:", error);
        toast.error("Could not rename story audio.");
        throw error;
      }
    },
    [],
  );

  const handleDelete = useCallback(async (item: StoryAudioItem) => {
    try {
      await invoke("delete_story_audio", { id: item.id });
      setItems((current) => {
        const nextItems = current.filter(
          (currentItem) => currentItem.id !== item.id,
        );
        setSelectedAudioId((currentSelectedId) =>
          currentSelectedId === item.id
            ? (nextItems[0]?.id ?? null)
            : currentSelectedId,
        );
        return nextItems;
      });
      toast.message("Story audio deleted.");
    } catch (error) {
      console.error("Failed to delete story audio:", error);
      toast.error("Could not delete story audio.");
    }
  }, []);

  const handleCancelJob = useCallback(async (job: StoryRenderJobSummary) => {
    setJobs((current) =>
      sortStoryRenderJobs(
        current.map((currentJob) =>
          currentJob.render_id === job.render_id
            ? markStoryRenderJobCancelled(currentJob)
            : currentJob,
        ),
      ),
    );
    setNowMs(Date.now());
    try {
      await invoke("cancel_story_render", { renderId: job.render_id });
      toast.message("Story render cancelled.");
    } catch (error) {
      console.error("Failed to cancel story render:", error);
      toast.error("Could not cancel story render.");
      void loadJobs();
    }
  }, [loadJobs]);

  const handleCreateProcessed = useCallback(
    async (
      item: StoryAudioItem,
      playbackRate: number,
      sampleRateHz: number,
      audioEffect: StoryAudioEffectPreset,
    ) => {
      try {
        const processed = await invoke<StoryAudioItem>(
          "create_processed_story_audio",
          {
            request: {
              id: item.id,
              playback_rate: playbackRate,
              sample_rate_hz: sampleRateHz,
              audio_effect: audioEffect,
            },
          },
        );
        setItems((current) => sortStoryAudioItems([...current, processed]));
        setSelectedAudioId(processed.id);
        setView("player");
        toast.success("Processed audio saved.");
      } catch (error) {
        console.error("Failed to save processed story audio:", error);
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not save processed audio.",
        );
      }
    },
    [],
  );

  return (
    <StoryAudioHistory
      items={items}
      jobs={jobs}
      nowMs={nowMs}
      isLoading={isLoading}
      view={view}
      selectedAudioId={selectedAudioId}
      onViewChange={setView}
      onSelectAudio={handleSelectAudio}
      onReveal={handleReveal}
      onToggleStarred={handleToggleStarred}
      onRename={handleRename}
      onDelete={handleDelete}
      onCancelJob={handleCancelJob}
      onCreateProcessed={handleCreateProcessed}
    />
  );
};

export const StoryAudioHistorySection = StoryAudioSidebar;

interface StoryAudioHistoryCardProps {
  item: StoryAudioItem;
  selected: boolean;
  onSelect: (item: StoryAudioItem, openPlayer?: boolean) => void;
  onReveal: (item: StoryAudioItem) => void;
  onToggleStarred: (item: StoryAudioItem) => void;
  onDelete: (item: StoryAudioItem) => void;
}

const StoryAudioHistoryCard: React.FC<StoryAudioHistoryCardProps> = ({
  item,
  selected,
  onSelect,
  onReveal,
  onToggleStarred,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [showCopied, setShowCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const hasScript = item.script_text.trim().length > 0;

  const handleLoadAudio = useCallback(async () => {
    try {
      const fileData = await readFile(item.output_path);
      const blob = new Blob([fileData], { type: "audio/wav" });
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error("Failed to load story audio:", error);
      toast.error(t("storyAudio.errors.load"));
      return null;
    }
  }, [item.output_path, t]);

  const handleCopyScript = async () => {
    if (!hasScript) return;
    try {
      await navigator.clipboard.writeText(item.script_text);
      setShowCopied(true);
      window.setTimeout(() => setShowCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy story script:", error);
      toast.error(t("storyAudio.errors.copyScript"));
    }
  };

  const actions = (
    <>
      <button
        type="button"
        onClick={() => void handleCopyScript()}
        className={historyActionButtonClassName}
        disabled={!hasScript}
        title={
          hasScript
            ? t("storyAudio.actions.copyScript")
            : t("storyAudio.noScriptSaved")
        }
        aria-label={
          hasScript
            ? t("storyAudio.actions.copyScript")
            : t("storyAudio.noScriptSaved")
        }
      >
        {showCopied ? (
          <Check width={14} height={14} />
        ) : (
          <Copy width={14} height={14} />
        )}
      </button>
      <button
        type="button"
        onClick={() => onReveal(item)}
        className={historyActionButtonClassName}
        title={t("storyAudio.actions.showInFolder")}
        aria-label={t("storyAudio.actions.showInFolder")}
      >
        <FolderOpen width={14} height={14} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onToggleStarred(item)}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
          item.starred
            ? "bg-[var(--accent-soft)] text-[var(--accent)] hover:text-[var(--accent)]/80"
            : "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
        }`}
        title={
          item.starred
            ? t("storyAudio.actions.unstar")
            : t("storyAudio.actions.star")
        }
        aria-label={
          item.starred
            ? t("storyAudio.actions.unstar")
            : t("storyAudio.actions.star")
        }
      >
        <Star
          width={14}
          height={14}
          fill={item.starred ? "currentColor" : "none"}
        />
      </button>
      {showDeleteConfirm ? (
        <>
          <button
            type="button"
            onClick={() => {
              onDelete(item);
              setShowDeleteConfirm(false);
            }}
            className={historyConfirmDeleteButtonClassName}
            title={t("storyAudio.actions.delete")}
            aria-label={t("storyAudio.actions.delete")}
          >
            <Trash2 width={14} height={14} />
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(false)}
            className={historyActionButtonClassName}
            title={t("storyAudio.actions.cancelDelete")}
            aria-label={t("storyAudio.actions.cancelDelete")}
          >
            <X width={14} height={14} />
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className={historyDangerActionButtonClassName}
          title={t("storyAudio.actions.delete")}
          aria-label={t("storyAudio.actions.delete")}
        >
          <Trash2 width={14} height={14} />
        </button>
      )}
    </>
  );

  const meta = <StoryAudioMetaLine item={item} />;
  const fallbackTitle = t("storyAudio.untitledStory");

  return (
    <article
      onClick={() => onSelect(item, true)}
      className={`card-linear group/story-audio relative cursor-pointer px-4 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text)_4%,transparent)] ${
        selected
          ? "border-[color-mix(in_srgb,var(--accent),transparent_45%)] bg-[var(--accent-soft)]"
          : ""
      }`}
      title={t("storyAudio.actions.openInPlayer")}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <AudioPlayer
          onLoadRequest={handleLoadAudio}
          className="min-w-0"
          initialDuration={
            item.duration_ms > 0 ? item.duration_ms / 1000 : undefined
          }
          title={item.title || fallbackTitle}
          meta={meta}
          actions={actions}
          starred={item.starred}
          selected={selected}
        />
      </div>
    </article>
  );
};

/** Compact one-line metadata, dot-separated, that replaces the chip cluster. */
const StoryAudioMetaLine: React.FC<{ item: StoryAudioItem }> = ({ item }) => {
  const { t } = useTranslation();
  const hasScript = item.script_text.trim().length > 0;
  const lineLabel =
    item.line_count > 0
      ? t("storyAudio.meta.lines", { count: item.line_count })
      : t("storyAudio.meta.audioFile");

  const parts: React.ReactNode[] = [
    <span key="time">{formatStoryTime(item.created_at_ms)}</span>,
    <span key="lines">{lineLabel}</span>,
    <span key="duration" className="tabular-nums">
      {formatDuration(item.duration_ms)}
    </span>,
  ];
  if (typeof item.cast_count === "number" && item.cast_count > 0) {
    parts.push(
      <span key="cast">
        {t("storyAudio.meta.cast", { count: item.cast_count })}
      </span>,
    );
  }
  if (
    typeof item.generation_time_ms === "number" &&
    item.generation_time_ms > 0
  ) {
    parts.push(
      <span key="gen">
        {t("storyAudio.meta.generatedIn")}{" "}
        {formatGenerationTime(item.generation_time_ms)}
      </span>,
    );
  }
  if (typeof item.sample_rate_hz === "number" && item.sample_rate_hz > 0) {
    parts.push(<span key="sr">{formatSampleRate(item.sample_rate_hz)}</span>);
  }
  if (item.audio_effect && item.audio_effect !== "clean") {
    parts.push(
      <span key="effect">{formatStoryAudioEffect(item.audio_effect)}</span>,
    );
  }
  parts.push(
    <span
      key="script"
      className={
        hasScript
          ? "inline-flex items-center gap-1 font-semibold text-[var(--success)]"
          : ""
      }
    >
      {hasScript ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-[var(--success)]"
        />
      ) : null}
      {hasScript
        ? t("storyAudio.meta.scriptSaved")
        : t("storyAudio.meta.audioOnly")}
    </span>,
  );
  if (item.expression_tags_used) {
    parts.push(<span key="exp">{t("storyAudio.meta.expressionTags")}</span>);
  }
  if (item.inline_prompt_used) {
    parts.push(<span key="inl">{t("storyAudio.meta.inlinePrompt")}</span>);
  }

  return (
    <>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 ? (
            <span aria-hidden className={storyMetaSeparatorClassName}>
              ·
            </span>
          ) : null}
          {part}
        </React.Fragment>
      ))}
    </>
  );
};

const StoryAudioPlayerView: React.FC<{
  item: StoryAudioItem | null;
  previousItem: StoryAudioItem | null;
  nextItem: StoryAudioItem | null;
  onSelectAudio: (item: StoryAudioItem, openPlayer?: boolean) => void;
  onReveal: (item: StoryAudioItem) => void;
  onRename: (item: StoryAudioItem, title: string) => Promise<void>;
  onCreateProcessed: (
    item: StoryAudioItem,
    playbackRate: number,
    sampleRateHz: number,
    audioEffect: StoryAudioEffectPreset,
  ) => Promise<void>;
}> = ({
  item,
  previousItem,
  nextItem,
  onSelectAudio,
  onReveal,
  onRename,
  onCreateProcessed,
}) => {
  const { t } = useTranslation();
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sampleRateHz, setSampleRateHz] = useState(24_000);
  const [audioEffect, setAudioEffect] = useState<StoryAudioEffectPreset>(
    item?.audio_effect ?? "clean",
  );
  const [isSaving, setIsSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const animationRef = useRef<number>();

  const hasScript = Boolean(item?.script_text.trim());

  useEffect(() => {
    setCurrentTime(0);
    setDuration(item && item.duration_ms > 0 ? item.duration_ms / 1000 : 0);
    setIsPlaying(false);
    setPlaybackRate(1);
    setSampleRateHz(item?.sample_rate_hz || 24_000);
    setAudioEffect(item?.audio_effect ?? "clean");
    setAudioSrc((currentSrc) => {
      if (currentSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(currentSrc);
      }
      return null;
    });
  }, [item?.id, item?.sample_rate_hz, item?.duration_ms, item?.audio_effect]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
  }, [playbackRate, audioSrc]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
      return;
    }

    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        setCurrentTime(audio.currentTime);
      }
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (audioSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(audioSrc);
      }
    };
  }, [audioSrc]);

  const loadAudio = useCallback(async () => {
    if (!item) return null;
    if (audioSrc) return audioSrc;
    setIsLoadingAudio(true);
    try {
      const fileData = await readFile(item.output_path);
      const blob = new Blob([fileData], { type: "audio/wav" });
      const nextSrc = URL.createObjectURL(blob);
      setAudioSrc(nextSrc);
      return nextSrc;
    } catch (error) {
      console.error("Failed to load story audio:", error);
      toast.error("Could not load story audio.");
      return null;
    } finally {
      setIsLoadingAudio(false);
    }
  }, [audioSrc, item]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !item || isLoadingAudio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    const src = await loadAudio();
    if (!src) return;
    audio.playbackRate = playbackRate;
    try {
      await audio.play();
    } catch (error) {
      console.error("Playback failed:", error);
      toast.error("Could not play generated audio.");
    }
  };

  const handleScrub = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number.parseFloat(event.target.value);
    setCurrentTime(nextTime);
    if (audioRef.current) {
      audioRef.current.currentTime = nextTime;
    }
  };

  const handleSaveProcessed = async () => {
    if (!item || isSaving) return;
    setIsSaving(true);
    try {
      await onCreateProcessed(item, playbackRate, sampleRateHz, audioEffect);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) {
      return;
    }
    if (deltaX < 0 && nextItem) {
      onSelectAudio(nextItem, true);
    } else if (deltaX > 0 && previousItem) {
      onSelectAudio(previousItem, true);
    }
  };

  const progressPercent =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;
  const sampleRateOptions = [
    item?.sample_rate_hz || 24_000,
    ...fixedSampleRateOptions,
  ].filter((value, index, values) => values.indexOf(value) === index);

  if (!item) {
    return (
      <div className="flat-card px-5 py-8 text-center">
        <p className="text-sm font-semibold text-[var(--text)]">
          {t("storyAudio.noSelectionTitle")}
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {t("storyAudio.noSelectionDescription")}
        </p>
      </div>
    );
  }

  return (
    <article
      className="flex min-h-[calc(100dvh-14rem)] flex-col gap-4"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="story-audio-player-scroll min-h-[16rem] flex-1 overflow-y-auto px-1 py-1">
        <StoryClipTimeline
          item={item}
          currentTime={currentTime}
          duration={duration}
          onSeek={(seconds) => {
            setCurrentTime(seconds);
            if (audioRef.current) {
              audioRef.current.currentTime = seconds;
            }
          }}
        />
        {hasScript ? (
          <pre className="whitespace-pre-wrap break-words font-[var(--font-body)] text-[17px] font-medium leading-8 text-[var(--text)]">
            {renderStoryScriptText(item.script_text)}
          </pre>
        ) : (
          <p className="text-base font-medium leading-7 text-[var(--muted)]">
            {t("storyAudio.noScriptSaved")}
          </p>
        )}
      </div>

      <DockedStoryAudioPlayer
        item={item}
        audioRef={audioRef}
        audioSrc={audioSrc}
        isPlaying={isPlaying}
        isLoadingAudio={isLoadingAudio}
        currentTime={currentTime}
        duration={duration}
        progressPercent={progressPercent}
        playbackRate={playbackRate}
        sampleRateHz={sampleRateHz}
        audioEffect={audioEffect}
        sampleRateOptions={sampleRateOptions}
        isSaving={isSaving}
        previousItem={previousItem}
        nextItem={nextItem}
        onTogglePlay={() => void togglePlayback()}
        onScrub={handleScrub}
        onChangePlaybackRate={setPlaybackRate}
        onChangeSampleRate={setSampleRateHz}
        onChangeAudioEffect={setAudioEffect}
        onSelectAudio={onSelectAudio}
        onReveal={onReveal}
        onRenameTitle={onRename}
        onSaveProcessed={() => void handleSaveProcessed()}
        onAudioLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          event.currentTarget.playbackRate = playbackRate;
        }}
        onAudioPlay={() => setIsPlaying(true)}
        onAudioPause={() => setIsPlaying(false)}
        onAudioEnded={() => {
          setIsPlaying(false);
          setCurrentTime(duration || 0);
        }}
      />
    </article>
  );
};

interface DockedStoryAudioPlayerProps {
  item: StoryAudioItem;
  audioRef: React.RefObject<HTMLAudioElement>;
  audioSrc: string | null;
  isPlaying: boolean;
  isLoadingAudio: boolean;
  currentTime: number;
  duration: number;
  progressPercent: number;
  playbackRate: number;
  sampleRateHz: number;
  audioEffect: StoryAudioEffectPreset;
  sampleRateOptions: number[];
  isSaving: boolean;
  previousItem: StoryAudioItem | null;
  nextItem: StoryAudioItem | null;
  onTogglePlay: () => void;
  onScrub: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onChangePlaybackRate: (value: number) => void;
  onChangeSampleRate: (value: number) => void;
  onChangeAudioEffect: (value: StoryAudioEffectPreset) => void;
  onSelectAudio: (item: StoryAudioItem, openPlayer?: boolean) => void;
  onReveal: (item: StoryAudioItem) => void;
  onRenameTitle: (item: StoryAudioItem, title: string) => Promise<void>;
  onSaveProcessed: () => void;
  onAudioLoadedMetadata: (
    event: React.SyntheticEvent<HTMLAudioElement>,
  ) => void;
  onAudioPlay: () => void;
  onAudioPause: () => void;
  onAudioEnded: () => void;
}

const DOCKED_TICK_COUNT = 64;
const DOCKED_TICK_HEIGHTS = Array.from(
  { length: DOCKED_TICK_COUNT },
  (_, i) => {
    const phase = i / (DOCKED_TICK_COUNT - 1);
    const wave =
      0.4 +
      0.6 *
        Math.abs(
          Math.sin(i * 0.5 + 0.4) *
            Math.cos(i * 0.27 + 1.3) *
            (1 - 0.2 * Math.abs(phase - 0.5)),
        );
    return Math.max(20, Math.min(100, Math.round(wave * 100)));
  },
);

const DockedStoryAudioPlayer: React.FC<DockedStoryAudioPlayerProps> = ({
  item,
  audioRef,
  audioSrc,
  isPlaying,
  isLoadingAudio,
  currentTime,
  duration,
  progressPercent,
  playbackRate,
  sampleRateHz,
  audioEffect,
  sampleRateOptions,
  isSaving,
  previousItem,
  nextItem,
  onTogglePlay,
  onScrub,
  onChangePlaybackRate,
  onChangeSampleRate,
  onChangeAudioEffect,
  onSelectAudio,
  onReveal,
  onRenameTitle,
  onSaveProcessed,
  onAudioLoadedMetadata,
  onAudioPlay,
  onAudioPause,
  onAudioEnded,
}) => {
  const { t } = useTranslation();
  const hasAudio = duration > 0;
  const fallbackTitle = t("storyAudio.untitledStory");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title || fallbackTitle);
  const [isRenaming, setIsRenaming] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditingTitle) {
      setDraftTitle(item.title || fallbackTitle);
    }
  }, [fallbackTitle, isEditingTitle, item.id, item.title]);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const commitTitle = async () => {
    const nextTitle = draftTitle.trim();
    const currentTitle = item.title || fallbackTitle;
    if (isRenaming) return;
    if (!nextTitle || nextTitle === currentTitle) {
      setDraftTitle(currentTitle);
      setIsEditingTitle(false);
      return;
    }

    setIsRenaming(true);
    try {
      await onRenameTitle(item, nextTitle);
      setIsEditingTitle(false);
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <div className="story-audio-docked-player z-20 mt-auto overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[0_22px_60px_-18px_rgba(0,0,0,0.32)]">
      <audio
        ref={audioRef}
        src={audioSrc ?? undefined}
        preload="metadata"
        onLoadedMetadata={onAudioLoadedMetadata}
        onPlay={onAudioPlay}
        onPause={onAudioPause}
        onEnded={onAudioEnded}
      />

      {/* Cassette row */}
      <div className="flex items-center gap-4 px-4 pt-4">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={isLoadingAudio}
          aria-label={isPlaying ? t("common.pause") : t("common.play")}
          title={isPlaying ? t("common.pause") : t("common.play")}
          className={`relative inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-[var(--inverse-text)] transition-all duration-200 ease-out hover:scale-[1.03] hover:bg-[var(--accent-hover)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:opacity-50 disabled:hover:scale-100 ${
            isPlaying
              ? "shadow-[0_14px_36px_-12px_color-mix(in_srgb,var(--accent),transparent_25%)]"
              : "shadow-[0_8px_22px_-10px_color-mix(in_srgb,var(--accent),transparent_45%)]"
          }`}
        >
          {isLoadingAudio ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-7 w-7" fill="currentColor" />
          ) : (
            <Play className="h-7 w-7 translate-x-[1px]" fill="currentColor" />
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={() => void commitTitle()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  setDraftTitle(item.title || fallbackTitle);
                  setIsEditingTitle(false);
                }
              }}
              disabled={isRenaming}
              className="h-7 min-w-0 rounded-md border border-[var(--accent)] bg-[var(--input)] px-2 text-base font-semibold leading-6 text-[var(--text)] outline-none focus:ring-2 focus:ring-[var(--accent-glow)] disabled:opacity-70"
              aria-label={t("storyAudio.titleAriaLabel")}
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingTitle(true)}
              className="min-w-0 truncate rounded-md text-start text-base font-semibold leading-6 text-[var(--text)] transition-colors hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
              title={t("storyAudio.actions.rename")}
              aria-label={t("storyAudio.actions.renameWithTitle", {
                title: item.title || fallbackTitle,
              })}
            >
              {item.title || fallbackTitle}
            </button>
          )}
          <div className="flex min-w-0 items-center gap-1.5 truncate text-[12px] leading-5 text-[var(--muted)]">
            <span className="tabular-nums text-[var(--text)]">
              {formatAudioClock(currentTime)}
            </span>
            <span aria-hidden className={storyMetaSeparatorClassName}>
              /
            </span>
            <span className="tabular-nums">
              {formatAudioClock(duration || item.duration_ms / 1000)}
            </span>
            <span aria-hidden className={storyMetaSeparatorClassName}>
              ·
            </span>
            <span>{formatSampleRate(item.sample_rate_hz || 24_000)}</span>
            {item.audio_effect && item.audio_effect !== "clean" ? (
              <>
                <span aria-hidden className={storyMetaSeparatorClassName}>
                  ·
                </span>
                <span>{formatStoryAudioEffect(item.audio_effect)}</span>
              </>
            ) : null}
            {item.line_count > 0 ? (
              <>
                <span aria-hidden className={storyMetaSeparatorClassName}>
                  ·
                </span>
                <span>
                  {t("storyAudio.meta.lines", { count: item.line_count })}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() =>
              previousItem ? onSelectAudio(previousItem, true) : undefined
            }
            disabled={!previousItem}
            className={historyActionButtonClassName}
            title={t("storyAudio.actions.previous")}
            aria-label={t("storyAudio.actions.previous")}
          >
            <SkipBack width={16} height={16} />
          </button>
          <button
            type="button"
            onClick={() =>
              nextItem ? onSelectAudio(nextItem, true) : undefined
            }
            disabled={!nextItem}
            className={historyActionButtonClassName}
            title={t("storyAudio.actions.next")}
            aria-label={t("storyAudio.actions.next")}
          >
            <SkipForward width={16} height={16} />
          </button>
          <button
            type="button"
            onClick={() => onReveal(item)}
            className={historyActionButtonClassName}
            title={t("storyAudio.actions.showInFolder")}
            aria-label={t("storyAudio.actions.showInFolder")}
          >
            <FolderOpen width={15} height={15} />
          </button>
        </div>
      </div>

      {/* Waveform scrubber */}
      <div className="px-4 pt-3">
        <div className="group/scrub relative flex h-7 cursor-pointer items-center">
          <div
            aria-hidden
            className="absolute inset-0 flex items-center gap-[2px]"
          >
            {DOCKED_TICK_HEIGHTS.map((heightPercent, index) => {
              const tickProgress = ((index + 0.5) / DOCKED_TICK_COUNT) * 100;
              const isFilled = hasAudio && tickProgress <= progressPercent;
              return (
                <span
                  key={index}
                  className="flex-1 rounded-full transition-colors duration-100"
                  style={{
                    height: `${heightPercent}%`,
                    background: isFilled
                      ? "var(--accent)"
                      : audioSrc
                        ? "color-mix(in srgb, var(--muted), transparent 55%)"
                        : "color-mix(in srgb, var(--muted), transparent 75%)",
                  }}
                />
              );
            })}
          </div>
          {hasAudio ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 h-7 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-0 shadow-[0_2px_8px_color-mix(in_srgb,var(--accent),transparent_55%)] transition-opacity duration-150 group-hover/scrub:opacity-100"
              style={{ left: `${progressPercent}%` }}
            />
          ) : null}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={currentTime}
            onChange={onScrub}
            disabled={!hasAudio}
            className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
            aria-label={t("storyAudio.timelineAriaLabel")}
          />
        </div>
      </div>

      {/* Bottom control row: speed, sample rate, effect, save */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          <span>{t("storyAudio.controls.speed")}</span>
          <PlaybackRatePopover
            value={playbackRate}
            options={playbackRateOptions}
            onChange={onChangePlaybackRate}
          />
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          <span>
            {t("storyAudio.controls.effect", { defaultValue: "Effect" })}
          </span>
          <StoryAudioEffectPopover
            value={audioEffect}
            onChange={onChangeAudioEffect}
          />
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          <span>{t("storyAudio.controls.saveAs")}</span>
          <SampleRatePopover
            value={sampleRateHz}
            options={sampleRateOptions}
            onChange={onChangeSampleRate}
          />
          <button
            type="button"
            onClick={onSaveProcessed}
            disabled={isSaving}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 text-[12px] font-semibold normal-case tracking-normal text-[var(--accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent-soft),var(--accent)_15%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:opacity-50"
            title={t("storyAudio.controls.saveProcessedCopy")}
            aria-label={t("storyAudio.controls.saveProcessedCopy")}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("storyAudio.controls.saveCopy")}
          </button>
        </div>
      </div>
    </div>
  );
};

const PlaybackRatePopover: React.FC<{
  value: number;
  options: number[];
  onChange: (value: number) => void;
}> = ({ value, options, onChange }) => {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--bg)] p-0.5">
      {options.map((option) => {
        const isActive = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={isActive}
            className={`min-w-[2.6rem] rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums normal-case tracking-normal transition-colors ${
              isActive
                ? "bg-[var(--accent)] text-[var(--inverse-text)] shadow-sm"
                : "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            }`}
            title={`${formatPlaybackRate(option)} playback speed`}
          >
            {formatPlaybackRate(option)}
          </button>
        );
      })}
    </div>
  );
};

const SampleRatePopover: React.FC<{
  value: number;
  options: number[];
  onChange: (value: number) => void;
}> = ({ value, options, onChange }) => {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--bg)] p-0.5">
      {options.map((option) => {
        const isActive = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={isActive}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums normal-case tracking-normal transition-colors ${
              isActive
                ? "bg-[var(--accent)] text-[var(--inverse-text)] shadow-sm"
                : "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            }`}
            title={`Save at ${formatSampleRate(option)}`}
          >
            {formatSampleRate(option)}
          </button>
        );
      })}
    </div>
  );
};

const StoryAudioEffectPopover: React.FC<{
  value: StoryAudioEffectPreset;
  onChange: (value: StoryAudioEffectPreset) => void;
}> = ({ value, onChange }) => {
  return (
    <div className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--bg)] p-0.5">
      {storyAudioEffectOptions.map((option) => {
        const isActive = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={isActive}
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold normal-case tracking-normal transition-colors ${
              isActive
                ? "bg-[var(--accent)] text-[var(--inverse-text)] shadow-sm"
                : "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            }`}
            title={`Save with ${formatStoryAudioEffect(option)}`}
          >
            {formatStoryAudioEffect(option)}
          </button>
        );
      })}
    </div>
  );
};

const StoryClipTimeline: React.FC<{
  item: StoryAudioItem;
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
}> = ({ item, currentTime, duration, onSeek }) => {
  const { t } = useTranslation();
  const [metadata, setMetadata] = useState<StoryProjectMetadata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [offsetAdjustments, setOffsetAdjustments] = useState<
    Record<string, number>
  >({});
  const [durationAdjustments, setDurationAdjustments] = useState<
    Record<string, number>
  >({});
  const dragRef = useRef<{
    clipId: string;
    startX: number;
    startOffset: number;
    timelineMs: number;
    mode: "move" | "resize";
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMetadata(null);
    setLoadError(null);
    setSelectedClipId(null);
    setOffsetAdjustments({});
    setDurationAdjustments({});

    if (!item.clips_path) {
      return;
    }

    void (async () => {
      try {
        const fileData = await readFile(item.clips_path ?? "");
        const parsed = JSON.parse(
          new TextDecoder().decode(fileData),
        ) as StoryProjectMetadata;
        if (cancelled) return;
        const clips = [...(parsed.clips ?? [])].sort(
          (left, right) =>
            left.offset_ms - right.offset_ms || left.line_number - right.line_number,
        );
        setMetadata({ ...parsed, clips });
        setSelectedClipId(clips[0]?.id ?? null);
      } catch (error) {
        console.error("Failed to load story clip timeline:", error);
        if (!cancelled) {
          setLoadError(
            t("storyAudio.timelineLoadError", {
              defaultValue: "Clip timeline unavailable.",
            }),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item.clips_path, item.id, t]);

  const clips = metadata?.clips ?? [];
  const timelineMs = Math.max(
    item.duration_ms,
    Math.round(duration * 1000),
    ...clips.map((clip) => clip.offset_ms + clip.duration_ms),
    1,
  );
  const selectedIndex = clips.findIndex((clip) => clip.id === selectedClipId);
  const selectedClip = selectedIndex >= 0 ? clips[selectedIndex] : null;

  const getAdjustedOffset = useCallback(
    (clip: StoryClipMetadata) =>
      Math.max(0, clip.offset_ms + (offsetAdjustments[clip.id] ?? 0)),
    [offsetAdjustments],
  );
  const getAdjustedDuration = useCallback(
    (clip: StoryClipMetadata) =>
      Math.max(250, clip.duration_ms + (durationAdjustments[clip.id] ?? 0)),
    [durationAdjustments],
  );

  const selectClip = useCallback(
    (clip: StoryClipMetadata) => {
      setSelectedClipId(clip.id);
      onSeek(getAdjustedOffset(clip) / 1000);
    },
    [getAdjustedOffset, onSeek],
  );

  const selectByDelta = useCallback(
    (delta: number) => {
      if (clips.length === 0) return;
      const currentIndex = Math.max(0, selectedIndex);
      const nextIndex = Math.min(
        clips.length - 1,
        Math.max(0, currentIndex + delta),
      );
      selectClip(clips[nextIndex]);
    },
    [clips, selectClip, selectedIndex],
  );

  const nudgeSelected = useCallback(
    (deltaMs: number) => {
      if (!selectedClip) return;
      setOffsetAdjustments((current) => ({
        ...current,
        [selectedClip.id]: Math.max(
          -selectedClip.offset_ms,
          (current[selectedClip.id] ?? 0) + deltaMs,
        ),
      }));
    },
    [selectedClip],
  );

  const resizeSelected = useCallback(
    (deltaMs: number) => {
      if (!selectedClip) return;
      setDurationAdjustments((current) => ({
        ...current,
        [selectedClip.id]: Math.max(
          250 - selectedClip.duration_ms,
          (current[selectedClip.id] ?? 0) + deltaMs,
        ),
      }));
    },
    [selectedClip],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const target = event.currentTarget;
      const width = target.getBoundingClientRect().width;
      if (width <= 0) return;
      const deltaMs = Math.round(
        ((event.clientX - drag.startX) / width) * drag.timelineMs,
      );
      if (drag.mode === "resize") {
        setDurationAdjustments((current) => ({
          ...current,
          [drag.clipId]: drag.startOffset + deltaMs,
        }));
      } else {
        setOffsetAdjustments((current) => ({
          ...current,
          [drag.clipId]: drag.startOffset + deltaMs,
        }));
      }
    },
    [],
  );

  const stopDragging = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (!item.clips_path && !metadata) {
    return null;
  }

  if (loadError) {
    return (
      <p className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm font-medium text-[var(--muted)]">
        {loadError}
      </p>
    );
  }

  if (clips.length === 0) {
    return null;
  }

  return (
    <section
      className="mb-4 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--input)] p-3"
      aria-label={t("storyAudio.clipTimelineAriaLabel", {
        defaultValue: "Story clip timeline",
      })}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          {t("storyAudio.clipTimelineTitle", {
            defaultValue: "Clips",
          })}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => nudgeSelected(-100)}
            disabled={!selectedClip}
            className={historyActionButtonClassName}
            title={t("storyAudio.controls.nudgeEarlier", {
              defaultValue: "Nudge earlier",
            })}
            aria-label={t("storyAudio.controls.nudgeEarlier", {
              defaultValue: "Nudge earlier",
            })}
          >
            <Rewind width={14} height={14} />
          </button>
          <button
            type="button"
            onClick={() => nudgeSelected(100)}
            disabled={!selectedClip}
            className={historyActionButtonClassName}
            title={t("storyAudio.controls.nudgeLater", {
              defaultValue: "Nudge later",
            })}
            aria-label={t("storyAudio.controls.nudgeLater", {
              defaultValue: "Nudge later",
            })}
          >
            <Forward width={14} height={14} />
          </button>
          <button
            type="button"
            onClick={() => resizeSelected(-100)}
            disabled={!selectedClip}
            className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-transparent px-2 text-xs font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50"
            title={t("storyAudio.controls.shortenClip", {
              defaultValue: "Shorten clip preview",
            })}
            aria-label={t("storyAudio.controls.shortenClip", {
              defaultValue: "Shorten clip preview",
            })}
          >
            -100
          </button>
          <button
            type="button"
            onClick={() => resizeSelected(100)}
            disabled={!selectedClip}
            className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-transparent px-2 text-xs font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50"
            title={t("storyAudio.controls.lengthenClip", {
              defaultValue: "Lengthen clip preview",
            })}
            aria-label={t("storyAudio.controls.lengthenClip", {
              defaultValue: "Lengthen clip preview",
            })}
          >
            +100
          </button>
        </div>
      </div>

      <div
        className="relative h-24 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]"
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div
          aria-hidden
          className="absolute left-0 top-0 h-full w-px bg-[var(--accent)] opacity-80"
          style={{
            left: `${Math.min(
              100,
              Math.max(0, (currentTime * 1000 * 100) / timelineMs),
            )}%`,
          }}
        />
        {clips.map((clip, index) => {
          const adjustedOffset = getAdjustedOffset(clip);
          const adjustedDuration = getAdjustedDuration(clip);
          const left = (adjustedOffset / timelineMs) * 100;
          const width = Math.max(3, (adjustedDuration / timelineMs) * 100);
          const isSelected = clip.id === selectedClipId;
          return (
            <div
              key={clip.id}
              className="absolute top-2 h-20 min-w-14"
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <button
                type="button"
                onClick={() => selectClip(clip)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    selectByDelta(1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    selectByDelta(-1);
                  }
                }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedClipId(clip.id);
                  dragRef.current = {
                    clipId: clip.id,
                    startX: event.clientX,
                    startOffset: offsetAdjustments[clip.id] ?? 0,
                    timelineMs,
                    mode: "move",
                  };
                }}
                className={`relative h-full w-full overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
                  isSelected
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] bg-[color-mix(in_srgb,var(--panel-bg),var(--accent-soft)_20%)] hover:border-[color-mix(in_srgb,var(--accent),transparent_45%)]"
                }`}
                aria-label={t("storyAudio.clipAriaLabel", {
                  defaultValue:
                    "Clip {{line}} {{speaker}}, starts at {{time}}",
                  line: clip.line_number,
                  speaker: clip.speaker,
                  time: formatDuration(adjustedOffset),
                })}
                aria-pressed={isSelected}
              >
                <span className="flex h-6 min-w-0 items-center gap-1 border-b border-[var(--border)] px-2 text-[10px] font-semibold text-[var(--text)]">
                  <span className="truncate">{clip.speaker}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-[var(--muted)]">
                    {index + 1}
                  </span>
                </span>
                <ClipWaveCanvas
                  peaks={clip.waveform_peaks}
                  selected={isSelected}
                />
                <span
                  aria-hidden
                  className="absolute inset-y-2 right-0 w-2 cursor-ew-resize rounded-full bg-[color-mix(in_srgb,var(--accent),transparent_55%)]"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedClipId(clip.id);
                    dragRef.current = {
                      clipId: clip.id,
                      startX: event.clientX,
                      startOffset: durationAdjustments[clip.id] ?? 0,
                      timelineMs,
                      mode: "resize",
                    };
                  }}
                />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const ClipWaveCanvas: React.FC<{
  peaks: number[];
  selected: boolean;
}> = ({ peaks, selected }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = selected ? "var(--accent)" : "var(--muted)";
    context.globalAlpha = selected ? 0.95 : 0.7;
    context.lineWidth = Math.max(1, pixelRatio);
    const centerY = height / 2;
    const usableHeight = height * 0.72;
    const safePeaks = peaks.length > 0 ? peaks : [0.2, 0.45, 0.3, 0.5];
    for (let x = 0; x < width; x += Math.max(1, Math.round(pixelRatio))) {
      const index = Math.min(
        safePeaks.length - 1,
        Math.floor((x / width) * safePeaks.length),
      );
      const peak = Math.min(1, Math.max(0.04, Math.abs(safePeaks[index])));
      const half = peak * usableHeight * 0.5;
      context.beginPath();
      context.moveTo(x, centerY - half);
      context.lineTo(x, centerY + half);
      context.stroke();
    }
  }, [peaks, selected]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-[calc(100%-1.5rem)] w-full"
      aria-hidden
    />
  );
};

function renderStoryScriptText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const lines = text.split("\n");

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      parts.push("\n");
    }

    const speakerMatch = line.match(/^(\s*)([^\s:[\]()][^:\n]{0,79}:)(?=\s|$)/);
    if (!speakerMatch) {
      parts.push(...renderStoryScriptTagSegments(line, `line-${lineIndex}`));
      return;
    }

    const [, leadingWhitespace, speakerLabel] = speakerMatch;
    if (leadingWhitespace) {
      parts.push(leadingWhitespace);
    }
    parts.push(
      <span
        key={`speaker-${lineIndex}`}
        className="font-bold text-[var(--text)]"
      >
        {speakerLabel}
      </span>,
    );
    parts.push(
      ...renderStoryScriptTagSegments(
        line.slice(speakerMatch[0].length),
        `line-${lineIndex}`,
      ),
    );
  });

  return parts;
}

function renderStoryScriptTagSegments(
  text: string,
  keyPrefix: string,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of text.matchAll(storyExpressionTokenPattern)) {
    const start = match.index ?? 0;
    const token = match[0];
    if (start > cursor) {
      parts.push(text.slice(cursor, start));
    }
    parts.push(
      <span
        key={`${keyPrefix}-tag-${index}`}
        className={storyScriptTagClassName(token)}
      >
        {token}
      </span>,
    );
    cursor = start + token.length;
    index += 1;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

function storyScriptTagClassName(token: string): string {
  const baseClass =
    "inline rounded-md border px-1.5 py-0.5 align-baseline font-semibold";
  if (token.startsWith("(")) {
    return `${baseClass} border-[color-mix(in_srgb,var(--accent-gold),transparent_45%)] bg-[var(--accent-gold-soft)] text-[color-mix(in_srgb,var(--accent-gold),var(--text)_18%)]`;
  }
  return `${baseClass} border-[color-mix(in_srgb,var(--accent),transparent_45%)] bg-[var(--accent-soft)] text-[var(--accent)]`;
}

const StoryRenderJobCard: React.FC<{
  job: StoryRenderJobSummary;
  nowMs: number;
  onCancel: (job: StoryRenderJobSummary) => void;
}> = ({ job, nowMs, onCancel }) => {
  const { t } = useTranslation();
  const isLive = isLiveStoryRenderJob(job);
  const progress = getStoryRenderJobProgress(job);
  const statusLabel = formatStoryRenderJobStatus(job, t);
  const elapsedFrom = job.started_at_ms ?? job.queued_at_ms;
  const elapsedMs = Math.max(0, nowMs - elapsedFrom);

  const isFailed = job.status === "failed";
  const isCancelled = job.status === "cancelled";
  const tileBg = isFailed
    ? "bg-[var(--danger-soft)] text-[var(--danger)]"
    : isCancelled
      ? "bg-[color-mix(in_srgb,var(--muted),transparent_75%)] text-[var(--muted)]"
      : "bg-[var(--accent-soft)] text-[var(--accent)]";
  const fillColor = isFailed
    ? "var(--danger)"
    : isCancelled
      ? "var(--muted)"
      : "var(--accent)";

  return (
    <article className="card-linear group/render-job relative px-4 py-3">
      <div className="flex items-stretch gap-3">
        <div
          className={`relative inline-flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-2xl ${tileBg}`}
          aria-hidden
        >
          {isFailed ? (
            <AlertCircle className="h-5 w-5" />
          ) : isLive ? (
            <Loader2 className="h-5 w-5 animate-[spin_1s_linear_infinite]" />
          ) : (
            <X className="h-5 w-5" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="m-0 min-w-0 truncate text-sm font-semibold leading-5 text-[var(--text)]">
              {job.title || t("storyAudio.untitledStory")}
            </p>
            <span className="ml-auto shrink-0 text-[11px] font-semibold tabular-nums text-[var(--muted)]">
              {Math.round(progress)}%
            </span>
            {isLive ? (
              <button
                type="button"
                onClick={() => onCancel(job)}
                className={historyDangerActionButtonClassName}
                title={t("storyAudio.actions.cancelRender")}
                aria-label={t("storyAudio.actions.cancelRender")}
              >
                <X width={14} height={14} />
              </button>
            ) : null}
          </div>

          <div
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--muted),transparent_80%)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{
                width: `${progress}%`,
                background: fillColor,
              }}
            />
          </div>

          <div className="flex min-w-0 items-center gap-1.5 truncate text-[11px] leading-4 text-[var(--muted)]">
            <span className="font-semibold text-[var(--text)]">
              {statusLabel}
            </span>
            <span aria-hidden className={storyMetaSeparatorClassName}>
              ·
            </span>
            <span>{formatStoryTime(job.created_at_ms)}</span>
            <span aria-hidden className={storyMetaSeparatorClassName}>
              ·
            </span>
            <span>
              {job.total_lines > 0
                ? t("storyAudio.meta.lineProgress", {
                    current: job.current_line,
                    total: job.total_lines,
                  })
                : t("storyAudio.status.preparing")}
            </span>
            <span aria-hidden className={storyMetaSeparatorClassName}>
              ·
            </span>
            <span className="tabular-nums">
              {formatGenerationTime(elapsedMs)}
            </span>
            {job.speaker ? (
              <>
                <span aria-hidden className={storyMetaSeparatorClassName}>
                  ·
                </span>
                <span>{job.speaker}</span>
              </>
            ) : null}
            {job.queue_position ? (
              <>
                <span aria-hidden className={storyMetaSeparatorClassName}>
                  ·
                </span>
                <span>{formatQueuePosition(job.queue_position, t)}</span>
              </>
            ) : null}
          </div>

          {job.error ? (
            <p className="text-[11px] leading-4 text-[var(--danger)]">
              {job.error}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
};

function groupStoryAudioItems(
  items: StoryAudioItem[],
  t: ReturnType<typeof useTranslation>["t"],
  locale?: string,
): Array<{
  key: string;
  label: string;
  items: StoryAudioItem[];
}> {
  return sortStoryAudioItems(items).reduce<
    Array<{ key: string; label: string; items: StoryAudioItem[] }>
  >((groups, item) => {
    const key = getStoryDateKey(item.created_at_ms);
    const lastGroup = groups[groups.length - 1];

    if (lastGroup?.key === key) {
      lastGroup.items.push(item);
      return groups;
    }

    groups.push({
      key,
      label: formatStoryGroupLabel(item.created_at_ms, t, locale),
      items: [item],
    });

    return groups;
  }, []);
}

function sortStoryRenderJobs(
  jobs: StoryRenderJobSummary[],
): StoryRenderJobSummary[] {
  return [...jobs].sort((left, right) => {
    if (isLiveStoryRenderJob(left) !== isLiveStoryRenderJob(right)) {
      return isLiveStoryRenderJob(left) ? -1 : 1;
    }
    const leftPosition = left.queue_position ?? Number.MAX_SAFE_INTEGER;
    const rightPosition = right.queue_position ?? Number.MAX_SAFE_INTEGER;
    if (leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }
    return left.created_at_ms - right.created_at_ms;
  });
}

function markStoryRenderJobCancelled(
  job: StoryRenderJobSummary,
): StoryRenderJobSummary {
  return {
    ...job,
    status: "cancelled",
    speaker: null,
    error: null,
    queue_position: null,
  };
}

function isLiveStoryRenderJob(job: StoryRenderJobSummary): boolean {
  return (
    job.status === "queued" ||
    job.status === "rendering" ||
    job.status === "assembling"
  );
}

function formatStoryRenderJobStatus(
  job: StoryRenderJobSummary,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (job.status === "queued") {
    return job.queue_position && job.queue_position > 1
      ? t("storyAudio.status.queuedAtPosition", {
          position: job.queue_position,
        })
      : t("storyAudio.status.queued");
  }
  if (job.status === "assembling") {
    return t("storyAudio.status.assembling");
  }
  if (job.status === "failed") {
    return t("storyAudio.status.failed");
  }
  if (job.status === "cancelled") {
    return t("storyAudio.status.cancelled");
  }
  if (job.total_lines > 0) {
    return t("storyAudio.status.generatingLine", {
      current: job.current_line,
      total: job.total_lines,
    });
  }
  return t("storyAudio.status.generating");
}

function formatQueuePosition(
  position: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return t("storyAudio.status.queuePosition", { position });
}

function getStoryRenderJobProgress(job: StoryRenderJobSummary): number {
  if (job.status === "completed") {
    return 100;
  }
  if (job.status === "assembling") {
    return 92;
  }
  if (job.status === "failed" || job.status === "cancelled") {
    return Math.max(8, lineProgress(job));
  }
  if (job.status === "queued") {
    return 8;
  }
  return lineProgress(job);
}

function lineProgress(job: StoryRenderJobSummary): number {
  if (job.total_lines <= 0) {
    return 8;
  }
  return Math.min(
    90,
    Math.max(8, Math.round((job.current_line / job.total_lines) * 90)),
  );
}

function getStoryDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatStoryGroupLabel(
  timestampMs: number,
  t: ReturnType<typeof useTranslation>["t"],
  locale?: string,
): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return t("storyAudio.unknownDate");
  }

  const today = new Date();
  if (
    today.getFullYear() === date.getFullYear() &&
    today.getMonth() === date.getMonth() &&
    today.getDate() === date.getDate()
  ) {
    return t("storyAudio.today");
  }

  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatStoryTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatAudioClock(secondsValue: number): string {
  if (!Number.isFinite(secondsValue)) {
    return "0:00";
  }
  const totalSeconds = Math.max(0, Math.floor(secondsValue));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatGenerationTime(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatSampleRate(sampleRateHz: number): string {
  if (sampleRateHz >= 1000) {
    return `${Number.parseFloat((sampleRateHz / 1000).toFixed(1))} kHz`;
  }
  return `${sampleRateHz} Hz`;
}

function formatPlaybackRate(playbackRate: number): string {
  return `${playbackRate}x`;
}

function formatStoryAudioEffect(effect: StoryAudioEffectPreset): string {
  switch (effect) {
    case "voice_polish":
      return "Voice Polish";
    case "radio":
      return "Radio";
    case "warm_room":
      return "Warm Room";
    case "clean":
    default:
      return "Clean";
  }
}

function sortStoryAudioItems(items: StoryAudioItem[]): StoryAudioItem[] {
  return [...items].sort((left, right) => {
    if (left.starred !== right.starred) {
      return left.starred ? -1 : 1;
    }
    return right.created_at_ms - left.created_at_ms;
  });
}
