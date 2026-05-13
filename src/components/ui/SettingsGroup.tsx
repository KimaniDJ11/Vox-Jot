import React, { createContext, useContext, useId } from "react";
import { LayoutGroup } from "framer-motion";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  /** When false, keeps the section label for accessibility but omits the visible duplicate heading. */
  showTitle?: boolean;
  /** Use for description-only intro groups whose next row is a controls toolbar. */
  descriptionOnlyGap?: "default" | "controls";
  /** Rendered on the trailing side of the heading row (outside the card). */
  titleAction?: React.ReactNode;
  /** When true, skips the bordered `card-linear` wrapper (children render flush). */
  noCard?: boolean;
  children: React.ReactNode;
}

type SettingsGroupContextValue = {
  groupId: string;
  grouped: boolean;
};

const SettingsGroupContext = createContext<SettingsGroupContextValue | null>(
  null,
);

/** Used by SettingContainer to share a single hover highlight track per group. */
export const useSettingsGroupContext = () => useContext(SettingsGroupContext);

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  showTitle = true,
  descriptionOnlyGap = "default",
  titleAction,
  noCard = false,
  children,
}) => {
  const groupId = useId();
  const hasHeader = (showTitle && title) || description || titleAction;
  const useControlsGap =
    !showTitle && Boolean(description) && descriptionOnlyGap === "controls";

  return (
    <SettingsGroupContext.Provider value={{ groupId, grouped: true }}>
      <LayoutGroup id={`settings-group-${groupId}`}>
        <section
          className={useControlsGap ? "space-y-0" : "space-y-2"}
          aria-label={title}
        >
          {hasHeader && (
            <div
              className={useControlsGap ? "px-1 mb-7" : "px-1 mb-2"}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {showTitle && title ? (
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle,var(--muted))]">
                      {title}
                    </h3>
                  ) : null}
                  {description && (
                    <p
                      className={
                        showTitle
                          ? "mt-1 text-[12px] leading-5 text-[var(--muted)]"
                          : "text-[13px] font-semibold tracking-[0.08em] leading-6 text-[var(--text-subtle,var(--muted))]"
                      }
                    >
                      {description}
                    </p>
                  )}
                </div>
                {titleAction ? (
                  <div className="shrink-0">{titleAction}</div>
                ) : null}
              </div>
            </div>
          )}
          {noCard ? (
            <div className="overflow-visible">{children}</div>
          ) : (
            <div className="card-linear overflow-visible">
              <div className="divide-y divide-[var(--ring-hairline,var(--border))]">
                {children}
              </div>
            </div>
          )}
        </section>
      </LayoutGroup>
    </SettingsGroupContext.Provider>
  );
};
