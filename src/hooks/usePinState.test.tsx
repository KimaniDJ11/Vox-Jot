// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PinState } from "@/bindings";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), getPinState: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: { getPinState: mocks.getPinState } }));
vi.mock("@/lib/tauriEvents", () => ({ listen: mocks.listen }));
vi.mock("@/lib/distribution", () => ({ isMacAppStoreBuild: false }));
import { usePinState } from "./usePinState";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Harness() {
  const state = usePinState();
  return <span>{state?.revision ?? "loading"}</span>;
}
function snapshot(revision: number): PinState {
  return { available: true, revision, target: null, bound: false, error: null };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("keeps a newer event when the initial snapshot arrives late", async () => {
  let event!: (event: { payload: PinState }) => void;
  let resolve!: (state: PinState) => void;
  mocks.listen.mockImplementation(async (_name, callback) => {
    event = callback;
    return vi.fn();
  });
  mocks.getPinState.mockReturnValue(
    new Promise<PinState>((done) => {
      resolve = done;
    }),
  );
  await act(async () => root.render(<Harness />));
  await act(async () => event({ payload: snapshot(3) }));
  await act(async () => resolve(snapshot(1)));
  expect(container.textContent).toBe("3");
  await act(async () => event({ payload: snapshot(2) }));
  expect(container.textContent).toBe("3");
});
it("removes a listener that finishes registering after unmount", async () => {
  let registered!: (unsubscribe: () => void) => void;
  const unsubscribe = vi.fn();
  mocks.listen.mockReturnValue(
    new Promise((done) => {
      registered = done;
    }),
  );
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(null));
  await act(async () => registered(unsubscribe));
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(mocks.getPinState).not.toHaveBeenCalled();
});
