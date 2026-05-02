// Output-related overrides (paste method, trailing space, mute).
//
// Same tri-state Dropdown pattern as the other override panels so all
// three tabs feel consistent (Nielsen #4) and there's no way to
// accidentally commit a "false" override when you really meant "leave
// the global setting alone."

import React from "react";
import type { PasteMethod, WriteRuleOverrides } from "@/bindings";
import { Dropdown } from "@/components/ui/Dropdown";

const pasteMethodLabel = "Paste method";
const trailingSpaceLabel = "Append trailing space";
const trailingSpaceHelp = "Add a space after dictated text.";
const muteLabel = "Mute output while recording";
const muteHelp = "Silence other apps' audio while this profile records.";
const useGlobalLabel = "Use global setting";

interface OutputOverridesProps {
  overrides: WriteRuleOverrides;
  onChange: (overrides: WriteRuleOverrides) => void;
}

const pasteOptions = [
  { value: "__global__", label: useGlobalLabel },
  { value: "ctrl_v", label: "Clipboard paste" },
  { value: "direct", label: "Direct type" },
  { value: "none", label: "Do not paste" },
  { value: "ctrl_shift_v", label: "Ctrl+Shift+V" },
  { value: "shift_insert", label: "Shift+Insert" },
  { value: "external_script", label: "External script" },
];

type TriState = "global" | "on" | "off";

const triStateOptions = (onLabel: string, offLabel: string) => [
  { value: "global", label: useGlobalLabel },
  { value: "on", label: onLabel },
  { value: "off", label: offLabel },
];

export const OutputOverrides: React.FC<OutputOverridesProps> = ({
  overrides,
  onChange,
}) => {
  const trailingSpace: TriState =
    overrides.append_trailing_space === true
      ? "on"
      : overrides.append_trailing_space === false
        ? "off"
        : "global";
  const mute: TriState =
    overrides.mute_while_recording === true
      ? "on"
      : overrides.mute_while_recording === false
        ? "off"
        : "global";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={pasteMethodLabel} fullWidth>
        <Dropdown
          options={pasteOptions}
          selectedValue={overrides.paste_method ?? "__global__"}
          onSelect={(value) =>
            onChange({
              ...overrides,
              paste_method:
                value === "__global__" ? null : (value as PasteMethod),
            })
          }
        />
      </Field>
      <Field label={trailingSpaceLabel} help={trailingSpaceHelp}>
        <Dropdown
          options={triStateOptions("Add trailing space", "No trailing space")}
          selectedValue={trailingSpace}
          onSelect={(value) =>
            onChange({
              ...overrides,
              append_trailing_space:
                value === "on" ? true : value === "off" ? false : null,
            })
          }
        />
      </Field>
      <Field label={muteLabel} help={muteHelp}>
        <Dropdown
          options={triStateOptions(
            "Mute while recording",
            "Keep audio playing",
          )}
          selectedValue={mute}
          onSelect={(value) =>
            onChange({
              ...overrides,
              mute_while_recording:
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
