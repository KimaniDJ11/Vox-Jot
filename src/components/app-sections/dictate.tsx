import React, { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Check, Keyboard, Mic, NotebookPen, Pin, Plus } from "lucide-react";

import { commands, type Note } from "@/bindings";
import { FileTranscriptionPanel } from "@/components/dictate/FileTranscriptionPanel";
import { CorrectionDictionaryView } from "@/components/settings/corrections/CorrectionDictionaryView";
import { HistorySettings } from "@/components/settings/history/HistorySettings";
import { ModelsSettings } from "@/components/settings/models/ModelsSettings";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionIntro } from "@/components/app-sections/shared";
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
      <SectionIntro
        title={t("appSections.sections.recentHistoryTitle")}
        description={t("appSections.sections.recentHistoryDescription")}
        descriptionOnlyGap="controls"
      >
        <HistorySettings />
      </SectionIntro>
    </div>
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
                <Plus className="mr-1 h-4 w-4" />
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
