import React, { useEffect, useMemo, useState } from "react";
import { commands, type ModelInfo, type WriteRuleOverrides } from "@/bindings";
import { Dropdown } from "@/components/ui/Dropdown";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { LANGUAGES } from "@/lib/constants/languages";

interface SpeechOverridesProps {
  overrides: WriteRuleOverrides;
  onChange: (overrides: WriteRuleOverrides) => void;
}

export const SpeechOverrides: React.FC<SpeechOverridesProps> = ({
  overrides,
  onChange,
}) => {
  const [models, setModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    void commands.getAvailableModels().then((result) => {
      if (result.status === "ok") {
        setModels(result.data);
      }
    });
  }, []);

  const modelOptions = useMemo(
    () => [
      { value: "__global__", label: "Use global setting" },
      ...models.map((model) => ({ value: model.id, label: model.name })),
    ],
    [models],
  );
  const languageOptions = useMemo(
    () => [
      { value: "__global__", label: "Use global setting" },
      ...LANGUAGES.map((language) => ({
        value: language.value,
        label: language.label,
      })),
    ],
    [],
  );

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <LabeledControl label="STT model">
        <Dropdown
          options={modelOptions}
          selectedValue={overrides.stt_model_id ?? "__global__"}
          onSelect={(value) =>
            onChange({
              ...overrides,
              stt_model_id: value === "__global__" ? null : value,
            })
          }
        />
      </LabeledControl>
      <LabeledControl label="Language">
        <Dropdown
          options={languageOptions}
          selectedValue={overrides.stt_language ?? "__global__"}
          onSelect={(value) =>
            onChange({
              ...overrides,
              stt_language: value === "__global__" ? null : value,
            })
          }
        />
      </LabeledControl>
      <ToggleSwitch
        grouped
        label="Translate to English"
        description="Override Whisper translation for this profile."
        checked={overrides.translate_to_english === true}
        onChange={(checked) =>
          onChange({ ...overrides, translate_to_english: checked })
        }
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
