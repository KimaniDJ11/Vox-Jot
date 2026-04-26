import React from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import type { WriteRule } from "@/bindings";
import { Button } from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

const dragHandlePrefix = "Priority";
const disabledLabel = "Disabled";
const appsLabel = "Apps";
const urlsLabel = "URLs";
const anyLabel = "Any";
const noneLabel = "None";
const usesGlobalSettingsLabel = "Uses global settings";
const separator = " · ";

interface WriteRuleRowProps {
  rule: WriteRule;
  index: number;
  count: number;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}

export const WriteRuleRow: React.FC<WriteRuleRowProps> = ({
  rule,
  index,
  count,
  onEdit,
  onDelete,
  onMove,
}) => {
  const bundleIds = rule.matchers.bundle_ids ?? [];
  const urls = rule.matchers.url_patterns ?? [];
  const overrides = [
    rule.overrides.tone_id ? `Tone: ${rule.overrides.tone_id}` : null,
    rule.overrides.stt_model_id
      ? `Engine: ${rule.overrides.stt_model_id}`
      : null,
    rule.overrides.auto_submit ? "Auto-submit" : null,
  ].filter(Boolean);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-3">
        <div className="pt-1 text-xs font-bold text-[var(--muted)]">
          {dragHandlePrefix} {rule.priority}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--text)]">
              {rule.name}
            </h3>
            {!rule.enabled ? (
              <Badge variant="secondary" className="px-2 py-0.5 text-xs">
                {disabledLabel}
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {appsLabel}:{" "}
            {bundleIds.length ? bundleIds.join(separator) : anyLabel}{" "}
            {separator}
            {urlsLabel}: {urls.length ? urls.join(separator) : noneLabel}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {overrides.length
              ? overrides.join(separator)
              : usesGlobalSettingsLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move up"
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label="Move down"
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onEdit}
            aria-label="Edit"
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="danger-ghost"
            size="icon-sm"
            onClick={onDelete}
            aria-label="Delete"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
};
