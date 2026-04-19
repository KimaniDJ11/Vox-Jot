import React from "react";
import { TitleBarModels, TitleBarStats } from "../title-bar";

/** Mobile layout: stats + models (desktop shows these in the sidebar). */
const Footer: React.FC = () => {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-3 py-1.5 text-xs text-[var(--muted)]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <TitleBarStats />
        <TitleBarModels />
      </div>
    </div>
  );
};

export default Footer;
