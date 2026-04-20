import React from "react";
import { TitleBarStats } from "../title-bar";
import SidebarModelLaunchers from "@/components/sidebar/SidebarModelLaunchers";

/** Mobile-only: stats strip + model launchers (desktop renders these in the sidebar). */
const Footer: React.FC = () => {
  return (
    <div className="flex flex-col gap-3 px-3 py-2.5 text-xs text-[var(--muted)]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <TitleBarStats />
      </div>
      <SidebarModelLaunchers />
    </div>
  );
};

export default Footer;
