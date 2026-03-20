import React, { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";

import UpdateChecker from "../update-checker";

const Footer: React.FC = () => {
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
        setVersion("1.0.0");
      }
    };

    fetchVersion();
  }, []);

  return (
    <div className="flex items-center justify-end gap-1 px-3 py-1.5 text-xs text-[var(--muted)]">
      <UpdateChecker />
      <span>·</span>
      {/* eslint-disable-next-line i18next/no-literal-string */}
      <span>v{version}</span>
    </div>
  );
};

export default Footer;
