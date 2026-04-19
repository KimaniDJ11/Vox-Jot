import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";

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

export interface SidebarItem {
  id: string;
  label: string;
  icon: SidebarIcon;
}

interface SidebarProps {
  activeSectionId: string;
  items: SidebarItem[];
  collapsed: boolean;
  settingsActive: boolean;
  onSectionChange: (id: string) => void;
  onSettingsClick: () => void;
}

/**
 * Sentinel id used for the "Settings" footer row so the hover highlight
 * can spring between nav rows and the settings row inside a single
 * LayoutGroup.
 */
const SETTINGS_ROW_ID = "__settings__";

export const Sidebar: React.FC<SidebarProps> = ({
  activeSectionId,
  items,
  collapsed,
  settingsActive,
  onSectionChange,
  onSettingsClick,
}) => {
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const itemLayoutClass = collapsed
    ? "justify-center px-0 py-2"
    : "gap-2.5 px-3 py-2 text-left";

  const clearHover = () => setHoveredId(null);

  const renderRow = (
    id: string,
    label: string,
    Icon: SidebarIcon,
    isActive: boolean,
    onClick: () => void,
  ) => {
    const isHovered = hoveredId === id;

    return (
      <motion.button
        key={id}
        type="button"
        onClick={onClick}
        whileTap={{ scale: 0.97 }}
        transition={press}
        onPointerEnter={() => setHoveredId(id)}
        onFocus={() => setHoveredId(id)}
        className={`sidebar__nav-button group relative flex w-full items-center rounded-2xl ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${itemLayoutClass}`}
        aria-current={isActive ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        title={collapsed ? label : undefined}
      >
        {/* Active pill — springs between rows whenever active changes. */}
        {isActive && (
          <motion.span
            layoutId="sidebar-active"
            transition={crisp}
            className="pointer-events-none absolute inset-0 rounded-2xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] ring-1 ring-[var(--ring-hairline)]"
            aria-hidden
          />
        )}

        {/* Hover track — only shown on non-active rows, so the active pill
         *  always remains visible underneath. */}
        {!isActive && (
          <HighlightTrack
            active={isHovered}
            layoutId="sidebar-hover"
            variant="surface"
            insetClass="inset-0"
            radiusClass="rounded-2xl"
          />
        )}

        <span
          className={`relative z-10 flex w-full items-center gap-2.5 ${collapsed ? "justify-center" : ""}`}
        >
          <Icon
            width={collapsed ? 18 : 17}
            height={collapsed ? 18 : 17}
            strokeWidth={1.75}
            className="sidebar__nav-icon shrink-0"
          />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={crisp}
                className="sidebar__nav-label truncate text-[13px] font-semibold leading-5 tracking-[-0.005em]"
              >
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </motion.button>
    );
  };

  return (
    <aside
      className="sidebar flex flex-col transition-all duration-300"
      aria-hidden={collapsed ? true : undefined}
      onPointerLeave={clearHover}
      onBlur={clearHover}
    >
      <div
        className={`sidebar__panel flex min-h-0 flex-1 flex-col ${collapsed ? "px-2 py-2.5" : "px-2.5 py-2.5"}`}
      >
        <LayoutGroup id="sidebar-rows">
          <nav
            aria-label={t("sidebar.settingsLabel", {
              defaultValue: "Section navigation",
            })}
            className="sidebar__nav min-h-0 flex-1 overflow-y-auto"
          >
            <div className="flex flex-col gap-1">
              {items.map((item) =>
                renderRow(
                  item.id,
                  item.label,
                  item.icon,
                  activeSectionId === item.id,
                  () => onSectionChange(item.id),
                ),
              )}
            </div>
          </nav>

          <div className="sidebar__footer mt-4 pt-3">
            {renderRow(
              SETTINGS_ROW_ID,
              t("sidebar.settingsButton", { defaultValue: "Settings" }),
              Settings,
              settingsActive,
              onSettingsClick,
            )}
          </div>
        </LayoutGroup>
      </div>
    </aside>
  );
};
