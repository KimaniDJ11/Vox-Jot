import { motion } from "framer-motion";
import { track } from "./springs";

type HighlightTrackProps = {
  /**
   * Whether this is the currently active/hovered row in its list.
   * Exactly one row in a list should pass `active={true}` at a time —
   * framer-motion will spring the highlight between whichever row has
   * it set, using the shared `layoutId`.
   */
  active: boolean;

  /**
   * The shared layout id for this list. Must be unique per list but
   * identical across every row in the same list. Examples:
   *   "top-nav-indicator"
   *   "sidebar-highlight"
   *   `settings-${groupId}`
   *   "cmdk-highlight"
   */
  layoutId: string;

  /** Extra classes layered onto the highlight pill. */
  className?: string;

  /**
   * Variant of the pill background. "soft" uses --accent-soft (for
   * hover tracks), "strong" uses --accent (for active selected state
   * like the current top-nav tab).
   */
  variant?: "soft" | "strong" | "surface";

  /** Corner radius utility override. */
  radiusClass?: string;

  /** Insets — defaults to inset-x-1 inset-y-0.5 so pill hugs content. */
  insetClass?: string;

  /** Z-index layering override. */
  zIndexClass?: string;
};

/**
 * A single shared-element pill that springs between the rows of a list.
 *
 * Usage pattern (list container must be `relative`):
 *
 *   <ul className="relative">
 *     {rows.map((r, i) => (
 *       <li
 *         key={r.id}
 *         className="relative h-9 px-3"
 *         onMouseEnter={() => setHovered(i)}
 *       >
 *         <HighlightTrack
 *           active={hovered === i}
 *           layoutId="my-list-highlight"
 *         />
 *         <div className="relative z-10">{r.label}</div>
 *       </li>
 *     ))}
 *   </ul>
 */
export function HighlightTrack({
  active,
  layoutId,
  className = "",
  variant = "soft",
  radiusClass = "rounded-md",
  insetClass = "inset-x-1 inset-y-0.5",
  zIndexClass = "z-0",
}: HighlightTrackProps) {
  if (!active) return null;

  const background =
    variant === "strong"
      ? "bg-[var(--accent)]"
      : variant === "surface"
        ? "bg-[color-mix(in_srgb,var(--text)_8%,transparent)]"
        : "bg-[var(--accent-soft)]";

  return (
    <motion.div
      layoutId={layoutId}
      transition={track}
      aria-hidden
      className={[
        "pointer-events-none absolute",
        insetClass,
        radiusClass,
        zIndexClass,
        background,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
