// One row in the Write Profiles list.
//
// UX heuristics applied here (Nielsen):
//   #2 Match real world  → resolve bundle ids to app names, tone ids to
//                          tone labels, model ids to model names.
//   #6 Recognition       → prefix a small monogram per app so the list
//                          is scannable at a glance.
//   #8 Aesthetic / minimal → drop the empty "URLs: None" / "Uses global
//                          settings" rows; replace raw priority number
//                          with a faint reorder-handle column. Only
//                          show overrides as a single-line summary.
//   #1 Visibility        → highlight the row currently matching the
//                          frontmost app with an "Active now" pill.

import React from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import type {
  InstalledApp,
  LLMPrompt,
  ModelInfo,
  ToneDefinition,
  WriteRule,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import { AppMonogram } from "./AppMonogram";

const disabledLabel = "Disabled";
const activeNowLabel = "Active now";
const anyAppLabel = "Any app";
const noOverridesLabel = "Inherits global settings";
const urlChipPrefix = "URL ·";
const moreSuffix = (n: number) => ` +${n}`;

interface WriteRuleRowProps {
  rule: WriteRule;
  index: number;
  count: number;
  apps: InstalledApp[];
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  models: ModelInfo[];
  isActive?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}

export const WriteRuleRow: React.FC<WriteRuleRowProps> = ({
  rule,
  index,
  count,
  apps,
  tones,
  prompts,
  models,
  isActive,
  onEdit,
  onDelete,
  onMove,
}) => {
  const bundleIds = rule.matchers.bundle_ids ?? [];
  const urls = rule.matchers.url_patterns ?? [];

  // Resolve human-readable summaries up front so the JSX stays tidy.
  const appsByBundleId = React.useMemo(
    () => new Map(apps.map((app) => [app.bundle_id, app.name])),
    [apps],
  );
  const toneById = React.useMemo(
    () => new Map(tones.map((tone) => [tone.id, tone.label || tone.id])),
    [tones],
  );
  const promptById = React.useMemo(
    () => new Map(prompts.map((prompt) => [prompt.id, prompt.name])),
    [prompts],
  );
  const modelById = React.useMemo(
    () => new Map(models.map((model) => [model.id, model.name])),
    [models],
  );

  const overridesSummary = React.useMemo(() => {
    const o = rule.overrides;
    const parts: string[] = [];
    if (o.tone_id) parts.push(`Tone · ${toneById.get(o.tone_id) ?? o.tone_id}`);
    if (o.stt_model_id)
      parts.push(`Engine · ${modelById.get(o.stt_model_id) ?? o.stt_model_id}`);
    if (o.stt_language) parts.push(`Lang · ${o.stt_language}`);
    if (o.translate_to_english === true) parts.push("Translate → EN");
    if (o.post_process_prompt_id)
      parts.push(
        `Prompt · ${promptById.get(o.post_process_prompt_id) ?? o.post_process_prompt_id}`,
      );
    if (o.auto_submit === true) parts.push("Auto-submit");
    if (o.auto_submit === false) parts.push("No auto-submit");
    if (o.append_trailing_space !== null && o.append_trailing_space !== undefined)
      parts.push(o.append_trailing_space ? "Trailing space" : "No trailing space");
    if (o.mute_while_recording === true) parts.push("Mute while recording");
    return parts;
  }, [rule.overrides, toneById, modelById, promptById]);

  return (
    <div
      className={[
        "group rounded-2xl border bg-[var(--card)] px-4 py-3 transition-shadow",
        isActive
          ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--border)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]",
        rule.enabled ? "" : "opacity-60",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        {/* Reorder column — small, left-aligned, doesn't demand attention */}
        <div className="flex shrink-0 flex-col items-center text-[var(--muted)]">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move up"
            className="rounded p-0.5 hover:bg-[var(--input)] disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label="Move down"
            className="rounded p-0.5 hover:bg-[var(--input)] disabled:opacity-30"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-sm font-semibold text-[var(--text)]">
              {rule.name}
            </h3>
            {isActive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                {activeNowLabel}
              </span>
            ) : null}
            {!rule.enabled ? (
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                {disabledLabel}
              </span>
            ) : null}
          </div>

          {/* App + URL summary line. Only render if there's something
              meaningful — empty rows just clutter the eye. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {bundleIds.length === 0 ? (
              <span className="text-xs text-[var(--muted)]">{anyAppLabel}</span>
            ) : (
              bundleIds.slice(0, 3).map((bundleId) => (
                <span
                  key={bundleId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--input)] px-2 py-0.5 text-xs text-[var(--text)]"
                  title={bundleId}
                >
                  <AppMonogram
                    bundleId={bundleId}
                    name={appsByBundleId.get(bundleId)}
                    size="xs"
                  />
                  {appsByBundleId.get(bundleId) ?? bundleId}
                </span>
              ))
            )}
            {bundleIds.length > 3 ? (
              <span className="text-xs text-[var(--muted)]">
                +{bundleIds.length - 3}
              </span>
            ) : null}
            {urls.length > 0 ? (
              <span className="rounded-full bg-[var(--input)] px-2 py-0.5 text-xs text-[var(--text)]">
                {urlChipPrefix} {urls[0]}
                {urls.length > 1 ? moreSuffix(urls.length - 1) : ""}
              </span>
            ) : null}
          </div>

          {/* Override summary line — single horizontal scrollable strip
              if needed. Suppressed entirely when no overrides exist. */}
          <p
            className="mt-1 truncate text-xs text-[var(--muted)]"
            title={overridesSummary.join(" · ")}
          >
            {overridesSummary.length === 0
              ? noOverridesLabel
              : overridesSummary.join(" · ")}
          </p>
        </div>

        {/* Actions — only show on hover/focus to reduce visual noise */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onEdit}
            aria-label="Edit profile"
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="danger-ghost"
            size="icon-sm"
            onClick={onDelete}
            aria-label="Delete profile"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
};
