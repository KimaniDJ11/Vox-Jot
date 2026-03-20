import React from "react";
import { useTranslation } from "react-i18next";
import {
  Cog,
  FlaskConical,
  History,
  Info,
  Sparkles,
  Cpu,
  Bot,
  SpellCheck,
} from "lucide-react";
import VoxJotMark from "./icons/VoxJotMark";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
  OllamaSettings,
  CorrectionSettings,
} from "./settings";
import { useSettingsStore } from "../stores/settingsStore";

const SidebarBrandIcon: React.FC<IconProps> = (props) => (
  <VoxJotMark {...props} monochrome />
);

export type SidebarSection = keyof typeof SECTIONS_CONFIG;

interface IconProps {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  [key: string]: any;
}

interface SectionConfig {
  labelKey: string;
  icon: React.ComponentType<IconProps>;
  component: React.ComponentType;
  enabled: (settings?: any) => boolean;
}

export const SECTIONS_CONFIG = {
  general: {
    labelKey: "sidebar.general",
    icon: SidebarBrandIcon,
    component: GeneralSettings,
    enabled: () => true,
  },
  models: {
    labelKey: "sidebar.models",
    icon: Cpu,
    component: ModelsSettings,
    enabled: () => true,
  },
  ollama: {
    labelKey: "sidebar.ollama",
    icon: Bot,
    component: OllamaSettings,
    enabled: () => true,
  },
  advanced: {
    labelKey: "sidebar.advanced",
    icon: Cog,
    component: AdvancedSettings,
    enabled: () => true,
  },
  postprocessing: {
    labelKey: "sidebar.postProcessing",
    icon: Sparkles,
    component: PostProcessingSettings,
    enabled: () => true,
  },
  corrections: {
    labelKey: "sidebar.corrections",
    icon: SpellCheck,
    component: CorrectionSettings,
    enabled: () => true,
  },
  history: {
    labelKey: "sidebar.history",
    icon: History,
    component: HistorySettings,
    enabled: () => true,
  },
  debug: {
    labelKey: "sidebar.debug",
    icon: FlaskConical,
    component: DebugSettings,
    enabled: (settings?: { debug_mode?: boolean }) =>
      settings?.debug_mode === true,
  },
  about: {
    labelKey: "sidebar.about",
    icon: Info,
    component: AboutSettings,
    enabled: () => true,
  },
} as const satisfies Record<string, SectionConfig>;

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  collapsed: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
  collapsed,
}) => {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings ?? undefined))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <aside className="sidebar flex flex-col border-r border-[var(--border)] bg-[var(--sidebar-bg)] transition-all duration-300">
      <div
        className={`flex flex-col flex-1 overflow-y-auto py-4 ${collapsed ? "px-2" : "px-5"}`}
      >
        <nav aria-label={t("sidebar.settingsLabel")}>
          <div className="flex flex-col gap-2 w-full">
            {availableSections.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              const iconSize = collapsed ? 20 : 18;

              return (
                <button
                  key={section.id}
                  className={`group relative flex w-full items-center rounded-xl transition-all duration-200 min-w-0 ${
                    collapsed
                      ? "justify-center px-0 py-2.5"
                      : "gap-3 px-4 py-3 text-left"
                  } ${
                    isActive
                      ? "bg-[var(--accent)] text-white font-bold shadow-sm"
                      : "bg-transparent text-[var(--text)] font-semibold hover:bg-[color-mix(in_srgb,var(--text),transparent_93%)]"
                  }`}
                  type="button"
                  aria-label={collapsed ? t(section.labelKey) : undefined}
                  title={collapsed ? t(section.labelKey) : undefined}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSectionChange(section.id)}
                >
                  <Icon
                    width={iconSize}
                    height={iconSize}
                    strokeWidth={
                      section.id === "general"
                        ? undefined
                        : isActive
                          ? 2.75
                          : 2.5
                    }
                    className={`shrink-0 transition-colors duration-200 ${
                      isActive
                        ? "text-white"
                        : "text-[var(--muted)] group-hover:text-[var(--text)]"
                    }`}
                  />
                  {!collapsed && (
                    <span
                      className="truncate text-[15px] leading-6 tracking-wide flex-1"
                      title={t(section.labelKey)}
                    >
                      {t(section.labelKey)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </aside>
  );
};
