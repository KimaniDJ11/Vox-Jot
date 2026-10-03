import { useEffect, useState } from "react";
import { commands, type PinState } from "@/bindings";
import { listen } from "@/lib/tauriEvents";
import { isMacAppStoreBuild } from "@/lib/distribution";

export function usePinState() {
  const [state, setState] = useState<PinState | null>(null);
  useEffect(() => {
    if (isMacAppStoreBuild) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const accept = (next: PinState) => {
      if (!disposed)
        setState((current) =>
          !current || next.revision >= current.revision ? next : current,
        );
    };
    // Register before querying, so a pin cannot disappear in the startup race.
    void listen<PinState>("pin-state-changed", ({ payload }) => accept(payload))
      .then(async (unsubscribe) => {
        if (disposed) {
          unsubscribe();
          return;
        }
        unlisten = unsubscribe;
        accept(await commands.getPinState());
      })
      .catch((error) => {
        if (!disposed)
          console.error("Unable to load pinned destination:", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return state;
}
