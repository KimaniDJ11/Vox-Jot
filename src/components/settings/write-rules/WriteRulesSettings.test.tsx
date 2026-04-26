import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WriteRule } from "@/bindings";
import { UrlPatternList } from "./matchers/UrlPatternList";
import { WriteRuleEditor } from "./WriteRuleEditor";

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    commands: {
      ...actual.commands,
      getAvailableModels: vi.fn(async () => ({ status: "ok", data: [] })),
      listInstalledApps: vi.fn(async () => ({ status: "ok", data: [] })),
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalName = "Gmail compose";
const editedName = "Gmail and Docs";
const invalidPattern = "https://gmail.com";
const invalidPatternMessage =
  "Skip the scheme; use host/path like github.com/orgs/*.";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const render = async (node: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(node);
  });

  return container;
};

const inputValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("Write Profiles rule UI", () => {
  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  it("saves edited rule details", async () => {
    const onSave = vi.fn();
    const rule: WriteRule = {
      id: "rule-1",
      name: originalName,
      enabled: true,
      priority: 80,
      matchers: {
        bundle_ids: ["com.apple.Safari"],
        url_patterns: ["mail.google.com"],
      },
      overrides: {},
    };

    const view = await render(
      <WriteRuleEditor
        rule={rule}
        tones={[]}
        prompts={[]}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    const nameInput = view.querySelector("input") as HTMLInputElement;
    await inputValue(nameInput, editedName);

    const buttons = Array.from(view.querySelectorAll("button"));
    await act(async () => {
      buttons[buttons.length - 1]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: editedName }),
    );
  });

  it("shows validation for URL patterns with schemes", async () => {
    const view = await render(
      <UrlPatternList patterns={[]} onChange={vi.fn()} />,
    );

    const input = view.querySelector("input") as HTMLInputElement;
    await inputValue(input, invalidPattern);

    const addButton = view.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      addButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.textContent).toContain(invalidPatternMessage);
  });
});
