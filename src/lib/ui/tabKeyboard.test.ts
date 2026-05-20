import { describe, expect, it, vi } from "vitest";

import { handleHorizontalTabListKeyDown } from "./tabKeyboard";

function makeTablist() {
  const tablist = document.createElement("div");
  tablist.setAttribute("role", "tablist");

  ["Dictate", "Refine", "Listen"].forEach((label, index) => {
    const tab = document.createElement("button");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", index === 0 ? "true" : "false");
    tab.textContent = label;
    tab.addEventListener("click", () => {
      Array.from(tablist.querySelectorAll('[role="tab"]')).forEach((node) =>
        node.setAttribute("aria-selected", "false"),
      );
      tab.setAttribute("aria-selected", "true");
    });
    tablist.append(tab);
  });

  document.body.append(tablist);
  return tablist;
}

function keyboardEvent(tablist: HTMLElement, key: string) {
  return {
    currentTarget: tablist,
    key,
    preventDefault: vi.fn(),
  };
}

describe("handleHorizontalTabListKeyDown", () => {
  it("moves focus and activates the next tab with ArrowRight", () => {
    const tablist = makeTablist();
    const tabs = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0]?.focus();

    const event = keyboardEvent(tablist, "ArrowRight");
    const handled = handleHorizontalTabListKeyDown(event);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");

    tablist.remove();
  });

  it("wraps backward from the first tab", () => {
    const tablist = makeTablist();
    const tabs = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0]?.focus();

    handleHorizontalTabListKeyDown(keyboardEvent(tablist, "ArrowLeft"));

    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs[2]?.getAttribute("aria-selected")).toBe("true");

    tablist.remove();
  });

  it("uses RTL horizontal arrow direction when requested", () => {
    const tablist = makeTablist();
    const tabs = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0]?.focus();

    handleHorizontalTabListKeyDown(keyboardEvent(tablist, "ArrowRight"), {
      direction: "rtl",
    });

    expect(document.activeElement).toBe(tabs[2]);

    tablist.remove();
  });

  it("supports Home and End without handling unrelated keys", () => {
    const tablist = makeTablist();
    const tabs = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1]?.focus();

    handleHorizontalTabListKeyDown(keyboardEvent(tablist, "End"));
    expect(document.activeElement).toBe(tabs[2]);

    handleHorizontalTabListKeyDown(keyboardEvent(tablist, "Home"));
    expect(document.activeElement).toBe(tabs[0]);

    const event = keyboardEvent(tablist, "PageDown");
    expect(handleHorizontalTabListKeyDown(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();

    tablist.remove();
  });
});
