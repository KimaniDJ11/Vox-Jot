import React from "react";

interface SidebarToggleIconProps extends React.SVGProps<SVGSVGElement> {
  collapsed: boolean;
}

const SidebarToggleIcon: React.FC<SidebarToggleIconProps> = ({
  collapsed,
  className = "",
  ...props
}) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`sidebar-toggle-icon ${className}`}
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <line
        x1="9"
        y1="3"
        x2="9"
        y2="21"
        style={{
          transform: collapsed ? "translateX(-3px)" : "translateX(0px)",
          opacity: collapsed ? 0.4 : 1,
          transition:
            "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease",
        }}
      />
    </svg>
  );
};

export default SidebarToggleIcon;
