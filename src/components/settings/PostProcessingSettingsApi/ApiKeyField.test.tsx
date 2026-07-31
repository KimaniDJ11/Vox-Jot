import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ApiKeyField } from "./ApiKeyField";

describe("ApiKeyField", () => {
  it("does not commit a blank saved key when the untouched field blurs", async () => {
    const onBlur = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ApiKeyField
          onBlur={onBlur}
          disabled={false}
          resetKey="provider-a"
          hasSavedValue
          placeholder="Saved key"
        />,
      );
    });

    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onBlur).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("commits after the user edits the field", async () => {
    const onBlur = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ApiKeyField
          onBlur={onBlur}
          disabled={false}
          resetKey="provider-a"
          hasSavedValue
        />,
      );
    });

    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "new-key");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onBlur).toHaveBeenCalledWith("new-key");

    await act(async () => {
      root.unmount();
    });
  });
});
