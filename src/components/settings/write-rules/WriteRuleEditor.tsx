// Editor for one Write Profile.
//
// Layout (top → bottom):
//   1. Templates strip (new profiles only) — picks a preset starting
//      point so the user isn't dropped onto a blank form.
//   2. Name field — with the live-match hint sitting beside it as soon
//      as the profile has any matchers, so the user gets immediate
//      feedback on whether it would fire on the focused app.
//   3. Triggers card — apps + URL patterns under one heading. Both
//      pickers are still independent components, but the visual frame
//      treats them as one concept ("where this profile fires").
//   4. Overrides editor — the new "active overrides only" pattern
//      replacing the old three-tab card-of-dropdowns. See
//      OverridesEditor.tsx for the rationale.
//
// Two presentations:
//   - "page"   → inline in the settings page with a sticky top bar
//                that holds back/cancel/save.
//   - "dialog" → a true modal: sticky header / scrolling body /
//                sticky footer, anchored Cancel + Save.

import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  commands,
  type LLMPrompt,
  type ModelInfo,
  type ToneDefinition,
  type WriteRule,
} from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { AppMultiPicker } from "./matchers/AppMultiPicker";
import { UrlPatternList } from "./matchers/UrlPatternList";
import { OverridesEditor } from "./editor/OverridesEditor";
import { TemplatesRow } from "./editor/TemplatesRow";
import { LiveMatchHint } from "./editor/LiveMatchHint";
import { hasNonBrowserAppMatcher } from "./lib/browserMatchers";
import { PROFILE_TEMPLATES, type ProfileTemplateId } from "./lib/templates";
import {
  countActiveOverrides,
  resetAllOverrides,
} from "./lib/overrideRegistry";

const backLabel = "Back to profiles";
const newProfileTitle = "New mode";
const editProfileTitle = "Edit mode";
const nameLabel = "Mode name";
const enabledLabel = "Enabled";
const triggersHeading = "Where it runs";
const triggersHelp =
  "Pick the apps and URL patterns this mode fires on. Leave both blank to match anything.";
const overridesHeading = "What it changes";
const overridesHelp =
  "Only the settings you add here are overridden — everything else keeps your global setting.";
const cancelLabel = "Cancel";
const saveLabel = "Save mode";
const nameRequiredHelp = "Give the mode a short, descriptive name.";
const createNamePlaceholder = "Name this mode";
const templateLabels = new Set(
  PROFILE_TEMPLATES.map((template) => template.label),
);
const nonBrowserUrlConflictMessage =
  "URL filters only work with browsers. Remove the non-browser app or remove the URL filter.";
const urlDisabledByNonBrowserAppMessage =
  "Remove the non-browser app before adding URL filters.";

interface WriteRuleEditorProps {
  rule?: WriteRule;
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  models?: ModelInfo[];
  onCreateTone?: (draft: {
    label: string;
    instruction: string;
  }) => Promise<ToneDefinition>;
  onSave: (rule: WriteRule) => void;
  onDraftChange?: () => void;
  onCancel: () => void;
  saveError?: string | null;
  presentation?: "page" | "dialog";
  titleId?: string;
}

const createRule = (): WriteRule => ({
  id: crypto.randomUUID(),
  name: "",
  enabled: true,
  priority: 0,
  matchers: { bundle_ids: [], url_patterns: [] },
  overrides: {},
});

export const WriteRuleEditor: React.FC<WriteRuleEditorProps> = ({
  rule,
  tones,
  prompts,
  models: modelsProp,
  onCreateTone,
  onSave,
  onDraftChange,
  onCancel,
  saveError,
  presentation = "page",
  titleId,
}) => {
  const [draft, setDraft] = useState<WriteRule>(rule ?? createRule());
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<ProfileTemplateId | null>(null);
  // The editor used to lean on each override panel to fetch its own
  // model list. With the new shared OverridesEditor we lift that fetch
  // to one place — but stay friendly to callers (and the existing test)
  // that don't pass `models` in by falling back to a self-fetch.
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    if (modelsProp !== undefined) return;
    void commands.getAvailableModels().then((result) => {
      if (result.status === "ok") setFetchedModels(result.data);
    });
  }, [modelsProp]);
  const models = modelsProp ?? fetchedModels;

  useEffect(() => {
    onDraftChange?.();
  }, [draft, onDraftChange]);

  const isNew = !rule;
  const isDialog = presentation === "dialog";
  const trimmedName = draft.name.trim();
  const selectedBundleIds = draft.matchers.bundle_ids ?? [];
  const selectedUrlPatterns = draft.matchers.url_patterns ?? [];
  const hasUrlPatterns = selectedUrlPatterns.length > 0;
  const hasNonBrowserApp = hasNonBrowserAppMatcher(selectedBundleIds);
  const hasMatcherConflict = hasUrlPatterns && hasNonBrowserApp;
  const canSave = trimmedName.length > 0 && !hasMatcherConflict;
  const overrideCount = useMemo(
    () => countActiveOverrides(draft.overrides),
    [draft.overrides],
  );
  const title = isNew ? newProfileTitle : trimmedName || editProfileTitle;
  const namePlaceholder = isNew
    ? createNamePlaceholder
    : "e.g. Slack & Discord chats";

  const applyTemplate = (id: ProfileTemplateId) => {
    const template = PROFILE_TEMPLATES.find((entry) => entry.id === id);
    if (!template) return;
    setSelectedTemplateId(id);
    setDraft((prev) => {
      const currentName = prev.name.trim();
      const shouldReplaceName =
        currentName.length === 0 || templateLabels.has(currentName);
      const base: WriteRule = {
        ...prev,
        name: shouldReplaceName ? "" : prev.name,
        overrides: resetAllOverrides(prev.overrides),
      };
      const next = template.apply(base);
      return {
        ...next,
        name:
          id === "blank" && shouldReplaceName
            ? ""
            : shouldReplaceName
              ? next.name
              : prev.name,
      };
    });
  };

  const saveButton = (
    <Button
      type="button"
      size="sm"
      onClick={() => onSave({ ...draft, name: trimmedName })}
      disabled={!canSave}
    >
      {saveLabel}
    </Button>
  );

  // ─── Body shared between page and dialog ─────────────────────────
  const body = (
    <div className="space-y-3">
      {isNew ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <TemplatesRow
            selectedId={selectedTemplateId}
            onSelect={applyTemplate}
          />
        </section>
      ) : null}

      {/* Identity row */}
      <section className="grid items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          <Input
            value={draft.name}
            placeholder={namePlaceholder}
            aria-label={nameLabel}
            className="w-full"
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
          {!canSave && !isNew ? (
            <p className="text-xs text-[var(--muted)]">{nameRequiredHelp}</p>
          ) : null}
          {saveError ? (
            <p className="text-xs font-medium text-[var(--danger)]">
              {saveError}
            </p>
          ) : null}
        </div>
        {!isNew ? (
          <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--input)] px-3 py-0">
            <SwitchControl
              checked={draft.enabled}
              onChange={(enabled) => setDraft({ ...draft, enabled })}
              ariaLabel={enabledLabel}
            />
            <span className="text-sm font-medium text-[var(--text)]">
              {enabledLabel}
            </span>
          </div>
        ) : null}
      </section>

      {/* Triggers card — apps + URLs under one heading */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {triggersHeading}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{triggersHelp}</p>
          </div>
          <LiveMatchHint matchers={draft.matchers} />
        </header>
        <StrictMatchWarning matchers={draft.matchers} />
        <div className="grid gap-4 md:grid-cols-2">
          <AppMultiPicker
            bundleIds={selectedBundleIds}
            compact={isDialog}
            browserOnly={hasUrlPatterns}
            onChange={(bundle_ids) =>
              setDraft({
                ...draft,
                matchers: { ...draft.matchers, bundle_ids },
              })
            }
          />
          <UrlPatternList
            patterns={selectedUrlPatterns}
            compact={isDialog}
            disabled={hasNonBrowserApp}
            disabledReason={urlDisabledByNonBrowserAppMessage}
            onChange={(url_patterns) =>
              setDraft({
                ...draft,
                matchers: { ...draft.matchers, url_patterns },
              })
            }
          />
        </div>
      </section>

      {/* Overrides editor */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {overridesHeading}
              {overrideCount > 0 ? (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-foreground)]">
                  {overrideCount}
                </span>
              ) : null}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {overridesHelp}
            </p>
          </div>
        </header>
        <OverridesEditor
          overrides={draft.overrides}
          models={models}
          tones={tones}
          prompts={prompts}
          onCreateTone={onCreateTone}
          onChange={(overrides) => setDraft({ ...draft, overrides })}
        />
      </section>
    </div>
  );

  // ─── DIALOG MODE ─────────────────────────────────────────────────
  if (isDialog) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {titleId ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{body}</div>

        <footer className="flex shrink-0 justify-end border-t border-[var(--ring-hairline)] bg-[var(--panel-bg)] px-5 py-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {cancelLabel}
            </Button>
            {saveButton}
          </div>
        </footer>
      </div>
    );
  }

  // ─── PAGE MODE ───────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-1 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-[var(--muted)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </Button>
          <h2 className="flex-1 truncate text-base font-semibold text-[var(--text)]">
            {title}
          </h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          {saveButton}
        </div>
      </div>

      {body}
    </div>
  );
};

const StrictMatchWarning: React.FC<{
  matchers: WriteRule["matchers"];
}> = ({ matchers }) => {
  const bundleIds = matchers.bundle_ids ?? [];
  const urlPatterns = matchers.url_patterns ?? [];
  if (bundleIds.length === 0 || urlPatterns.length === 0) return null;

  const includesNonBrowserApp = hasNonBrowserAppMatcher(bundleIds);
  if (!includesNonBrowserApp) return null;

  return (
    <div className="mb-3 rounded-xl border border-[color-mix(in_srgb,var(--warning),transparent_70%)] bg-[var(--warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--warning)]">
      {nonBrowserUrlConflictMessage}
    </div>
  );
};
