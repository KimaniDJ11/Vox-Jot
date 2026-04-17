/**
 * Shared keyboard focus and minimum tap targets for buttons and interactive controls.
 * Aligns custom `<button>` elements with `Button` and platform guidance (44×44 CSS px).
 */

/** Same focus ring as `Button` — use on native buttons for consistency. */
export const interactiveFocusRingClass =
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-glow)]";

/** WCAG 2.5.5 (AAA) / Apple HIG minimum height for primary tap targets. */
export const minTapTargetHeightClass = "min-h-[44px]";

/** Icon-only and square controls (toolbar, title bar). */
export const minTapTargetSquareClass = "min-h-[44px] min-w-[44px]";
