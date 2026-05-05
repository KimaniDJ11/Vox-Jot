import { useEffect, useRef } from "react";

interface RefreshOnWindowFocusOptions {
  minIntervalMs?: number;
}

export function useRefreshOnWindowFocus(
  refresh: () => void | Promise<void>,
  options: RefreshOnWindowFocusOptions = {},
): void {
  const { minIntervalMs = 1000 } = options;
  const refreshRef = useRef(refresh);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const now = Date.now();
      if (now - lastRefreshAtRef.current < minIntervalMs) {
        return;
      }

      lastRefreshAtRef.current = now;
      void refreshRef.current();
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [minIntervalMs]);
}
