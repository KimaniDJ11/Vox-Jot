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
        <div className="px-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[color-mix(in_srgb,var(--color-text),transparent_45%)]">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--color-text),transparent_35%)]">
              {description}
            </p>
          )}
        </div>
      )}
      <div className="glass-panel rounded-2xl overflow-visible">
        <div className="divide-y divide-[color-mix(in_srgb,var(--color-text),transparent_86%)]">
          {children}
        </div>
      </div>
    </section>
  );
};
