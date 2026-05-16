import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Settings } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";

import { HighlightTrack } from "@/motion/HighlightTrack";
import { crisp, press } from "@/motion/springs";
import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";
import SidebarStatsGrid from "@/components/sidebar/SidebarStatsGrid";
import SidebarModelLaunchers from "@/components/sidebar/SidebarModelLaunchers";

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
  iconTone?: SidebarIconTone;
}

export type SidebarIconTone =
  | "accent"
  | "blue"
  | "gold"
  | "green"
  | "red"
  | "teal"
  | "violet";

interface SidebarProps {
  activeSectionId: string;
  items: SidebarItem[];
  collapsed: boolean;
  settingsActive: boolean;
  showStatusCards?: boolean;
  onSectionChange: (id: string) => void;
  onSettingsClick: () => void;
}

interface StoryRenderJobSummary {
  status: string;
}

/**
 * Sentinel id used for the "Settings" footer row so the hover highlight
 * can spring between nav rows and the settings row inside a single
 * LayoutGroup.
 */
const SETTINGS_ROW_ID = "__settings__";

type SidebarIconToneStyle = React.CSSProperties & {
  "--sidebar-icon-color"?: string;
  "--sidebar-icon-bg"?: string;
};

const sidebarIconToneStyles: Record<SidebarIconTone, SidebarIconToneStyle> = {
  accent: {
    "--sidebar-icon-color": "var(--accent)",
    "--sidebar-icon-bg": "color-mix(in srgb, var(--accent) 14%, transparent)",
  },
  blue: {
    "--sidebar-icon-color": "var(--info)",
    "--sidebar-icon-bg": "var(--info-soft)",
  },
  gold: {
    "--sidebar-icon-color": "var(--voice)",
    "--sidebar-icon-bg": "var(--voice-soft)",
  },
  green: {
    "--sidebar-icon-color": "var(--success)",
    "--sidebar-icon-bg": "var(--success-soft)",
  },
  red: {
    "--sidebar-icon-color": "var(--danger)",
    "--sidebar-icon-bg": "var(--danger-soft)",
  },
  teal: {
    "--sidebar-icon-color": "var(--accent-teal)",
    "--sidebar-icon-bg": "var(--accent-teal-soft)",
  },
  violet: {
    "--sidebar-icon-color": "var(--accent-2)",
    "--sidebar-icon-bg": "color-mix(in srgb, var(--accent-2) 14%, transparent)",
  },
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeSectionId,
  items,
  collapsed,
  settingsActive,
  showStatusCards = false,
  onSectionChange,
  onSettingsClick,
}) => {
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [generatedAudioPulse, setGeneratedAudioPulse] = useState(false);
  const [renderQueueActive, setRenderQueueActive] = useState(false);
  const generatedAudioPulseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke<StoryRenderJobSummary[]>("list_story_render_jobs")
      .then((jobs) => {
        if (!cancelled) {
          setRenderQueueActive(jobs.some(isActiveStoryRenderJob));
        }
      })
      .catch((error) => {
        console.error("Failed to load story render queue state:", error);
      });

    const unlistenAudio = listen("story-audio-updated", () => {
      setGeneratedAudioPulse(true);
      if (generatedAudioPulseTimerRef.current !== null) {
        window.clearTimeout(generatedAudioPulseTimerRef.current);
      }
      generatedAudioPulseTimerRef.current = window.setTimeout(() => {
        setGeneratedAudioPulse(false);
        generatedAudioPulseTimerRef.current = null;
      }, 6000);
    });
    const unlistenQueue = listen<StoryRenderJobSummary[]>(
      "story-render-queue-updated",
      (event) => {
        setRenderQueueActive(event.payload.some(isActiveStoryRenderJob));
      },
    );

    return () => {
      cancelled = true;
      void unlistenAudio.then((fn) => fn());
      void unlistenQueue.then((fn) => fn());
      if (generatedAudioPulseTimerRef.current !== null) {
        window.clearTimeout(generatedAudioPulseTimerRef.current);
      }
    };
  }, []);

  const itemLayoutClass = collapsed
    ? "justify-center px-0 py-2"
    : "gap-2.5 px-3 py-2 text-left";

  const clearHover = () => setHoveredId(null);

  const renderRow = (
    id: string,
    label: string,
    Icon: SidebarIcon,
    iconTone: SidebarIconTone = "accent",
    isActive: boolean,
    onClick: () => void,
  ) => {
    const isHovered = hoveredId === id;
    const showGeneratedAudioActivity =
      id === "story-audio-history" &&
      (generatedAudioPulse || renderQueueActive);

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
        style={sidebarIconToneStyles[iconTone]}
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
          <span className="sidebar__nav-icon-shell flex shrink-0 items-center justify-center rounded-full">
            <Icon
              width={collapsed ? 18 : 17}
              height={collapsed ? 18 : 17}
              strokeWidth={1.85}
              className="sidebar__nav-icon shrink-0"
            />
          </span>
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={crisp}
                className="sidebar__nav-label flex min-w-0 flex-1 items-center gap-2 text-[13px] font-semibold leading-5 tracking-[-0.005em]"
              >
                <span className="truncate">{label}</span>
                {showGeneratedAudioActivity ? (
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
            aria-label={t("sidebar.sectionNavigation", {
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
                  item.iconTone,
                  activeSectionId === item.id,
                  () => onSectionChange(item.id),
                ),
              )}
            </div>
          </nav>

          <div className="sidebar__lower-stack">
            {showStatusCards && !collapsed && (
              <div className="sidebar__status-cards mt-3 flex flex-col gap-2">
                <SidebarStatsGrid />
                <SidebarModelLaunchers variant="stats" />
              </div>
            )}

            <div className="sidebar__footer mt-4 pt-3">
              {renderRow(
                SETTINGS_ROW_ID,
                t("sidebar.settingsButton", { defaultValue: "Settings" }),
                Settings,
                "teal",
                settingsActive,
                onSettingsClick,
              )}
            </div>
          </div>
        </LayoutGroup>
      </div>
    </aside>
  );
};

function isActiveStoryRenderJob(job: StoryRenderJobSummary): boolean {
  return (
    job.status === "queued" ||
    job.status === "rendering" ||
    job.status === "assembling"
  );
}
