import React from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";

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

export const Sidebar: React.FC<SidebarProps> = ({
  activeSectionId,
  items,
  collapsed,
  settingsActive,
  onSectionChange,
  onSettingsClick,
}) => {
  const { t } = useTranslation();
  const itemLayoutClass = collapsed
    ? "justify-center px-0 py-2"
    : "gap-2.5 px-3 py-2 text-left";

  return (
    <aside className="sidebar flex flex-col transition-all duration-300">
      <div
        className={`sidebar__panel flex min-h-0 flex-1 flex-col ${collapsed ? "px-2 py-2.5" : "px-2.5 py-2.5"}`}
      >
        <nav
          aria-label={t("sidebar.settingsLabel", {
            defaultValue: "Section navigation",
          })}
          className="sidebar__nav min-h-0 flex-1 overflow-y-auto"
        >
          <div className="flex flex-col gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = activeSectionId === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSectionChange(item.id)}
                  className={`sidebar__nav-button group relative flex w-full items-center rounded-2xl ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${itemLayoutClass}`}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    width={collapsed ? 18 : 17}
                    height={collapsed ? 18 : 17}
                    strokeWidth={isActive ? 2.3 : 2.15}
                    className="sidebar__nav-icon shrink-0"
                  />
                  {!collapsed && (
                    <span className="sidebar__nav-label truncate text-[13.5px] font-semibold leading-5">
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="sidebar__footer mt-4 pt-3">
          <button
            type="button"
            onClick={onSettingsClick}
            className={`sidebar__nav-button group relative flex w-full items-center rounded-2xl ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${itemLayoutClass}`}
            aria-current={settingsActive ? "page" : undefined}
            aria-label={collapsed ? "Settings" : undefined}
            title={collapsed ? "Settings" : undefined}
          >
            <Settings
              width={collapsed ? 18 : 17}
              height={collapsed ? 18 : 17}
              strokeWidth={settingsActive ? 2.3 : 2.15}
              className="sidebar__nav-icon shrink-0"
            />
            {!collapsed && (
              <span className="sidebar__nav-label truncate text-[13.5px] font-semibold leading-5">
                {t("sidebar.settingsButton", { defaultValue: "Settings" })}
              </span>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
