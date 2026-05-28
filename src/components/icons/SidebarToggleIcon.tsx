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
      <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h10a2.5 2.5 0 0 1 2.5 2.5v13A2.5 2.5 0 0 1 17 21H7a2.5 2.5 0 0 1-2.5-2.5z" />
      <path d="M9.5 3v18" />
      <path d="M13.25 8h3.5" opacity={0.72} />
      <path d="M13.25 12h4.25" opacity={0.72} />
      <path d="M13.25 16h3" opacity={0.72} />
      {collapsed ? (
        <path d="M19.25 4.75 4.75 19.25" strokeWidth={2.5} />
      ) : null}
    </svg>
  );
};

export default SidebarToggleIcon;
