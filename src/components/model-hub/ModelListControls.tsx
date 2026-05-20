import React from "react";
import { ArrowUpDown, Globe, SlidersHorizontal } from "lucide-react";
import type { ModelSortMode, ModelSortOption } from "@/lib/modelListOrdering";

export interface ModelListControlOption {
  value: string;
  label: string;
}

interface SelectControlProps {
  value: string;
  options: ModelListControlOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  title: string;
  selectedLabel: string;
  active: boolean;
  children: React.ReactNode;
}

interface ModelListControlsProps {
  provider?: {
    value: string;
    options: ModelListControlOption[];
    onChange: (value: string) => void;
    label: string;
    show?: boolean;
  };
  language?: {
    value: string;
    options: ModelListControlOption[];
    onChange: (value: string) => void;
    label: string;
    show?: boolean;
  };
  sort: {
    value: ModelSortMode;
    options: ModelSortOption[];
    onChange: (value: ModelSortMode) => void;
    label: string;
  };
  className?: string;
}

const SelectControl: React.FC<SelectControlProps> = ({
  value,
  options,
  onChange,
  ariaLabel,
  title,
  selectedLabel,
  active,
  children,
}) => {
  const optionsWithCurrent = options.some((option) => option.value === value)
    ? options
    : [{ value, label: selectedLabel || value }, ...options];

  return (
    <div
      className={`relative inline-flex h-10 shrink-0 ${
        active ? "w-[8.75rem] max-w-full" : "w-10"
      }`}
    >
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`h-full w-full appearance-none rounded-full border px-0 py-1.5 text-xs font-semibold text-transparent shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] ${
          active
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--border)] bg-[var(--card)]"
        }`}
        aria-label={ariaLabel}
        title={title}
      >
        {optionsWithCurrent.map((option) => (
          <option
            key={option.value}
            value={option.value}
            style={{ color: "var(--text)", backgroundColor: "var(--card)" }}
          >
            {option.label}
          </option>
        ))}
      </select>
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center ${
          active ? "gap-1.5 px-3" : ""
        }`}
        aria-hidden
      >
        {children}
        {active ? (
          <span className="min-w-0 truncate text-xs font-semibold text-[var(--text)]">
            {selectedLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export const ModelListControls: React.FC<ModelListControlsProps> = ({
  provider,
  language,
  sort,
  className = "",
}) => {
  const showProvider =
    provider?.show !== false &&
    ((provider?.options.length ?? 0) > 1 || provider?.value !== "all");
  const showLanguage =
    language?.show !== false &&
    ((language?.options.length ?? 0) > 1 || language?.value !== "all");

  return (
    <div
      className={`flex flex-wrap items-center justify-end gap-2 ${className}`}
    >
      {showProvider && provider ? (
        <SelectControl
          value={provider.value}
          options={provider.options}
          onChange={provider.onChange}
          ariaLabel={`Filter models by provider: ${provider.label}`}
          title={`Provider: ${provider.label}`}
          selectedLabel={provider.label}
          active={provider.value !== "all"}
        >
          <SlidersHorizontal className="h-4 w-4 text-[var(--text)]" />
        </SelectControl>
      ) : null}

      {showLanguage && language ? (
        <SelectControl
          value={language.value}
          options={language.options}
          onChange={language.onChange}
          ariaLabel={`Filter models by language: ${language.label}`}
          title={`Language: ${language.label}`}
          selectedLabel={language.label}
          active={language.value !== "all"}
        >
          <Globe className="h-4 w-4 text-[var(--text)]" />
        </SelectControl>
      ) : null}

      <SelectControl
        value={sort.value}
        options={sort.options}
        onChange={(value) => sort.onChange(value as ModelSortMode)}
        ariaLabel={`Sort models: ${sort.label}`}
        title={`Sort: ${sort.label}`}
        selectedLabel={sort.label}
        active={sort.value !== "best_match"}
      >
        <ArrowUpDown className="h-4 w-4 text-[var(--text)]" />
      </SelectControl>
    </div>
  );
};

export default ModelListControls;
