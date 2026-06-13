import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";

// Collapsible document search that mirrors the Dictionary toolbar's search:
// a round icon button that expands into an input (auto-focused), collapses on
// Escape or outside-click, and shows an accent tint while a query is active.
export const ReaderSearchControl: React.FC<{
  query: string;
  onQueryChange: (query: string) => void;
}> = ({ query, onQueryChange }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!expanded) return;
    inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setExpanded(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [expanded]);

  const label = t("dictate.reader.search", {
    defaultValue: "Search documents",
  });

  return (
    <div ref={containerRef} className="flex justify-end">
      {expanded ? (
        <label
          className="relative flex h-9 w-[min(18rem,calc(100vw-3rem))] min-w-[11rem] items-center"
          aria-label={label}
        >
          <Search
            className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--accent-hover)]"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                if (query) {
                  onQueryChange("");
                } else {
                  setExpanded(false);
                }
                event.preventDefault();
              }
            }}
            placeholder={label}
            className="h-9 w-full rounded-full border-[1.5px] border-[var(--accent-hover)] bg-transparent py-1 pl-8 pr-8 text-xs font-bold text-[var(--accent-hover)] outline-none placeholder:text-[var(--accent-hover)] hover:bg-[var(--accent-soft)] focus:border-[var(--accent-hover)] focus:ring-2 focus:ring-[var(--accent-glow)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label={t("dictate.reader.clearSearch", {
                defaultValue: "Clear search",
              })}
              className="absolute right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
        </label>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={label}
          title={label}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-[var(--accent-hover)] text-[var(--accent-hover)] transition-colors hover:border-[var(--accent-hover)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            query ? "bg-[var(--accent-soft)]" : "bg-transparent"
          }`}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
