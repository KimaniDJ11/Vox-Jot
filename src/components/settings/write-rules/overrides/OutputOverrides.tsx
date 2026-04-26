import React from "react";
import type { PasteMethod, WriteRuleOverrides } from "@/bindings";
import { Dropdown } from "@/components/ui/Dropdown";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";

const pasteMethodLabel = "Paste method";

interface OutputOverridesProps {
  overrides: WriteRuleOverrides;
  onChange: (overrides: WriteRuleOverrides) => void;
}

const pasteOptions = [
  { value: "__global__", label: "Use global setting" },
  { value: "ctrl_v", label: "Clipboard paste" },
  { value: "direct", label: "Direct type" },
  { value: "none", label: "Do not paste" },
  { value: "ctrl_shift_v", label: "Ctrl+Shift+V" },
  { value: "shift_insert", label: "Shift+Insert" },
  { value: "external_script", label: "External script" },
];

export const OutputOverrides: React.FC<OutputOverridesProps> = ({
  overrides,
  onChange,
}) => (
  <div className="grid gap-3 md:grid-cols-3">
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--muted)]">
        {pasteMethodLabel}
      </label>
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
    </div>
    <ToggleSwitch
      grouped
      label="Append trailing space"
      description="Add a space after dictated text."
      checked={overrides.append_trailing_space === true}
      onChange={(checked) =>
        onChange({ ...overrides, append_trailing_space: checked })
      }
    />
    <ToggleSwitch
      grouped
      label="Mute while recording"
      description="Mute system output while this profile records."
      checked={overrides.mute_while_recording === true}
      onChange={(checked) =>
        onChange({ ...overrides, mute_while_recording: checked })
      }
    />
  </div>
);
