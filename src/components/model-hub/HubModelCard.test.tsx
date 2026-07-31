import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const { openUrlMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

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
          cancelConfirmLabel: "Stop this download?",
          cancelConfirmDetail: "The current transfer will stop.",
          cancelKeepLabel: "Keep downloading",
          cancelConfirmActionLabel: "Stop download",
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
    const cancelAgain = view.container.querySelector(
      'button[aria-label="Cancel test model download"]',
    ) as HTMLButtonElement | null;
    expect(cancelAgain).not.toBeNull();
    await act(async () => {
      cancelAgain?.click();
    });
    expect(onCancel).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Stop this download?");
    expect(view.container.textContent).toContain(
      "The current transfer will stop.",
    );

    const keep = view.container.querySelector(
      'button[aria-label="Keep downloading"]',
    ) as HTMLButtonElement | null;
    expect(keep).not.toBeNull();
    await act(async () => {
      keep?.click();
    });
    expect(view.container.textContent).not.toContain("Stop this download?");

    const cancelAfterKeep = view.container.querySelector(
      'button[aria-label="Cancel test model download"]',
    ) as HTMLButtonElement | null;
    expect(cancelAfterKeep).not.toBeNull();
    await act(async () => {
      cancelAfterKeep?.click();
    });
    const confirmCancel = view.container.querySelector(
      'button[aria-label="Stop download"]',
    ) as HTMLButtonElement | null;
    expect(confirmCancel).not.toBeNull();
    await act(async () => {
      confirmCancel?.click();
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

  it("shows retry and dismiss controls on failed downloads", async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const view = await render(
      <HubModelCard
        title="Failed model"
        downloadState={{
          label: "Download failed",
          error: "Stream failed for model.safetensors",
          onRetry,
          onDismiss,
          retryLabel: "Try again",
          dismissLabel: "Dismiss",
        }}
      />,
    );

    expect(view.container.textContent).toContain(
      "Stream failed for model.safetensors",
    );
    const retry = view.container.querySelector(
      'button[aria-label="Try again"]',
    ) as HTMLButtonElement | null;
    const dismiss = view.container.querySelector(
      'button[aria-label="Dismiss"]',
    ) as HTMLButtonElement | null;
    expect(retry).not.toBeNull();
    expect(dismiss).not.toBeNull();
    await act(async () => {
      retry?.click();
      dismiss?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    await view.cleanup();
  });

  it("shows cancelled downloads as neutral with resume and dismiss", async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    const view = await render(
      <HubModelCard
        title="Cancelled model"
        downloadState={{
          label: "Download cancelled",
          detail: "Download stopped. Start it again from this card.",
          cancelled: true,
          onRetry,
          onDismiss,
          retryLabel: "Resume",
          dismissLabel: "Dismiss",
        }}
      />,
    );

    expect(view.container.textContent).toContain("Download cancelled");
    expect(view.container.textContent).toContain(
      "Download stopped. Start it again from this card.",
    );
    expect(view.container.textContent).not.toContain("Download failed");
    expect(view.container.querySelector('[role="progressbar"]')).toBeNull();
    const resume = view.container.querySelector(
      'button[aria-label="Resume"]',
    ) as HTMLButtonElement | null;
    const dismiss = view.container.querySelector(
      'button[aria-label="Dismiss"]',
    ) as HTMLButtonElement | null;
    expect(resume).not.toBeNull();
    expect(dismiss).not.toBeNull();
    await act(async () => {
      resume?.click();
      dismiss?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);

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
      '[aria-label="modelHub.actionConfirmation"]',
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
      view.container.querySelector(
        '[aria-label="modelHub.actionConfirmation"]',
      ),
    ).toBeNull();
    expect(view.container.textContent).toContain("Runtime");
    expect(view.container.textContent).toContain(routingControlsLabel);
    expect(
      view.container.querySelector('[data-testid="routing-controls"]'),
    ).not.toBeNull();

    await view.cleanup();
  });

  it("dedupes repeated metadata chips while preserving separate params and size chips", async () => {
    const view = await render(
      <HubModelCard
        title="Tesseract OCR"
        capabilityChips={[
          { id: "identity-params", label: "Params 1.5B" },
          { id: "capability-size", label: "1.5B" },
          { id: "identity-arch", label: "Arch Tesseract" },
          { id: "capability-backend", label: "Tesseract" },
          { id: "identity-format", label: "Format Tessdata" },
          { id: "capability-source", label: "Tessdata" },
        ]}
      />,
    );

    const text = view.container.textContent ?? "";
    expect(text).toContain("Params 1.5B");
    expect(text.match(/1\.5B/g)).toHaveLength(2);
    expect(text.match(/Tesseract/g)).toHaveLength(2);
    expect(text.match(/Tessdata/g)).toHaveLength(1);

    await view.cleanup();
  });

  it("opens footer metadata links through the Tauri opener", async () => {
    openUrlMock.mockResolvedValueOnce(undefined);
    const cardClick = vi.fn();
    const view = await render(
      <HubModelCard
        title="Linked model"
        footerMetaLinks={[
          {
            label: "Open model source",
            url: "https://huggingface.co/example/model",
          },
        ]}
        onClick={cardClick}
      />,
    );

    const linkButton = view.container.querySelector(
      'button[aria-label="Open model source"]',
    ) as HTMLButtonElement | null;
    expect(linkButton).not.toBeNull();

    await act(async () => {
      linkButton?.click();
    });

    expect(openUrlMock).toHaveBeenCalledWith(
      "https://huggingface.co/example/model",
    );
    expect(cardClick).not.toHaveBeenCalled();

    await view.cleanup();
  });

  it("does not expose a root button when footer controls are nested", async () => {
    openUrlMock.mockResolvedValueOnce(undefined);
    const cardClick = vi.fn();
    const acquireClick = vi.fn();
    const view = await render(
      <HubModelCard
        title="Chatterbox Turbo"
        footerMetaLinks={[
          {
            label: "Open Chatterbox Turbo source",
            url: "https://huggingface.co/ResembleAI/chatterbox-turbo",
          },
        ]}
        trailing={{
          kind: "acquire",
          label: "Download Chatterbox Turbo",
          onClick: acquireClick,
        }}
        onClick={cardClick}
      />,
    );

    const card = view.container.firstElementChild as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card?.getAttribute("role")).toBeNull();
    expect(card?.getAttribute("tabindex")).toBeNull();

    await act(async () => {
      card?.click();
    });
    expect(cardClick).toHaveBeenCalledTimes(1);

    const sourceButton = view.container.querySelector(
      'button[aria-label="Open Chatterbox Turbo source"]',
    ) as HTMLButtonElement | null;
    expect(sourceButton).not.toBeNull();
    await act(async () => {
      sourceButton?.click();
    });
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://huggingface.co/ResembleAI/chatterbox-turbo",
    );
    expect(cardClick).toHaveBeenCalledTimes(1);

    const downloadButton = view.container.querySelector(
      'button[aria-label="Download Chatterbox Turbo"]',
    ) as HTMLButtonElement | null;
    expect(downloadButton?.type).toBe("button");
    await act(async () => {
      downloadButton?.click();
    });
    expect(acquireClick).toHaveBeenCalledTimes(1);
    expect(cardClick).toHaveBeenCalledTimes(1);

    await view.cleanup();
  });

  it("keeps plain clickable cards keyboard accessible", async () => {
    const cardClick = vi.fn();
    const view = await render(
      <HubModelCard title="Plain model" onClick={cardClick} />,
    );

    const card = view.container.firstElementChild as HTMLElement | null;
    expect(card?.getAttribute("role")).toBe("button");
    expect(card?.getAttribute("tabindex")).toBe("0");

    await act(async () => {
      card?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(cardClick).toHaveBeenCalledTimes(1);

    await view.cleanup();
  });
});
