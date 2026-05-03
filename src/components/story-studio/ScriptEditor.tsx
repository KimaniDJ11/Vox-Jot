import React from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/ui/Textarea";

const scriptTitle = "Script";
const scriptDescription =
  "Use one line per spoken part in Character: dialogue format.";

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
  const { t } = useTranslation();

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">
          {scriptTitle}
        </h3>
        <p className="mt-1 text-sm text-[var(--muted)]">{scriptDescription}</p>
      </div>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        spellCheck={true}
        className="min-h-[180px] resize-y font-mono text-[13px] leading-6 lg:min-h-[220px]"
        placeholder={t("storyStudio.script.placeholder")}
      />
    </section>
  );
};
