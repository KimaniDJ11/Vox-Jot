// Editor for one Write Profile, used in "edit mode" of the Write
// Profiles settings page. The parent renders either the list OR this
// editor — never both at once — so the user keeps a clear sense of
// place (Nielsen #3, user control). A sticky header keeps the Save /
// Cancel actions visible no matter how far the user scrolls inside
// the override panels.
//
// The three override panels (Speech / Refine / Output) used to be
// stacked cards. We collapsed them into a tabbed control so the
// editor fits on a laptop screen without scrolling and so users see
// a count of overrides per tab — a one-line "did I customize
// anything?" answer.

import React, { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { LLMPrompt, ToneDefinition, WriteRule } from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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
const nameLabel = "Profile name";
const namePlaceholder = "e.g. Slack & Discord chats";
const enabledLabel = "Enabled";
const enabledDescription =
  "Disabled profiles are kept in the list but ignored during dictation.";
const matchHeading = "Match";
const matchHelp =
  "Pick the apps and/or URL patterns this profile should fire on. Leave blank to match anything.";
const overridesHeading = "Overrides";
const overridesHelp =
  "Anything you don't override here keeps the global setting.";
const speechTab = "Speech";
const refineTab = "Refine";
const outputTab = "Output";
const cancelLabel = "Cancel";
const saveLabel = "Save profile";
const nameRequiredHelp = "Give the profile a short, descriptive name.";

interface WriteRuleEditorProps {
  rule?: WriteRule;
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  onSave: (rule: WriteRule) => void;
  onCancel: () => void;
  saveError?: string | null;
}

const createRule = (): WriteRule => ({
  id: crypto.randomUUID(),
  name: "New profile",
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
}) => {
  const [draft, setDraft] = useState<WriteRule>(rule ?? createRule());
  const [activeTab, setActiveTab] = useState<OverrideTab>("speech");
  const isNew = !rule;
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

  return (
    <div className="space-y-4">
      {/* Sticky header — keeps Save/Cancel always reachable. */}
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
            {isNew ? newProfileTitle : trimmedName || editProfileTitle}
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onSave({ ...draft, name: trimmedName })}
            disabled={!canSave}
          >
            {saveLabel}
          </Button>
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
            <p className="mt-0.5 text-xs text-[var(--muted)]">{overridesHelp}</p>
          </div>
          <Tabs<OverrideTab>
            items={[
              { value: "speech", label: speechTab, badge: counts.speech },
              { value: "refine", label: refineTab, badge: counts.refine },
              { value: "output", label: outputTab, badge: counts.output },
            ]}
            active={activeTab}
            onChange={setActiveTab}
          />
        </header>
        <div className="pt-1">
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
        </div>
      </section>
    </div>
  );
};
