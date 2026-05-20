import React from "react";
import { createRoot } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ModelDropdown from "./ModelDropdown";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../ui/ProviderIcon", () => ({
  ProviderIcon: () => <span data-testid="provider-icon" />,
  engineTypeToProviderId: () => "whisper",
  resolveModelProviderId: () => "whisper",
}));

vi.mock("../../lib/utils/modelTranslation", () => ({
  getTranslatedModelName: (model: { name: string }) => model.name,
  getTranslatedModelDescription: (model: { description: string }) =>
    model.description,
}));

const models = [
  {
    id: "small",
    name: "Small",
    description: "Small model",
    is_downloaded: true,
    is_downloading: false,
    is_custom: false,
    engine_type: "whisper",
  },
  {
    id: "large",
    name: "Large",
    description: "Large model",
    is_downloaded: true,
    is_downloading: false,
    is_custom: false,
    engine_type: "whisper",
  },
] as never;

describe("ModelDropdown", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("visually marks the keyboard-active option separately from the selected model", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ModelDropdown
          id="model-list"
          labelledBy="model-button"
          models={models}
          currentModelId="small"
          activeIndex={1}
          onActiveIndexChange={vi.fn()}
          onClose={vi.fn()}
          onModelSelect={vi.fn()}
          returnFocusToTrigger={vi.fn()}
        />,
      );
    });

    const selected = container.querySelector("#model-list-option-small");
    const keyboardActive = container.querySelector("#model-list-option-large");

    expect(selected?.className).toContain("bg-[var(--accent)]");
    expect(keyboardActive?.className).toContain("bg-[var(--input)]");

    await act(async () => {
      root.unmount();
    });
  });

  it("closes on Tab blur without pulling focus back to the trigger", async () => {
    const onClose = vi.fn();
    const returnFocusToTrigger = vi.fn();
    const container = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(container, outside);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ModelDropdown
          id="model-list"
          labelledBy="model-button"
          models={models}
          currentModelId="small"
          activeIndex={0}
          onActiveIndexChange={vi.fn()}
          onClose={onClose}
          onModelSelect={vi.fn()}
          returnFocusToTrigger={returnFocusToTrigger}
        />,
      );
    });

    const listbox = container.querySelector(
      '[role="listbox"]',
    ) as HTMLDivElement;

    await act(async () => {
      Simulate.blur(listbox, { relatedTarget: outside });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(returnFocusToTrigger).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
    outside.remove();
  });
});
