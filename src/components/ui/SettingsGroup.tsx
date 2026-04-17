import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  /** Rendered on the trailing side of the heading row (outside the card). */
  titleAction?: React.ReactNode;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  titleAction,
  children,
}) => {
  return (
    <section className="space-y-2">
      {title && (
        <div className="px-1 mb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
                {title}
              </h3>
              {description && (
                <p className="mt-1 text-[13px] leading-5 text-[var(--muted)]">
                  {description}
                </p>
              )}
            </div>
            {titleAction ? <div className="shrink-0">{titleAction}</div> : null}
          </div>
        </div>
      )}
      <div className="flat-card overflow-visible">
        <div className="divide-y divide-[var(--border)]">{children}</div>
      </div>
    </section>
  );
};
