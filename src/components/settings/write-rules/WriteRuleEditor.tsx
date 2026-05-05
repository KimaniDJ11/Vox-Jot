// Editor for one Write Profile, used in "edit mode" of the Write
// Profiles settings page. The parent renders either the list OR this
// editor — never both at once — so the user keeps a clear sense of
// place (Nielsen #3, user control).
//
// Two presentations:
//   - "page"   → inline in the settings page with a sticky top bar
//                that holds back/cancel/save.
//   - "dialog" → a true modal: sticky header / scrolling body /
//                sticky footer, anchored Cancel + Save.
//
// The three override panels (Speech / Refine / Output) are a tabbed
// control so the editor fits on a laptop screen without scrolling and
// users see a count of overrides per tab.

import React, { useMemo, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LLMPrompt, ToneDefinition, WriteRule } from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Tabs } from "@/components/ui/Tabs";
import { AppMultiPicker } from "./matchers/AppMultiPicker";
import { UrlPatternList } from "./matchers/UrlPatternList";
import { SpeechOverrides } from "./overrides/SpeechOverrides";
import { RefineOverrides } from "./overrides/RefineOverrides";
import { OutputOverrides } from "./overrides/OutputOverrides";

const backLabel = "Back to profiles";
const newProfileTitle = "New profile";
const editProfileTitle = "Edit profile";
const newProfileSubtitle =
  "Run different dictation behavior in different apps and URLs.";
const nameLabel = "Profile name";
const enabledLabel = "Enabled";
const enabledDescription =
  "Disabled profiles are kept in the list but ignored during dictation.";
const matchHeading = "Where it runs";
const matchHelp =
  "Pick the apps and URL patterns this profile fires on. Leave both blank to match anything.";
const overridesHeading = "What it changes";
const overridesHelp =
  "Anything you don't override here keeps the global setting.";
const speechTab = "Speech";
const refineTab = "Refine";
const outputTab = "Output";
const cancelLabel = "Cancel";
const saveLabel = "Save profile";
const nameRequiredHelp = "Give the profile a short, descriptive name.";
const createNamePlaceholder = "Create a profile name";

interface WriteRuleEditorProps {
  rule?: WriteRule;
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
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

type OverrideTab = "speech" | "refine" | "output";

export const WriteRuleEditor: React.FC<WriteRuleEditorProps> = ({
  rule,
  tones,
  prompts,
  onSave,
  onCancel,
  saveError,
  presentation = "page",
  titleId,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<WriteRule>(rule ?? createRule());
  const [activeTab, setActiveTab] = useState<OverrideTab>("speech");
  const isNew = !rule;
  const isDialog = presentation === "dialog";
  const trimmedName = draft.name.trim();
  const canSave = trimmedName.length > 0;

  // Per-tab override counts — used both as Tab badges and as the
  // editor's at-a-glance "I customized N things" indicator.
  const counts = useMemo(() => {
    const o = draft.overrides;
    const speech =
      (o.stt_model_id ? 1 : 0) +
      (o.stt_language ? 1 : 0) +
      (typeof o.translate_to_english === "boolean" ? 1 : 0);
    const refine =
      (o.tone_id ? 1 : 0) +
      (o.post_process_prompt_id ? 1 : 0) +
      (typeof o.auto_submit === "boolean" ? 1 : 0) +
      (typeof o.force_post_process === "boolean" ? 1 : 0);
    const output =
      (o.paste_method ? 1 : 0) +
      (typeof o.append_trailing_space === "boolean" ? 1 : 0) +
      (typeof o.mute_while_recording === "boolean" ? 1 : 0);
    return { speech, refine, output, total: speech + refine + output };
  }, [draft.overrides]);

  const title = isNew ? newProfileTitle : trimmedName || editProfileTitle;
  const namePlaceholder = isNew
    ? createNamePlaceholder
    : t("refine.writeRules.editor.namePlaceholder");

  const overridePanel = (
    <>
      {activeTab === "speech" ? (
        <SpeechOverrides
          overrides={draft.overrides}
          onChange={(overrides) => setDraft({ ...draft, overrides })}
        />
      ) : null}
      {activeTab === "refine" ? (
        <RefineOverrides
          overrides={draft.overrides}
          tones={tones}
          prompts={prompts}
          onChange={(overrides) => setDraft({ ...draft, overrides })}
        />
      ) : null}
      {activeTab === "output" ? (
        <OutputOverrides
          overrides={draft.overrides}
          onChange={(overrides) => setDraft({ ...draft, overrides })}
        />
      ) : null}
    </>
  );

  const tabsControl = (
    <Tabs<OverrideTab>
      items={[
        { value: "speech", label: speechTab, badge: counts.speech },
        { value: "refine", label: refineTab, badge: counts.refine },
        { value: "output", label: outputTab, badge: counts.output },
      ]}
      active={activeTab}
      onChange={setActiveTab}
    />
  );

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

  // ─── DIALOG MODE ─────────────────────────────────────────────────
  if (isDialog) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Sticky title bar */}
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

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {/* Identity row — no card chrome, just inline form fields */}
          <section className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <Input
                value={draft.name}
                placeholder={namePlaceholder}
                aria-label={nameLabel}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
              {!canSave ? (
                <p className="text-xs text-[var(--muted)]">
                  {nameRequiredHelp}
                </p>
              ) : null}
              {saveError ? (
                <p className="text-xs font-medium text-[var(--danger)]">
                  {saveError}
                </p>
              ) : null}
            </div>
            <div className="inline-flex min-h-10 items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--input)] px-3 py-1.5">
              <SwitchControl
                checked={draft.enabled}
                onChange={(enabled) => setDraft({ ...draft, enabled })}
                ariaLabel={enabledLabel}
              />
              <span className="text-sm font-medium text-[var(--text)]">
                {enabledLabel}
              </span>
            </div>
          </section>

          {/* Match card */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <header className="mb-3">
              <h3 className="text-sm font-semibold text-[var(--text)]">
                {matchHeading}
              </h3>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{matchHelp}</p>
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              <AppMultiPicker
                bundleIds={draft.matchers.bundle_ids ?? []}
                compact
                onChange={(bundle_ids) =>
                  setDraft({
                    ...draft,
                    matchers: { ...draft.matchers, bundle_ids },
                  })
                }
              />
              <UrlPatternList
                patterns={draft.matchers.url_patterns ?? []}
                compact
                onChange={(url_patterns) =>
                  setDraft({
                    ...draft,
                    matchers: { ...draft.matchers, url_patterns },
                  })
                }
              />
            </div>
          </section>

          {/* Overrides card with tabs as primary nav */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--text)]">
                  {overridesHeading}
                </h3>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {overridesHelp}
                </p>
              </div>
              {tabsControl}
            </header>
            <div>{overridePanel}</div>
          </section>
        </div>

        {/* Sticky footer */}
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--ring-hairline)] bg-[var(--panel-bg)] px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {saveButton}
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

      {/* Identity card — name + enabled */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">
            {nameLabel}
          </label>
          <Input
            value={draft.name}
            placeholder={namePlaceholder}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
          {!canSave ? (
            <p className="text-xs text-[var(--muted)]">{nameRequiredHelp}</p>
          ) : null}
          {saveError ? (
            <p className="text-xs font-medium text-[var(--danger)]">
              {saveError}
            </p>
          ) : null}
        </div>
        <div className="mt-3">
          <ToggleSwitch
            grouped
            label={enabledLabel}
            description={enabledDescription}
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </div>
      </section>

      {/* Match card */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <header className="mb-3">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {matchHeading}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{matchHelp}</p>
        </header>
        <div className="grid gap-4">
          <AppMultiPicker
            bundleIds={draft.matchers.bundle_ids ?? []}
            onChange={(bundle_ids) =>
              setDraft({
                ...draft,
                matchers: { ...draft.matchers, bundle_ids },
              })
            }
          />
          <UrlPatternList
            patterns={draft.matchers.url_patterns ?? []}
            onChange={(url_patterns) =>
              setDraft({
                ...draft,
                matchers: { ...draft.matchers, url_patterns },
              })
            }
          />
        </div>
      </section>

      {/* Overrides card with tabs */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {overridesHeading}
              {counts.total > 0 ? (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-white">
                  {counts.total}
                </span>
              ) : null}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {overridesHelp}
            </p>
          </div>
          {tabsControl}
        </header>
        <div className="pt-1">{overridePanel}</div>
      </section>
    </div>
  );
};
