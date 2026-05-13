// Templates strip shown only when creating a new profile. Picking one
// merges its preset overrides into the draft (and seeds the name when
// the user hasn't typed anything yet). The bar disappears once the
// profile is saved — there's no "switch template later" affordance,
// because once a profile has been edited, mixing in a different
// template's preset would silently overwrite the user's choices.
//
// We deliberately don't pre-populate apps/URLs from a template. Those
// are too user-specific to guess.

import React from "react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PROFILE_TEMPLATES, type ProfileTemplateId } from "../lib/templates";

interface TemplatesRowProps {
  selectedId: ProfileTemplateId | null;
  onSelect: (id: ProfileTemplateId) => void;
}

export const TemplatesRow: React.FC<TemplatesRowProps> = ({
  selectedId,
  onSelect,
}) => {
  const { t } = useTranslation();

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-[var(--muted)]">
        {t("refine.writeRules.templates.heading")}
      </p>
      <div className="flex flex-wrap gap-2">
        {PROFILE_TEMPLATES.map((template) => (
          <TemplateChip
            key={template.id}
            label={t(`refine.writeRules.templates.${template.id}.label`)}
            description={t(
              `refine.writeRules.templates.${template.id}.description`,
            )}
            icon={template.icon}
            selected={selectedId === template.id}
            onClick={() => onSelect(template.id)}
          />
        ))}
      </div>
    </div>
  );
};

const TemplateChip: React.FC<{
  label: string;
  description: string;
  icon: LucideIcon;
  selected: boolean;
  onClick: () => void;
}> = ({ label, description, icon: Icon, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={description}
    aria-pressed={selected}
    className={[
      "group flex min-w-[78px] flex-col items-center gap-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
      selected
        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]"
        : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-[var(--accent)]/60 hover:text-[var(--text)]",
    ].join(" ")}
  >
    <Icon
      className={[
        "h-4 w-4",
        selected
          ? "text-[var(--accent)]"
          : "text-[var(--muted)] group-hover:text-[var(--text)]",
      ].join(" ")}
      aria-hidden
    />
    {label}
  </button>
);
