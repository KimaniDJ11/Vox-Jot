import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@/bindings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      options?: { defaultValue?: string; modelName?: string },
    ) =>
      options?.defaultValue?.replace(
        "{{modelName}}",
        options.modelName ?? "",
      ) ?? "",
  }),
}));

import ModelCard from "./ModelCard";

const createModel = (overrides: Partial<ModelInfo> = {}): ModelInfo =>
  ({
    id: "small",
    name: "Small",
    description: "Small speech model",
    filename: "ggml-small.bin",
    url: "https://example.com/ggml-small.bin",
    sha256: null,
    size_mb: 466,
    is_downloaded: false,
    is_downloading: false,
    partial_size: 0,
    is_directory: false,
    engine_type: "Whisper",
    accuracy_score: 0.8,
    speed_score: 0.8,
    supports_translation: false,
    is_recommended: false,
    supported_languages: ["en"],
    is_custom: false,
    ...overrides,
  }) as ModelInfo;

async function render(node: React.ReactNode) {
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
}

describe("ModelCard", () => {
  it("uses the explicit icon as the only download trigger", async () => {
    const onDownload = vi.fn();
    const onSelect = vi.fn();
    const view = await render(
      <ModelCard
        model={createModel()}
        status="downloadable"
        onDownload={onDownload}
        onSelect={onSelect}
      />,
    );

    const card = view.container.firstElementChild as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card?.getAttribute("role")).toBeNull();

    await act(async () => {
      card?.click();
    });
    expect(onDownload).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();

    const downloadButton = view.container.querySelector(
      'button[aria-label="Download Small"]',
    ) as HTMLButtonElement | null;
    expect(downloadButton).not.toBeNull();

    await act(async () => {
      downloadButton?.click();
    });
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledWith("small");
    expect(onSelect).not.toHaveBeenCalled();

    await view.cleanup();
  });
});
