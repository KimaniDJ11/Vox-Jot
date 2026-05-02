import React from "react";
import { Textarea } from "@/components/ui/Textarea";

interface ScriptEditorProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  value,
  disabled = false,
  onChange,
}) => {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">Script</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Use one line per spoken part in Character: dialogue format.
        </p>
      </div>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        spellCheck={true}
        className="min-h-[180px] resize-y font-mono text-[13px] leading-6 lg:min-h-[220px]"
        placeholder={
          "Narrator: The city lights flickered awake.\nHero: I know that voice.\nGuide: Then follow it."
        }
      />
    </section>
  );
};
