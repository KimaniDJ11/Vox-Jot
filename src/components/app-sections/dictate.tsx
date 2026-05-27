import React, { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  CalendarDays,
  Check,
  Flame,
  Keyboard,
  LetterText,
  Mic,
  NotebookPen,
  Pin,
  Plus,
} from "lucide-react";
import { motion } from "framer-motion";

import { commands, type HistoryEntry, type Note } from "@/bindings";
import { FileTranscriptionPanel } from "@/components/dictate/FileTranscriptionPanel";
import { CorrectionDictionaryView } from "@/components/settings/corrections/CorrectionDictionaryView";
import { HistorySettings } from "@/components/settings/history/HistorySettings";
import { ModelsSettings } from "@/components/settings/models/ModelsSettings";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionIntro } from "@/components/app-sections/shared";
import { useDictationStats } from "@/hooks/useDictationStats";
import type { ModelHubControlState } from "@/components/model-hub/modelHubControls";
import { useSettings } from "@/hooks/useSettings";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";

const formatShortcut = (binding: string | undefined): string => {
  if (!binding) return "Not set";

  return binding
    .split("+")
    .map((part) => {
      const normalized = part.trim().toLowerCase();
      switch (normalized) {
        case "cmd":
        case "command":
          return "Cmd";
        case "ctrl":
          return "Ctrl";
        case "option":
        case "opt":
        case "alt":
          return "Option";
        case "shift":
          return "Shift";
        case "space":
          return "Space";
        default:
          return normalized.length === 1
            ? normalized.toUpperCase()
            : normalized.charAt(0).toUpperCase() + normalized.slice(1);
      }
    })
    .join(" + ");
};

const firstDictationReminderDismissedKey =
  "voxjot:first-dictation-reminder-dismissed";

const hasDismissedFirstDictationReminder = (): boolean => {
  if (typeof window === "undefined") return false;
  return (
    window.localStorage.getItem(firstDictationReminderDismissedKey) === "1"
  );
};

const markFirstDictationReminderDismissed = () => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(firstDictationReminderDismissedKey, "1");
};

const formatCompactNumber = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
};

const commonFavoriteWordStopWords = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "you",
  "your",
  "are",
  "but",
  "not",
  "have",
  "has",
  "had",
  "was",
  "were",
  "will",
  "would",
  "can",
  "could",
  "should",
  "from",
  "they",
  "them",
  "then",
  "than",
  "there",
  "here",
  "what",
  "when",
  "where",
  "just",
  "like",
  "about",
  "into",
  "onto",
  "over",
  "under",
  "again",
  "really",
]);

const getHistoryEntryText = (entry: HistoryEntry): string =>
  entry.pasted_text?.trim() ||
  entry.post_processed_text?.trim() ||
  entry.transcription_text.trim();

const getHistoryEntryAppLabel = (entry: HistoryEntry): string | null => {
  const appName = entry.screen_context_metadata?.active_app_name?.trim();
  const bundleId = entry.screen_context_metadata?.active_app_bundle_id?.trim();

  if (appName) return appName;
  if (!bundleId) return null;

  const bundleParts = bundleId.split(".").filter(Boolean);
  const fallback = bundleParts[bundleParts.length - 1];
  return fallback
    ? fallback
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char: string) => char.toUpperCase())
    : bundleId;
};

const mostCommon = <T,>(items: T[]): T | null => {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  let best: T | null = null;
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }

  return best;
};

type HomeHistoryInsights = {
  mostActiveDay: string;
  favoriteWord: string;
  mostActiveTime: string;
  mostUsedApp: string;
};

const emptyHomeHistoryInsights: HomeHistoryInsights = {
  mostActiveDay: "Not yet",
  favoriteWord: "Not yet",
  mostActiveTime: "Not yet",
  mostUsedApp: "Not yet",
};

const formatWordForDisplay = (word: string, locale: string): string =>
  word.length > 0
    ? word.charAt(0).toLocaleUpperCase(locale) + word.slice(1)
    : word;

const formatHourForDisplay = (hour: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: "numeric" }).format(
    new Date(2024, 0, 1, hour),
  );

const computeHomeHistoryInsights = (
  entries: HistoryEntry[],
  locale: string,
): HomeHistoryInsights => {
  if (entries.length === 0) return emptyHomeHistoryInsights;

  const entryDates = entries.map((entry) => new Date(entry.timestamp * 1000));
  const activeDay = mostCommon(entryDates.map((date) => date.getDay()));
  const activeHour = mostCommon(entryDates.map((date) => date.getHours()));
  const mostUsedApp = mostCommon(
    entries
      .map((entry) => getHistoryEntryAppLabel(entry))
      .filter((label): label is string => Boolean(label)),
  );

  const words = entries.flatMap((entry) => {
    const text = getHistoryEntryText(entry).toLocaleLowerCase(locale);
    return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) ?? [])
      .map((word) => word.replace(/^[’'-]+|[’'-]+$/g, ""))
      .filter((word) => word.length > 2)
      .filter((word) => !commonFavoriteWordStopWords.has(word));
  });
  const favoriteWord = mostCommon(words);

  return {
    mostActiveDay:
      activeDay === null
        ? emptyHomeHistoryInsights.mostActiveDay
        : new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
            new Date(2024, 0, 7 + activeDay),
          ),
    favoriteWord: favoriteWord
      ? formatWordForDisplay(favoriteWord, locale)
      : emptyHomeHistoryInsights.favoriteWord,
    mostActiveTime:
      activeHour === null
        ? emptyHomeHistoryInsights.mostActiveTime
        : formatHourForDisplay(activeHour, locale),
    mostUsedApp: mostUsedApp ?? emptyHomeHistoryInsights.mostUsedApp,
  };
};

const useHomeHistoryInsights = (locale: string): HomeHistoryInsights => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const refreshInsights = useCallback(async () => {
    try {
      const result = await commands.getHistoryEntries();
      if (result.status === "ok") {
        setEntries(result.data);
      }
    } catch (error) {
      console.warn("Failed to load home history insights:", error);
    }
  }, []);

  useEffect(() => {
    void refreshInsights();

    const cleanupPromise = listen("history-updated", () => {
      void refreshInsights();
    });

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [refreshInsights]);

  return useMemo(
    () => computeHomeHistoryInsights(entries, locale),
    [entries, locale],
  );
};

export const DictateModelsSection: React.FC<{
  titleActionTargetId?: string;
  showActiveModelBanner?: boolean;
  hubSearchQuery?: string;
  modelHubControls?: ModelHubControlState;
  hubFilterLabels?: boolean;
  showEvaluationPanel?: boolean;
}> = ({
  titleActionTargetId,
  showActiveModelBanner = true,
  hubSearchQuery,
  modelHubControls,
  hubFilterLabels,
  showEvaluationPanel,
}) => (
  <div className="space-y-6">
    <ModelsSettings
      titleActionTargetId={titleActionTargetId}
      showActiveModelBanner={showActiveModelBanner}
      hubSearchQuery={hubSearchQuery}
      modelHubControls={modelHubControls}
      hubFilterLabels={hubFilterLabels}
      showEvaluationPanel={showEvaluationPanel}
    />
  </div>
);

export const DictateHistorySection: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const [hasCompletedFirstDictation, setHasCompletedFirstDictation] = useState<
    boolean | null
  >(() => (hasDismissedFirstDictationReminder() ? true : null));
  const bindings = getSetting("bindings");
  const dictationShortcut = formatShortcut(
    bindings?.transcribe?.current_binding ||
      bindings?.transcribe?.default_binding,
  );

  const refreshFirstDictationState = useCallback(async () => {
    try {
      const result = await commands.getLatestHistoryEntry();
      if (result.status === "ok") {
        const hasHistory = Boolean(result.data);
        if (hasHistory) markFirstDictationReminderDismissed();
        setHasCompletedFirstDictation(
          hasHistory || hasDismissedFirstDictationReminder(),
        );
      }
    } catch (error) {
      console.warn("Failed to check first dictation history state:", error);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const refreshIfMounted = async () => {
      try {
        const result = await commands.getLatestHistoryEntry();
        if (isMounted && result.status === "ok") {
          const hasHistory = Boolean(result.data);
          if (hasHistory) markFirstDictationReminderDismissed();
          setHasCompletedFirstDictation(
            hasHistory || hasDismissedFirstDictationReminder(),
          );
        }
      } catch (error) {
        console.warn("Failed to check first dictation history state:", error);
      }
    };

    void refreshIfMounted();

    const cleanupPromise = listen("history-updated", () => {
      void refreshFirstDictationState();
    });

    return () => {
      isMounted = false;
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [refreshFirstDictationState]);

  return (
    <div className="space-y-6">
      {hasCompletedFirstDictation === false && (
        <FirstDictationReminder shortcut={dictationShortcut} />
      )}
      <HomeStatsCards />
      <HistorySettings />
    </div>
  );
};

function useAppIcon(bundleId: string | null | undefined): string | null {
  const [iconUrl, setIconUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!bundleId) {
      setIconUrl(null);
      return;
    }

    let cancelled = false;
    void commands.getAppIcon(bundleId).then((result) => {
      if (!cancelled && result.status === "ok" && result.data) {
        setIconUrl(result.data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bundleId]);

  return iconUrl;
}

const cardEntrance = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: i * 0.05,
      duration: 0.4,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  }),
};

const HomeStatsCards: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { stats } = useDictationStats();
  const insights = useHomeHistoryInsights(i18n.language);
  const topAppIcon = useAppIcon(stats?.top_app_bundle_id);

  const cards = [
    {
      label: t("titleBar.streakLabel", { defaultValue: "Streak" }),
      value: String(stats?.streak_days ?? 0),
      detail: t("appSections.homeStats.mostActiveDay", {
        defaultValue: "Most active: {{day}}",
        day: insights.mostActiveDay,
      }),
      icon: <Flame className="h-4.5 w-4.5 fill-current" strokeWidth={1.5} />,
      accentColor: "var(--voice)",
      title: t("titleBar.streak", { count: stats?.streak_days ?? 0 }),
    },
    {
      label: t("titleBar.totalWordsLabel", { defaultValue: "Words" }),
      value: formatCompactNumber(stats?.total_words ?? 0),
      detail: t("appSections.homeStats.favoriteWord", {
        defaultValue: "Fav word: {{word}}",
        word: insights.favoriteWord,
      }),
      icon: <LetterText className="h-4.5 w-4.5" strokeWidth={2} />,
      accentColor: "var(--accent)",
      title: t("titleBar.totalWords", { count: stats?.total_words ?? 0 }),
    },
    {
      label: t("titleBar.todayLabel", { defaultValue: "Today" }),
      value: formatCompactNumber(stats?.today_words ?? 0),
      detail: t("appSections.homeStats.mostActiveTime", {
        defaultValue: "Most active: {{time}}",
        time: insights.mostActiveTime,
      }),
      icon: <CalendarDays className="h-4.5 w-4.5" strokeWidth={2} />,
      accentColor: "var(--success, #22c55e)",
      title: t("titleBar.todayWords", { count: stats?.today_words ?? 0 }),
    },
    {
      label: t("titleBar.appsLabel", { defaultValue: "Apps" }),
      value: formatCompactNumber(stats?.unique_app_count ?? 0),
      detail: stats?.top_app_name ? (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          <span className="shrink-0">
            {t("appSections.homeStats.mostUsedAppLabel", {
              defaultValue: "Most used:",
            })}
          </span>
          {topAppIcon ? (
            <img
              src={topAppIcon}
              alt=""
              className="h-5 w-5 shrink-0 rounded-[5px] object-contain"
              aria-hidden
            />
          ) : (
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[10px] font-extrabold text-[var(--accent)]"
              aria-hidden
            >
              {stats.top_app_name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="truncate text-[11px] font-semibold">
            {stats.top_app_name}
          </span>
        </span>
      ) : (
        t("appSections.homeStats.mostUsedApp", {
          defaultValue: "Most used: {{app}}",
          app: insights.mostUsedApp,
        })
      ),
      icon: <AppWindow className="h-4.5 w-4.5" strokeWidth={2} />,
      accentColor: "var(--accent-gold, #d89a5c)",
      title: t("titleBar.appsUsed", {
        count: stats?.unique_app_count ?? 0,
        defaultValue:
          (stats?.unique_app_count ?? 0) === 1
            ? "{{count}} app used"
            : "{{count}} apps used",
      }),
    },
  ];

  return (
    <section
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-label={t("titleBar.recentActivity", {
        defaultValue: "Recent activity",
      })}
    >
      {cards.map((card, i) => (
        <motion.div
          key={card.label}
          variants={cardEntrance}
          initial="hidden"
          animate="visible"
          custom={i}
          whileHover={{
            y: -3,
            boxShadow: "var(--shadow-md)",
            borderColor: card.accentColor,
            transition: { duration: 0.2, ease: "easeOut" },
          }}
          className="flat-card group relative flex min-h-[6.5rem] flex-col justify-between overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3.5 shadow-[var(--shadow-sm)] transition-colors duration-300"
          style={
            {
              "--card-accent": card.accentColor,
            } as React.CSSProperties
          }
          title={card.title}
        >
          {/* Subtle top accent bar */}
          <span
            className="pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-40 transition-opacity duration-300 group-hover:opacity-100"
            style={{ background: card.accentColor }}
            aria-hidden
          />

          <div className="flex items-center justify-between gap-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110"
              style={{
                backgroundColor: `color-mix(in srgb, ${card.accentColor} 10%, transparent)`,
                color: card.accentColor,
              }}
              aria-hidden
            >
              {card.icon}
            </span>
            <span className="text-2xl font-bold tabular-nums leading-none tracking-tight text-[var(--text)]">
              {card.value}
            </span>
          </div>

          <div className="mt-2 min-w-0">
            <span className="block text-sm font-semibold leading-tight text-[var(--text)]">
              {card.label}
            </span>
            <span className="mt-1 block truncate text-[11px] font-medium leading-4 text-[var(--muted)]">
              {card.detail}
            </span>
          </div>
        </motion.div>
      ))}
    </section>
  );
};

const FirstDictationReminder: React.FC<{ shortcut: string }> = ({
  shortcut,
}) => {
  const { t } = useTranslation();
  const checks = [
    t("appSections.firstDictationReminder.checks.cursor", {
      defaultValue: "Place your cursor in any app where text can be typed.",
    }),
    t("appSections.firstDictationReminder.checks.shortcut", {
      defaultValue: "Hold the shortcut, speak naturally, then release.",
    }),
    t("appSections.firstDictationReminder.checks.textAppears", {
      defaultValue: "Vox Jot enters the transcript into the focused field.",
    }),
  ];

  return (
    <section className="rounded-lg border border-[color-mix(in_srgb,var(--accent)_28%,var(--border))] bg-[linear-gradient(180deg,var(--accent-soft),transparent_70%),var(--card)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-md bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--accent)]">
            <Mic className="h-3.5 w-3.5" aria-hidden />
            {t("appSections.firstDictationReminder.eyebrow", {
              defaultValue: "First dictation",
            })}
          </div>
          <h2 className="text-base font-semibold text-[var(--text)]">
            {t("appSections.firstDictationReminder.title", {
              defaultValue: "Try Vox Jot anywhere you can type",
            })}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            {t("appSections.firstDictationReminder.description", {
              defaultValue:
                "Keep this window open or switch to another app. The shortcut works from the focused text field.",
            })}
          </p>
        </div>
        <div className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-center">
          <div className="mb-1 flex items-center justify-center gap-1.5 text-xs font-bold text-[var(--muted)]">
            <Keyboard className="h-3.5 w-3.5" aria-hidden />
            {t("appSections.firstDictationReminder.shortcutLabel", {
              defaultValue: "Shortcut",
            })}
          </div>
          <kbd className="block rounded-md border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 font-mono text-sm font-bold text-[var(--text)]">
            {shortcut}
          </kbd>
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {checks.map((check) => (
          <div
            key={check}
            className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-semibold leading-snug text-[var(--text)]"
          >
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
            <span>{check}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

export const FileTranscriptionSection: React.FC = () => (
  <div className="space-y-6">
    <FileTranscriptionPanel />
  </div>
);

export const CorrectionsSection: React.FC = () => <LearnedCorrectionsSection />;

export const LearnedCorrectionsSection: React.FC<{
  titleActionTargetId?: string;
}> = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <CorrectionDictionaryView
        sectionTitle={t("appSections.sections.dictionaryTitle")}
        showHeaderTitle={false}
      />
    </div>
  );
};

const NoteRow: React.FC<{ note: Note; onOpen: () => void }> = ({
  note,
  onOpen,
}) => {
  const { t } = useTranslation();
  const title =
    note.title.trim() ||
    note.content.trim().split("\n")[0].slice(0, 60) ||
    t("appSections.common.untitled");
  const preview = note.content.trim()
    ? note.content.trim().split("\n").slice(0, 2).join(" ").slice(0, 100)
    : t("appSections.common.emptyNote");
  const date = new Date(note.updated_at * 1000);
  const formattedDate = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text),transparent_94%)] focus-visible:bg-[color-mix(in_srgb,var(--text),transparent_94%)] ${interactiveFocusRingClass}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--text)]">
            {title}
          </span>
          {note.is_pinned && (
            <Pin className="h-3 w-3 shrink-0 rotate-45 text-[var(--accent)]" />
          )}
        </div>
        <p className="mt-0.5 truncate text-xs font-normal leading-snug text-[var(--text)]">
          {preview}
        </p>
      </div>
      <span className="shrink-0 text-xs text-[var(--muted)]">
        {formattedDate}
      </span>
    </button>
  );
};

export const JotPadSection: React.FC = () => {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadNotes = useCallback(() => {
    commands
      .getNotes()
      .then((result) => {
        if (result.status === "ok") {
          setNotes(result.data);
        }
      })
      .catch(() => {
        setNotes([]);
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    const unlisten = listen("notes-updated", () => {
      loadNotes();
    });

    return () => {
      unlisten.then((cleanup) => cleanup());
    };
  }, [loadNotes]);

  const openNoteInJotPad = useCallback(async (noteId?: number) => {
    if (noteId !== undefined) {
      await commands.showScratchpadForNote(noteId);
      return;
    }

    await commands.showScratchpad();
  }, []);

  const createNote = useCallback(async () => {
    const result = await commands.createNote("", "");
    if (result.status === "ok") {
      loadNotes();
      void openNoteInJotPad(result.data.id);
    }
  }, [loadNotes, openNoteInJotPad]);

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return b.updated_at - a.updated_at;
    });
  }, [notes]);

  return (
    <div className="space-y-4">
      <SectionIntro
        title={t("appSections.sections.jotPadTitle")}
        description={t("appSections.sections.jotPadDescription")}
      >
        {isLoading ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-8 text-center text-sm text-[var(--muted)] shadow-[var(--shadow-sm)]">
            {t("appSections.common.loadingNotes")}
          </div>
        ) : notes.length === 0 ? (
          <EmptyState
            icon={<NotebookPen className="h-5 w-5" aria-hidden />}
            title={t("appSections.jotPad.empty")}
            description={t("appSections.jotPad.emptyDescription")}
            example={t("appSections.jotPad.emptyExample")}
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void createNote()}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t("appSections.common.createNote")}
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
            {sortedNotes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                onOpen={() => void openNoteInJotPad(note.id)}
              />
            ))}
          </div>
        )}
      </SectionIntro>
    </div>
  );
};
