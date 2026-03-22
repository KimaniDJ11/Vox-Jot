import React from "react";
import {
  TitleBarModels,
  TitleBarOllamaReady,
  TitleBarStats,
} from "../title-bar";

const Footer: React.FC = () => {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 px-3 py-1.5 text-xs text-[var(--muted)]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <TitleBarStats />
        <TitleBarModels />
        <TitleBarOllamaReady />
      </div>
    </div>
  );
};

export default Footer;
