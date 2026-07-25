// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

import { useTauriEvent } from "@/hooks/useTauriEvent";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const Harness: React.FC<{ onEvent: (value: string) => void }> = ({
  onEvent,
}) => {
  useTauriEvent<string>("audit-event", (event) => onEvent(event.payload));
  return null;
};

describe("useTauriEvent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    eventMocks.listen.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("unlistens when registration resolves after unmount", async () => {
    const registration = deferred<() => void>();
    const unlisten = vi.fn();
    eventMocks.listen.mockReturnValue(registration.promise);

    await act(async () => {
      root.render(<Harness onEvent={vi.fn()} />);
    });
    await act(async () => {
      root.unmount();
    });
    await act(async () => {
      registration.resolve(unlisten);
      await registration.promise;
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it("subscribes once and forwards events to the latest handler", async () => {
    let callback: ((event: { payload: string }) => void) | undefined;
    const unlisten = vi.fn();
    eventMocks.listen.mockImplementation(
      async (_eventName: string, nextCallback: typeof callback) => {
        callback = nextCallback;
        return unlisten;
      },
    );
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    await act(async () => {
      root.render(<Harness onEvent={firstHandler} />);
    });
    await act(async () => {
      root.render(<Harness onEvent={secondHandler} />);
    });
    await act(async () => {
      callback?.({ payload: "latest" });
    });

    expect(eventMocks.listen).toHaveBeenCalledTimes(1);
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledWith("latest");

    await act(async () => {
      root.unmount();
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
    container.remove();
  });
});
