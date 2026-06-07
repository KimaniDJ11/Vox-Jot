import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SoundDesignPanel } from "./SoundDesignPanel";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("@/components/model-hub/modelHubTabs", () => ({
  openModelHub: vi.fn(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const render = async (node: React.ReactNode) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });
  await act(async () => {
    await Promise.resolve();
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

describe("SoundDesignPanel", () => {
  it("does not present a downloadable creative audio model as selected", async () => {
    invokeMock.mockResolvedValueOnce({
      install_root: "/tmp/vox-jot/creative-audio",
      models: [
        {
          id: "stable-audio-3-small-sfx",
          label: "Stable Audio 3 Small SFX",
          provider: "Stability AI",
          provider_id: "stability_ai",
          status_label: "Download required",
          installed: false,
          runnable: false,
          selected: false,
          active: false,
          downloadable: true,
          modes: ["sfx", "ambience"],
        },
      ],
    });

    const view = await render(
      <SoundDesignPanel
        projectId="story-1"
        sounds={[]}
        onSoundsChanged={vi.fn()}
      />,
    );

    expect(
      view.container.querySelector(
        'button[aria-label^="Selected creative audio model:"]',
      ),
    ).toBeNull();
    expect(view.container.textContent).not.toContain(
      "Stable Audio 3 Small SFX",
    );
    expect(view.container.textContent).toContain(
      "Download a creative audio model",
    );
    expect(view.container.textContent).toContain("Download required");

    await view.cleanup();
  });
});
