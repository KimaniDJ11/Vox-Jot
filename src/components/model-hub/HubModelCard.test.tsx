import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";

import HubModelCard from "./HubModelCard";

describe("HubModelCard", () => {
  const render = async (node: React.ReactNode) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;

    await act(async () => {
      root = createRoot(container);
      root.render(node);
    });

    return {
      container,
      async cleanup() {
        await act(async () => {
          root?.unmount();
        });
        container.remove();
      },
    };
  };

  it("uses the fixed footer row for download progress", async () => {
    const onCancel = vi.fn();
    const view = await render(
      <HubModelCard
        title="Test model"
        description="A local model"
        footerMetaItems={["Original footer"]}
        trailing={{
          kind: "acquire",
          label: "Download model",
        }}
        downloadState={{
          label: "Downloading 42%",
          detail: "weights.gguf",
          progress: 42,
          onCancel,
          cancelLabel: "Cancel test model download",
        }}
      />,
    );

    const progress = view.container.querySelector('[role="progressbar"]');
    expect(progress).not.toBeNull();
    expect(progress?.getAttribute("aria-valuenow")).toBe("42");
    expect(view.container.textContent).toContain("Downloading 42%");
    expect(view.container.textContent).toContain("weights.gguf");
    expect(view.container.textContent).not.toContain("Original footer");

    const cancel = view.container.querySelector(
      'button[aria-label="Cancel test model download"]',
    ) as HTMLButtonElement | null;
    expect(cancel).not.toBeNull();
    await act(async () => {
      cancel?.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    await view.cleanup();
  });

  it("omits aria-valuenow for indeterminate progress", async () => {
    const view = await render(
      <HubModelCard
        title="Preparing model"
        downloadState={{
          label: "Preparing download...",
          indeterminate: true,
        }}
      />,
    );

    const progress = view.container.querySelector('[role="progressbar"]');
    expect(progress).not.toBeNull();
    expect(progress?.hasAttribute("aria-valuenow")).toBe(false);

    await view.cleanup();
  });
});
