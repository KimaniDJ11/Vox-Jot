// One launcher-style tile in the Write Profiles individual view.
//
// UX heuristics applied here (Nielsen):
//   #2 Match real world  → resolve bundle ids to app names, tone ids to
//                          tone labels.
//   #6 Recognition       → make the native app icon the main scan target.
//   #8 Aesthetic / minimal → remove card chrome in the app-icon grid.
//   #1 Visibility        → highlight the row currently matching the
//                          frontmost app with an "Active now" pill above
//                          the icon.

import React from "react";
import { AppWindow, Globe, Pencil, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  InstalledApp,
  LLMPrompt,
  ModelInfo,
  ToneDefinition,
  WriteRule,
} from "@/bindings";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { humanizeBundleId } from "@/lib/installedApps";
import { AppMonogram } from "./AppMonogram";

const urlChipPrefix = "URL ·";
const moreSuffix = (n: number) => ` +${n}`;
const anyBrowserLabel = "All browsers";

interface WriteRuleRowProps {
  rule: WriteRule;
  apps: InstalledApp[];
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  models: ModelInfo[];
  isActive?: boolean;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
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
  const { t } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
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
      return t("refine.writeRules.row.multipleApps", {
        count: bundleIds.length,
      });
    }
    return t("refine.writeRules.row.anyApp");
  }, [appNameFor, bundleIds, primaryBundleId, t, urls]);

  const isUrlSpecific = urls.length > 0;
  const hasSingleAppTarget = bundleIds.length === 1 && primaryBundleId !== null;
  const showPrimaryAppIcon = hasSingleAppTarget;
  const showBrowserIcon = isUrlSpecific && !hasSingleAppTarget;
  const overrideSummary = React.useMemo(() => {
    const o = rule.overrides;
    const parts: string[] = [];
    if (o.cleanup_level) parts.push(cleanupLevelLabel(o.cleanup_level));
    if (o.tone_id) parts.push(toneById.get(o.tone_id) ?? o.tone_id);
    const hasOtherSummary =
      o.cleanup_level ||
      o.tone_id ||
      o.post_process_prompt_id ||
      typeof o.force_post_process === "boolean";
    if (o.stt_model_id && (!isUrlSpecific || !hasOtherSummary)) {
      parts.push(modelById.get(o.stt_model_id) ?? o.stt_model_id);
    }
    if (o.post_process_prompt_id)
      parts.push(
        promptById.get(o.post_process_prompt_id) ?? o.post_process_prompt_id,
      );
    if (o.force_post_process === true) parts.push("Always post-process");
    if (o.force_post_process === false) parts.push("Skip post-process");
    return parts.length > 0
      ? parts.join(" · ")
      : t("refine.writeRules.row.inheritsGlobal");
  }, [isUrlSpecific, modelById, promptById, rule.overrides, t, toneById]);
  const targetChips = React.useMemo(() => {
    if (urls.length === 0) return [];

    const chips: Array<{
      key: string;
      label: string;
      kind: "app" | "url" | "any-browser";
    }> = [];
    if (urls.length > 0 && bundleIds.length === 0) {
      chips.push({
        key: "any-browser",
        label: anyBrowserLabel,
        kind: "any-browser",
      });
    }
    for (const bundleId of bundleIds) {
      chips.push({
        key: `app:${bundleId}`,
        label: appNameFor(bundleId),
        kind: "app",
      });
    }
    for (const url of urls) {
      chips.push({ key: `url:${url}`, label: url, kind: "url" });
    }
    return chips;
  }, [appNameFor, bundleIds, urls]);

  return (
    <div
      className={[
        "group flex min-h-[178px] flex-col items-center justify-start text-center",
        rule.enabled ? "" : "opacity-60",
      ].join(" ")}
      title={primaryTarget}
    >
      <div className="flex h-6 items-center justify-center">
        {isActive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-foreground)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-foreground)]" />
            {t("refine.writeRules.row.activeNow")}
          </span>
        ) : null}
      </div>

      <div className="flex h-[84px] items-center justify-center">
        {showPrimaryAppIcon && primaryBundleId ? (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-[22px] p-1 transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
            aria-label={`${t("refine.writeRules.row.editProfile")}: ${primaryTarget}`}
          >
            <AppMonogram
              bundleId={primaryBundleId}
              name={appNameFor(primaryBundleId)}
              size="hero"
            />
          </button>
        ) : showBrowserIcon ? (
          <button
            type="button"
            onClick={onEdit}
            className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-[var(--input)] text-[var(--text)] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
            aria-label={`${t("refine.writeRules.row.editProfile")}: ${primaryTarget}`}
          >
            <Globe className="h-9 w-9" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-[var(--input)] text-[var(--muted)] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
            aria-label={`${t("refine.writeRules.row.editProfile")}: ${primaryTarget}`}
          >
            <AppWindow className="h-9 w-9" aria-hidden />
          </button>
        )}
      </div>

      <div className="mt-1 flex h-8 min-w-0 items-center justify-center">
        {!confirmingDelete ? (
          <>
            <p className="max-w-full truncate px-1 text-base font-medium leading-6 text-[var(--text)] group-hover:hidden group-focus-within:hidden">
              {rule.name}
            </p>
            <div className="hidden items-center justify-center gap-1 group-hover:flex group-focus-within:flex">
              <ActionIconButton
                className="h-8 w-8 [&>svg]:h-4 [&>svg]:w-4"
                onClick={onEdit}
                aria-label={`${t("refine.writeRules.row.editProfile")}: ${primaryTarget}`}
                title={t("refine.writeRules.row.editProfile")}
              >
                <Pencil aria-hidden />
              </ActionIconButton>
              <ActionIconButton
                className="h-8 w-8 [&>svg]:h-4 [&>svg]:w-4"
                tone="danger"
                onClick={() => setConfirmingDelete(true)}
                aria-label={`${t("refine.writeRules.row.deleteProfile")}: ${primaryTarget}`}
                title={t("refine.writeRules.row.deleteProfile")}
              >
                <Trash2 aria-hidden />
              </ActionIconButton>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center gap-1">
            <ActionIconButton
              className="h-8 w-8 [&>svg]:h-4 [&>svg]:w-4"
              tone="confirm"
              onClick={async () => {
                await onDelete();
                setConfirmingDelete(false);
              }}
              aria-label={`${t("refine.writeRules.row.deleteProfile")}: ${primaryTarget}`}
              title={t("refine.writeRules.row.deleteProfile")}
            >
              <Trash2 aria-hidden />
            </ActionIconButton>
            <ActionIconButton
              className="h-8 w-8 [&>svg]:h-4 [&>svg]:w-4"
              onClick={() => setConfirmingDelete(false)}
              aria-label={t("common.cancel", { defaultValue: "Cancel" })}
              title={t("common.cancel", { defaultValue: "Cancel" })}
            >
              <X aria-hidden />
            </ActionIconButton>
          </div>
        )}
      </div>

      {!confirmingDelete ? (
        <p className="max-w-full truncate px-1 text-xs leading-5 text-[var(--muted)]">
          {overrideSummary}
        </p>
      ) : null}

      {!confirmingDelete && targetChips.length > 0 ? (
        <div className="mt-1 flex max-w-full flex-wrap justify-center gap-1">
          {targetChips.map((chip) => (
            <span
              key={chip.key}
              title={chip.label}
              className="inline-flex max-w-[150px] items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--text)]"
            >
              {chip.kind === "app" && primaryBundleId ? (
                <AppMonogram
                  bundleId={chip.key.replace(/^app:/, "")}
                  name={chip.label}
                  size="xs"
                />
              ) : (
                <Globe
                  className="h-3 w-3 shrink-0 text-[var(--muted)]"
                  aria-hidden
                />
              )}
              <span className="min-w-0 truncate">{chip.label}</span>
            </span>
          ))}
        </div>
      ) : null}

      {!rule.enabled ? (
        <span className="mt-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          {t("refine.writeRules.row.disabled")}
        </span>
      ) : null}
    </div>
  );
};

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
