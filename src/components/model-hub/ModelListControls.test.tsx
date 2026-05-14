import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";
import ModelListControls from "./ModelListControls";

describe("ModelListControls", () => {
  it("renders only meaningful provider and language controls plus sort", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ModelListControls
          provider={{
            value: "all",
            options: [{ value: "all", label: "Provider" }],
            onChange: vi.fn(),
            label: "Provider",
          }}
          language={{
            value: "all",
            options: [
              { value: "all", label: "Language" },
              { value: "en", label: "English" },
            ],
            onChange: vi.fn(),
            label: "Language",
          }}
          sort={{
            value: "best_match",
            options: [
              { value: "best_match", label: "Best Match" },
              { value: "alphabetical", label: "Alphabetical" },
            ],
            onChange: vi.fn(),
            label: "Best Match",
          }}
        />,
      );
    });

    expect(
      container.querySelector(
        '[aria-label="Filter models by provider: Provider"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[aria-label="Filter models by language: Language"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Sort models: Best Match"]'),
    ).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("emits sort changes", async () => {
    const onSortChange = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ModelListControls
          sort={{
            value: "best_match",
            options: [
              { value: "best_match", label: "Best Match" },
              { value: "alphabetical", label: "Alphabetical" },
            ],
            onChange: onSortChange,
            label: "Best Match",
          }}
        />,
      );
    });

    const select = container.querySelector(
      '[aria-label="Sort models: Best Match"]',
    ) as HTMLSelectElement;
    await act(async () => {
      select.value = "alphabetical";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSortChange).toHaveBeenCalledWith("alphabetical");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps a globally selected filter visible when it is not in local options", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ModelListControls
          provider={{
            value: "ollama",
            options: [{ value: "all", label: "Provider" }],
            onChange: vi.fn(),
            label: "Ollama",
            show: true,
          }}
          sort={{
            value: "alphabetical",
            options: [
              { value: "best_match", label: "Best Match" },
              { value: "alphabetical", label: "Alphabetical" },
            ],
            onChange: vi.fn(),
            label: "Alphabetical",
          }}
        />,
      );
    });

    const providerSelect = container.querySelector(
      '[aria-label="Filter models by provider: Ollama"]',
    ) as HTMLSelectElement;
    const sortSelect = container.querySelector(
      '[aria-label="Sort models: Alphabetical"]',
    ) as HTMLSelectElement;

    expect(providerSelect.value).toBe("ollama");
    expect(providerSelect.options[0]?.textContent).toBe("Ollama");
    expect(sortSelect.value).toBe("alphabetical");

    await act(async () => {
      root.unmount();
    });
  });
});
