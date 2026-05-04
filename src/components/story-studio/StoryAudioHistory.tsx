import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";
import { Check, Copy, FolderOpen, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AudioPlayer } from "@/components/ui/AudioPlayer";
import { useRefreshOnWindowFocus } from "@/hooks/useRefreshOnWindowFocus";

export interface StoryAudioItem {
  id: string;
  title: string;
  script_text: string;
  output_path: string;
  created_at_ms: number;
  duration_ms: number;
  line_count: number;
  cast_count: number;
  starred: boolean;
}

interface StoryAudioHistoryProps {
  items: StoryAudioItem[];
  isLoading: boolean;
  onReveal: (item: StoryAudioItem) => void;
  onToggleStarred: (item: StoryAudioItem) => void;
  onUpdateTitle: (item: StoryAudioItem, title: string) => Promise<void>;
  onDelete: (item: StoryAudioItem) => void;
}

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

export const StoryAudioHistory: React.FC<StoryAudioHistoryProps> = ({
  items,
  isLoading,
  onReveal,
  onToggleStarred,
  onUpdateTitle,
  onDelete,
}) => {
  const groupedItems = groupStoryAudioItems(items);

  return (
    <section className="space-y-3" aria-label="Generated story audio">
      {isLoading ? (
        <div className="flat-card overflow-visible px-5 py-8 text-center">
          <p className="text-sm font-semibold text-[var(--text)]">
            Loading story audio...
          </p>
        </div>
      ) : groupedItems.length === 0 ? (
        <div className="flat-card overflow-visible px-5 py-8 text-center">
          <p className="text-sm font-semibold text-[var(--text)]">
            {noGeneratedAudioTitle}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {noGeneratedAudioDescription}
          </p>
        </div>
      ) : (
        <div className="space-y-5 py-4">
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
                    onReveal={onReveal}
                    onToggleStarred={onToggleStarred}
                    onUpdateTitle={onUpdateTitle}
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
  const [isLoading, setIsLoading] = useState(true);

  const loadItems = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setIsLoading(true);
    }
    try {
      const nextItems = await invoke<StoryAudioItem[]>("list_story_audio");
      setItems(sortStoryAudioItems(nextItems));
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

  useEffect(() => {
    const unlisten = listen("story-audio-updated", () => {
      void loadItems();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadItems]);

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

  const handleUpdateTitle = useCallback(
    async (item: StoryAudioItem, title: string) => {
      try {
        const updated = await invoke<StoryAudioItem>(
          "update_story_audio_title",
          {
            id: item.id,
            title,
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
      setItems((current) =>
        current.filter((currentItem) => currentItem.id !== item.id),
      );
      toast.message("Story audio deleted.");
    } catch (error) {
      console.error("Failed to delete story audio:", error);
      toast.error("Could not delete story audio.");
    }
  }, []);

  return (
    <StoryAudioHistory
      items={items}
      isLoading={isLoading}
      onReveal={handleReveal}
      onToggleStarred={handleToggleStarred}
      onUpdateTitle={handleUpdateTitle}
      onDelete={handleDelete}
    />
  );
};

export const StoryAudioHistorySection = StoryAudioSidebar;

interface StoryAudioHistoryCardProps {
  item: StoryAudioItem;
  onReveal: (item: StoryAudioItem) => void;
  onToggleStarred: (item: StoryAudioItem) => void;
  onUpdateTitle: (item: StoryAudioItem, title: string) => Promise<void>;
  onDelete: (item: StoryAudioItem) => void;
}

const StoryAudioHistoryCard: React.FC<StoryAudioHistoryCardProps> = ({
  item,
  onReveal,
  onToggleStarred,
  onUpdateTitle,
  onDelete,
}) => {
  const [showCopied, setShowCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(item.title || "Untitled Story");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const isCommittingTitleRef = useRef(false);
  const hasScript = item.script_text.trim().length > 0;

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(item.title || "Untitled Story");
    }
  }, [isEditingTitle, item.title]);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

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

  const commitTitle = useCallback(async () => {
    if (isCommittingTitleRef.current) {
      return;
    }
    const nextTitle = normalizeStoryAudioTitle(titleDraft);
    const currentTitle = item.title || "Untitled Story";

    if (nextTitle === currentTitle) {
      setTitleDraft(currentTitle);
      setIsEditingTitle(false);
      return;
    }

    isCommittingTitleRef.current = true;
    setIsSavingTitle(true);
    try {
      await onUpdateTitle(item, nextTitle);
      setTitleDraft(nextTitle);
      setIsEditingTitle(false);
    } finally {
      isCommittingTitleRef.current = false;
      setIsSavingTitle(false);
    }
  }, [item, onUpdateTitle, titleDraft]);

  const cancelTitleEdit = useCallback(() => {
    setTitleDraft(item.title || "Untitled Story");
    setIsEditingTitle(false);
  }, [item.title]);

  return (
    <article className="card-linear group/story-audio relative grid grid-cols-1 gap-y-3 px-4 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] md:grid-cols-[5.75rem_minmax(0,1fr)] md:items-baseline md:gap-x-4 md:gap-y-2.5">
      <div className="min-w-0 tabular text-[12px] font-medium leading-5 text-[var(--muted)]">
        {formatStoryTime(item.created_at_ms)}
      </div>

      {isEditingTitle ? (
        <input
          ref={titleInputRef}
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commitTitle();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelTitleEdit();
            }
          }}
          className="min-h-8 w-full min-w-0 rounded-md border border-[var(--accent)] bg-[var(--card)] px-2 py-1 font-[var(--font-body)] text-base font-normal leading-6 text-[var(--text)] shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] sm:w-auto sm:min-w-64"
          disabled={isSavingTitle}
          maxLength={120}
          aria-label="Story audio title"
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsEditingTitle(true)}
          className="-mx-1 min-h-8 min-w-0 cursor-text rounded-md px-1 text-left font-[var(--font-body)] text-base font-normal leading-6 text-[var(--text)] transition-colors hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
          title="Rename story audio"
          aria-label={`Rename story audio titled ${item.title || "Untitled Story"}`}
        >
          <span className="block max-w-full break-words">
            {item.title || "Untitled Story"}
          </span>
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 md:col-start-2">
        <AudioPlayer
          onLoadRequest={handleLoadAudio}
          className="min-w-0 flex-1 sm:min-w-[220px]"
        />

        <div className="flex items-center gap-1 opacity-100 transition-opacity duration-150">
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

      <div className="flex flex-wrap items-center gap-1.5 md:col-start-2">
        <span className={storyChipClassName}>
          {item.line_count > 0
            ? `${item.line_count} line${item.line_count === 1 ? "" : "s"}`
            : "Audio file"}
        </span>
        {item.cast_count > 0 ? (
          <span className={storyChipClassName}>
            {item.cast_count === 1 ? "1 cast member" : `${item.cast_count} cast`}
          </span>
        ) : null}
        <span className={storyChipClassName}>
          {formatDuration(item.duration_ms)}
        </span>
        <span
          className={`${storyChipClassName} ${
            hasScript
              ? "border-[color-mix(in_srgb,var(--success),transparent_60%)] bg-[var(--success-soft)] text-[var(--success)]"
              : ""
          }`}
        >
          {hasScript ? "Script saved" : "Audio only"}
        </span>
        {item.starred ? (
          <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-[color-mix(in_srgb,var(--accent),transparent_55%)] bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold leading-4 text-[var(--accent)]">
            {starredLabel}
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

function normalizeStoryAudioTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled Story";
}

function sortStoryAudioItems(items: StoryAudioItem[]): StoryAudioItem[] {
  return [...items].sort((left, right) => {
    if (left.starred !== right.starred) {
      return left.starred ? -1 : 1;
    }
    return right.created_at_ms - left.created_at_ms;
  });
}
