// Speech-related overrides for a Write Profile.
//
// All controls share a "Use global setting" sentinel as the first
// option (Nielsen #5, error prevention — there is no way to
// accidentally override a field with an invalid empty value), and
// every override field is opt-in: the toggle below the dropdowns
// stays neutral by default rather than committing the user to a
// boolean override the moment they open the panel.

import React, { useEffect, useMemo, useState } from "react";
import { commands, type ModelInfo, type WriteRuleOverrides } from "@/bindings";
import { Dropdown } from "@/components/ui/Dropdown";
import { LANGUAGES } from "@/lib/constants/languages";

const sttModelLabel = "STT model";
const languageLabel = "Language";
const translateLabel = "Translate to English";
const translateHelp = "Override Whisper translation behavior for this profile.";
const useGlobalLabel = "Use global setting";

interface SpeechOverridesProps {
  overrides: WriteRuleOverrides;
  onChange: (overrides: WriteRuleOverrides) => void;
}

type TranslateChoice = "global" | "on" | "off";

export const SpeechOverrides: React.FC<SpeechOverridesProps> = ({
  overrides,
  onChange,
}) => {
  const [models, setModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    void commands.getAvailableModels().then((result) => {
      if (result.status === "ok") setModels(result.data);
    });
  }, []);

  const modelOptions = useMemo(
    () => [
      { value: "__global__", label: useGlobalLabel },
      ...models.map((model) => ({ value: model.id, label: model.name })),
    ],
    [models],
  );
  const languageOptions = useMemo(
    () => [
      { value: "__global__", label: useGlobalLabel },
      ...LANGUAGES.map((language) => ({
        value: language.value,
        label: language.label,
      })),
    ],
    [],
  );

  const translateChoice: TranslateChoice =
    overrides.translate_to_english === true
      ? "on"
      : overrides.translate_to_english === false
        ? "off"
        : "global";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={sttModelLabel}>
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
      </Field>
      <Field label={languageLabel}>
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
      </Field>
      <Field label={translateLabel} help={translateHelp} fullWidth>
        <Dropdown
          options={[
            { value: "global", label: useGlobalLabel },
            { value: "on", label: "Translate to English" },
            { value: "off", label: "Keep original language" },
          ]}
          selectedValue={translateChoice}
          onSelect={(value) =>
            onChange({
              ...overrides,
              translate_to_english:
                value === "on" ? true : value === "off" ? false : null,
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
