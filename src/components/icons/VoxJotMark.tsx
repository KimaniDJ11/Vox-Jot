import React from "react";

type VoxJotMarkProps = {
  width?: number | string;
  height?: number | string;
  size?: number | string;
  className?: string;
  monochrome?: boolean;
  showBackground?: boolean;
  title?: string;
};

const BRAND_BLUE = "#0F55A8";
const BRAND_COPPER = "#D89A5C";
const BRAND_CREAM = "#F6EFE4";

const VoxJotMark = ({
  width,
  height,
  size,
  className,
  monochrome = false,
  showBackground = false,
  title,
}: VoxJotMarkProps) => {
  const resolvedWidth = width ?? size ?? 320;
  const resolvedHeight = height ?? size ?? resolvedWidth;
  const primary = monochrome ? "currentColor" : BRAND_BLUE;
  const accent = monochrome ? "currentColor" : BRAND_COPPER;
  const accessibleTitle = title ?? "Vox Jot";

  return (
    <svg
      width={resolvedWidth}
      height={resolvedHeight}
      viewBox="0 0 320 320"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={accessibleTitle}
    >
      {showBackground ? (
        <rect width="320" height="320" rx="72" fill={BRAND_CREAM} />
      ) : null}
      <path
        d="M89 78H215C247 78 273 104 273 136V164C273 196 247 222 215 222H100L48 253V136C48 104 73 78 89 78Z"
        stroke={primary}
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M91 114H214"
        stroke={primary}
        strokeWidth="18"
        strokeLinecap="round"
      />
      <path
        d="M80 145H214"
        stroke={primary}
        strokeWidth="18"
        strokeLinecap="round"
      />
      <path
        d="M101 177H183"
        stroke={primary}
        strokeWidth="18"
        strokeLinecap="round"
      />
      <circle cx="214" cy="177" r="12" fill={accent} />
    </svg>
  );
};

export default VoxJotMark;
