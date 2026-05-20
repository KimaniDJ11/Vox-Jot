import React from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, Loader2, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import {
  CompactBadgeRow,
  CompactMetaRow,
  type CompactBadgeItem,
} from "@/components/ui/CompactOverflow";
import { ProviderIcon } from "@/components/ui/ProviderIcon";
import { dedupeCapabilityChips } from "@/components/model-hub/modelIdentityChips";

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
  /** Inline title-row badges that must stay visible, such as license warnings. */
  titleBadges?: CompactBadgeItem[];
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
  footerMetaLeadingActions?: React.ReactNode;
  footerMetaLinks?: Array<{ label: string; url: string }>;
  footerMetaIcon?: React.ReactNode;
  footerMetaMaxVisible?: number;
  footerOverflowLabel?: string;

  /** Trailing footer slot: acquire/remove icons or progress indicator. */
  trailing?: HubTrailing;

  /**
   * Unified download/progress treatment for the footer row. Replaces footer
   * metadata + trailing action without changing the card's outer dimensions.
   */
  downloadState?: HubDownloadState;

  /**
   * Optional block below the core. Interactive footer extras such as delete
   * confirmations are normalized into the footer row so cards do not grow.
   */
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

export interface HubDownloadState {
  label: string;
  detail?: string | null;
  error?: string | null;
  /** 0-100. Omit for indeterminate/preparing/importing stages. */
  progress?: number | null;
  indeterminate?: boolean;
  cancelling?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
}

const baseClasses =
  "flex h-full min-h-[176px] min-w-0 flex-col gap-3 rounded-xl px-4 py-3.5 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 motion-reduce:transition-none";

const HubModelCard: React.FC<HubModelCardProps> = ({
  title,
  providerId,
  subline,
  titleBadges,
  headerBadges,
  headerBadgesMaxVisible = 2,
  description,
  secondary,
  capabilityChips,
  capabilityChipsMaxVisible = 6,
  footerMetaItems,
  footerMetaLeadingActions,
  footerMetaLinks,
  footerMetaIcon,
  footerMetaMaxVisible = 3,
  footerOverflowLabel,
  trailing,
  downloadState,
  footerExtra,
  onClick,
  onKeyDown,
  disabled = false,
  variant = "default",
  active = false,
  className = "",
}) => {
  const { t } = useTranslation();
  const isClickable = Boolean(onClick) && !disabled;
  const isFeatured = variant === "featured";
  const hasNestedInteractive =
    Boolean(downloadState?.onCancel) ||
    Boolean(footerExtra) ||
    Boolean(footerMetaLeadingActions) ||
    Boolean(footerMetaLinks?.length) ||
    Boolean(trailing);

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
    if (event.target !== event.currentTarget) return;
    onKeyDown?.(event);
    if (!isClickable) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
  };

  const trailingNode = renderTrailing(trailing);
  const visibleCapabilityChips = capabilityChips
    ? dedupeCapabilityChips(capabilityChips)
    : undefined;
  const hasCapabilityRow =
    (visibleCapabilityChips && visibleCapabilityChips.length > 0) ||
    Boolean(secondary);
  const inlineFooterExtraParts = getInlineFooterExtraParts(footerExtra);

  return (
    <div
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={hasNestedInteractive && isClickable ? title : undefined}
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
            {titleBadges && titleBadges.length > 0 ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                {titleBadges.map(renderTitleBadge)}
              </div>
            ) : null}
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
            {visibleCapabilityChips && visibleCapabilityChips.length > 0 ? (
              <CompactBadgeRow
                items={visibleCapabilityChips}
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

      {/* FOOTER — meta + trailing action, or unified download state. */}
      {downloadState ? (
        renderDownloadState(downloadState)
      ) : inlineFooterExtraParts ? (
        renderInlineFooterExtra(
          inlineFooterExtraParts,
          t("modelHub.actionConfirmation"),
        )
      ) : (
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
          {footerMetaLeadingActions ? (
            <div className="flex shrink-0 items-center gap-1">
              {footerMetaLeadingActions}
            </div>
          ) : null}
          {footerMetaLinks && footerMetaLinks.length > 0 ? (
            <div className="flex shrink-0 items-center gap-1">
              {footerMetaLinks.slice(0, 2).map((link) => (
                <Button
                  key={`${link.label}:${link.url}`}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void openUrl(link.url).catch((error) => {
                      console.error("Failed to open model source:", error);
                    });
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className="text-[var(--accent)] hover:bg-logo-primary/10 hover:text-[var(--accent)]"
                  title={link.url}
                  aria-label={link.label}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </Button>
              ))}
            </div>
          ) : null}
          {trailingNode}
        </div>
      )}

      {/* Optional block below the core (progress, confirmation). */}
      {footerExtra && !inlineFooterExtraParts ? (
        <div className="mt-1 w-full">{footerExtra}</div>
      ) : null}
    </div>
  );
};

function renderTitleBadge(item: CompactBadgeItem): React.ReactNode {
  const tooltip = item.detail ? `${item.label} — ${item.detail}` : item.label;
  const isLicenseGate = item.id === "license-gate";

  return (
    <Badge
      key={item.id}
      variant={item.variant ?? "secondary"}
      className={[
        "shrink-0 whitespace-nowrap px-2.5 py-1 text-[11px] font-semibold",
        isLicenseGate
          ? "border border-[color-mix(in_srgb,var(--accent),transparent_45%)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="inline-flex items-center" title={tooltip}>
        {item.icon ? <span className="mr-1 shrink-0">{item.icon}</span> : null}
        <span>{item.label}</span>
      </span>
    </Badge>
  );
}

type FooterExtraElementProps = {
  children?: React.ReactNode;
  onClick?: unknown;
  onKeyDown?: unknown;
};

function getInlineFooterExtraParts(
  footerExtra: React.ReactNode,
): React.ReactNode[] | null {
  if (!React.isValidElement(footerExtra)) return null;

  const props = footerExtra.props as FooterExtraElementProps;
  if (!props.onClick && !props.onKeyDown) return null;

  const children = React.Children.toArray(props.children);

  // Delete confirmations in model cards generally render as:
  // root -> [message, actions] or root -> wrapper -> [message, actions].
  // Pull those two pieces into the fixed footer slot instead of rendering the
  // whole block below the card, which changes the card height.
  if (children.length === 1 && React.isValidElement(children[0])) {
    const nestedProps = children[0].props as FooterExtraElementProps;
    const nestedChildren = React.Children.toArray(nestedProps.children);
    if (nestedChildren.length >= 2) {
      return nestedChildren;
    }
  }

  return children.length >= 2 ? children : null;
}

function renderInlineFooterExtra(
  parts: React.ReactNode[],
  actionConfirmationLabel: string,
): React.ReactNode {
  const [message, actions] = parts;

  return (
    <div
      className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--danger),transparent_58%)] bg-[var(--danger-soft)] px-2.5 py-1.5 sm:flex-nowrap"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={actionConfirmationLabel}
      role="group"
    >
      <div className="min-w-[12rem] flex-1 overflow-hidden [&_p]:!truncate [&_p]:!text-xs [&_p]:!leading-4 [&_p+p]:!mt-0.5 [&_p+p]:!line-clamp-1 [&_p+p]:!text-[11px] [&_p+p]:!text-[var(--muted)] [&_svg]:shrink-0">
        {message}
      </div>
      {actions ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5 sm:flex-none [&_button]:!shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function renderDownloadState(state: HubDownloadState): React.ReactNode {
  const hasKnownProgress =
    typeof state.progress === "number" && Number.isFinite(state.progress);
  const progress = hasKnownProgress
    ? Math.max(0, Math.min(100, state.progress ?? 0))
    : null;
  const indeterminate = state.indeterminate || progress === null;
  const label = state.error ?? state.label;
  const cancelLabel = state.cancelLabel ?? "Cancel download";

  return (
    <div
      className={[
        "relative flex min-h-11 min-w-0 items-center gap-2 overflow-hidden rounded-lg border px-2.5 pb-2.5 pt-1.5",
        state.error
          ? "border-[color-mix(in_srgb,var(--danger),transparent_58%)] bg-[var(--danger-soft)]"
          : "border-[var(--border)] bg-[var(--panel-bg)]",
      ].join(" ")}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="group"
      aria-label={label}
    >
      <div
        className={[
          "pointer-events-none absolute inset-y-0 left-0 opacity-55",
          state.error
            ? "bg-[color-mix(in_srgb,var(--danger),transparent_80%)]"
            : "bg-[linear-gradient(90deg,color-mix(in_srgb,var(--accent),transparent_82%),color-mix(in_srgb,var(--accent),transparent_68%))]",
          indeterminate
            ? "w-1/2 animate-[hub-progress-sweep_1.35s_ease-in-out_infinite]"
            : "transition-[width] duration-300",
        ].join(" ")}
        style={indeterminate ? undefined : { width: `${progress}%` }}
        aria-hidden
      />
      <div
        className="absolute inset-x-2.5 bottom-1 h-1 overflow-hidden rounded-full bg-[var(--input)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
        aria-label={label}
      >
        <div
          className={[
            "h-full rounded-full bg-[var(--accent)]",
            indeterminate
              ? "w-1/3 animate-[hub-progress-sweep_1.35s_ease-in-out_infinite]"
              : "transition-[width] duration-300",
          ].join(" ")}
          style={indeterminate ? undefined : { width: `${progress}%` }}
        />
      </div>
      <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--card)] text-[var(--accent)] shadow-[inset_0_0_0_1px_var(--border)]">
        {state.cancelling ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden />
        )}
      </div>
      <div className="relative z-10 min-w-0 flex-1">
        <p
          className={`truncate text-xs font-semibold ${state.error ? "text-[var(--danger)]" : "text-[var(--text)]"}`}
          title={label}
        >
          {label}
        </p>
        {state.detail ? (
          <p
            className="truncate text-[11px] leading-4 text-[var(--muted)]"
            title={state.detail}
          >
            {state.detail}
          </p>
        ) : null}
      </div>
      {progress !== null && !state.error ? (
        <span className="relative z-10 shrink-0 text-xs font-semibold tabular-nums text-[var(--muted)]">
          {Math.round(progress)}%
        </span>
      ) : null}
      {state.onCancel ? (
        <Button
          type="button"
          variant="danger-ghost"
          size="icon-sm"
          title={cancelLabel}
          aria-label={cancelLabel}
          disabled={state.cancelling}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            state.onCancel?.();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className="relative z-10"
        >
          {state.cancelling ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <X aria-hidden />
          )}
        </Button>
      ) : null}
    </div>
  );
}

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
          onKeyDown={(event) => event.stopPropagation()}
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
      onKeyDown={(event) => event.stopPropagation()}
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
