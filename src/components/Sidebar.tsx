import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Settings } from "lucide-react";
import { LayoutGroup } from "framer-motion";

import SidebarModelLaunchers, {
  MODEL_HUB_ROW_ID,
} from "@/components/sidebar/SidebarModelLaunchers";
import {
  SidebarNavRow,
  type SidebarIconTone,
} from "@/components/sidebar/SidebarNavRow";

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
  groupLabel?: string;
}

export type { SidebarIconTone };

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

  const clearHover = () => setHoveredId(null);

  const renderRow = (
    id: string,
    label: string,
    Icon: SidebarIcon,
    iconTone: SidebarIconTone = "accent",
    isActive: boolean,
    onClick: () => void,
  ) => {
    const showGeneratedAudioActivity =
      id === "story-audio-history" &&
      (generatedAudioPulse || renderQueueActive);
    const activityLabel = showGeneratedAudioActivity
      ? t("sidebar.generatedAudioActive", {
          defaultValue: "Generated audio activity in progress",
        })
      : null;

    return (
      <SidebarNavRow
        key={id}
        id={id}
        label={label}
        icon={Icon}
        iconTone={iconTone}
        isActive={isActive}
        collapsed={collapsed}
        hovered={hoveredId === id}
        onHoverStart={() => setHoveredId(id)}
        activityLabel={activityLabel}
        showActivityIndicator={showGeneratedAudioActivity}
        onClick={onClick}
      />
    );
  };

  return (
    <aside
      className="sidebar flex flex-col transition-all duration-300"
      onPointerLeave={clearHover}
      onBlur={clearHover}
    >
      <div
        className={`sidebar__panel flex min-h-0 flex-1 flex-col ${collapsed ? "px-2 py-2.5" : "px-1.5 py-2.5"}`}
      >
        <LayoutGroup id="sidebar-rows">
          <nav
            aria-label={t("sidebar.sectionNavigation", {
              defaultValue: "Section navigation",
            })}
            className="sidebar__nav min-h-0 flex-1 overflow-y-auto"
          >
            <div className="flex flex-col gap-0.5">
              {items.map((item, index) => {
                const previousGroup = items[index - 1]?.groupLabel;
                const showGroupLabel =
                  !collapsed &&
                  item.groupLabel &&
                  item.groupLabel !== previousGroup;

                return (
                  <React.Fragment key={item.id}>
                    {showGroupLabel ? (
                      <div className="sidebar__group-label px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] first:pt-0">
                        {item.groupLabel}
                      </div>
                    ) : null}
                    {renderRow(
                      item.id,
                      item.label,
                      item.icon,
                      item.iconTone,
                      activeSectionId === item.id,
                      () => onSectionChange(item.id),
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </nav>

          <div className="sidebar__lower-stack">
            <div className="sidebar__footer mt-4 flex flex-col gap-0.5 pt-3">
              {showStatusCards ? (
                <SidebarModelLaunchers
                  collapsed={collapsed}
                  hovered={hoveredId === MODEL_HUB_ROW_ID}
                  onHoverStart={() => setHoveredId(MODEL_HUB_ROW_ID)}
                />
              ) : null}
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
