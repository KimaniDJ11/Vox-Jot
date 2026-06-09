import React from "react";

import { interactiveFocusRingClass } from "@/lib/interactiveFocus";

export const visualizationButtonClassName = `group relative min-h-[44px] overflow-hidden rounded-lg border p-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ${interactiveFocusRingClass}`;

export const selectedVisualizationClassName =
  "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent),transparent_90%)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent),transparent_45%)]";

export const unselectedVisualizationClassName =
  "border-[var(--border)] bg-[var(--panel-bg)] hover:border-[color-mix(in_srgb,var(--accent),transparent_35%)] hover:bg-[color-mix(in_srgb,var(--accent),transparent_94%)]";

export const disabledVisualizationClassName = "cursor-not-allowed opacity-50";

export const SelectionDot: React.FC<{ selected: boolean }> = ({ selected }) => (
  <span
    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
      selected
        ? "border-[var(--accent)] bg-[var(--accent)]"
        : "border-[var(--border)] bg-[var(--card)]"
    }`}
    aria-hidden
  >
    {selected ? (
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-foreground)]" />
    ) : null}
  </span>
);

export const visualizationStateClass = (selected: boolean, disabled = false) =>
  [
    visualizationButtonClassName,
    selected
      ? selectedVisualizationClassName
      : unselectedVisualizationClassName,
    disabled ? disabledVisualizationClassName : "cursor-pointer",
  ].join(" ");
