import React, { useId, useRef, useState, useEffect } from "react";
import {
  type WatchFolderConfig,
  type WatchFolderExistingFile,
  commands,
} from "@/bindings";
import { useTranslation } from "react-i18next";
import { basename } from "../file-workspace/filePaths";
import { ActionIconButton } from "@/components/ui";
import { X, Loader2 } from "lucide-react";
import { formatBytes } from "../reader/readerPresentation";
import { Button } from "@/components/ui/Button";

export const WatchFolderExistingFilesDialog: React.FC<{
  folder: WatchFolderConfig;
  files: WatchFolderExistingFile[];
  onClose: () => void;
}> = ({ folder, files, onClose }) => {
  const { t } = useTranslation();
  const titleId = useId();
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    // Preselect files that are missing output, plus tiny existing outputs
    // that the backend flagged as likely incomplete.
    () =>
      new Set(
        files
          .filter(
            (f) => !f.has_transcript || f.transcript_status === "needs_review",
          )
          .map((f) => f.path),
      ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = files.length > 0 && selected.size === files.length;
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        selected.size > 0 && selected.size < files.length;
    }
  }, [selected, files.length]);

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(files.map((f) => f.path)));
  };

  const toggleOne = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await commands.transcribeWatchFolderFiles(
        folder.id,
        files.filter((f) => selected.has(f.path)).map((f) => f.path),
      );
      if (r.status === "ok") {
        onClose();
        return;
      }
      setError(r.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
      onClick={onClose}
      role="presentation"
      data-testid="watch-folder-existing-files-dialog"
    >
      <div
        className="absolute inset-0 bg-[var(--scrim-bg)] backdrop-blur-[2px]"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(80vh,640px)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-[var(--ring-hairline)] bg-[var(--panel-bg)] shadow-[var(--modal-shadow)]"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-sm font-semibold text-[var(--text)]"
            >
              {t("dictate.watchFolders.scan.title", {
                defaultValue: "Transcribe existing files?",
              })}
            </h2>
            <p className="mt-1 truncate text-xs text-[var(--muted)]">
              {t("dictate.watchFolders.scan.subtitle", {
                defaultValue:
                  "“{{folder}}” already contains {{count}} audio or video file(s). New files are transcribed automatically.",
                folder: basename(folder.path),
                count: files.length,
              })}
            </p>
          </div>
          <ActionIconButton
            type="button"
            onClick={onClose}
            aria-label={t("common.close", { defaultValue: "Close" })}
            title={t("common.close", { defaultValue: "Close" })}
          >
            <X aria-hidden />
          </ActionIconButton>
        </div>

        {files.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-[var(--muted)]">
            {t("dictate.watchFolders.scan.empty", {
              defaultValue:
                "No audio or video files in this folder yet. New files are transcribed automatically.",
            })}
          </p>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 border-b border-[var(--border)] px-5 py-2.5 text-xs font-medium text-[var(--text)]">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="size-3.5 accent-[var(--accent)]"
              checked={allSelected}
              onChange={toggleAll}
            />
            {t("dictate.watchFolders.scan.selectAll", {
              defaultValue: "Select all ({{count}})",
              count: files.length,
            })}
          </label>
        )}

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {files.map((f) => (
            <li key={f.path}>
              <label
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-xs hover:bg-[var(--input)]"
                title={
                  f.transcript_warning
                    ? `${f.relative_path} - ${f.transcript_warning}`
                    : f.relative_path
                }
              >
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 accent-[var(--accent)]"
                  checked={selected.has(f.path)}
                  onChange={() => toggleOne(f.path)}
                />
                <span className="min-w-0 flex-1 truncate text-[var(--text)]">
                  {f.relative_path}
                </span>
                {f.transcript_status === "needs_review" ? (
                  <span className="shrink-0 rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--danger)]">
                    {t("dictate.watchFolders.scan.needsReview", {
                      defaultValue: "Needs review",
                    })}
                  </span>
                ) : f.has_transcript ? (
                  <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,var(--card))] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                    {t("dictate.watchFolders.scan.transcribed", {
                      defaultValue: "Transcribed",
                    })}
                  </span>
                ) : null}
                <span className="shrink-0 tabular-nums text-[var(--muted)]">
                  {formatBytes(f.size_bytes)}
                </span>
              </label>
            </li>
          ))}
        </ul>

        {error ? (
          <p className="px-5 py-2 text-xs text-[var(--danger)]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            {t("dictate.watchFolders.scan.skip", { defaultValue: "Skip" })}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={selected.size === 0 || submitting}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : null}
            {t("dictate.watchFolders.scan.confirm", {
              defaultValue: "Transcribe {{count}} file(s)",
              count: selected.size,
            })}
          </Button>
        </div>
      </div>
    </div>
  );
};
