import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";

interface PathDisplayProps {
  path: string;
  onOpen: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export const PathDisplay: React.FC<PathDisplayProps> = ({
  path,
  onOpen,
  disabled = false,
  ariaLabel,
}) => {
  const { t } = useTranslation();
  const pathLabel =
    ariaLabel ??
    t("ui.pathDisplay.pathLabel", { defaultValue: "Filesystem path" });

  return (
    <div className="flex items-center gap-2">
      <div
        role="textbox"
        aria-readonly="true"
        aria-label={pathLabel}
        tabIndex={0}
        className="flex-1 min-w-0 px-3 py-2 bg-[var(--input)] border border-[var(--border)] rounded-full text-xs font-mono-token text-[var(--text)] break-all select-text cursor-text"
      >
        {path}
      </div>
      <Button
        onClick={onOpen}
        variant="secondary"
        size="sm"
        disabled={disabled}
        className="px-3 py-2"
      >
        {t("common.open")}
      </Button>
    </div>
  );
};
