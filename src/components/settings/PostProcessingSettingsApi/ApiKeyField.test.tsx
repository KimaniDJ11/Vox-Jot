import React from "react";
import { createRoot } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
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
      Simulate.blur(input);
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
      input.value = "new-key";
      Simulate.change(input);
    });

    await act(async () => {
      Simulate.blur(input);
    });

    expect(onBlur).toHaveBeenCalledWith("new-key");

    await act(async () => {
      root.unmount();
    });
  });
});
