// One row in the Write Profiles list.
//
// UX heuristics applied here (Nielsen):
//   #2 Match real world  → resolve bundle ids to app names, tone ids to
//                          tone labels, model ids to model names.
//   #6 Recognition       → prefix a small monogram per app so the list
//                          is scannable at a glance.
//   #8 Aesthetic / minimal → drop the empty "URLs: None" / "Uses global
//                          settings" rows; show overrides as a
//                          single-line summary.
//   #1 Visibility        → highlight the row currently matching the
//                          frontmost app with an "Active now" pill.

import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import type {
  InstalledApp,
  LLMPrompt,
  ModelInfo,
  ToneDefinition,
  WriteRule,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import { humanizeBundleId } from "@/lib/installedApps";
import { AppMonogram } from "./AppMonogram";

const disabledLabel = "Disabled";
const activeNowLabel = "Active now";
const anyAppLabel = "Any app";
const multipleAppsLabel = (count: number) => `${count} apps`;
const noOverridesLabel = "Inherits global settings";
const urlChipPrefix = "URL ·";
const moreSuffix = (n: number) => ` +${n}`;

interface WriteRuleRowProps {
  rule: WriteRule;
  apps: InstalledApp[];
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  models: ModelInfo[];
  isActive?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export const WriteRuleRow: React.FC<WriteRuleRowProps> = ({
  rule,
  apps,
  tones,
  prompts,
  models,
  isActive,
  onEdit,
  onDelete,
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

  const appNameFor = React.useCallback(
    (bundleId: string) =>
      appsByBundleId.get(bundleId) ?? humanizeBundleId(bundleId),
    [appsByBundleId],
  );

  const primaryBundleId = bundleIds[0] ?? null;
  const primaryTarget = React.useMemo(() => {
    if (urls.length > 0) {
      return `${urlChipPrefix} ${urls[0]}${
        urls.length > 1 ? moreSuffix(urls.length - 1) : ""
      }`;
    }
    if (bundleIds.length === 1 && primaryBundleId) {
      return appNameFor(primaryBundleId);
    }
    if (bundleIds.length > 1) {
      return multipleAppsLabel(bundleIds.length);
    }
    return anyAppLabel;
  }, [appNameFor, bundleIds, primaryBundleId, urls]);

  const showPrimaryAppIcon =
    bundleIds.length === 1 && urls.length === 0 && primaryBundleId !== null;
  const showMatcherContext = bundleIds.length > 1 || urls.length > 0;

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
    if (o.force_post_process === true) parts.push("Always post-process");
    if (o.force_post_process === false) parts.push("Skip post-process");
    if (
      o.append_trailing_space !== null &&
      o.append_trailing_space !== undefined
    )
      parts.push(
        o.append_trailing_space ? "Trailing space" : "No trailing space",
      );
    if (o.mute_while_recording === true) parts.push("Mute while recording");
    return parts;
  }, [rule.overrides, toneById, modelById, promptById]);

  return (
    <div
      className={[
        "group flex h-full min-h-[128px] flex-col rounded-2xl border bg-[var(--card)] px-4 py-3 transition-shadow",
        isActive
          ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--border)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]",
        rule.enabled ? "" : "opacity-60",
      ].join(" ")}
    >
      <div className="flex flex-1 items-center gap-3">
        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3
              className="flex min-w-0 items-center gap-3 text-lg font-semibold text-[var(--text)]"
              title={primaryTarget}
            >
              {showPrimaryAppIcon ? (
                <AppMonogram
                  bundleId={primaryBundleId}
                  name={appNameFor(primaryBundleId)}
                  size="lg"
                />
              ) : null}
              <span className="truncate">{primaryTarget}</span>
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

          {showMatcherContext ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {bundleIds.slice(0, 3).map((bundleId) => (
                <span
                  key={bundleId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--input)] px-2.5 py-1 text-[13px] text-[var(--text)]"
                  title={bundleId}
                >
                  <AppMonogram
                    bundleId={bundleId}
                    name={appNameFor(bundleId)}
                    size="sm"
                  />
                  {appNameFor(bundleId)}
                </span>
              ))}
              {bundleIds.length > 3 ? (
                <span className="text-xs text-[var(--muted)]">
                  +{bundleIds.length - 3}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Override summary line — single horizontal scrollable strip
              if needed. Suppressed entirely when no overrides exist. */}
          <p
            className="mt-2 truncate text-sm leading-5 text-[var(--muted)]"
            title={overridesSummary.join(" · ")}
          >
            {overridesSummary.length === 0
              ? noOverridesLabel
              : overridesSummary.join(" · ")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
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
