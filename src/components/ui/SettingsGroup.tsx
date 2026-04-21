import React, { createContext, useContext, useId } from "react";
import { LayoutGroup } from "framer-motion";

interface SettingsGroupProps {
  title?: string;
  description?: string;
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
  titleAction,
  noCard = false,
  children,
}) => {
  const groupId = useId();

  return (
    <SettingsGroupContext.Provider value={{ groupId, grouped: true }}>
      <LayoutGroup id={`settings-group-${groupId}`}>
        <section className="space-y-2">
          {title && (
            <div className="px-1 mb-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle,var(--muted))]">
                    {title}
                  </h3>
                  {description && (
                    <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
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
