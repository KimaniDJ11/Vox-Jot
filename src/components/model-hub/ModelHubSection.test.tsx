import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renderHubSection = vi.hoisted(() => {
  return function renderHubSection(
    ReactModule: typeof import("react"),
    testId: string,
    props: {
      modelHubControls?: {
        providerFilter: string;
        languageFilter: string;
        sortMode: string;
        setProviderFilter: (value: string) => void;
        setLanguageFilter: (value: string) => void;
        setSortMode: (value: string) => void;
      };
    },
  ) {
    const controls = props.modelHubControls;

    if (!controls) {
      return ReactModule.createElement("section", {
        "data-testid": `${testId}-inactive`,
      });
    }

    return ReactModule.createElement(
      "section",
      { "data-testid": testId },
      ReactModule.createElement(
        "span",
        { "data-testid": `${testId}-sort` },
        controls.sortMode,
      ),
      ReactModule.createElement(
        "span",
        { "data-testid": `${testId}-provider` },
        controls.providerFilter,
      ),
      ReactModule.createElement(
        "select",
        {
          "aria-label": `${testId} sort`,
          value: controls.sortMode,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
            controls.setSortMode(event.target.value),
        },
        ReactModule.createElement(
          "option",
          { value: "best_match" },
          "Best Match",
        ),
        ReactModule.createElement(
          "option",
          { value: "alphabetical" },
          "Alphabetical",
        ),
      ),
      ReactModule.createElement(
        "select",
        {
          "aria-label": `${testId} provider`,
          value: controls.providerFilter,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
            controls.setProviderFilter(event.target.value),
        },
        ReactModule.createElement("option", { value: "all" }, "All"),
        ReactModule.createElement("option", { value: "neural" }, "Neural"),
      ),
    );
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("framer-motion", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const passthrough =
    (element: keyof JSX.IntrinsicElements) =>
    ({
      children,
      layoutId: _layoutId,
      transition: _transition,
      whileTap: _whileTap,
      ...props
    }: React.HTMLAttributes<HTMLElement> & {
      children?: React.ReactNode;
      layoutId?: string;
      transition?: unknown;
      whileTap?: unknown;
    }) =>
      ReactModule.createElement(element, props, children);

  return {
    LayoutGroup: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    motion: {
      button: passthrough("button"),
      span: passthrough("span"),
    },
  };
});

vi.mock("@/components/app-sections/dictate", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    DictateModelsSection: (props: never) =>
      renderHubSection(ReactModule, "stt", props),
  };
});

vi.mock("@/components/model-hub/SpeechAnalysisEnginesSection", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    default: (props: never) => renderHubSection(ReactModule, "analysis", props),
  };
});

vi.mock("@/components/app-sections/refine", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    RefineModelsSection: (props: never) =>
      renderHubSection(ReactModule, "llm", props),
  };
});

vi.mock("@/components/settings/general/ListenSections", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    EngineLibrarySection: (props: never) =>
      renderHubSection(ReactModule, "tts", props),
  };
});

vi.mock("@/components/model-hub/CreativeAudioEnginesSection", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    default: (props: never) =>
      renderHubSection(ReactModule, "creative_audio", props),
  };
});

vi.mock("@/components/model-hub/AudioCleanupEnginesSection", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    default: (props: never) =>
      renderHubSection(ReactModule, "audio_cleanup", props),
  };
});

vi.mock("@/components/model-hub/OcrEnginesSection", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    default: (props: never) => renderHubSection(ReactModule, "ocr", props),
  };
});

import ModelHubSection from "@/components/model-hub/ModelHubSection";
import {
  MODEL_HUB_SCOPE_STORAGE_KEY,
  MODEL_HUB_TAB_STORAGE_KEY,
} from "@/components/model-hub/modelHubTabs";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
    },
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: globalThis.localStorage,
  });
}

describe("ModelHubSection", () => {
  beforeEach(() => {
    installLocalStorageMock();
    window.localStorage.removeItem(MODEL_HUB_SCOPE_STORAGE_KEY);
    window.localStorage.removeItem(MODEL_HUB_TAB_STORAGE_KEY);
  });

  const render = async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = null;

    await act(async () => {
      root = createRoot(container);
      root.render(<ModelHubSection />);
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

  it("shares sort mode across model hub category tabs", async () => {
    const view = await render();

    const sttSort = view.container.querySelector(
      '[aria-label="stt sort"]',
    ) as HTMLSelectElement;
    await act(async () => {
      sttSort.value = "alphabetical";
      sttSort.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const ocrTab = Array.from(view.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Screen OCR",
    );
    expect(ocrTab).not.toBeUndefined();

    await act(async () => {
      ocrTab?.click();
    });

    expect(
      view.container.querySelector('[data-testid="ocr-sort"]')?.textContent,
    ).toBe("alphabetical");

    await view.cleanup();
  });

  it("keeps provider filters scoped while sort mode is shared", async () => {
    const view = await render();

    const sttSort = view.container.querySelector(
      '[aria-label="stt sort"]',
    ) as HTMLSelectElement;
    await act(async () => {
      sttSort.value = "alphabetical";
      sttSort.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const ocrTab = Array.from(view.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Screen OCR",
    );
    await act(async () => {
      ocrTab?.click();
    });

    const ocrProvider = view.container.querySelector(
      '[aria-label="ocr provider"]',
    ) as HTMLSelectElement;
    await act(async () => {
      ocrProvider.value = "neural";
      ocrProvider.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const sttTab = Array.from(view.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Speech (STT)",
    );
    await act(async () => {
      sttTab?.click();
    });

    expect(
      view.container.querySelector('[data-testid="stt-sort"]')?.textContent,
    ).toBe("alphabetical");
    expect(
      view.container.querySelector('[data-testid="stt-provider"]')?.textContent,
    ).toBe("all");

    await view.cleanup();
  });

  it("includes Audio Cleanup as its own category with scoped filters", async () => {
    const view = await render();

    const sttSort = view.container.querySelector(
      '[aria-label="stt sort"]',
    ) as HTMLSelectElement;
    await act(async () => {
      sttSort.value = "alphabetical";
      sttSort.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const audioCleanupTab = Array.from(
      view.container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Audio Cleanup");
    expect(audioCleanupTab).not.toBeUndefined();

    await act(async () => {
      audioCleanupTab?.click();
    });

    expect(
      view.container.querySelector('[data-testid="audio_cleanup-sort"]')
        ?.textContent,
    ).toBe("alphabetical");

    const audioCleanupProvider = view.container.querySelector(
      '[aria-label="audio_cleanup provider"]',
    ) as HTMLSelectElement;
    await act(async () => {
      audioCleanupProvider.value = "neural";
      audioCleanupProvider.dispatchEvent(
        new Event("change", { bubbles: true }),
      );
    });

    const sttTab = Array.from(view.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Speech (STT)",
    );
    await act(async () => {
      sttTab?.click();
    });

    expect(
      view.container.querySelector('[data-testid="stt-provider"]')?.textContent,
    ).toBe("all");

    await view.cleanup();
  });

  it("opens scoped Audio Cleanup without the full category tab bar", async () => {
    window.localStorage.setItem(MODEL_HUB_SCOPE_STORAGE_KEY, "audio_cleanup");
    window.localStorage.setItem(MODEL_HUB_TAB_STORAGE_KEY, "audio_cleanup");

    const view = await render();

    expect(view.container.querySelector('[role="tablist"]')).toBeNull();
    expect(
      view.container.querySelector('[data-testid="audio_cleanup-sort"]')
        ?.textContent,
    ).toBe("best_match");
    expect(view.container.textContent).not.toContain("Speech (STT)");
    expect(view.container.textContent).not.toContain("Refine (LLM)");

    await view.cleanup();
  });
});
