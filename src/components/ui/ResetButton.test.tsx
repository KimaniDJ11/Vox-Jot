import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetButton } from "./ResetButton";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "common.cancel" ? "Cancel" : "Reset"),
  }),
}));

describe("reset confirmation", () => {
  let host: HTMLDivElement;
  let root: Root;
  const reset = vi.fn();
  const buttons = () => Array.from(host.querySelectorAll("button"));

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    reset.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<ResetButton onClick={reset} />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("requires a second action, with cancellation available", () => {
    act(() => buttons()[0].click());
    expect(reset).not.toHaveBeenCalled();
    expect(buttons().map((button) => button.textContent)).toEqual([
      "Reset",
      "Cancel",
    ]);
    act(() => buttons()[1].click());
    expect(reset).not.toHaveBeenCalled();
    expect(buttons()).toHaveLength(1);
    act(() => buttons()[0].click());
    act(() => buttons()[0].click());
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("cancels with Escape and returns focus to Reset", () => {
    act(() => buttons()[0].click());
    buttons()[1].focus();
    act(() =>
      buttons()[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(reset).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons()).toHaveLength(1);
  });

  it("cannot confirm once the action becomes disabled", () => {
    act(() => buttons()[0].click());
    act(() => root.render(<ResetButton onClick={reset} disabled />));
    act(() => buttons()[0].click());
    expect(reset).not.toHaveBeenCalled();
    act(() => buttons()[1].click());
    expect(buttons()).toHaveLength(1);
  });
});
