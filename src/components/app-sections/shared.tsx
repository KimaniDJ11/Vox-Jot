import React from "react";
import { SettingsGroup } from "@/components/ui";

export { subtleCardClassName } from "@/components/ui/subtleCard";

export const SectionIntro: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <SettingsGroup noCard title={title} description={description}>
    {children}
  </SettingsGroup>
);

export const SectionLoading: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-5 py-6 text-sm font-medium text-[var(--muted)] shadow-[var(--shadow-sm)]"
  >
    Loading section...
  </div>
);
