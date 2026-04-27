// Lightweight segmented-control / tab strip used by the Write Rule
// editor to collapse three overrides cards into one card with three
// panels. Stateless: the parent owns the active tab so it can persist
// the user's last-used tab across edits if it wants to.
//
// Why not a heavier dependency: every existing UI primitive in
// `src/components/ui/` is hand-rolled. This stays consistent with that
// pattern and keeps bundle size flat.

import React from "react";

export interface TabItem<Value extends string> {
  value: Value;
  label: string;
  /** Optional badge shown on the tab — e.g. count of overridden fields. */
  badge?: number | string;
}

interface TabsProps<Value extends string> {
  items: TabItem<Value>[];
  active: Value;
  onChange: (value: Value) => void;
  className?: string;
}

export function Tabs<Value extends string>({
  items,
  active,
  onChange,
  className = "",
}: TabsProps<Value>) {
  return (
    <div
      role="tablist"
      className={[
        "inline-flex rounded-full border border-[var(--border)] bg-[var(--input)] p-0.5",
        className,
      ].join(" ")}
    >
      {items.map((item) => {
        const selected = item.value === active;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              selected
                ? "bg-[var(--card)] text-[var(--text)] shadow-[var(--shadow-sm)]"
                : "text-[var(--muted)] hover:text-[var(--text)]",
            ].join(" ")}
          >
            {item.label}
            {item.badge !== undefined && item.badge !== 0 && item.badge !== "" ? (
              <span
                className={[
                  "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold",
                  selected
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--border)] text-[var(--muted)]",
                ].join(" ")}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
