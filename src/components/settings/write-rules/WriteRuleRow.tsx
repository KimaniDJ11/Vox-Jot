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
  const { t } = useTranslation();
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

  const showPrimaryAppIcon =
    bundleIds.length === 1 && urls.length === 0 && primaryBundleId !== null;
  const showMatcherContext = bundleIds.length > 1 || urls.length > 0;

  const overridesSummary = React.useMemo(() => {
    const o = rule.overrides;
    const parts: string[] = [];
    if (o.tone_id)
      parts.push(
        `${t("refine.writeRules.row.overrideTone")} · ${toneById.get(o.tone_id) ?? o.tone_id}`,
      );
    if (o.stt_model_id)
      parts.push(
        `${t("refine.writeRules.row.overrideEngine")} · ${modelById.get(o.stt_model_id) ?? o.stt_model_id}`,
      );
    if (o.stt_language)
      parts.push(
        `${t("refine.writeRules.row.overrideLanguage")} · ${o.stt_language}`,
      );
    if (o.translate_to_english === true)
      parts.push(t("refine.writeRules.row.translateToEnglish"));
    if (o.post_process_prompt_id)
      parts.push(
        `${t("refine.writeRules.row.overridePrompt")} · ${promptById.get(o.post_process_prompt_id) ?? o.post_process_prompt_id}`,
      );
    if (o.auto_submit === true)
      parts.push(t("refine.writeRules.row.autoSubmit"));
    if (o.auto_submit === false)
      parts.push(t("refine.writeRules.row.noAutoSubmit"));
    if (o.force_post_process === true)
      parts.push(t("refine.writeRules.row.alwaysPostProcess"));
    if (o.force_post_process === false)
      parts.push(t("refine.writeRules.row.skipPostProcess"));
    if (
      o.append_trailing_space !== null &&
      o.append_trailing_space !== undefined
    )
      parts.push(
        o.append_trailing_space
          ? t("refine.writeRules.row.trailingSpace")
          : t("refine.writeRules.row.noTrailingSpace"),
      );
    if (o.mute_while_recording === true)
      parts.push(t("refine.writeRules.row.muteWhileRecording"));
    return parts;
  }, [rule.overrides, toneById, modelById, promptById, t]);

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
                {t("refine.writeRules.row.activeNow")}
              </span>
            ) : null}
            {!rule.enabled ? (
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
                {t("refine.writeRules.row.disabled")}
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
              ? t("refine.writeRules.row.inheritsGlobal")
              : overridesSummary.join(" · ")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ActionIconButton
            onClick={onEdit}
            aria-label={t("refine.writeRules.row.editProfile")}
            title={t("refine.writeRules.row.editProfile")}
          >
            <Pencil aria-hidden />
          </ActionIconButton>
          <ActionIconButton
            tone="danger"
            onClick={onDelete}
            aria-label={t("refine.writeRules.row.deleteProfile")}
            title={t("refine.writeRules.row.deleteProfile")}
          >
            <Trash2 aria-hidden />
          </ActionIconButton>
        </div>
      </div>
    </div>
  );
};
