// URL pattern list for the "Match" card.
//
// UX heuristics in play:
//   #5 Error prevention   → reject obvious mistakes (schemes, spaces)
//                           inline rather than at save time.
//   #10 Help & docs       → show example patterns the user can click
//                           to add — they immediately learn the
//                           grammar (`*.gmail.com`, `github.com/orgs/*`)
//                           by example.

import React, { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/Input";

const fieldLabel = "URLs";
const helpHint = "Optional. Use `*` as a wildcard. Skip `https://`.";
const removeUrlPatternLabel = "Remove URL pattern";
const noConstraintChip = "No URL constraint";
const examplesLabel = "Examples:";

const EXAMPLES = ["mail.google.com", "*.gmail.com", "github.com/orgs/*"];

interface UrlPatternListProps {
  patterns: string[];
  onChange: (patterns: string[]) => void;
  compact?: boolean;
}

const validatePattern = (pattern: string) => {
  const trimmed = pattern.trim();
  if (!trimmed) return "Enter a URL pattern.";
  if (/\s/.test(trimmed)) return "URL patterns cannot contain spaces.";
  if (trimmed.includes("://"))
    return "Skip the scheme; use host/path like github.com/orgs/*.";
  return null;
};

export const UrlPatternList: React.FC<UrlPatternListProps> = ({
  patterns,
  onChange,
  compact = false,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addPattern = (raw: string) => {
    const next = raw.trim();
    const validation = validatePattern(next);
    if (validation) {
      setError(validation);
      return;
    }
    if (!patterns.includes(next)) {
      onChange([...patterns, next]);
    }
    setDraft("");
    setError(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium text-[var(--muted)]">
          {fieldLabel}
        </label>
        {!compact ? (
          <span className="text-[11px] text-[var(--muted)]">{helpHint}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 min-h-[26px]">
        {patterns.length === 0 ? (
          compact ? (
            <span className="text-xs italic text-[var(--muted)]">
              {noConstraintChip}
            </span>
          ) : (
            <span className="rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
              {noConstraintChip}
            </span>
          )
        ) : (
          patterns.map((pattern) => (
            <span
              key={pattern}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] py-0.5 pl-3 pr-2 text-xs font-medium text-[var(--text)]"
            >
              {pattern}
              <button
                type="button"
                className="text-[var(--muted)] hover:text-[var(--danger)]"
                onClick={() =>
                  onChange(patterns.filter((item) => item !== pattern))
                }
                aria-label={removeUrlPatternLabel}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>

      <Input
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            addPattern(draft);
          }
        }}
        placeholder={t("refine.writeRules.matchers.addUrlPattern")}
        className="w-full"
      />

      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
        <span>{compact ? "Try:" : examplesLabel}</span>
        {EXAMPLES.map((example, index) => (
          <React.Fragment key={example}>
            {compact && index > 0 ? (
              <span aria-hidden="true" className="text-[var(--border)]">
                ·
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => addPattern(example)}
              disabled={patterns.includes(example)}
              className={
                compact
                  ? "inline-flex min-h-7 items-center rounded-md px-1.5 py-1 font-mono text-[11px] text-[var(--muted)] underline-offset-2 hover:text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--panel-bg)] disabled:opacity-40"
                  : "rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
              }
            >
              {example}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
