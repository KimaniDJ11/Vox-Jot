import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";

/**
 * True when the Tauri window is in native fullscreen (macOS).
 * Used to drop the traffic-light shim so title bar controls align with the sidebar.
 */
export function useMacosWindowFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (platform() !== "macos") return;

    let unlistenResize: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    const sync = async () => {
      try {
        setFullscreen(await getCurrentWindow().isFullscreen());
      } catch {
        /* ignore */
      }
    };

    void sync();

    void (async () => {
      try {
        const win = getCurrentWindow();
        unlistenResize = await win.onResized(() => void sync());
        unlistenFocus = await win.onFocusChanged(() => void sync());
      } catch {
        /* ignore */
      }
    })();

    return () => {
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, []);

  return fullscreen;
}
