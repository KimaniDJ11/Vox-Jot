import React from "react";
import type { LLMPrompt, ToneDefinition, WriteRuleOverrides } from "@/bindings";
import { Dropdown } from "@/components/ui/Dropdown";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";

interface RefineOverridesProps {
  overrides: WriteRuleOverrides;
  tones: ToneDefinition[];
  prompts: LLMPrompt[];
  onChange: (overrides: WriteRuleOverrides) => void;
}

export const RefineOverrides: React.FC<RefineOverridesProps> = ({
  overrides,
  tones,
  prompts,
  onChange,
}) => {
  const toneOptions = [
    { value: "__global__", label: "Use global setting" },
    ...tones.map((tone) => ({ value: tone.id, label: tone.label || tone.id })),
  ];
  const promptOptions = [
    { value: "__global__", label: "Use global setting" },
    ...prompts.map((prompt) => ({ value: prompt.id, label: prompt.name })),
  ];

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <LabeledControl label="Tone">
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
      </LabeledControl>
      <LabeledControl label="Prompt">
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
      </LabeledControl>
      <ToggleSwitch
        grouped
        label="Auto-submit"
        description="Press Enter after output for this profile."
        checked={overrides.auto_submit === true}
        onChange={(checked) => onChange({ ...overrides, auto_submit: checked })}
      />
    </div>
  );
};

const LabeledControl: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className="space-y-1.5">
    <label className="text-xs font-medium text-[var(--muted)]">{label}</label>
    {children}
  </div>
);
