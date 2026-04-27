// Refine-related overrides (tone, post-process prompt, auto-submit).
//
// The auto-submit control was a plain ToggleSwitch which forced the
// user to commit to either "on" or "off" — there was no way to say
// "leave it global". Now it's a 3-way Dropdown like the other tri-state
// fields so the editor's behavior is consistent across panels
// (Nielsen #4, consistency & standards).

import React from "react";
import type { LLMPrompt, ToneDefinition, WriteRuleOverrides } from "@/bindings";
import { Dropdown } from "@/components/ui/Dropdown";

const toneLabel = "Tone";
const promptLabel = "Post-process prompt";
const autoSubmitLabel = "Auto-submit";
const autoSubmitHelp = "Press Enter automatically after dictating.";
const useGlobalLabel = "Use global setting";

interface RefineOverridesProps {
  overrides: WriteRuleOverrides;
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  onChange: (overrides: WriteRuleOverrides) => void;
}

type TriState = "global" | "on" | "off";

export const RefineOverrides: React.FC<RefineOverridesProps> = ({
  overrides,
  tones,
  prompts,
  onChange,
}) => {
  const toneOptions = [
    { value: "__global__", label: useGlobalLabel },
    ...tones.map((tone) => ({ value: tone.id, label: tone.label || tone.id })),
  ];
  const promptOptions = [
    { value: "__global__", label: useGlobalLabel },
    ...prompts.map((prompt) => ({ value: prompt.id, label: prompt.name })),
  ];

  const autoSubmit: TriState =
    overrides.auto_submit === true
      ? "on"
      : overrides.auto_submit === false
        ? "off"
        : "global";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={toneLabel}>
        <Dropdown
          options={toneOptions}
          selectedValue={overrides.tone_id ?? "__global__"}
          onSelect={(value) =>
            onChange({
              ...overrides,
              tone_id: value === "__global__" ? null : value,
            })
          }
        />
      </Field>
      <Field label={promptLabel}>
        <Dropdown
          options={promptOptions}
          selectedValue={overrides.post_process_prompt_id ?? "__global__"}
          onSelect={(value) =>
            onChange({
              ...overrides,
              post_process_prompt_id: value === "__global__" ? null : value,
            })
          }
        />
      </Field>
      <Field label={autoSubmitLabel} help={autoSubmitHelp} fullWidth>
        <Dropdown
          options={[
            { value: "global", label: useGlobalLabel },
            { value: "on", label: "Auto-submit" },
            { value: "off", label: "Don't auto-submit" },
          ]}
          selectedValue={autoSubmit}
          onSelect={(value) =>
            onChange({
              ...overrides,
              auto_submit: value === "on" ? true : value === "off" ? false : null,
            })
          }
        />
      </Field>
    </div>
  );
};

const Field: React.FC<{
  label: string;
  help?: string;
  fullWidth?: boolean;
  children: React.ReactNode;
}> = ({ label, help, fullWidth, children }) => (
  <div className={"space-y-1.5 " + (fullWidth ? "md:col-span-2" : "")}>
    <label className="text-xs font-medium text-[var(--muted)]">{label}</label>
    {children}
    {help ? <p className="text-[11px] text-[var(--muted)]">{help}</p> : null}
  </div>
);
