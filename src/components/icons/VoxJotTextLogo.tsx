/* eslint-disable i18next/no-literal-string */
import React from "react";

const VoxJotTextLogo = ({
  width,
  height,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) => {
  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox="0 0 360 88"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Vox Jot"
    >
      <g transform="translate(0 4) scale(0.26)">
        <path
          d="M89 78H215C247 78 273 104 273 136V164C273 196 247 222 215 222H100L48 253V136C48 104 73 78 89 78Z"
          stroke="#0F55A8"
          strokeWidth="18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M91 114H214"
          stroke="#0F55A8"
          strokeWidth="18"
          strokeLinecap="round"
        />
        <path
          d="M80 145H214"
          stroke="#0F55A8"
          strokeWidth="18"
          strokeLinecap="round"
        />
        <path
          d="M101 177H183"
          stroke="#0F55A8"
          strokeWidth="18"
          strokeLinecap="round"
        />
        <circle cx="214" cy="177" r="12" fill="#D89A5C" />
      </g>
      <text
        x="84"
        y="58"
        fill="#0F55A8"
        fontFamily="'Avenir Next', Avenir, 'SF Pro Display', system-ui, -apple-system, sans-serif"
        fontWeight="800"
        fontSize="42"
        letterSpacing="-2"
      >
        Vox Jot
      </text>
    </svg>
  );
};

export default VoxJotTextLogo;
