import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ClipboardCopy,
  ListTodo,
  Loader2,
  NotebookPen,
  Sparkles,
  Volume2,
  Wand2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { commands } from "@/bindings";

type TransformTask = "summarize" | "cleanup" | "notes" | "action_items";

const TRANSFORM_TASKS: Array<{
  id: TransformTask;
  defaultLabel: string;
  Icon: typeof Sparkles;
}> = [
  { id: "summarize", defaultLabel: "Summarize", Icon: Sparkles },
  { id: "cleanup", defaultLabel: "Clean up", Icon: Wand2 },
  { id: "notes", defaultLabel: "Make notes", Icon: NotebookPen },
  { id: "action_items", defaultLabel: "Action items", Icon: ListTodo },
];

export type ReaderTransformToolsProps = {
  documentText: string;
  onListen: (text: string) => void;
  /** Drop the inline border/heading when rendered inside a popup dialog. */
  embedded?: boolean;
};

export const ReaderTransformTools: React.FC<ReaderTransformToolsProps> = ({
  documentText,
  onListen,
  embedded = false,
}) => {
  const { t } = useTranslation();
  const [runningTask, setRunningTask] = useState<TransformTask | null>(null);
  const [result, setResult] = useState<{
    task: TransformTask;
    text: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const hasText = documentText.trim().length > 0;

  const runTask = useCallback(
    async (task: TransformTask) => {
      if (!hasText || runningTask) return;
      setRunningTask(task);
      setError("");
      try {
        const result = await commands.readerTransformText(documentText, task);
        if (result.status === "error") {
          throw new Error(result.error);
        }
        setResult({ task, text: result.data.trim() });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : t("dictate.reader.transform.failed", {
                  defaultValue: "The AI transform failed.",
                }),
        );
      } finally {
        setRunningTask(null);
      }
    },
    [documentText, hasText, runningTask, t],
  );

  const copyResult = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(
        t("dictate.reader.transform.copyFailed", {
          defaultValue: "Failed to copy the result.",
        }),
      );
    }
  }, [result, t]);

  const taskLabel = (task: TransformTask): string => {
    const entry = TRANSFORM_TASKS.find((item) => item.id === task);
    return t(`dictate.reader.transform.${task}`, {
      defaultValue: entry?.defaultLabel ?? task,
    });
  };

  return (
    <div
      className={
        embedded
          ? "space-y-3"
          : "space-y-3 border-t border-[var(--border)] pt-4"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {embedded ? null : (
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            {t("dictate.reader.transform.title", { defaultValue: "Transform" })}
          </span>
        )}
        {TRANSFORM_TASKS.map(({ id, defaultLabel, Icon }) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant="secondary"
            disabled={!hasText || runningTask !== null}
            onClick={() => void runTask(id)}
            className="gap-1.5 text-xs"
          >
            {runningTask === id ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <Icon size={13} aria-hidden="true" />
            )}
            {t(`dictate.reader.transform.${id}`, {
              defaultValue: defaultLabel,
            })}
          </Button>
        ))}
      </div>

      {error ? (
        <div
          className="rounded-lg bg-[color-mix(in_srgb,var(--danger),transparent_94%)] px-3 py-2 text-xs text-[var(--text)]"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--text)]">
              {taskLabel(result.task)}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onListen(result.text)}
                className="gap-1.5 text-xs"
              >
                <Volume2 size={13} aria-hidden="true" />
                {t("dictate.reader.transform.listen", {
                  defaultValue: "Listen",
                })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={copyResult}
                className="gap-1.5 text-xs"
              >
                {copied ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <ClipboardCopy size={13} aria-hidden="true" />
                )}
                {copied
                  ? t("dictate.reader.copied", { defaultValue: "Copied" })
                  : t("dictate.reader.transform.copy", {
                      defaultValue: "Copy",
                    })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setResult(null)}
                className="gap-1.5 text-xs"
                aria-label={t("dictate.reader.transform.clear", {
                  defaultValue: "Clear result",
                })}
                title={t("dictate.reader.transform.clear", {
                  defaultValue: "Clear result",
                })}
              >
                <X size={13} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <p className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text)]">
            {result.text}
          </p>
        </div>
      ) : null}
    </div>
  );
};
