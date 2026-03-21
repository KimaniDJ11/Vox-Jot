import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <section className="space-y-2">
      {title && (
        <div className="px-5 mb-3">
          <h2 className="text-xl font-extrabold uppercase tracking-[0.16em] text-black dark:text-[var(--text)]">
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 text-[13px] text-mid-gray leading-relaxed">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="flat-card overflow-visible">
        <div className="divide-y divide-[var(--border)]">{children}</div>
      </div>
    </section>
  );
};
