import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  showDetailView: vi.fn(),
}));

const translationMock = vi.hoisted(() => ({
  t: (_key: string, options?: { defaultValue?: string }) =>
    options?.defaultValue ?? _key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: translationMock.t,
  }),
}));

vi.mock("@/bindings", () => ({
  commands: {
    showDetailView: commandMocks.showDetailView,
  },
}));

import SidebarModelLaunchers from "@/components/sidebar/SidebarModelLaunchers";

describe("SidebarModelLaunchers", () => {
  beforeEach(() => {
    commandMocks.showDetailView.mockResolvedValue({ status: "ok" });
  });

  it("renders a single Model Hub launcher button", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SidebarModelLaunchers />);
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(container.textContent).toContain("Model Hub");
    expect(container.querySelectorAll("button")).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("opens the model hub when clicked", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(<SidebarModelLaunchers />);
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
    });

    expect(commandMocks.showDetailView).toHaveBeenCalledWith("model-hub");

    await act(async () => {
      root.unmount();
    });
  });
});
