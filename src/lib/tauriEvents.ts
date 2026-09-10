import {
  listen as tauriListen,
  type Event,
  type EventCallback,
  type EventName,
  type Options,
  type UnlistenFn,
} from "@tauri-apps/api/event";

export type { Event, EventCallback, EventName, Options, UnlistenFn };

type MaybeAsyncUnlisten = () => unknown;

const reportLifecycleFailure = (
  operation: "listen" | "unlisten",
  eventName: EventName,
  error: unknown,
) => {
  console.warn(`Failed to ${operation} for Tauri event '${eventName}':`, error);
};

/**
 * Register a Tauri event listener without allowing webview teardown races to
 * become unhandled promise rejections.
 *
 * Tauri's public type declares `UnlistenFn` as synchronous, but its runtime
 * implementation returns a promise. During HMR or window teardown the
 * JavaScript listener registry can disappear before that promise runs. The
 * wrapped cleanup is therefore idempotent and consumes both synchronous and
 * asynchronous cleanup failures.
 */
export async function listen<T>(
  eventName: EventName,
  handler: EventCallback<T>,
  options?: Options,
): Promise<UnlistenFn> {
  let rawUnlisten: UnlistenFn;

  try {
    rawUnlisten = await tauriListen<T>(eventName, handler, options);
  } catch (error) {
    reportLifecycleFailure("listen", eventName, error);
    return () => {};
  }

  let disposed = false;

  return () => {
    if (disposed) return;
    disposed = true;

    try {
      const result = (rawUnlisten as MaybeAsyncUnlisten)();
      const catchHandler = (result as { catch?: unknown } | null)?.catch;
      if (typeof catchHandler === "function") {
        void (result as Promise<void>).catch((error) => {
          reportLifecycleFailure("unlisten", eventName, error);
        });
      }
    } catch (error) {
      reportLifecycleFailure("unlisten", eventName, error);
    }
  };
}
