import React, { useRef, useState, useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { commands } from "@/bindings";

interface CappedSectionProps {
  /** The detail-view section ID (e.g. "history", "phrase-keys"). */
  section: string;
  /** Max visible height in px before the cap kicks in. */
  maxHeight?: number;
  /** Label for the "show more" button, e.g. "Show all history". */
  showMoreLabel: string;
  children: React.ReactNode;
}

/**
 * Wraps section content with a height cap. When content exceeds `maxHeight`,
 * it fades out and shows a "Show more" button that opens a detail-view window.
 */
export const CappedSection: React.FC<CappedSectionProps> = ({
  section,
  maxHeight = 480,
  showMoreLabel,
  children,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const check = () => {
      setIsOverflowing(el.scrollHeight > maxHeight);
    };

    check();

    // Re-check when content might change (e.g. async loads)
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxHeight]);

  return (
    <div>
      <div
        ref={contentRef}
        className="relative overflow-hidden transition-[max-height] duration-300"
        style={{ maxHeight: isOverflowing ? maxHeight : undefined }}
      >
        {children}

        {/* Fade-out gradient overlay */}
        {isOverflowing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--bg)] to-transparent" />
        )}
      </div>

      {isOverflowing && (
        <button
          type="button"
          onClick={() => void commands.showDetailView(section)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-medium text-[var(--accent)] shadow-[var(--shadow-sm)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent),transparent_92%)]"
        >
          {showMoreLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
