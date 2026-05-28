import React, {
  useCallback,
  useEffect,
  useId,
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

import { useSettingAccessibilityContext } from "./settingAccessibilityContext";

export interface DropdownOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
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
  ariaLabel?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  className = "",
  placeholder,
  disabled = false,
  onRefresh,
  ariaLabel,
}) => {
  const { t } = useTranslation();
  const settingAccessibility = useSettingAccessibilityContext();
  const triggerId = useId();
  const listboxId = useId();
  const resolvedAriaLabel =
    ariaLabel ??
    settingAccessibility.label ??
    t("ui.dropdown.ariaLabel", {
      defaultValue: "Select an option",
    });
  const resolvedPlaceholder =
    placeholder ??
    t("ui.dropdown.placeholder", { defaultValue: "Select an option..." });
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
  const triggerAccessibleName = selectedOption?.label
    ? `${resolvedAriaLabel}: ${selectedOption.label}`
    : resolvedAriaLabel;
  const selectedIndex = options.findIndex(
    (option) => option.value === selectedValue && !option.disabled,
  );
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);
  const reverseEnabledIndex = [...options]
    .reverse()
    .findIndex((option) => !option.disabled);
  const lastEnabledIndex =
    reverseEnabledIndex >= 0 ? options.length - 1 - reverseEnabledIndex : -1;

  const getNextEnabledIndex = (fromIndex: number, direction: 1 | -1) => {
    if (options.length === 0 || firstEnabledIndex < 0) {
      return 0;
    }

    let nextIndex = fromIndex;
    for (let i = 0; i < options.length; i += 1) {
      nextIndex = (nextIndex + direction + options.length) % options.length;
      if (!options[nextIndex]?.disabled) {
        return nextIndex;
      }
    }

    return firstEnabledIndex;
  };

  const handleSelect = (value: string) => {
    onSelect(value);
    setIsOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const openDropdown = (
    initialIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex,
  ) => {
    if (disabled) return;
    if (onRefresh) onRefresh();
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setActiveIndex(Math.max(0, initialIndex));
    setIsOpen(true);
  };

  const handleToggle = () => {
    if (disabled) return;
    if (isOpen) {
      setIsOpen(false);
      setMenuRect(null);
      return;
    }
    openDropdown();
  };

  useEffect(() => {
    if (!isOpen || options.length === 0) return;
    const frame = requestAnimationFrame(() => {
      optionRefs.current[activeIndex]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, isOpen, options.length]);

  const handleTriggerKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (
    event,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openDropdown(firstEnabledIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openDropdown(
        lastEnabledIndex >= 0 ? lastEnabledIndex : firstEnabledIndex,
      );
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setMenuRect(null);
    }
  };

  const handleMenuKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setMenuRect(null);
      requestAnimationFrame(() => buttonRef.current?.focus());
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => getNextEnabledIndex(index, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => getNextEnabledIndex(index, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex >= 0 ? firstEnabledIndex : 0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(lastEnabledIndex >= 0 ? lastEnabledIndex : 0);
    }
  };

  const menuPanel =
    isOpen && !disabled && menuRect ? (
      <div
        ref={menuRef}
        className="fixed z-[200] max-h-[min(15rem,70vh)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-lg)]"
        role="listbox"
        id={listboxId}
        aria-labelledby={triggerId}
        onKeyDown={handleMenuKeyDown}
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
          options.map((option, index) => (
            <button
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              aria-selected={selectedValue === option.value}
              tabIndex={index === activeIndex ? 0 : -1}
              className={`w-full px-3 py-2.5 text-start text-[14px] transition-colors duration-150 ${interactiveFocusRingClass} ${minTapTargetHeightClass} ${
                selectedValue === option.value
                  ? "bg-[var(--accent-soft)] font-semibold !text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent),transparent_86%)]"
                  : "text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--accent),transparent_92%)]"
              } ${option.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              onClick={() => handleSelect(option.value)}
              disabled={option.disabled}
            >
              <span className="flex min-w-0 items-center gap-2">
                {option.icon}
                <span className="truncate">{option.label}</span>
              </span>
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
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        id={triggerId}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={triggerAccessibleName}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selectedOption?.icon}
          <span className="truncate">
            {selectedOption?.label || resolvedPlaceholder}
          </span>
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
