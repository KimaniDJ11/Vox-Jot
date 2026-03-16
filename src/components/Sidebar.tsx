import React from "react";
import { useTranslation } from "react-i18next";
import { Cog, FlaskConical, History, Info, Sparkles, Cpu, Bot } from "lucide-react";
import VoxJotTextLogo from "./icons/VoxJotTextLogo";
import VoxJotMark from "./icons/VoxJotMark";
import { useSettings } from "../hooks/useSettings";
import {
  GeneralSettings,
  AdvancedSettings,
  HistorySettings,
  DebugSettings,
  AboutSettings,
  PostProcessingSettings,
  ModelsSettings,
  OllamaSettings,
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
  enabled: (settings: any) => boolean;
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
    enabled: (settings) => settings?.debug_mode ?? false,
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
  const { settings } = useSettings();

  const availableSections = Object.entries(SECTIONS_CONFIG)
    .filter(([_, config]) => config.enabled(settings))
    .map(([id, config]) => ({ id: id as SidebarSection, ...config }));

  return (
    <aside className="h-full w-60 shrink-0 p-4">
      <div className="glass-panel-elevated flex h-full flex-col rounded-[28px] p-4">
        <VoxJotTextLogo width={126} className="mx-auto mt-1" />
        <div className="my-4 h-px bg-[color-mix(in_srgb,var(--color-logo-primary),transparent_80%)]" />
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {availableSections.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              className={`glass-interactive relative flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors ${
                isActive
                  ? "border border-[color-mix(in_srgb,var(--color-logo-primary),transparent_48%)] bg-[color-mix(in_srgb,var(--glass-bg-elevated),white_8%)] text-[var(--color-logo-primary)] shadow-[0_16px_36px_-24px_rgba(39,64,139,0.75)] dark:text-blue-200"
                  : "border border-transparent text-[color-mix(in_srgb,var(--color-text),transparent_20%)] hover:bg-[color-mix(in_srgb,var(--glass-bg),white_10%)]"
              }`}
              type="button"
              onClick={() => onSectionChange(section.id)}
            >
              {isActive && (
                <span
                  className="pointer-events-none absolute inset-y-2 left-1 w-1 rounded-full bg-gradient-to-b from-[var(--color-logo-primary)] via-[color-mix(in_srgb,var(--color-logo-primary),white_22%)] to-[var(--color-accent-gold)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-logo-primary),white_30%),0_0_24px_color-mix(in_srgb,var(--color-logo-primary),transparent_24%)]"
                  aria-hidden="true"
                />
              )}
              <Icon width={20} height={20} className="shrink-0" />
              <p
                className="truncate text-sm font-medium"
                title={t(section.labelKey)}
              >
                {t(section.labelKey)}
              </p>
            </button>
          );
        })}
        </div>
      </div>
    </aside>
  );
};
