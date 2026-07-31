import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSetting = vi.fn();
let appTheme: string | undefined;

vi.mock("@/hooks/useSettings", () => ({
  useSetting: () => appTheme,
  useUpdateSetting: () => updateSetting,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: {
        defaultValue?: unknown;
        returnObjects?: boolean;
        theme?: string;
      },
    ) => {
      if (key === "onboarding.appearance.features") {
        return [
          "Galaxy is selected by default for new installs.",
          "Your choice applies immediately across Vox Jot.",
          "You can switch themes later from Settings.",
        ];
      }

      if (key === "onboarding.appearance.chooseTheme") {
        return `Choose ${options?.theme} theme`;
      }

      if (key.startsWith("settings.advanced.theme.options.")) {
        const theme = key.split(".").pop() ?? "";
        return theme.charAt(0).toUpperCase() + theme.slice(1);
      }

      return typeof options?.defaultValue === "string"
        ? options.defaultValue
        : key;
    },
  }),
}));

import ThemeStep from "./ThemeStep";

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

describe("ThemeStep", () => {
  beforeEach(() => {
    appTheme = undefined;
    updateSetting.mockResolvedValue(undefined);
  });

  it("defaults to Galaxy and applies a selected theme immediately", async () => {
    const view = await render(<ThemeStep onContinue={vi.fn()} />);

    const galaxyButton = view.container.querySelector(
      'button[aria-label="Choose Galaxy theme"]',
    ) as HTMLButtonElement | null;
    const darkButton = view.container.querySelector(
      'button[aria-label="Choose Dark theme"]',
    ) as HTMLButtonElement | null;

    expect(galaxyButton).not.toBeNull();
    expect(darkButton).not.toBeNull();
    expect(galaxyButton?.getAttribute("aria-pressed")).toBe("true");
    expect(darkButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      darkButton?.click();
    });

    expect(updateSetting).toHaveBeenCalledWith("app_theme", "dark");
    expect(darkButton?.getAttribute("aria-pressed")).toBe("true");
    expect(galaxyButton?.getAttribute("aria-pressed")).toBe("false");

    await view.cleanup();
  });
});
