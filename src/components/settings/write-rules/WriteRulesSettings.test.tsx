import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WriteRule } from "@/bindings";
import { UrlPatternList } from "./matchers/UrlPatternList";
import {
  groupWriteRules,
  WriteProfileGroupCard,
} from "./WriteProfileGroupCard";
import { WriteRuleEditor } from "./WriteRuleEditor";
import { WriteRuleRow } from "./WriteRuleRow";

vi.mock("@/bindings", async () => {
  const actual =
    await vi.importActual<typeof import("@/bindings")>("@/bindings");
  return {
    ...actual,
    commands: {
      ...actual.commands,
      getAppIcon: vi.fn(async () => ({ status: "ok", data: null })),
      getAvailableModels: vi.fn(async () => ({ status: "ok", data: [] })),
      getFrontmostAppForExclusion: vi.fn(async () => ({
        status: "ok",
        data: {
          bundle_id: "com.apple.Safari",
          localized_name: "Safari",
        },
      })),
      getFrontmostUrlForWriteRules: vi.fn(async () => ({
        status: "ok",
        data: "https://mail.google.com",
      })),
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

    // The new editor has many buttons (sticky header + tabs + URL
    // example chips), so we resolve "Save mode" by text. This also
    // documents the contract: the editor's primary CTA must be labelled
    // "Save mode" so the user can find it without scanning icons.
    const saveButton = Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Save mode",
    ) as HTMLButtonElement | undefined;
    expect(saveButton).toBeDefined();
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

    // The new UrlPatternList drops the explicit "+ Add URL" button in
    // favor of pressing Enter inside the input — fewer clicks, matches
    // chip-style inputs elsewhere in the app.
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(view.textContent).toContain(invalidPatternMessage);
  });

  it("requires inline confirmation before deleting a grouped profile", async () => {
    const onDelete = vi.fn();
    const rule: WriteRule = {
      id: "rule-1",
      name: "Code profile",
      enabled: true,
      priority: 80,
      matchers: {
        bundle_ids: ["com.microsoft.VSCode"],
        url_patterns: [],
      },
      overrides: {
        tone_id: "coding",
      },
    };
    const group = groupWriteRules([rule])[0];
    if (!group) throw new Error("Expected grouped write profile");

    const view = await render(
      <WriteProfileGroupCard
        group={group}
        apps={[
          {
            bundle_id: "com.microsoft.VSCode",
            name: "Code",
          },
        ]}
        tones={[{ id: "coding", label: "Coding", instruction: "" }]}
        prompts={[]}
        models={[]}
        activeRuleId={null}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const firstDeleteButton = view.querySelector(
      'button[aria-label="Delete Code profile"]',
    ) as HTMLButtonElement;
    expect(firstDeleteButton).toBeDefined();

    await act(async () => {
      firstDeleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDelete).not.toHaveBeenCalled();

    const confirmDeleteButton = view.querySelector(
      'button[aria-label="refine.writeRules.row.deleteProfile"]',
    ) as HTMLButtonElement;
    expect(confirmDeleteButton).toBeDefined();
    await act(async () => {
      confirmDeleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDelete).toHaveBeenCalledWith("rule-1");
  });

  it("uses the mode name as the grouped card heading with override details below", async () => {
    const rule: WriteRule = {
      id: "rule-1",
      name: "Messages profile",
      enabled: true,
      priority: 80,
      matchers: {
        bundle_ids: ["com.apple.MobileSMS"],
        url_patterns: [],
      },
      overrides: {
        tone_id: "casual",
      },
    };
    const group = groupWriteRules([rule])[0];
    if (!group) throw new Error("Expected grouped write profile");
    const toneInstruction =
      "Use a casual, conversational tone suitable for quick chat messages while preserving meaning.";
    const toneSummary =
      "Casual, conversational wording for quick chat messages.";

    const view = await render(
      <WriteProfileGroupCard
        group={group}
        apps={[
          {
            bundle_id: "com.apple.MobileSMS",
            name: "Messages",
          },
        ]}
        tones={[{ id: "casual", label: "Casual", instruction: toneInstruction }]}
        prompts={[]}
        models={[]}
        activeRuleId={null}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const heading = view.querySelector("h3");
    expect(heading?.textContent).toBe("Messages profile");
    expect(heading?.classList.contains("heading-display")).toBe(true);
    expect(heading?.classList.contains("write-profile-group-title")).toBe(true);
    expect(heading?.classList.contains("text-2xl")).toBe(true);
    expect(heading?.classList.contains("font-bold")).toBe(true);
    expect(view.querySelector("p")?.classList.contains("line-clamp-3")).toBe(
      true,
    );
    expect(view.querySelector("p")?.classList.contains("font-normal")).toBe(
      true,
    );
    expect(
      view
        .querySelector("p")
        ?.classList.contains("write-profile-group-description"),
    ).toBe(true);
    expect(view.querySelector("p")?.classList.contains("font-bold")).toBe(false);
    expect(view.querySelector("p")?.classList.contains("text-sm")).toBe(true);
    expect(view.querySelector("p")?.classList.contains("text-[var(--text)]")).toBe(
      true,
    );
    expect(view.textContent).toContain("Casual");
    expect(view.textContent).toContain(toneSummary);
    expect(view.textContent).not.toContain(toneInstruction);
    expect(view.textContent).not.toContain("Tone · Casual");
    expect(view.textContent).not.toContain("1 profile");
  });

  it("uses a short card summary for the built-in coding tone", async () => {
    const rule: WriteRule = {
      id: "rule-1",
      name: "Code profile",
      enabled: true,
      priority: 80,
      matchers: {
        bundle_ids: ["com.microsoft.VSCode"],
        url_patterns: [],
      },
      overrides: {
        tone_id: "coding",
      },
    };
    const group = groupWriteRules([rule])[0];
    if (!group) throw new Error("Expected grouped write profile");
    const longInstruction =
      "Format the text as precise technical writing suited for code editors and terminals. Use exact technical terms, preserve variable and function names verbatim, format code snippets with proper syntax, and keep comments concise.";

    const view = await render(
      <WriteProfileGroupCard
        group={group}
        apps={[
          {
            bundle_id: "com.microsoft.VSCode",
            name: "Code",
          },
        ]}
        tones={[{ id: "coding", label: "Coding", instruction: longInstruction }]}
        prompts={[]}
        models={[]}
        activeRuleId={null}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(view.querySelector("h3")?.textContent).toBe("Code profile");
    expect(view.textContent).toContain("Coding");
    expect(view.textContent).toContain(
      "Precise technical writing for code editors and terminals.",
    );
    expect(view.textContent).not.toContain("Use exact technical terms");
  });

  it("collapses large grouped app sets behind a plus icon", async () => {
    const rules: WriteRule[] = Array.from({ length: 6 }, (_, index) => ({
      id: `rule-${index + 1}`,
      name: `Profile ${index + 1}`,
      enabled: true,
      priority: 80,
      matchers: {
        bundle_ids: [`com.example.App${index + 1}`],
        url_patterns: [],
      },
      overrides: {
        tone_id: "casual",
      },
    }));
    const group = groupWriteRules(rules)[0];
    if (!group) throw new Error("Expected grouped write profile");

    const view = await render(
      <WriteProfileGroupCard
        group={group}
        apps={rules.map((rule, index) => ({
          bundle_id: rule.matchers.bundle_ids?.[0] ?? "",
          name: `App ${index + 1}`,
        }))}
        tones={[{ id: "casual", label: "Casual", instruction: "" }]}
        prompts={[]}
        models={[]}
        activeRuleId={null}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const showMoreButton = view.querySelector(
      'button[aria-label="Show 1 more profiles"]',
    ) as HTMLButtonElement;
    expect(showMoreButton).toBeDefined();
    expect(view.querySelector('button[aria-label="Edit Profile 6"]')).toBeNull();

    await act(async () => {
      showMoreButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      view.querySelector('button[aria-label="Edit Profile 6"]'),
    ).toBeDefined();
    expect(
      view.querySelector('button[aria-label="Show fewer profiles"]'),
    ).toBeDefined();
  });

  it("hides preview on modes that do not change text cleanup", async () => {
    const rule: WriteRule = {
      id: "rule-1",
      name: "Safari engine",
      enabled: true,
      priority: 80,
      matchers: {
        bundle_ids: ["com.apple.Safari"],
        url_patterns: ["apple.com"],
      },
      overrides: {
        stt_model_id: "whisper-medium",
        force_post_process: false,
      },
    };
    const group = groupWriteRules([rule])[0];
    if (!group) throw new Error("Expected grouped write profile");

    const view = await render(
      <WriteProfileGroupCard
        group={group}
        apps={[{ bundle_id: "com.apple.Safari", name: "Safari" }]}
        tones={[]}
        prompts={[]}
        models={[]}
        activeRuleId={null}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTry={vi.fn()}
      />,
    );

    expect(view.textContent).not.toContain("Preview mode");
  });

  it("uses a generic browser icon for URL rules targeting multiple browsers", async () => {
    const rule: WriteRule = {
      id: "rule-1",
      name: "Browser sites",
      enabled: true,
      priority: 80,
      matchers: {
        bundle_ids: ["com.apple.Safari", "com.google.Chrome"],
        url_patterns: ["apple.com"],
      },
      overrides: {
        tone_id: "neutral",
      },
    };

    const view = await render(
      <WriteRuleRow
        rule={rule}
        apps={[
          { bundle_id: "com.apple.Safari", name: "Safari" },
          { bundle_id: "com.google.Chrome", name: "Chrome" },
        ]}
        tones={[{ id: "neutral", label: "Neutral", instruction: "" }]}
        prompts={[]}
        models={[]}
        isActive={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const iconButton = view.querySelector(
      'button[aria-label$="URL · apple.com"]',
    );
    expect(iconButton?.querySelector("svg")).toBeDefined();
    expect(iconButton?.textContent).toBe("");
  });
});
