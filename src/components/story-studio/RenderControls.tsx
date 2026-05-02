import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Play,
  Square,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface RenderControlsProps {
  canRender: boolean;
  isRendering: boolean;
  progressLabel: string | null;
  validationErrorCount: number;
  outputPath: string | null;
  durationMs: number | null;
  lineCount: number;
  pauseMs: number;
  onPauseChange: (value: number) => void;
  onRender: () => void;
  onCancel: () => void;
  onPlay: () => void;
  onReveal: () => void;
  className?: string;
}

export const RenderControls: React.FC<RenderControlsProps> = ({
  canRender,
  isRendering,
  progressLabel,
  validationErrorCount,
  outputPath,
  durationMs,
  lineCount,
  pauseMs,
  onPauseChange,
  onRender,
  onCancel,
  onPlay,
  onReveal,
  className = "",
}) => {
  const durationLabel =
    durationMs === null ? null : formatDuration(Math.max(0, durationMs));
  const progressPercent =
    isRendering && progressLabel ? getProgressPercent(progressLabel) : null;
  const statusLabel = isRendering
    ? progressLabel
    : validationErrorCount > 0
      ? `${validationErrorCount} issue${validationErrorCount === 1 ? "" : "s"} to fix before rendering`
      : outputPath
        ? `Rendered ${lineCount} line${lineCount === 1 ? "" : "s"}${durationLabel ? ` (${durationLabel})` : ""}`
        : `${lineCount} line${lineCount === 1 ? "" : "s"} ready to render`;

  return (
    <section
      className={`space-y-3 rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] px-3 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.06)] backdrop-blur-md ${className}`}
    >
      <div className="grid gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">Output</h3>
          <div
            className="mt-1 flex items-center gap-2 text-sm text-[var(--muted)]"
            aria-live="polite"
          >
            {validationErrorCount > 0 ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-[var(--danger)]" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--success)]" />
            )}
            <span>{statusLabel}</span>
          </div>
        </div>
        <label className="text-sm font-medium text-[var(--text)]">
          Pause between lines
          <input
            type="number"
            min={0}
            max={10000}
            step={100}
            value={pauseMs}
            onChange={(event) =>
              onPauseChange(Number.parseInt(event.target.value, 10) || 0)
            }
            disabled={isRendering}
            className="mt-1 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>

      {isRendering && progressPercent !== null ? (
        <div
          className="h-2 overflow-hidden rounded-full bg-[var(--panel-bg)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {isRendering ? (
          <Button
            type="button"
            variant="danger-ghost"
            onClick={onCancel}
            className="w-full sm:w-auto lg:w-full"
          >
            <Square className="h-4 w-4" />
            Cancel Render
          </Button>
        ) : (
          <Button
            type="button"
            onClick={onRender}
            disabled={!canRender}
            variant="primary"
            className="w-full sm:w-auto lg:w-full"
          >
            <WandSparkles className="h-4 w-4" />
            Generate Story Audio
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={onPlay}
          disabled={!outputPath || isRendering}
          className="flex-1 sm:flex-none lg:flex-1"
        >
          <Play className="h-4 w-4" />
          Play
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onReveal}
          disabled={!outputPath || isRendering}
          className="flex-1 sm:flex-none lg:flex-1"
        >
          <FolderOpen className="h-4 w-4" />
          Reveal
        </Button>
      </div>
    </section>
  );
};

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getProgressPercent(progressLabel: string): number {
  const match = progressLabel.match(/line\s+(\d+)\s+of\s+(\d+)/i);
  if (!match) {
    return progressLabel.toLocaleLowerCase().includes("assembling") ? 92 : 8;
  }
  const current = Number.parseInt(match[1], 10);
  const total = Number.parseInt(match[2], 10);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return 8;
  }
  return Math.min(90, Math.max(8, Math.round((current / total) * 90)));
}
