import React from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  InstalledApp,
  LLMPrompt,
  ModelInfo,
  ToneDefinition,
  WriteRule,
  WriteRuleOverrides,
} from "@/bindings";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { humanizeBundleId } from "@/lib/installedApps";
import { AppMonogram } from "./AppMonogram";

interface WriteRuleGroup {
  key: string;
  rules: WriteRule[];
  overrides: WriteRuleOverrides;
}

const activeNowLabel = "Active now";
const anyAppLabel = "Any app";
const noOverridesLabel = "Inherits global settings";
const urlChipPrefix = "URL ·";
const collapsedIconLimit = 5;
const builtInToneSummaries: Record<string, string> = {
  casual: "Casual, conversational wording for quick chat messages.",
  coding: "Precise technical writing for code editors and terminals.",
  concise: "Shorter, clearer wording that preserves important details.",
  neutral: "Neutral wording close to what was spoken.",
  professional: "Polished professional wording for email and documents.",
};

const toneCardDescription = (tone: ToneDefinition): string | null =>
  builtInToneSummaries[tone.id] ?? (tone.instruction.trim() || null);

const initialsFor = (label: string): string =>
  label
    .split(/[\s._/:+-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "?";

interface WriteProfileGroupCardProps {
  group: WriteRuleGroup;
  apps: InstalledApp[];
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  models: ModelInfo[];
  activeRuleId: string | null;
  onEdit: (rule: WriteRule) => void;
  onDelete: (id: string) => void | Promise<void>;
}

const writeRuleGroupKey = (overrides: WriteRuleOverrides): string => {
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
  const [confirmingDeleteId, setConfirmingDeleteId] = React.useState<
    string | null
  >(null);
  const [showAllRules, setShowAllRules] = React.useState(false);
  const appsByBundleId = React.useMemo(
    () => new Map(apps.map((app) => [app.bundle_id, app.name])),
    [apps],
  );
  const toneById = React.useMemo(
    () => new Map(tones.map((tone) => [tone.id, tone])),
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
  const visibleRules = showAllRules
    ? group.rules
    : group.rules.slice(0, collapsedIconLimit);
  const hiddenRuleCount = Math.max(group.rules.length - collapsedIconLimit, 0);
  const confirmingRule = group.rules.find(
    (rule) => rule.id === confirmingDeleteId,
  );

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
  const confirmingTarget = confirmingRule ? targetForRule(confirmingRule) : null;

  const overridesSummary = React.useMemo(() => {
    const o = group.overrides;
    const parts: string[] = [];
    if (o.tone_id) parts.push(toneById.get(o.tone_id)?.label || o.tone_id);
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
  }, [group.overrides, modelById, promptById, toneById]);
  const toneDescription = React.useMemo(() => {
    const toneId = group.overrides.tone_id?.trim();
    if (!toneId) return null;
    const tone = toneById.get(toneId);
    return tone ? toneCardDescription(tone) : null;
  }, [group.overrides.tone_id, toneById]);

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
            <h3 className="write-profile-group-title heading-display min-w-0 truncate text-2xl font-bold leading-tight text-[var(--text)]">
              {overridesSummary.length === 0
                ? noOverridesLabel
                : overridesSummary.join(" · ")}
            </h3>
            {activeRule ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                {activeNowLabel}
              </span>
            ) : null}
          </div>
          {toneDescription ? (
            <p className="write-profile-group-description mt-1 line-clamp-3 text-sm font-normal leading-6 text-[var(--text)]">
              {toneDescription}
            </p>
          ) : null}

          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-y-2 pl-1">
            {visibleRules.map((rule, index) => {
              const target = targetForRule(rule);
              return (
                <div
                  key={rule.id}
                  className={[
                    "group/app relative",
                    index === 0 ? "" : "-ml-3",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => onEdit(rule)}
                    aria-label={`Edit ${rule.name}`}
                    title={`Edit ${target.label}`}
                    className={[
                      "relative flex h-14 w-14 items-center justify-center rounded-full border-4 bg-[color-mix(in_srgb,var(--text),transparent_82%)] shadow-[var(--shadow-sm)] transition-transform hover:z-20 hover:-translate-y-0.5 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                      rule.id === activeRuleId
                        ? "z-10 border-[var(--accent)]"
                        : "border-[color-mix(in_srgb,var(--text),transparent_72%)]",
                      rule.enabled ? "" : "opacity-55",
                    ].join(" ")}
                  >
                    {target.firstBundleId ? (
                      <AppMonogram
                        bundleId={target.firstBundleId}
                        name={appNameFor(target.firstBundleId)}
                        size="lg"
                        className="rounded-xl"
                      />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-sm font-bold text-[var(--text)]">
                        {initialsFor(target.label)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(rule.id)}
                    aria-label={`Delete ${rule.name}`}
                    title={`Delete ${rule.name}`}
                    className="absolute -right-0.5 -top-0.5 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--danger)] opacity-0 shadow-[var(--shadow-sm)] transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] group-hover/app:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              );
            })}
            {hiddenRuleCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setShowAllRules((value) => !value);
                  setConfirmingDeleteId(null);
                }}
                aria-label={
                  showAllRules
                    ? "Show fewer profiles"
                    : `Show ${hiddenRuleCount} more profiles`
                }
                title={
                  showAllRules
                    ? "Show fewer"
                    : `Show ${hiddenRuleCount} more profiles`
                }
                className="-ml-3 flex h-14 w-14 items-center justify-center rounded-full border-4 border-[color-mix(in_srgb,var(--text),transparent_72%)] bg-[color-mix(in_srgb,var(--text),transparent_82%)] text-[var(--text)] shadow-[var(--shadow-sm)] transition-transform hover:z-20 hover:-translate-y-0.5 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {showAllRules ? (
                  <X className="h-6 w-6" aria-hidden />
                ) : (
                  <Plus className="h-7 w-7" aria-hidden />
                )}
              </button>
            ) : null}
          </div>

          {confirmingRule && confirmingTarget ? (
            <div className="mt-3 flex min-w-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text)]"
                title={confirmingTarget.label}
              >
                {t("refine.writeRules.row.confirmDeleteProfile", {
                  defaultValue: "Delete {{label}}?",
                  label: confirmingTarget.label,
                })}
              </span>
              <ActionIconButton
                tone="confirm"
                onClick={async () => {
                  await onDelete(confirmingRule.id);
                  setConfirmingDeleteId(null);
                }}
                aria-label={t("refine.writeRules.row.deleteProfile")}
                title={t("refine.writeRules.row.deleteProfile")}
              >
                <Trash2 aria-hidden />
              </ActionIconButton>
              <ActionIconButton
                onClick={() => setConfirmingDeleteId(null)}
                aria-label={t("common.cancel", {
                  defaultValue: "Cancel",
                })}
                title={t("common.cancel", { defaultValue: "Cancel" })}
              >
                <X aria-hidden />
              </ActionIconButton>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
