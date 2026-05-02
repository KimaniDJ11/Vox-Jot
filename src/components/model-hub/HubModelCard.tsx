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
  // Identity
  title: string;
  /** Passed to ProviderIcon as the leading 40px logo. */
  providerId?: string;
  /**
   * Optional sub-line shown directly under the title (e.g. "OpenAI · Whisper Family").
   * Truncates to a single line.
   */
  subline?: string;
  /** Top-right badges. Reserve for status only (Active, New, Beta, Recommended). */
  headerBadges?: CompactBadgeItem[];
  headerBadgesMaxVisible?: number;

  /** Two-line value-prop sentence. Renders muted with line-clamp-2. */
  description?: string;
  /** Optional right-aligned content on the capability-chip row (e.g. STT score bars). */
  secondary?: React.ReactNode;

  /**
   * Capability/fact chips between description and divider. Use for differentiating
   * facts: deployment (Local/Cloud), size, languages, capability flags. Cap at 4 visible.
   */
  capabilityChips?: CompactBadgeItem[];
  capabilityChipsMaxVisible?: number;

  /** Footer chips (left side): source/runtime/language list. Below the divider. */
  footerMetaItems?: string[];
  footerMetaIcon?: React.ReactNode;
  footerMetaMaxVisible?: number;
  footerOverflowLabel?: string;

  /** Trailing footer slot: acquire/remove icons or progress indicator. */
  trailing?: HubTrailing;

  /** Optional block below the core (progress bar, delete confirmation). */
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
 * Universal footer trailing descriptor.
 * Two affordances:
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
  "flex h-full min-h-[176px] min-w-0 flex-col gap-3 rounded-xl px-4 py-3.5 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 motion-reduce:transition-none";

const HubModelCard: React.FC<HubModelCardProps> = ({
  title,
  providerId,
  subline,
  headerBadges,
  headerBadgesMaxVisible = 2,
  description,
  secondary,
  capabilityChips,
  capabilityChipsMaxVisible = 4,
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
    : "cursor-pointer hover:border-logo-primary/50 hover:bg-logo-primary/5 hover:shadow-md group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

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
  const hasCapabilityRow =
    (capabilityChips && capabilityChips.length > 0) || Boolean(secondary);

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
      {/* IDENTITY — 40px logo as left rail, title block on the right. */}
      <div className="flex min-w-0 items-start gap-3">
        {providerId ? (
          <ProviderIcon providerId={providerId} size="xl" className="mt-0.5" />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-start gap-2">
            <h3
              className={`min-w-0 flex-1 truncate text-base font-semibold leading-tight text-[var(--text)] ${isClickable ? "group-hover:text-[var(--accent)]" : ""} transition-colors`}
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
          {subline ? (
            <p
              className="min-w-0 truncate text-xs font-medium text-[var(--muted)]"
              title={subline}
            >
              {subline}
            </p>
          ) : null}
          {description ? (
            <p
              className="min-w-0 text-sm leading-snug text-[var(--muted)] line-clamp-2"
              title={description}
            >
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {/* CAPABILITY CHIPS — fact chips + optional right-aligned secondary slot. */}
      {hasCapabilityRow ? (
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {capabilityChips && capabilityChips.length > 0 ? (
              <CompactBadgeRow
                items={capabilityChips}
                maxVisible={capabilityChipsMaxVisible}
                overflowLabel={`${title} capabilities`}
              />
            ) : null}
          </div>
          {secondary ? (
            <div className="hidden shrink-0 sm:block">{secondary}</div>
          ) : null}
        </div>
      ) : null}

      {/* Spacer keeps divider/footer pinned at a consistent visual height. */}
      <div className="flex-1" />

      {/* Divider */}
      <div className="border-t border-mid-gray/20" />

      {/* FOOTER — meta + trailing action. */}
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

      {/* Optional block below the core (progress, confirmation). */}
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
          size="icon"
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
      size="icon"
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
