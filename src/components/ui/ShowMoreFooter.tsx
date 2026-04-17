import React from "react";
import { ArrowRight } from "lucide-react";

import { commands } from "@/bindings";
import { interactiveFocusRingClass, minTapTargetHeightClass } from "@/lib/interactiveFocus";

interface ShowMoreFooterProps {
  /** The detail-view section ID (e.g. "history", "phrase-keys"). */
  section?: string;
  /** Label shown on the button, e.g. "Show all 42 entries". */
  label: string;
  /** Optional custom action instead of opening the shared detail view. */
  onClick?: () => void;
}

/**
 * A footer button that opens the detail-view floating window for a section.
 * Use at the bottom of capped inline lists so users can see everything.
 */
export const ShowMoreFooter: React.FC<ShowMoreFooterProps> = ({
  section,
  label,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={() => {
        if (onClick) {
          onClick();
          return;
        }
        if (section) {
          void commands.showDetailView(section);
        }
      }}
      className={`flex w-full items-center justify-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-medium text-[var(--accent)] shadow-[var(--shadow-sm)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent),transparent_92%)] ${interactiveFocusRingClass} ${minTapTargetHeightClass}`}
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
};
