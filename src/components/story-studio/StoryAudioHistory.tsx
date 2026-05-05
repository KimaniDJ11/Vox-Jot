import React, { useCallback, useEffect, useRef, useState } from "react";
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

export interface StoryAudioItem {
  id: string;
  title: string;
  script_text: string;
  output_path: string;
  created_at_ms: number;
  duration_ms: number;
  line_count: number;
  generation_time_ms?: number;
  sample_rate_hz?: number;
  expression_tags_used?: boolean;
  inline_prompt_used?: boolean;
  starred: boolean;
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
  onDelete: (item: StoryAudioItem) => void;
  onCancelJob: (job: StoryRenderJobSummary) => void;
  onCreateProcessed: (
    item: StoryAudioItem,
    playbackRate: number,
    sampleRateHz: number,
  ) => Promise<void>;
}

type StoryAudioView = "timeline" | "player";

const historyActionButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]";

const historyDangerActionButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]";
const historyConfirmDeleteButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger-soft)_70%,var(--danger)_30%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]";

const storyChipClassName =
  "inline-flex max-w-full min-w-0 items-center rounded-full border border-mid-gray/20 px-2.5 py-1 text-xs font-semibold leading-4 text-[var(--muted)]";
const noGeneratedAudioTitle = "No generated audio yet";
const noGeneratedAudioDescription =
  "Generated stories will appear here after the first render.";
const starredLabel = "Starred";
const generatedInLabel = "Generated in";
const expressionTagsUsedLabel = "Expression tags";
const inlinePromptUsedLabel = "Inline prompt";
const renderingGroupLabel = "Rendering";
const queuePositionLabel = "Queue";
const noSelectedAudioTitle = "No generated audio selected";
const noSelectedAudioDescription =
  "Render audio in Studio or switch back to Timeline.";
const scriptLabel = "Script";
const noScriptSavedLabel = "No script was saved with this audio file.";
const storyAudioViewItems = [
  { value: "timeline", label: "Timeline" },
  { value: "player", label: "Player" },
] satisfies Array<{ value: StoryAudioView; label: string }>;
const playbackRateOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];
const fixedSampleRateOptions = [16_000, 24_000, 44_100, 48_000];

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
  onDelete,
  onCancelJob,
  onCreateProcessed,
}) => {
  const sortedItems = sortStoryAudioItems(items);
  const groupedItems = groupStoryAudioItems(sortedItems);
  const selectedItem =
    sortedItems.find((item) => item.id === selectedAudioId) ??
    sortedItems[0] ??
    null;
  const selectedIndex = selectedItem
    ? sortedItems.findIndex((item) => item.id === selectedItem.id)
    : -1;
  const previousItem = selectedIndex > 0 ? sortedItems[selectedIndex - 1] : null;
  const nextItem =
    selectedIndex >= 0 && selectedIndex + 1 < sortedItems.length
      ? sortedItems[selectedIndex + 1]
      : null;

  return (
    <section className="space-y-3" aria-label="Generated story audio">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<StoryAudioView>
          items={storyAudioViewItems}
          value={view}
          onChange={onViewChange}
          ariaLabel="Generated audio view"
          layoutId="generated-audio-view"
        />
        {selectedItem ? (
          <p className="min-w-0 truncate text-xs font-medium text-[var(--muted)]">
            {view === "player"
              ? `${selectedIndex + 1} of ${sortedItems.length}`
              : selectedItem.title || "Untitled Story"}
          </p>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flat-card overflow-visible px-5 py-8 text-center">
          <p className="text-sm font-semibold text-[var(--text)]">
            Loading story audio...
          </p>
        </div>
      ) : groupedItems.length === 0 && jobs.length === 0 ? (
        <div className="flat-card overflow-visible px-5 py-8 text-center">
          <p className="text-sm font-semibold text-[var(--text)]">
            {noGeneratedAudioTitle}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {noGeneratedAudioDescription}
          </p>
        </div>
      ) : view === "player" ? (
        <StoryAudioPlayerView
          item={selectedItem}
          previousItem={previousItem}
          nextItem={nextItem}
          onSelectAudio={onSelectAudio}
          onReveal={onReveal}
          onCreateProcessed={onCreateProcessed}
        />
      ) : (
        <div className="space-y-5 py-4">
          {jobs.length > 0 ? (
            <section className="space-y-2.5">
              <div className="sticky top-0 z-10 -mx-1 px-1 py-1 backdrop-blur-md">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  {renderingGroupLabel}
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

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextItems = await invoke<StoryAudioItem[]>("list_story_audio");
      const sortedItems = sortStoryAudioItems(nextItems);
      setItems(sortedItems);
      setSelectedAudioId((current) =>
        current && sortedItems.some((item) => item.id === current)
          ? current
          : sortedItems[0]?.id ?? null,
      );
    } catch (error) {
      console.error("Failed to load generated story audio:", error);
      toast.error("Could not load generated story audio.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

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
    if (!selectedAudioId || !items.some((item) => item.id === selectedAudioId)) {
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

  const handleDelete = useCallback(async (item: StoryAudioItem) => {
    try {
      await invoke("delete_story_audio", { id: item.id });
      setItems((current) => {
        const nextItems = current.filter(
          (currentItem) => currentItem.id !== item.id,
        );
        setSelectedAudioId((currentSelectedId) =>
          currentSelectedId === item.id
            ? nextItems[0]?.id ?? null
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
    try {
      await invoke("cancel_story_render", { renderId: job.render_id });
      toast.message("Story render cancelled.");
    } catch (error) {
      console.error("Failed to cancel story render:", error);
      toast.error("Could not cancel story render.");
    }
  }, []);

  const handleCreateProcessed = useCallback(
    async (
      item: StoryAudioItem,
      playbackRate: number,
      sampleRateHz: number,
    ) => {
      try {
        const processed = await invoke<StoryAudioItem>(
          "create_processed_story_audio",
          {
            request: {
              id: item.id,
              playback_rate: playbackRate,
              sample_rate_hz: sampleRateHz,
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
      toast.error("Could not load story audio.");
      return null;
    }
  }, [item.output_path]);

  const handleCopyScript = async () => {
    if (!hasScript) {
      return;
    }
    try {
      await navigator.clipboard.writeText(item.script_text);
      setShowCopied(true);
      window.setTimeout(() => setShowCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy story script:", error);
      toast.error("Could not copy story script.");
    }
  };

  return (
    <article
      onClick={() => onSelect(item, true)}
      className={`card-linear group/story-audio relative grid cursor-pointer grid-cols-1 gap-y-3 px-4 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] md:grid-cols-[5.75rem_minmax(0,1fr)] md:items-baseline md:gap-x-4 md:gap-y-2.5 ${
        selected
          ? "border-[color-mix(in_srgb,var(--accent),transparent_45%)] bg-[var(--accent-soft)]"
          : ""
      }`}
      title="Open in player"
    >
      <div className="min-w-0 tabular text-[12px] font-medium leading-5 text-[var(--muted)]">
        {formatStoryTime(item.created_at_ms)}
      </div>

      <p className="m-0 min-w-0 font-[var(--font-body)] text-base font-normal leading-6 text-[var(--text)]">
        {item.title || "Untitled Story"}
      </p>

      <div
        className="flex flex-wrap items-center justify-between gap-2 md:col-start-2"
        onClick={(event) => event.stopPropagation()}
      >
        <AudioPlayer
          onLoadRequest={handleLoadAudio}
          className="min-w-0 flex-1 sm:min-w-[220px]"
        />

        <div
          className="flex items-center gap-1 opacity-100 transition-opacity duration-150"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void handleCopyScript()}
            className={historyActionButtonClassName}
            disabled={!hasScript}
            title={hasScript ? "Copy script" : "No script saved"}
            aria-label={hasScript ? "Copy script" : "No script saved"}
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
            title="Show audio file in folder"
            aria-label="Show audio file in folder"
          >
            <FolderOpen width={14} height={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onToggleStarred(item)}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
              item.starred
                ? "bg-[var(--accent-soft)] text-[var(--accent)] hover:text-[var(--accent)]/80"
                : "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
            }`}
            title={item.starred ? "Unstar story audio" : "Star story audio"}
            aria-label={
              item.starred ? "Unstar story audio" : "Star story audio"
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
                title="Delete story audio"
                aria-label="Delete story audio"
              >
                <Trash2 width={14} height={14} />
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className={historyActionButtonClassName}
                title="Cancel delete"
                aria-label="Cancel delete"
              >
                <X width={14} height={14} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className={historyDangerActionButtonClassName}
              title="Delete story audio"
              aria-label="Delete story audio"
            >
              <Trash2 width={14} height={14} />
            </button>
          )}
        </div>
      </div>

      <StoryAudioChips item={item} className="md:col-start-2" />
    </article>
  );
};

const StoryAudioChips: React.FC<{
  item: StoryAudioItem;
  className?: string;
}> = ({ item, className = "" }) => {
  const hasScript = item.script_text.trim().length > 0;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className={storyChipClassName}>
        {item.line_count > 0
          ? `${item.line_count} line${item.line_count === 1 ? "" : "s"}`
          : "Audio file"}
      </span>
      <span className={storyChipClassName}>
        {formatDuration(item.duration_ms)}
      </span>
      {typeof item.generation_time_ms === "number" &&
      item.generation_time_ms > 0 ? (
        <span className={storyChipClassName}>
          {generatedInLabel} {formatGenerationTime(item.generation_time_ms)}
        </span>
      ) : null}
      {typeof item.sample_rate_hz === "number" && item.sample_rate_hz > 0 ? (
        <span className={storyChipClassName}>
          {formatSampleRate(item.sample_rate_hz)}
        </span>
      ) : null}
      <span
        className={`${storyChipClassName} ${
          hasScript
            ? "border-[color-mix(in_srgb,var(--success),transparent_60%)] bg-[var(--success-soft)] text-[var(--success)]"
            : ""
        }`}
      >
        {hasScript ? "Script saved" : "Audio only"}
      </span>
      {item.expression_tags_used ? (
        <span className={storyChipClassName}>{expressionTagsUsedLabel}</span>
      ) : null}
      {item.inline_prompt_used ? (
        <span className={storyChipClassName}>{inlinePromptUsedLabel}</span>
      ) : null}
      {item.starred ? (
        <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-[color-mix(in_srgb,var(--accent),transparent_55%)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold leading-4 text-[var(--accent)]">
          {starredLabel}
        </span>
      ) : null}
    </div>
  );
};

const StoryAudioPlayerView: React.FC<{
  item: StoryAudioItem | null;
  previousItem: StoryAudioItem | null;
  nextItem: StoryAudioItem | null;
  onSelectAudio: (item: StoryAudioItem, openPlayer?: boolean) => void;
  onReveal: (item: StoryAudioItem) => void;
  onCreateProcessed: (
    item: StoryAudioItem,
    playbackRate: number,
    sampleRateHz: number,
  ) => Promise<void>;
}> = ({
  item,
  previousItem,
  nextItem,
  onSelectAudio,
  onReveal,
  onCreateProcessed,
}) => {
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sampleRateHz, setSampleRateHz] = useState(24_000);
  const [isSaving, setIsSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const animationRef = useRef<number>();

  const hasScript = Boolean(item?.script_text.trim());

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setPlaybackRate(1);
    setSampleRateHz(item?.sample_rate_hz || 24_000);
    setAudioSrc((currentSrc) => {
      if (currentSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(currentSrc);
      }
      return null;
    });
  }, [item?.id, item?.sample_rate_hz]);

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
      await onCreateProcessed(item, playbackRate, sampleRateHz);
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
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const sampleRateOptions = [
    item?.sample_rate_hz || 24_000,
    ...fixedSampleRateOptions,
  ].filter((value, index, values) => values.indexOf(value) === index);

  if (!item) {
    return (
      <div className="flat-card px-5 py-8 text-center">
        <p className="text-sm font-semibold text-[var(--text)]">
          {noSelectedAudioTitle}
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {noSelectedAudioDescription}
        </p>
      </div>
    );
  }

  return (
    <article
      className="flex min-h-[calc(100dvh-14rem)] flex-col gap-4 pb-[10rem]"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flat-card flex min-h-[16rem] flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              {scriptLabel}
            </p>
            <h3 className="mt-1 truncate text-lg font-semibold text-[var(--text)]">
              {item.title || "Untitled Story"}
            </h3>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {hasScript ? (
            <pre className="whitespace-pre-wrap break-words font-[var(--font-body)] text-sm leading-7 text-[var(--text)]">
              {item.script_text}
            </pre>
          ) : (
            <p className="text-sm leading-6 text-[var(--muted)]">
              {noScriptSavedLabel}
            </p>
          )}
        </div>
        <StoryAudioChips
          item={item}
          className="border-t border-[var(--border)] px-5 py-4"
        />
      </div>

      <div className="story-audio-docked-player z-20 mt-auto overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[0_18px_50px_rgba(0,0,0,0.26)]">
        <audio
          ref={audioRef}
          src={audioSrc ?? undefined}
          preload="metadata"
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || 0);
            event.currentTarget.playbackRate = playbackRate;
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(duration || 0);
          }}
        />
        <div className="story-audio-top-scrubber-shell">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={currentTime}
            onChange={handleScrub}
            className="story-audio-top-scrubber"
            aria-label="Audio timeline"
          />
          <div
            className="story-audio-top-progress"
            style={{ width: `${progressPercent}%` }}
            aria-hidden
          />
        </div>
        <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Music2 className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--text)]">
                {item.title || "Untitled Story"}
              </p>
              <p className="truncate text-xs text-[var(--muted)]">
                {formatDuration(item.duration_ms)} ·{" "}
                {formatSampleRate(item.sample_rate_hz || 24_000)}
              </p>
            </div>
          </div>

          <div className="grid min-w-0 gap-3">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => previousItem && onSelectAudio(previousItem, true)}
                disabled={!previousItem}
                className={historyActionButtonClassName}
                title="Previous generated audio"
                aria-label="Previous generated audio"
              >
                <SkipBack width={15} height={15} />
              </button>
              <button
                type="button"
                onClick={() => void togglePlayback()}
                disabled={isLoadingAudio}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--inverse-text)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:opacity-50"
                title={isPlaying ? "Pause" : "Play"}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" fill="currentColor" />
                ) : (
                  <Play className="h-5 w-5" fill="currentColor" />
                )}
              </button>
              <button
                type="button"
                onClick={() => nextItem && onSelectAudio(nextItem, true)}
                disabled={!nextItem}
                className={historyActionButtonClassName}
                title="Next generated audio"
                aria-label="Next generated audio"
              >
                <SkipForward width={15} height={15} />
              </button>
              <span className="min-w-[5.25rem] text-center text-xs tabular-nums text-[var(--muted)]">
                {formatAudioClock(currentTime)} / {formatAudioClock(duration)}
              </span>
              <select
                value={playbackRate}
                onChange={(event) =>
                  setPlaybackRate(Number.parseFloat(event.target.value))
                }
                className="h-9 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 text-xs font-semibold text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
                aria-label="Playback speed"
                title="Playback speed"
              >
                {playbackRateOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatPlaybackRate(option)}
                  </option>
                ))}
              </select>
              <select
                value={sampleRateHz}
                onChange={(event) =>
                  setSampleRateHz(Number.parseInt(event.target.value, 10))
                }
                className="h-9 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 text-xs font-semibold text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
                aria-label="Save sample rate"
                title="Save sample rate"
              >
                {sampleRateOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatSampleRate(option)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleSaveProcessed()}
                disabled={isSaving}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:opacity-50"
                title="Save copy"
                aria-label="Save copy"
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onReveal(item)}
                className={historyActionButtonClassName}
                title="Show audio file in folder"
                aria-label="Show audio file in folder"
              >
                <FolderOpen width={14} height={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};

const StoryRenderJobCard: React.FC<{
  job: StoryRenderJobSummary;
  nowMs: number;
  onCancel: (job: StoryRenderJobSummary) => void;
}> = ({ job, nowMs, onCancel }) => {
  const isLive = isLiveStoryRenderJob(job);
  const progress = getStoryRenderJobProgress(job);
  const statusLabel = formatStoryRenderJobStatus(job);
  const elapsedFrom = job.started_at_ms ?? job.queued_at_ms;
  const elapsedMs = Math.max(0, nowMs - elapsedFrom);

  return (
    <article className="card-linear relative grid grid-cols-1 gap-y-3 px-4 py-4 md:grid-cols-[5.75rem_minmax(0,1fr)] md:items-baseline md:gap-x-4 md:gap-y-2.5">
      <div className="min-w-0 tabular text-[12px] font-medium leading-5 text-[var(--muted)]">
        {formatStoryTime(job.created_at_ms)}
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {job.status === "failed" ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-[var(--danger)]" />
          ) : isLive ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-[spin_1s_linear_infinite] text-[var(--accent)]" />
          ) : (
            <X className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          )}
          <p className="m-0 min-w-0 cursor-text select-text truncate font-[var(--font-body)] text-base font-normal leading-6 text-[var(--text)]">
            {job.title || "Untitled Story"}
          </p>
        </div>
        {job.error ? (
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {job.error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 md:col-start-2">
        <div className="min-w-[min(100%,18rem)] flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-[var(--text)]">
              {statusLabel}
            </span>
            {job.speaker ? (
              <span className="text-[var(--muted)]">{job.speaker}</span>
            ) : null}
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--panel-bg)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-200 ${
                job.status === "failed"
                  ? "bg-[var(--danger)]"
                  : job.status === "cancelled"
                    ? "bg-[var(--muted)]"
                    : "bg-[var(--accent)]"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {isLive ? (
          <button
            type="button"
            onClick={() => onCancel(job)}
            className={historyDangerActionButtonClassName}
            title="Cancel story render"
            aria-label="Cancel story render"
          >
            <X width={14} height={14} />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 md:col-start-2">
        <span className={storyChipClassName}>
          {job.total_lines > 0
            ? `${job.current_line}/${job.total_lines} lines`
            : "Preparing"}
        </span>
        <span className={storyChipClassName}>
          {formatGenerationTime(elapsedMs)}
        </span>
        {job.queue_position ? (
          <span className={storyChipClassName}>
            {formatQueuePosition(job.queue_position)}
          </span>
        ) : null}
      </div>
    </article>
  );
};

function groupStoryAudioItems(items: StoryAudioItem[]): Array<{
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
      label: formatStoryGroupLabel(item.created_at_ms),
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

function isLiveStoryRenderJob(job: StoryRenderJobSummary): boolean {
  return (
    job.status === "queued" ||
    job.status === "rendering" ||
    job.status === "assembling"
  );
}

function formatStoryRenderJobStatus(job: StoryRenderJobSummary): string {
  if (job.status === "queued") {
    return job.queue_position && job.queue_position > 1
      ? `Queued at position ${job.queue_position}`
      : "Queued";
  }
  if (job.status === "assembling") {
    return "Assembling final audio";
  }
  if (job.status === "failed") {
    return "Generation failed";
  }
  if (job.status === "cancelled") {
    return "Cancelled";
  }
  if (job.total_lines > 0) {
    return `Generating line ${job.current_line} of ${job.total_lines}`;
  }
  return "Generating";
}

function formatQueuePosition(position: number): string {
  return `${queuePositionLabel} #${position}`;
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

function formatStoryGroupLabel(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  const today = new Date();
  if (
    today.getFullYear() === date.getFullYear() &&
    today.getMonth() === date.getMonth() &&
    today.getDate() === date.getDate()
  ) {
    return "Today";
  }

  return new Intl.DateTimeFormat(undefined, {
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

function sortStoryAudioItems(items: StoryAudioItem[]): StoryAudioItem[] {
  return [...items].sort((left, right) => {
    if (left.starred !== right.starred) {
      return left.starred ? -1 : 1;
    }
    return right.created_at_ms - left.created_at_ms;
  });
}
