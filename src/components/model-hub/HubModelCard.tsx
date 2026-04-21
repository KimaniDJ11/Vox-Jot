import React from "react";
import { Download, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  CompactBadgeRow,
  CompactMetaRow,
  type CompactBadgeItem,
} from "@/components/ui/CompactOverflow";
import { ProviderIcon } from "@/components/ui/ProviderIcon";

export type HubCardVariant = "default" | "featured";

export interface HubModelCardProps {
  // Identity (row 1)
  title: string;
  /** Passed to ProviderIcon as the leading logo. */
  providerId?: string;
  headerBadges?: CompactBadgeItem[];
  headerBadgesMaxVisible?: number;

  // Summary (row 2)
  /** Muted single-line description (truncates, title on hover). */
  description?: string;
  /** Optional right-aligned secondary content on the same row as description (sm+). */
  secondary?: React.ReactNode;

  // Actions strip (row 3)
  /** Chip strings shown on the left of row 3 (languages, runtime, etc.). */
  footerMetaItems?: string[];
  footerMetaIcon?: React.ReactNode;
  footerMetaMaxVisible?: number;
  footerOverflowLabel?: string;

  /** Trailing row-3 slot: acquire/remove icons or progress indicator. */
  trailing?: HubTrailing;

  // Optional block below the 3-row core (progress, notes).
  footerExtra?: React.ReactNode;

  // Interaction
  onClick?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Disables the whole card click target + adds muted styling. */
  disabled?: boolean;
  /** Visual emphasis (matches STT featured variant). */
  variant?: HubCardVariant;
  /** When true, applies the "active" outline/shadow treatment. */
  active?: boolean;

  className?: string;
}

/**
 * Universal row-3 trailing descriptor.
 * All three tabs (STT / LLM / TTS) share the same two affordances:
 *   - acquire (Download) when the asset isn't available locally
 *   - remove  (Trash2)   when it's installed and removable
 * A spinner can replace either icon while busy. Primary selection is
 * always the whole-card click — no "Use" / "Set Active" text button here.
 */
export type HubTrailing =
  | {
      kind: "acquire";
      onClick?: () => void;
      /** Shown next to the icon (e.g. "120 MB"). */
      sizeLabel?: string;
      disabled?: boolean;
      busy?: boolean;
      /** aria-label + tooltip. */
      label: string;
    }
  | {
      kind: "remove";
      onClick?: () => void;
      disabled?: boolean;
      busy?: boolean;
      label: string;
    }
  | {
      kind: "custom";
      node: React.ReactNode;
    }
  | null
  | undefined;

const baseClasses =
  "flex h-full min-w-0 flex-col gap-3 rounded-xl px-4 py-3 text-left transition-all duration-200";

const HubModelCard: React.FC<HubModelCardProps> = ({
  title,
  providerId,
  headerBadges,
  headerBadgesMaxVisible = 2,
  description,
  secondary,
  footerMetaItems,
  footerMetaIcon,
  footerMetaMaxVisible = 3,
  footerOverflowLabel,
  trailing,
  footerExtra,
  onClick,
  onKeyDown,
  disabled = false,
  variant = "default",
  active = false,
  className = "",
}) => {
  const isClickable = Boolean(onClick) && !disabled;
  const isFeatured = variant === "featured";

  const variantClasses = isFeatured
    ? "border-2 border-logo-primary/25 bg-logo-primary/5 shadow-[var(--shadow-sm)]"
    : active
      ? "border border-[var(--accent)] bg-[var(--card)] shadow-[var(--shadow-md)]"
      : "border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-sm)]";

  const interactiveClasses = !isClickable
    ? disabled
      ? "opacity-60"
      : ""
    : "cursor-pointer hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-md group";

  const handleClick = () => {
    if (!isClickable) return;
    onClick?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (!isClickable) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
  };

  const trailingNode = renderTrailing(trailing);

  return (
    <div
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-disabled={disabled || undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[baseClasses, variantClasses, interactiveClasses, className]
        .filter(Boolean)
        .join(" ")}
    >
      {/* ROW 1 — identity */}
      <div className="flex min-w-0 items-center gap-2">
        {providerId ? <ProviderIcon providerId={providerId} size="sm" /> : null}
        <h3
          className={`min-w-0 flex-1 truncate text-base font-semibold text-[var(--text)] ${isClickable ? "group-hover:text-[var(--accent)]" : ""} transition-colors`}
          title={title}
        >
          {title}
        </h3>
        {headerBadges && headerBadges.length > 0 ? (
          <CompactBadgeRow
            items={headerBadges}
            maxVisible={headerBadgesMaxVisible}
            overflowLabel={`${title} badges`}
          />
        ) : null}
      </div>

      {/* ROW 2 — summary (single line; optional secondary on sm+).
          `min-h-10` reserves space for the tallest `secondary` content
          (STT score bars) so STT / LLM / TTS cards stay the same height. */}
      {(description || secondary) && (
        <div className="flex min-h-10 min-w-0 items-center gap-3">
          <p
            className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]"
            title={description ?? undefined}
          >
            {description ?? "\u00A0"}
          </p>
          {secondary ? (
            <div className="hidden shrink-0 sm:block">{secondary}</div>
          ) : null}
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-mid-gray/20" />

      {/* ROW 3 — meta + trailing */}
      <div className="flex min-w-0 items-center gap-2">
        {footerMetaItems && footerMetaItems.length > 0 ? (
          <CompactMetaRow
            items={footerMetaItems}
            maxVisible={footerMetaMaxVisible}
            icon={footerMetaIcon}
            overflowLabel={footerOverflowLabel ?? `${title} details`}
            className="flex-1"
          />
        ) : (
          <span className="flex-1" />
        )}
        {trailingNode}
      </div>

      {/* Optional block below the 3-row core */}
      {footerExtra ? <div className="mt-1 w-full">{footerExtra}</div> : null}
    </div>
  );
};

function renderTrailing(trailing: HubTrailing): React.ReactNode {
  if (!trailing) return null;
  if (trailing.kind === "custom") return trailing.node;

  if (trailing.kind === "acquire") {
    const {
      onClick,
      sizeLabel,
      disabled: itemDisabled,
      busy,
      label,
    } = trailing;
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {sizeLabel ? (
          <span className="text-xs tabular-nums text-[var(--muted)]">
            {sizeLabel}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          title={label}
          aria-label={label}
          disabled={itemDisabled || busy}
          onClick={(event) => {
            event.stopPropagation();
            onClick?.();
          }}
          className="text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
        >
          {busy ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
        </Button>
      </div>
    );
  }

  // remove
  const { onClick, disabled: itemDisabled, busy, label } = trailing;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      disabled={itemDisabled || busy}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className="shrink-0 text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
    >
      {busy ? (
        <Loader2 className="animate-spin" />
      ) : (
        <Trash2 className="w-3.5 h-3.5" />
      )}
    </Button>
  );
}

export default HubModelCard;
