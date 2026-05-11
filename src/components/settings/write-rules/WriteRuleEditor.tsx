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
import { ArrowLeft, X } from "lucide-react";
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
import { PROFILE_TEMPLATES, type ProfileTemplateId } from "./lib/templates";
import { countActiveOverrides } from "./lib/overrideRegistry";

const backLabel = "Back to profiles";
const newProfileTitle = "New profile";
const editProfileTitle = "Edit profile";
const newProfileSubtitle =
  "Run different dictation behavior in different apps and URLs.";
const nameLabel = "Profile name";
const enabledLabel = "Enabled";
const triggersHeading = "Where it runs";
const triggersHelp =
  "Pick the apps and URL patterns this profile fires on. Leave both blank to match anything.";
const overridesHeading = "What it changes";
const overridesHelp =
  "Only the settings you add here are overridden — everything else keeps your global setting.";
const cancelLabel = "Cancel";
const saveLabel = "Save profile";
const nameRequiredHelp = "Give the profile a short, descriptive name.";
const createNamePlaceholder = "Create a profile name";

interface WriteRuleEditorProps {
  rule?: WriteRule;
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  models?: ModelInfo[];
  onSave: (rule: WriteRule) => void;
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
  onSave,
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

  const isNew = !rule;
  const isDialog = presentation === "dialog";
  const trimmedName = draft.name.trim();
  const canSave = trimmedName.length > 0;
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
    setDraft((prev) => template.apply(prev));
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
        <header className="mb-3">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {triggersHeading}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{triggersHelp}</p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <AppMultiPicker
            bundleIds={draft.matchers.bundle_ids ?? []}
            compact={isDialog}
            onChange={(bundle_ids) =>
              setDraft({
                ...draft,
                matchers: { ...draft.matchers, bundle_ids },
              })
            }
          />
          <UrlPatternList
            patterns={draft.matchers.url_patterns ?? []}
            compact={isDialog}
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
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-white">
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
          onChange={(overrides) => setDraft({ ...draft, overrides })}
        />
      </section>
    </div>
  );

  // ─── DIALOG MODE ─────────────────────────────────────────────────
  if (isDialog) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-start gap-3 border-b border-[var(--ring-hairline)] bg-[var(--panel-bg)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="truncate text-base font-semibold text-[var(--text)]"
            >
              {title}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
              {newProfileSubtitle}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label={cancelLabel}
            title={cancelLabel}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{body}</div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--ring-hairline)] bg-[var(--panel-bg)] px-5 py-3">
          <LiveMatchHint matchers={draft.matchers} />
          <div className="flex items-center gap-2">
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
      <div className="sticky top-0 z-10 -mx-1 rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--card)]/80">
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
