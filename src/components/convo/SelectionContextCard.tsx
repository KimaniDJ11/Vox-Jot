import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardPaste, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface SelectionContextCardProps {
  text: string | null;
  onRefresh: () => void;
  onPaste: (text: string) => void;
}

export const SelectionContextCard: React.FC<SelectionContextCardProps> = ({
  text,
  onRefresh,
  onPaste,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [pasteInput, setPasteInput] = useState("");
  const showPasteBox = !text;

  const displayText = text || "";
  const shouldTruncate = displayText.length > 300 && !expanded;
  const shown = shouldTruncate
    ? displayText.slice(0, 300) + "\u2026"
    : displayText;

  if (showPasteBox) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-[var(--muted)]">
          {t("convo.selection.pastePrompt")}
        </p>
        <textarea
          value={pasteInput}
          onChange={(e) => setPasteInput(e.target.value)}
          placeholder={t("convo.selection.pastePrompt")}
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--accent)]"
          rows={3}
        />
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (pasteInput.trim()) onPaste(pasteInput.trim());
            }}
            disabled={!pasteInput.trim()}
            className="text-xs"
          >
            <ClipboardPaste className="mr-1 h-3 w-3" />
            {t("convo.filesContext.pasteText")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            className="text-xs"
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            {t("convo.selection.refreshSelection")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--muted)]">
            {t("convo.selection.title")}
          </p>
          <p
            className="mt-1 cursor-pointer whitespace-pre-wrap text-xs text-[var(--text)]"
            onClick={() => setExpanded(!expanded)}
          >
            {shown}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            className="h-7 w-7 p-0"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
};
