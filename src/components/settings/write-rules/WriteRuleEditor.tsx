import React, { useState } from "react";
import type { LLMPrompt, ToneDefinition, WriteRule } from "@/bindings";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { AppMultiPicker } from "./matchers/AppMultiPicker";
import { UrlPatternList } from "./matchers/UrlPatternList";
import { SpeechOverrides } from "./overrides/SpeechOverrides";
import { RefineOverrides } from "./overrides/RefineOverrides";
import { OutputOverrides } from "./overrides/OutputOverrides";

const nameLabel = "Name";
const priorityLabel = "Priority";
const enabledLabel = "Enabled";
const disabledDescription = "Disabled profiles are ignored during dictation.";
const matchLabel = "Match";
const appsLabel = "Apps";
const urlsLabel = "URLs";
const speechLabel = "Speech";
const refineLabel = "Refine";
const outputLabel = "Output";
const cancelLabel = "Cancel";
const saveProfileLabel = "Save profile";

interface WriteRuleEditorProps {
  rule?: WriteRule;
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  onSave: (rule: WriteRule) => void;
  onCancel: () => void;
}

const createRule = (): WriteRule => ({
  id: crypto.randomUUID(),
  name: "New profile",
  enabled: true,
  priority: 50,
  matchers: { bundle_ids: [], url_patterns: [] },
  overrides: {},
});

export const WriteRuleEditor: React.FC<WriteRuleEditorProps> = ({
  rule,
  tones,
  prompts,
  onSave,
  onCancel,
}) => {
  const [draft, setDraft] = useState<WriteRule>(rule ?? createRule());
  const canSave = draft.name.trim().length > 0;

  return (
    <div className="rounded-2xl border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent),transparent_95%)] p-4">
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">
              {nameLabel}
            </label>
            <Input
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">
              {priorityLabel}
            </label>
            <Input
              type="number"
              value={draft.priority}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  priority: Number(event.target.value) || 0,
                })
              }
            />
          </div>
        </div>

        <ToggleSwitch
          grouped
          label={enabledLabel}
          description={disabledDescription}
          checked={draft.enabled}
          onChange={(enabled) => setDraft({ ...draft, enabled })}
        />

        <EditorCard title={matchLabel}>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--muted)]">
                {appsLabel}
              </label>
              <AppMultiPicker
                bundleIds={draft.matchers.bundle_ids ?? []}
                onChange={(bundle_ids) =>
                  setDraft({
                    ...draft,
                    matchers: { ...draft.matchers, bundle_ids },
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--muted)]">
                {urlsLabel}
              </label>
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
          </div>
        </EditorCard>

        <EditorCard title={speechLabel}>
          <SpeechOverrides
            overrides={draft.overrides}
            onChange={(overrides) => setDraft({ ...draft, overrides })}
          />
        </EditorCard>

        <EditorCard title={refineLabel}>
          <RefineOverrides
            overrides={draft.overrides}
            tones={tones}
            prompts={prompts}
            onChange={(overrides) => setDraft({ ...draft, overrides })}
          />
        </EditorCard>

        <EditorCard title={outputLabel}>
          <OutputOverrides
            overrides={draft.overrides}
            onChange={(overrides) => setDraft({ ...draft, overrides })}
          />
        </EditorCard>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={() => onSave(draft)}
            disabled={!canSave}
          >
            {saveProfileLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

const EditorCard: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
    <h4 className="mb-3 text-sm font-semibold text-[var(--text)]">{title}</h4>
    {children}
  </section>
);
