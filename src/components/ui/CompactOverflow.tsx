import React, { useEffect, useRef, useState } from "react";
import { Check, Info } from "lucide-react";

import { interactiveFocusRingClass } from "@/lib/interactiveFocus";

import Badge from "./Badge";
import { Tooltip } from "./Tooltip";

type BadgeVariant = "primary" | "secondary" | "success";

export interface CompactBadgeItem {
  id: string;
  label: string;
  variant?: BadgeVariant;
  icon?: React.ReactNode;
  /** Plain-language description shown on hover / keyboard focus (tooltip + overflow popover lines). */
  detail?: string;
}

export const ActiveBadgeIcon: React.FC<{ className?: string }> = ({
  className = "h-3.5 w-3.5",
}) => <Check className={className} aria-hidden />;

function badgeIconForItem(item: CompactBadgeItem) {
  if (item.id === "active") {
    return <ActiveBadgeIcon />;
  }
  return item.icon;
}

interface OverflowInfoButtonProps {
  lines: string[];
  label: string;
}

const OverflowInfoButton: React.FC<OverflowInfoButtonProps> = ({
  lines,
  label,
}) => {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!triggerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] ${interactiveFocusRingClass}`}
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
      >
        <Info className="h-3 w-3" />
      </button>
      {open ? (
        <Tooltip
          targetRef={triggerRef as React.RefObject<HTMLElement>}
          position="bottom"
        >
          <div className="space-y-1 text-xs leading-5 text-[var(--text)]">
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
};

export const CompactBadgeRow: React.FC<{
  items: CompactBadgeItem[];
  maxVisible?: number;
  overflowLabel: string;
}> = ({ items, maxVisible = 2, overflowLabel }) => {
  const visibleItems = items.slice(0, maxVisible);
  const hiddenItems = items.slice(maxVisible);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap">
      {visibleItems.map((item) => {
        const tooltip = item.detail
          ? `${item.label} — ${item.detail}`
          : item.label;
        const icon = badgeIconForItem(item);
        return (
          <Badge
            key={item.id}
            variant={item.variant ?? "secondary"}
            className="min-w-0 max-w-[9.5rem] shrink truncate"
          >
            <span className="inline-flex min-w-0 items-center" title={tooltip}>
              {icon ? <span className="mr-1 shrink-0">{icon}</span> : null}
              <span className="truncate">{item.label}</span>
            </span>
          </Badge>
        );
      })}
      {hiddenItems.length > 0 ? (
        <OverflowInfoButton
          label={overflowLabel}
          lines={hiddenItems.map((item) =>
            item.detail ? `${item.label} — ${item.detail}` : item.label,
          )}
        />
      ) : null}
    </div>
  );
};

export const CompactMetaRow: React.FC<{
  items: string[];
  maxVisible?: number;
  icon?: React.ReactNode;
  overflowLabel: string;
  className?: string;
}> = ({ items, maxVisible = 3, icon, overflowLabel, className = "" }) => {
  const visibleItems = items.slice(0, maxVisible);
  const hiddenItems = items.slice(maxVisible);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`flex min-w-0 items-center gap-2 text-xs text-[var(--muted)] ${className}`.trim()}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="truncate" title={visibleItems.join(" · ")}>
        {visibleItems.join(" · ")}
      </span>
      {hiddenItems.length > 0 ? (
        <OverflowInfoButton label={overflowLabel} lines={hiddenItems} />
      ) : null}
    </div>
  );
};
