import type { SettingsSnapshot } from "@/bindings";
import { listen } from "@/lib/tauriEvents";

/** The backend broadcasts every committed settings snapshot on this event. */
export const SETTINGS_SNAPSHOT_EVENT = "settings-snapshot";

export function subscribeSettingsSnapshots(
  onSnapshot: (snapshot: SettingsSnapshot) => void,
): () => void {
  let disposed = false;
  let revision = -1;
  const unlisten = listen<SettingsSnapshot>(
    SETTINGS_SNAPSHOT_EVENT,
    (event) => {
      if (!disposed && event.payload.revision > revision) {
        revision = event.payload.revision;
        onSnapshot(event.payload);
      }
    },
  );

  return () => {
    if (disposed) return;
    disposed = true;
    void unlisten.then((stop) => stop());
  };
}
