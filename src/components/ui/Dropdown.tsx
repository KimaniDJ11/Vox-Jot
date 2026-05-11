import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  interactiveFocusRingClass,
  minTapTargetHeightClass,
} from "@/lib/interactiveFocus";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DropdownProps {
  options: DropdownOption[];
  className?: string;
  selectedValue: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onRefresh?: () => void;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  className = "",
  placeholder,
  disabled = false,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder =
    placeholder ??
    t("ui.dropdown.placeholder", { defaultValue: "Select an option..." });
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const updateMenuRect = useCallback(() => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuRect(null);
      return;
    }
    updateMenuRect();
    const onScrollOrResize = () => updateMenuRect();
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [isOpen, updateMenuRect]);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const selectedOption = options.find(
    (option) => option.value === selectedValue,
  );

  const handleSelect = (value: string) => {
    onSelect(value);
    setIsOpen(false);
  };

  const handleToggle = () => {
    if (disabled) return;
    if (isOpen) {
      setIsOpen(false);
      setMenuRect(null);
      return;
    }
    if (onRefresh) onRefresh();
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setIsOpen(true);
  };

  const menuPanel =
    isOpen && !disabled && menuRect ? (
      <div
        ref={menuRef}
        className="fixed z-[200] max-h-[min(15rem,70vh)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-lg)]"
        role="listbox"
        style={{
          top: menuRect.top,
          left: menuRect.left,
          width: menuRect.width,
        }}
      >
        {options.length === 0 ? (
          <div className="px-3 py-2 text-[14px] text-[var(--muted)]">
            {t("common.noOptionsFound")}
          </div>
        ) : (
          options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selectedValue === option.value}
              className={`w-full px-3 py-2.5 text-start text-[14px] transition-colors duration-150 ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${
                selectedValue === option.value
                  ? "bg-[var(--accent-soft)] font-semibold !text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent),transparent_86%)]"
                  : "text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--accent),transparent_92%)]"
              } ${option.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              onClick={() => handleSelect(option.value)}
              disabled={option.disabled}
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))
        )}
      </div>
    ) : null;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`flex min-w-[220px] items-center justify-between rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 text-start text-base font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] transition-all duration-150 ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "hover:bg-[color-mix(in_srgb,var(--accent),transparent_92%)] cursor-pointer hover:border-[var(--accent)]"
        }`}
        onClick={handleToggle}
        disabled={disabled}
      >
        <span className="truncate">
          {selectedOption?.label || resolvedPlaceholder}
        </span>
        <svg
          className={`w-4 h-4 ms-2 transition-transform duration-200 ${isOpen ? "transform rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {typeof document !== "undefined" && menuPanel
        ? createPortal(menuPanel, document.body)
        : null}
    </div>
  );
};
