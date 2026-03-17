import React from "react";
import { useTranslation } from "react-i18next";
import { Cog, FlaskConical, History, Info, Sparkles, Cpu, Bot, SpellCheck } from "lucide-react";
import VoxJotTextLogo from "./icons/VoxJotTextLogo";
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
    enabled: () => true,
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
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSectionChange,
}) => {
  const { t } = useTranslation();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled())
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <aside className="sidebar flex flex-col border-r border-[var(--border)] bg-[var(--sidebar-bg)] transition-all duration-300">
      <div className="flex flex-col flex-1 px-5 py-4 overflow-y-auto">
        <VoxJotTextLogo width={128} className="mb-8 mt-2 shrink-0 hidden md:block" />
        <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          Settings
        </div>
        <div className="flex flex-col gap-2 w-full">
          {availableSections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;

            return (
              <button
                key={section.id}
                className={`group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-200 min-w-0 ${
                  isActive
                    ? "bg-[var(--accent)] text-white font-semibold shadow-sm"
                    : "bg-transparent text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text),transparent_93%)]"
                }`}
                type="button"
                onClick={() => onSectionChange(section.id)}
              >
                {/* We can optionally handle a side indicator or remove it since the background is solid. Removing it for cleaner look. */}
                <Icon
                  width={18}
                  height={18}
                  className={`shrink-0 transition-colors duration-200 ${
                    isActive ? "text-white" : "text-[var(--muted)] group-hover:text-[var(--text)]"
                  }`}
                />
                <span
                  className="truncate text-[15px] leading-6 tracking-wide flex-1"
                  title={t(section.labelKey)}
                >
                  {t(section.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
