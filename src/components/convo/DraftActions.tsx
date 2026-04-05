import React from "react";
import { useTranslation } from "react-i18next";
import { Replace, PlusCircle, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface DraftActionsProps {
  draftContent: string;
  noteId: number | null;
  onReplace: () => void;
  onAppend: () => void;
  onCopy: () => void;
}

export const DraftActions: React.FC<DraftActionsProps> = ({
  draftContent,
  noteId,
  onReplace,
  onAppend,
  onCopy,
}) => {
  const { t } = useTranslation();

  if (!draftContent || !noteId) return null;

  return (
    <div className="mt-2 flex gap-1.5 border-t border-[var(--border)] pt-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={onReplace}
        className="text-xs"
      >
        <Replace className="mr-1 h-3 w-3" />
        {t("convo.jotpad.replaceNote")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onAppend}
        className="text-xs"
      >
        <PlusCircle className="mr-1 h-3 w-3" />
        {t("convo.jotpad.appendToNote")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCopy}
        className="text-xs"
      >
        <Copy className="mr-1 h-3 w-3" />
        {t("convo.jotpad.copyDraft")}
      </Button>
    </div>
  );
};
