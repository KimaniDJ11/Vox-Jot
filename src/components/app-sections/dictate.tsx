import React, { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { NotebookPen, Pin, Plus } from "lucide-react";

import { commands, type Note } from "@/bindings";
import { FileTranscriptionPanel } from "@/components/dictate/FileTranscriptionPanel";
import { CorrectionDictionaryView } from "@/components/settings/corrections/CorrectionDictionaryView";
import { HistorySettings } from "@/components/settings/history/HistorySettings";
import { ModelsSettings } from "@/components/settings/models/ModelsSettings";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionIntro } from "@/components/app-sections/shared";
import type { ModelHubControlState } from "@/components/model-hub/modelHubControls";

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
  return (
    <div className="space-y-6">
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
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text),transparent_94%)]"
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
