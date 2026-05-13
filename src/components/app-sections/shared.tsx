import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "@/components/ui";

export { subtleCardClassName } from "@/components/ui/subtleCard";

export const SectionIntro: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <SettingsGroup
    noCard
    title={title}
    description={description}
    showTitle={false}
  >
    {children}
  </SettingsGroup>
);

export const SectionLoading: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-5 py-6 text-sm font-medium text-[var(--muted)] shadow-[var(--shadow-sm)]"
    >
      {t("appSections.common.loadingSection")}
    </div>
  );
};
