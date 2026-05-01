import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { File, FolderOpen, ClipboardPaste, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { interactiveFocusRingClass } from "@/lib/interactiveFocus";
import { commands, type ConvoContextItem } from "@/bindings";

interface FilesContextCardProps {
  sessionId: string | null;
}

export const FilesContextCard: React.FC<FilesContextCardProps> = ({
  sessionId,
}) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<ConvoContextItem[]>([]);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteInput, setPasteInput] = useState("");

  const refreshItems = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await commands.convoListContextItems(sessionId);
      if (result.status === "ok") {
        setItems(result.data as unknown as ConvoContextItem[]);
      }
    } catch {
      // ignore
    }
  }, [sessionId]);

  useEffect(() => {
    refreshItems();
  }, [refreshItems]);

  const handleAttachFile = async () => {
    if (!sessionId) return;
    try {
      await commands.convoPickFilesContext(sessionId);
      await refreshItems();
    } catch (err) {
      console.error("Failed to attach file:", err);
    }
  };

  const handleAttachFolder = async () => {
    if (!sessionId) return;
    try {
      await commands.convoPickFolderContext(sessionId);
      await refreshItems();
    } catch (err) {
      console.error("Failed to attach folder:", err);
    }
  };

  const handlePasteText = async () => {
    if (!sessionId || !pasteInput.trim()) return;
    try {
      await commands.convoAddContextItem(
        sessionId,
        "Pasted text",
        "pasted_text",
        pasteInput.trim(),
      );
      setPasteInput("");
      setShowPasteBox(false);
      await refreshItems();
    } catch (err) {
      console.error("Failed to add pasted text:", err);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!sessionId) return;
    try {
      await commands.convoRemoveContextItem(sessionId, itemId);
      await refreshItems();
    } catch {
      // ignore
    }
  };

  const sourceIcon = (type: string) => {
    switch (type) {
      case "file":
        return <File className="h-3 w-3" />;
      case "folder":
        return <FolderOpen className="h-3 w-3" />;
      default:
        return <ClipboardPaste className="h-3 w-3" />;
    }
  };

  return (
    <div className="space-y-2">
      {/* Attached items */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-xs text-[var(--text)]"
            >
              {sourceIcon(item.source_type)}
              <span className="max-w-[150px] truncate">{item.label}</span>
              <span className="text-[var(--muted)]">
                {t("convo.filesContext.charCount", {
                  count: Math.round(item.char_count / 1000),
                })}
              </span>
              <button
                type="button"
                onClick={() => void handleRemoveItem(item.id)}
                className={`ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--text)] ${interactiveFocusRingClass}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Paste box */}
      {showPasteBox && (
        <div className="space-y-1.5">
          <textarea
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
            placeholder={t("convo.filesContext.pasteText")}
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--accent)]"
            rows={3}
          />
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handlePasteText()}
              disabled={!pasteInput.trim()}
              className="text-xs"
            >
              {t("convo.common.send")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowPasteBox(false);
                setPasteInput("");
              }}
              className="text-xs"
            >
              {t("convo.filesContext.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleAttachFile()}
          className="text-xs"
        >
          <Plus className="mr-1 h-3 w-3" />
          {t("convo.filesContext.attachFiles")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleAttachFolder()}
          className="text-xs"
        >
          <FolderOpen className="mr-1 h-3 w-3" />
          {t("convo.filesContext.attachFolder")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPasteBox(true)}
          className="text-xs"
        >
          <ClipboardPaste className="mr-1 h-3 w-3" />
          {t("convo.filesContext.pasteText")}
        </Button>
      </div>
    </div>
  );
};
