import type { WatchFolderOutputFormat } from "@/bindings";
import React, {
  useRef,
  useId,
  useState,
  useMemo,
  useCallback,
  useLayoutEffect,
  useEffect,
} from "react";
import { Captions, FileText, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";

const watchFolderFormatTone = (format?: WatchFolderOutputFormat): string => {
  switch (format) {
    case "srt":
      return "text-[var(--accent)] bg-[var(--accent-soft)]";
    case "vtt":
      return "text-[var(--info)] bg-[color-mix(in_srgb,var(--info),transparent_88%)]";
    case "text":
    default:
      return "text-[var(--muted)] bg-[var(--input)]";
  }
};

const WatchFolderFormatIcon: React.FC<{
  format?: WatchFolderOutputFormat;
  size?: number;
}> = ({ format, size = 18 }) => {
  if (format === "srt" || format === "vtt") {
    return <Captions size={size} aria-hidden="true" />;
  }
  return <FileText size={size} aria-hidden="true" />;
};

export const WatchFolderFormatPicker: React.FC<{
  value?: WatchFolderOutputFormat;
  onChange: (format: WatchFolderOutputFormat) => void;
}> = ({ value = "text", onChange }) => {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerId = useId();
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [popupRect, setPopupRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const options: Array<{
    value: WatchFolderOutputFormat;
    label: string;
  }> = useMemo(
    () => [
      {
        value: "text",
        label: t("dictate.watchFolders.formatText", {
          defaultValue: "Text",
        }),
      },
      {
        value: "srt",
        label: t("dictate.watchFolders.formatSrt", {
          defaultValue: "SRT",
        }),
      },
      {
        value: "vtt",
        label: t("dictate.watchFolders.formatVtt", {
          defaultValue: "VTT",
        }),
      },
    ],
    [t],
  );

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex] ?? options[0];
  const ariaLabel = t("dictate.watchFolders.formatAria", {
    defaultValue: "Output format",
  });
  const triggerLabel = `${ariaLabel}: ${selectedOption.label}`;

  const updatePopupRect = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPopupRect({
      top: rect.bottom + 6,
      left: rect.left,
      width: 144,
    });
  }, []);

  const openPopup = useCallback(() => {
    updatePopupRect();
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  }, [selectedIndex, updatePopupRect]);

  const closePopup = useCallback(() => {
    setIsOpen(false);
    setPopupRect(null);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePopupRect();
    const handleLayoutChange = () => updatePopupRect();
    window.addEventListener("resize", handleLayoutChange);
    document.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      document.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [isOpen, updatePopupRect]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      closePopup();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [closePopup, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      optionRefs.current[activeIndex]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, isOpen]);

  const selectFormat = (nextValue: WatchFolderOutputFormat) => {
    onChange(nextValue);
    closePopup();
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const handleTriggerKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (
    event,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openPopup();
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closePopup();
    }
  };

  const handleMenuKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    event,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePopup();
      requestAnimationFrame(() => buttonRef.current?.focus());
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectFormat(options[activeIndex]?.value ?? value);
    }
  };

  const popup =
    isOpen && popupRect ? (
      <div
        ref={popupRef}
        id={listboxId}
        role="listbox"
        aria-labelledby={triggerId}
        className="fixed z-[200] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-[var(--shadow-lg)]"
        style={{
          top: popupRect.top,
          left: popupRect.left,
          width: popupRect.width,
        }}
        onKeyDown={handleMenuKeyDown}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={index === activeIndex ? 0 : -1}
              className={[
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
                selected
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--text)] hover:bg-[var(--input)]",
              ].join(" ")}
              onClick={() => selectFormat(option.value)}
            >
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  watchFolderFormatTone(option.value),
                ].join(" ")}
                aria-hidden="true"
              >
                <WatchFolderFormatIcon format={option.value} size={16} />
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={triggerId}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={triggerLabel}
        title={triggerLabel}
        className={[
          "inline-flex h-9 min-w-12 items-center justify-center gap-1 rounded-full border border-[var(--border)] px-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]",
          "hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]",
          watchFolderFormatTone(value),
        ].join(" ")}
        onClick={() => {
          if (isOpen) closePopup();
          else openPopup();
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <WatchFolderFormatIcon format={value} />
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={
            isOpen ? "rotate-180 transition-transform" : "transition-transform"
          }
        />
      </button>
      {typeof document !== "undefined" && popup
        ? createPortal(popup, document.body)
        : null}
    </>
  );
};
