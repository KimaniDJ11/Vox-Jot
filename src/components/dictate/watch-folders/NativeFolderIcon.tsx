import React, { useState, useEffect } from "react";
import { commands } from "@/bindings";
import { AlertCircle, Folder } from "lucide-react";

const FOLDER_ICON_CACHE = new Map<string, string | null>();

export const NativeFolderIcon: React.FC<{
  path: string;
  name: string;
  missing?: boolean;
}> = ({ path, name, missing = false }) => {
  const [icon, setIcon] = useState<string | null>(() => {
    return FOLDER_ICON_CACHE.has(path) ? FOLDER_ICON_CACHE.get(path)! : null;
  });

  useEffect(() => {
    let cancelled = false;
    if (FOLDER_ICON_CACHE.has(path)) {
      setIcon(FOLDER_ICON_CACHE.get(path)!);
      return;
    }

    void commands
      .getFileIcon(path)
      .then((result) => {
        const dataUrl = result.status === "ok" ? result.data : null;
        FOLDER_ICON_CACHE.set(path, dataUrl);
        if (!cancelled) setIcon(dataUrl);
      })
      .catch(() => {
        FOLDER_ICON_CACHE.set(path, null);
        if (!cancelled) setIcon(null);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (missing) {
    return (
      <span
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--danger),transparent_90%)] text-[var(--danger)]"
        aria-hidden="true"
        title={name}
      >
        <AlertCircle className="h-6 w-6" />
      </span>
    );
  }

  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        width={44}
        height={44}
        className="inline-block h-11 w-11 shrink-0 rounded-md"
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  return (
    <span
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_14%,var(--card))] text-[var(--accent)]"
      aria-hidden="true"
      title={name}
    >
      <Folder className="h-6 w-6" />
    </span>
  );
};
