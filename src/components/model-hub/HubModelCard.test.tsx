import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";

import HubModelCard from "./HubModelCard";

describe("HubModelCard", () => {
  const deleteTitle = "Delete downloaded weights?";
  const deleteDetail = "You can download this model again later.";
  const cancelLabel = "Cancel";
  const deleteLabel = "Delete";
  const routingControlsLabel = "Routing controls stay expanded.";

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

  it("renders interactive footerExtra in the fixed footer row", async () => {
    const view = await render(
      <HubModelCard
        title="Installed model"
        footerMetaItems={["Local"]}
        footerExtra={
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div>
              <div>
                <p>{deleteTitle}</p>
                <p>{deleteDetail}</p>
              </div>
              <div>
                <button type="button">{cancelLabel}</button>
                <button type="button">{deleteLabel}</button>
              </div>
            </div>
          </div>
        }
      />,
    );

    const inlineConfirmation = view.container.querySelector(
      '[aria-label="Model action confirmation"]',
    );
    expect(inlineConfirmation).not.toBeNull();
    expect(inlineConfirmation?.textContent).toContain(deleteTitle);
    expect(inlineConfirmation?.textContent).toContain(deleteDetail);
    expect(inlineConfirmation?.textContent).toContain(cancelLabel);
    expect(inlineConfirmation?.textContent).toContain(deleteLabel);
    expect(view.container.textContent).not.toContain("Local");

    await view.cleanup();
  });

  it("keeps non-interactive footerExtra below the core card", async () => {
    const view = await render(
      <HubModelCard
        title="Routed model"
        footerMetaItems={["Runtime"]}
        footerExtra={
          <div data-testid="routing-controls">
            <p>{routingControlsLabel}</p>
          </div>
        }
      />,
    );

    expect(
      view.container.querySelector('[aria-label="Model action confirmation"]'),
    ).toBeNull();
    expect(view.container.textContent).toContain("Runtime");
    expect(view.container.textContent).toContain(routingControlsLabel);
    expect(
      view.container.querySelector('[data-testid="routing-controls"]'),
    ).not.toBeNull();

    await view.cleanup();
  });
});
