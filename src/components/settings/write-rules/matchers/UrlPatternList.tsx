import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const noUrlConstraintLabel = "No URL constraint";
const addUrlLabel = "Add URL";
const removeUrlPatternLabel = "Remove URL pattern";
const urlPlaceholder = "Add URL pattern (e.g. *.gmail.com)";

interface UrlPatternListProps {
  patterns: string[];
  onChange: (patterns: string[]) => void;
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
}) => {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addPattern = () => {
    const next = draft.trim();
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
      <div className="flex flex-wrap gap-2">
        {patterns.length === 0 ? (
          <span className="rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
            {noUrlConstraintLabel}
          </span>
        ) : (
          patterns.map((pattern) => (
            <span
              key={pattern}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-medium text-[var(--text)]"
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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addPattern();
            }
          }}
          placeholder={urlPlaceholder}
          className="min-w-[260px]"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={addPattern}
        >
          <Plus className="h-3.5 w-3.5" />
          {addUrlLabel}
        </Button>
      </div>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
    </div>
  );
};
