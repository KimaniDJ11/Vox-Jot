import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  InstalledApp,
  LLMPrompt,
  ModelInfo,
  ToneDefinition,
  WriteRule,
  WriteRuleOverrides,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import { humanizeBundleId } from "@/lib/installedApps";
import { AppMonogram } from "./AppMonogram";

export interface WriteRuleGroup {
  key: string;
  rules: WriteRule[];
  overrides: WriteRuleOverrides;
}

const activeNowLabel = "Active now";
const anyAppLabel = "Any app";
const noOverridesLabel = "Inherits global settings";
const urlChipPrefix = "URL ·";
const profilesLabel = (count: number) =>
  count === 1 ? "1 profile" : `${count} profiles`;

interface WriteProfileGroupCardProps {
  group: WriteRuleGroup;
  apps: InstalledApp[];
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  models: ModelInfo[];
  activeRuleId: string | null;
  onEdit: (rule: WriteRule) => void;
  onDelete: (id: string) => void;
}

export const writeRuleGroupKey = (overrides: WriteRuleOverrides): string => {
  const normalized: Required<WriteRuleOverrides> = {
    stt_model_id: overrides.stt_model_id?.trim() || null,
    stt_language: overrides.stt_language?.trim() || null,
    translate_to_english: overrides.translate_to_english ?? null,
    tone_id: overrides.tone_id?.trim() || null,
    post_process_prompt_id: overrides.post_process_prompt_id?.trim() || null,
    auto_submit: overrides.auto_submit ?? null,
    paste_method: overrides.paste_method ?? null,
    append_trailing_space: overrides.append_trailing_space ?? null,
    mute_while_recording: overrides.mute_while_recording ?? null,
    force_post_process: overrides.force_post_process ?? null,
  };
  return JSON.stringify(normalized);
};

export const groupWriteRules = (rules: WriteRule[]): WriteRuleGroup[] => {
  const groupsByKey = new Map<string, WriteRuleGroup>();
  for (const rule of rules) {
    const key = writeRuleGroupKey(rule.overrides);
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.rules.push(rule);
    } else {
      groupsByKey.set(key, {
        key,
        rules: [rule],
        overrides: rule.overrides,
      });
    }
  }

  return [...groupsByKey.values()].sort((left, right) =>
    groupSortLabel(left).localeCompare(groupSortLabel(right)),
  );
};

const groupSortLabel = (group: WriteRuleGroup): string =>
  group.overrides.tone_id ??
  group.overrides.stt_model_id ??
  group.rules[0]?.name ??
  group.key;

export const WriteProfileGroupCard: React.FC<WriteProfileGroupCardProps> = ({
  group,
  apps,
  tones,
  prompts,
  models,
  activeRuleId,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation();
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
  const activeRule = group.rules.find((rule) => rule.id === activeRuleId);

  const targetForRule = React.useCallback(
    (rule: WriteRule) => {
      const bundleIds = rule.matchers.bundle_ids ?? [];
      const urls = rule.matchers.url_patterns ?? [];
      const firstBundleId = bundleIds[0] ?? null;
      const label =
        urls.length > 0
          ? `${urlChipPrefix} ${urls[0]}${urls.length > 1 ? ` +${urls.length - 1}` : ""}`
          : bundleIds.length === 1 && firstBundleId
            ? appNameFor(firstBundleId)
            : bundleIds.length > 1
              ? `${bundleIds.length} apps`
              : anyAppLabel;

      return {
        firstBundleId,
        label,
      };
    },
    [appNameFor],
  );

  const overridesSummary = React.useMemo(() => {
    const o = group.overrides;
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
    if (o.append_trailing_space !== null && o.append_trailing_space !== undefined)
      parts.push(o.append_trailing_space ? "Trailing space" : "No trailing space");
    if (o.mute_while_recording === true) parts.push("Mute while recording");
    return parts;
  }, [group.overrides, modelById, promptById, toneById]);

  return (
    <div
      className={[
        "group flex h-full min-h-[160px] flex-col rounded-2xl border bg-[var(--card)] px-4 py-3 transition-shadow",
        activeRule
          ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--border)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]",
      ].join(" ")}
    >
      <div className="flex flex-1 flex-col">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-sm font-semibold text-[var(--text)]">
              {overridesSummary.length === 0
                ? noOverridesLabel
                : overridesSummary.join(" · ")}
            </h3>
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              {profilesLabel(group.rules.length)}
            </span>
            {activeRule ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                {activeNowLabel}
              </span>
            ) : null}
          </div>

          <div className="mt-3 space-y-1.5">
            {group.rules.map((rule) => {
              const target = targetForRule(rule);
              return (
                <div
                  key={rule.id}
                  className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1.5"
                >
                  {target.firstBundleId ? (
                    <AppMonogram
                      bundleId={target.firstBundleId}
                      name={appNameFor(target.firstBundleId)}
                      size="sm"
                    />
                  ) : null}
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text)]"
                    title={target.label}
                  >
                    {target.label}
                  </span>
                  {!rule.enabled ? (
                    <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--muted)]">
                      {t("refine.writeRules.disabled")}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onEdit(rule)}
                    aria-label={`Edit ${rule.name}`}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="danger-ghost"
                    size="icon-xs"
                    onClick={() => onDelete(rule.id)}
                    aria-label={`Delete ${rule.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
