import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react";

interface JotpadContextCardProps {
  noteContent: string | null;
  noteId: number | null;
}

export const JotpadContextCard: React.FC<JotpadContextCardProps> = ({
  noteContent,
  noteId,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Suppress unused-var lint — noteId is passed for future use
  void noteId;

  if (!noteContent) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <NotebookPen className="h-3.5 w-3.5" />
        <span>{t("convo.jotpad.emptyState")}</span>
      </div>
    );
  }

  const preview =
    noteContent.length > 200 && !expanded
      ? noteContent.slice(0, 200) + "\u2026"
      : noteContent;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <NotebookPen className="h-3.5 w-3.5 text-[var(--muted)]" />
        <span className="text-xs font-medium text-[var(--muted)]">
          {t("convo.jotpad.title")}
        </span>
      </div>
      <p
        className="cursor-pointer whitespace-pre-wrap text-xs text-[var(--text)]"
        onClick={() => setExpanded(!expanded)}
      >
        {preview}
      </p>
    </div>
  );
};
