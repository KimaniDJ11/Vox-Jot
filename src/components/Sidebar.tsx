import React from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";

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

  return (
    <aside className="sidebar flex flex-col border-r border-[var(--border)] bg-[var(--sidebar-bg)] transition-all duration-300">
      <div
        className={`flex min-h-0 flex-1 flex-col ${collapsed ? "px-2 py-4" : "px-4 py-5"}`}
      >
        <nav
          aria-label={t("sidebar.settingsLabel", {
            defaultValue: "Section navigation",
          })}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = activeSectionId === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSectionChange(item.id)}
                  className={`group relative flex w-full items-center rounded-2xl transition-all duration-200 ${
                    collapsed
                      ? "justify-center px-0 py-3"
                      : "gap-3 px-4 py-3 text-left"
                  } ${
                    isActive
                      ? "bg-[var(--accent)] text-[var(--inverse-text)] shadow-sm"
                      : "text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text),transparent_93%)]"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    width={collapsed ? 19 : 18}
                    height={collapsed ? 19 : 18}
                    strokeWidth={isActive ? 2.6 : 2.35}
                    className={`shrink-0 ${
                      isActive
                        ? "text-[var(--inverse-text)]"
                        : "text-[var(--muted)] group-hover:text-[var(--text)]"
                    }`}
                  />
                  {!collapsed && (
                    <span
                      className={`truncate text-base font-bold leading-6 ${
                        isActive
                          ? "text-[var(--inverse-text)]"
                          : "text-[var(--text)]"
                      }`}
                    >
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={onSettingsClick}
            className={`group relative flex w-full items-center rounded-2xl transition-all duration-200 ${
              collapsed
                ? "justify-center px-0 py-3"
                : "gap-3 px-4 py-3 text-left"
            } ${
              settingsActive
                ? "bg-[var(--accent)] text-[var(--inverse-text)] shadow-sm"
                : "text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text),transparent_93%)]"
            }`}
            aria-current={settingsActive ? "page" : undefined}
            aria-label={collapsed ? "Settings" : undefined}
            title={collapsed ? "Settings" : undefined}
          >
            <Settings
              width={collapsed ? 19 : 18}
              height={collapsed ? 19 : 18}
              strokeWidth={settingsActive ? 2.6 : 2.35}
              className={`shrink-0 ${
                settingsActive
                  ? "text-[var(--inverse-text)]"
                  : "text-[var(--muted)] group-hover:text-[var(--text)]"
              }`}
            />
            {!collapsed && (
              <span
                className={`truncate text-base font-bold leading-6 ${
                  settingsActive
                    ? "text-[var(--inverse-text)]"
                    : "text-[var(--text)]"
                }`}
              >
                Settings
              </span>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
