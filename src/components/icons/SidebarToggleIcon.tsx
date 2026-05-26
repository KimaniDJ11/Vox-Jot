import React from "react";

interface SidebarToggleIconProps extends React.SVGProps<SVGSVGElement> {
  collapsed: boolean;
}

const SidebarToggleIcon: React.FC<SidebarToggleIconProps> = ({
  collapsed,
  ...props
}) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4.75 5.75A2.75 2.75 0 0 1 7.5 3h9A2.75 2.75 0 0 1 19.25 5.75v12.5A2.75 2.75 0 0 1 16.5 21h-9a2.75 2.75 0 0 1-2.75-2.75z" />
      <path d="M9.25 3v18" />
      <path d="M12.75 8h3.25" opacity={0.5} />
      <path d="M12.75 12h4.25" opacity={0.5} />
      <path d="M12.75 16h2.75" opacity={0.5} />
      {collapsed && <path d="M18.75 4.25 5.25 19.75" />}
    </svg>
  );
};

export default SidebarToggleIcon;
