// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DeliveryRecord } from "@/bindings";
const mocks = vi.hoisted(() => ({
  retryDelivery: vi.fn(),
  deliverViaPaste: vi.fn(),
  copyPinnedDelivery: vi.fn(),
}));
vi.mock("@/bindings", () => ({ commands: mocks }));
vi.mock("@/hooks/usePinState", () => ({
  usePinState: () => ({ available: true }),
}));
vi.mock("@/hooks/useTauriEvent", () => ({ useTauriEvent: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { PinnedDeliveryCard } from "./PinnedDelivery";
const record: DeliveryRecord = {
  id: "delivery",
  source: "history",
  source_id: "1",
  text: "saved result",
  state: "deferred",
  reason: null,
  message: null,
  confirmed_utf16: 0,
  may_have_written: false,
  updated_at: 1,
  target: {
    id: "pin",
    generation: 1,
    pid: 1,
    bundle_id: "test",
    app_name: "Test",
    pinned_at: 1,
    locator: {
      role: "AXTextArea",
      subrole: null,
      identifier: null,
      label: "Text",
      document: null,
      window_title: null,
    },
  },
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
function button(key: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === key,
  );
}
it("offers Copy without retry for uncertain or partial writes", async () => {
  for (const state of ["uncertain", "partial"] as const) {
    await act(async () =>
      root.render(
        <PinnedDeliveryCard
          record={{ ...record, state, may_have_written: true }}
        />,
      ),
    );
    expect(button("pinnedTarget.copy")).toBeTruthy();
    expect(button("pinnedTarget.retry")).toBeUndefined();
    expect(button("pinnedTarget.paste")).toBeUndefined();
  }
});
it("prevents duplicate clicks while an insertion is pending", async () => {
  mocks.retryDelivery.mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(<PinnedDeliveryCard record={record} />));
  const retry = button("pinnedTarget.retry")!;
  const paste = button("pinnedTarget.paste")!;
  await act(async () => {
    retry.click();
    retry.click();
    paste.click();
  });
  expect(mocks.retryDelivery).toHaveBeenCalledOnce();
  expect(mocks.deliverViaPaste).not.toHaveBeenCalled();
  expect(paste.disabled).toBe(true);
});
it("does not offer insertion until saving succeeded", async () => {
  await act(async () =>
    root.render(<PinnedDeliveryCard record={record} persisted={false} />),
  );
  expect(button("pinnedTarget.copy")).toBeTruthy();
  expect(button("pinnedTarget.retry")).toBeUndefined();
});
