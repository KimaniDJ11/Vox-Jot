import React from "react";
import { Globe, Plus, Trash2, WandSparkles, X } from "lucide-react";
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
import {
  engineTypeToProviderId,
  ProviderIcon,
  resolveModelProviderId,
} from "@/components/ui/ProviderIcon";
import { humanizeBundleId } from "@/lib/installedApps";
import { AppMonogram } from "./AppMonogram";

interface WriteRuleGroup {
  key: string;
  rules: WriteRule[];
  overrides: WriteRuleOverrides;
}

const activeNowLabel = "Active now";
const anyAppLabel = "Any app";
const anyBrowserLabel = "All browsers";
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

const hasPreviewableCleanup = (overrides: WriteRuleOverrides): boolean =>
  Boolean(
    (overrides.cleanup_level && overrides.cleanup_level !== "raw") ||
      overrides.tone_id ||
      overrides.post_process_prompt_id ||
      overrides.force_post_process === true,
  );

const initialsFor = (label: string): string =>
  label
    .split(/[\s._/:+-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "?";

function cleanupLevelLabel(level: string): string {
  switch (level) {
    case "raw":
      return "Raw cleanup";
    case "light":
      return "Light cleanup";
    case "medium":
      return "Medium cleanup";
    case "high":
      return "High cleanup";
    default:
      return level;
  }
}

interface WriteProfileGroupCardProps {
  group: WriteRuleGroup;
  apps: InstalledApp[];
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  models: ModelInfo[];
  activeRuleId: string | null;
  onEdit: (rule: WriteRule) => void;
  onDelete: (id: string) => void | Promise<void>;
  onTry?: (rule: WriteRule) => void | Promise<void>;
}

const writeRuleGroupKey = (overrides: WriteRuleOverrides): string => {
  const normalized: Required<WriteRuleOverrides> = {
    stt_model_id: overrides.stt_model_id?.trim() || null,
    stt_language: overrides.stt_language?.trim() || null,
    translate_to_english: overrides.translate_to_english ?? null,
    tone_id: overrides.tone_id?.trim() || null,
    post_process_prompt_id: overrides.post_process_prompt_id?.trim() || null,
    cleanup_level: overrides.cleanup_level ?? null,
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
  group.overrides.cleanup_level ??
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
  onTry,
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
  const sttModelById = React.useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );

  const appNameFor = React.useCallback(
    (bundleId: string) =>
      appsByBundleId.get(bundleId) ?? humanizeBundleId(bundleId),
    [appsByBundleId],
  );
  const activeRule = group.rules.find((rule) => rule.id === activeRuleId);
  const tryRule = activeRule ?? group.rules[0] ?? null;
  const canPreviewMode =
    Boolean(onTry && tryRule) && hasPreviewableCleanup(group.overrides);
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
  const cardTitle =
    group.rules.length === 1
      ? (group.rules[0]?.name.trim() ?? "")
      : "";
  const targetChips = React.useMemo(() => {
    const hasUrlTarget = group.rules.some(
      (rule) => (rule.matchers.url_patterns ?? []).length > 0,
    );
    if (!hasUrlTarget) return [];

    const chips: Array<{
      key: string;
      label: string;
      kind: "app" | "url" | "any-browser" | "any-app";
      bundleId?: string;
    }> = [];
    const seen = new Set<string>();
    for (const rule of group.rules) {
      const bundleIds = rule.matchers.bundle_ids ?? [];
      const urls = rule.matchers.url_patterns ?? [];
      if (urls.length > 0 && bundleIds.length === 0) {
        const key = "any-browser";
        if (!seen.has(key)) {
          chips.push({ key, label: anyBrowserLabel, kind: "any-browser" });
          seen.add(key);
        }
      } else if (bundleIds.length === 0 && urls.length === 0) {
        const key = "any-app";
        if (!seen.has(key)) {
          chips.push({ key, label: anyAppLabel, kind: "any-app" });
          seen.add(key);
        }
      }
      for (const bundleId of bundleIds) {
        const key = `app:${bundleId}`;
        if (seen.has(key)) continue;
        chips.push({
          key,
          label: appNameFor(bundleId),
          kind: "app",
          bundleId,
        });
        seen.add(key);
      }
      for (const url of urls) {
        const key = `url:${url}`;
        if (seen.has(key)) continue;
        chips.push({ key, label: url, kind: "url" });
        seen.add(key);
      }
    }
    return chips;
  }, [appNameFor, group.rules]);

  const overridesSummary = React.useMemo(() => {
    const o = group.overrides;
    const parts: string[] = [];
    if (o.cleanup_level) parts.push(cleanupLevelLabel(o.cleanup_level));
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
  const cardDisplayTitle =
    cardTitle ||
    (overridesSummary.length === 0
      ? noOverridesLabel
      : overridesSummary.join(" · "));
  const targetDescription = React.useMemo(() => {
    if (group.rules.length !== 1) return null;
    const rule = group.rules[0];
    if (!rule) return null;
    const bundleIds = rule.matchers.bundle_ids ?? [];
    const urls = rule.matchers.url_patterns ?? [];
    const urlLabel =
      urls.length === 0
        ? null
        : `${urls[0]}${urls.length > 1 ? ` +${urls.length - 1}` : ""}`;

    if (urlLabel && bundleIds.length === 0) {
      return `Runs on ${urlLabel} in any supported browser.`;
    }
    if (urlLabel && bundleIds.length === 1) {
      return `Runs in ${appNameFor(bundleIds[0] ?? "")} when the URL matches ${urlLabel}.`;
    }
    if (urlLabel && bundleIds.length > 1) {
      return `Runs in ${bundleIds.length} browsers when the URL matches ${urlLabel}.`;
    }
    if (bundleIds.length === 1) {
      return `Runs in ${appNameFor(bundleIds[0] ?? "")}.`;
    }
    if (bundleIds.length > 1) {
      return `Runs in ${bundleIds.length} apps.`;
    }
    return "Runs in any app.";
  }, [appNameFor, group.rules]);
  const cardDescription = [
    cardTitle && overridesSummary.length > 0 ? overridesSummary.join(" · ") : null,
    toneDescription,
    targetDescription,
  ]
    .filter(Boolean)
    .join(" · ");
  const engineProviderId = React.useMemo(() => {
    const modelId = group.overrides.stt_model_id?.trim();
    if (!modelId) return null;
    const model = sttModelById.get(modelId);
    if (!model) return null;
    return resolveModelProviderId(
      `${model.name} ${model.id}`,
      engineTypeToProviderId(model.engine_type),
    );
  }, [group.overrides.stt_model_id, sttModelById]);

  return (
    <div
      className={[
        "group flex h-full min-h-[330px] flex-col rounded-2xl border bg-[var(--card)] px-4 py-3 transition-shadow",
        activeRule
          ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--border)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]",
      ].join(" ")}
    >
      <div className="flex flex-1 flex-col">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="write-profile-group-title heading-display min-w-0 truncate text-2xl font-bold leading-tight text-[var(--text)]">
              {cardDisplayTitle}
            </h3>
            {activeRule ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                {activeNowLabel}
              </span>
            ) : null}
          </div>
          {cardDescription ? (
            <p className="write-profile-group-description mt-1 line-clamp-3 text-sm font-normal leading-6 text-[var(--text)]">
              {cardDescription}
            </p>
          ) : null}

          {targetChips.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {targetChips.map((chip) => (
                <TargetChip
                  key={chip.key}
                  label={chip.label}
                  kind={chip.kind}
                  bundleId={chip.bundleId}
                  appNameFor={appNameFor}
                />
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3">
            {visibleRules.map((rule) => {
              const target = targetForRule(rule);
              return (
                <div key={rule.id} className="group/app relative">
                  <button
                    type="button"
                    onClick={() => onEdit(rule)}
                    aria-label={`Edit ${rule.name}`}
                    title={`Edit ${target.label}`}
                    className={[
                      "relative flex h-14 w-14 items-center justify-center rounded-2xl border border-transparent transition-transform hover:z-20 hover:-translate-y-0.5 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                      rule.id === activeRuleId
                        ? "z-10 bg-[var(--accent-soft)]"
                        : "bg-transparent",
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
                    ) : engineProviderId ? (
                      <ProviderIcon providerId={engineProviderId} size="xl" />
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
                className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text)] shadow-[var(--shadow-sm)] transition-transform hover:z-20 hover:-translate-y-0.5 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
          {canPreviewMode && tryRule ? (
            <div className="mt-auto pt-4">
              <button
                type="button"
                onClick={() => void onTry?.(tryRule)}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--ring-hairline)] bg-[var(--panel-bg)] px-3 text-xs font-bold text-[var(--text)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
              >
                <WandSparkles className="h-3.5 w-3.5" aria-hidden />
                {t("refine.writeRules.row.tryMode", {
                  defaultValue: "Preview mode",
                })}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const TargetChip: React.FC<{
  label: string;
  kind: "app" | "url" | "any-browser" | "any-app";
  bundleId?: string;
  appNameFor: (bundleId: string) => string;
}> = ({ label, kind, bundleId, appNameFor }) => (
  <span
    className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 text-xs font-medium text-[var(--text)]"
    title={label}
  >
    {kind === "app" && bundleId ? (
      <AppMonogram
        bundleId={bundleId}
        name={appNameFor(bundleId)}
        size="xs"
      />
    ) : (
      <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden />
    )}
    <span className="min-w-0 truncate">{label}</span>
  </span>
);
