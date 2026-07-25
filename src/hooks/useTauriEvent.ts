import { useEffect, useLayoutEffect, useRef } from "react";
import {
  listen,
  type Event as TauriEvent,
  type UnlistenFn,
} from "@tauri-apps/api/event";

/**
 * Subscribe once while always invoking the latest committed handler.
 * Tauri registers listeners asynchronously, so an unmount that wins the race
 * immediately disposes the late listener instead of leaking it.
 */
export function useTauriEvent<T>(
  eventName: string,
  handler: (event: TauriEvent<T>) => void,
) {
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void listen<T>(eventName, (event) => handlerRef.current(event))
      .then((registeredUnlisten) => {
        if (disposed) {
          registeredUnlisten();
        } else {
          unlisten = registeredUnlisten;
        }
      })
      .catch((error) => {
        if (!disposed) {
          console.error(
            `Failed to listen for Tauri event '${eventName}':`,
            error,
          );
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [eventName]);
}
