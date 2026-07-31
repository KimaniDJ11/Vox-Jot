import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { HighlightTrack } from "@/motion/HighlightTrack";
import { crisp, press } from "@/motion/springs";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";

type SidebarIcon = React.ComponentType<{
  className?: string;
  width?: number | string;
  height?: number | string;
  strokeWidth?: number | string;
}>;

export type SidebarIconTone =
  "accent" | "blue" | "gold" | "green" | "red" | "teal" | "violet";

type SidebarIconToneStyle = React.CSSProperties & {
  "--sidebar-icon-color"?: string;
};

const sidebarIconToneStyles: Record<SidebarIconTone, SidebarIconToneStyle> = {
  accent: {
    "--sidebar-icon-color": "var(--accent)",
  },
  blue: {
    "--sidebar-icon-color": "var(--info)",
  },
  gold: {
    "--sidebar-icon-color": "var(--voice)",
  },
  green: {
    "--sidebar-icon-color": "var(--success)",
  },
  red: {
    "--sidebar-icon-color": "var(--danger)",
  },
  teal: {
    "--sidebar-icon-color": "var(--accent-teal)",
  },
  violet: {
    "--sidebar-icon-color": "var(--accent-2)",
  },
};

export interface SidebarNavRowProps {
  id: string;
  label: string;
  icon: SidebarIcon;
  iconTone?: SidebarIconTone;
  isActive?: boolean;
  collapsed?: boolean;
  onClick: () => void;
  hovered?: boolean;
  onHoverStart?: () => void;
  activityLabel?: string | null;
  showActivityIndicator?: boolean;
}

export const SidebarNavRow: React.FC<SidebarNavRowProps> = ({
  id,
  label,
  icon: Icon,
  iconTone = "accent",
  isActive = false,
  collapsed = false,
  onClick,
  hovered,
  onHoverStart,
  activityLabel = null,
  showActivityIndicator = false,
}) => {
  const [internalHovered, setInternalHovered] = useState(false);
  const isHovered = hovered ?? internalHovered;
  const itemLayoutClass = collapsed
    ? "justify-center px-0 py-2"
    : "px-1.5 py-0 text-left";
  const accessibleLabel = activityLabel ? `${label}. ${activityLabel}` : label;

  const handleHoverStart = () => {
    onHoverStart?.();
    if (hovered === undefined) {
      setInternalHovered(true);
    }
  };

  const handleHoverEnd = () => {
    if (hovered === undefined) {
      setInternalHovered(false);
    }
  };

  return (
    <motion.button
      key={id}
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      transition={press}
      onPointerEnter={handleHoverStart}
      onPointerLeave={handleHoverEnd}
      onFocus={handleHoverStart}
      onBlur={handleHoverEnd}
      className={`sidebar__nav-button group relative flex w-full items-center rounded-xl ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${itemLayoutClass}`}
      style={sidebarIconToneStyles[iconTone]}
      aria-current={isActive ? "page" : undefined}
      aria-label={collapsed || activityLabel ? accessibleLabel : undefined}
      title={collapsed || activityLabel ? accessibleLabel : undefined}
    >
      {isActive ? (
        <motion.span
          layoutId="sidebar-active"
          transition={crisp}
          className="pointer-events-none absolute inset-0 rounded-xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] ring-1 ring-[var(--ring-hairline)]"
          aria-hidden
        />
      ) : null}

      {!isActive ? (
        <HighlightTrack
          active={isHovered}
          layoutId="sidebar-hover"
          variant="surface"
          insetClass="inset-0"
          radiusClass="rounded-xl"
        />
      ) : null}

      <span
        className={`relative z-10 flex w-full items-center ${collapsed ? "justify-center" : "gap-1.5"}`}
      >
        <span className="sidebar__nav-icon-shell flex shrink-0 items-center justify-center rounded-full">
          <Icon
            width={collapsed ? 18 : 16}
            height={collapsed ? 18 : 16}
            strokeWidth={1.85}
            className="sidebar__nav-icon shrink-0"
          />
        </span>
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={crisp}
              className="sidebar__nav-label flex min-w-0 flex-1 items-center gap-2 text-[13px] font-bold leading-5 tracking-[-0.005em]"
            >
              <span className="truncate">{label}</span>
              {showActivityIndicator ? (
                <span
                  className="ms-auto inline-flex h-5 shrink-0 items-end gap-0.5 rounded-full bg-[var(--accent-soft)] px-2 py-1"
                  aria-hidden="true"
                >
                  {[0, 1, 2].map((index) => (
                    <span
                      key={index}
                      className="h-2 w-1 rounded-full bg-[var(--accent)] animate-[pulse_0.8s_ease-in-out_infinite]"
                      style={{ animationDelay: `${index * 120}ms` }}
                    />
                  ))}
                </span>
              ) : null}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </motion.button>
  );
};
