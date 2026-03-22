import React from "react";

type ModelStatus =
  | "ready"
  | "loading"
  | "downloading"
  | "extracting"
  | "error"
  | "unloaded"
  | "none";

interface ModelStatusButtonProps {
  status: ModelStatus;
  displayText: string;
  isDropdownOpen: boolean;
  onClick: () => void;
  className?: string;
  /** Overrides default `font-semibold` on the label (e.g. title bar `font-bold`). */
  labelClassName?: string;
  /** Larger hit targets and glyphs for the window title bar. */
  density?: "default" | "titleBar";
}

const ModelStatusButton: React.FC<ModelStatusButtonProps> = ({
  status,
  displayText,
  isDropdownOpen,
  onClick,
  className = "",
  labelClassName,
  density = "default",
}) => {
  const getStatusColor = (status: ModelStatus): string => {
    switch (status) {
      case "ready":
        return "bg-[var(--success)]";
      case "loading":
        return "bg-[var(--warning)] animate-pulse";
      case "downloading":
        return "bg-[var(--accent)] animate-pulse";
      case "extracting":
        return "bg-[var(--voice)] animate-pulse";
      case "error":
        return "bg-[var(--danger)]";
      case "unloaded":
        return "bg-[var(--muted)]/60";
      case "none":
        return "bg-[var(--danger)]";
      default:
        return "bg-[var(--muted)]/60";
    }
  };

  const isTitleBar = density === "titleBar";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center hover:text-[var(--text)] transition-colors ${
        isTitleBar ? "gap-2.5" : "gap-2"
      } ${className}`}
      title={`Model status: ${displayText}`}
    >
      <div
        className={`rounded-full shrink-0 ${getStatusColor(status)} ${
          isTitleBar ? "h-2.5 w-2.5" : "h-2 w-2"
        }`}
      />
      <span
        className={`truncate ${isTitleBar ? "max-w-[11rem]" : "max-w-28"} ${
          labelClassName ?? "font-semibold"
        }`}
      >
        {displayText}
      </span>
      <svg
        className={`shrink-0 transition-transform ${isTitleBar ? "h-4 w-4" : "h-3 w-3"} ${isDropdownOpen ? "rotate-180" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={isTitleBar ? 2.25 : 2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>
  );
};

export default ModelStatusButton;
