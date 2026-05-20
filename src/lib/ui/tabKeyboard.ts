import type React from "react";

type HorizontalDirection = "ltr" | "rtl";

interface TabKeyboardOptions {
  activate?: boolean;
  direction?: HorizontalDirection;
}

type TabKeyboardEvent = Pick<
  React.KeyboardEvent<HTMLElement>,
  "currentTarget" | "key" | "preventDefault"
>;

const tabSelector = '[role="tab"]:not([aria-disabled="true"]):not(:disabled)';

function getTargetIndex(
  key: string,
  currentIndex: number,
  tabCount: number,
  direction: HorizontalDirection,
): number | null {
  if (tabCount === 0) {
    return null;
  }

  if (key === "Home") {
    return 0;
  }

  if (key === "End") {
    return tabCount - 1;
  }

  const nextKey = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
  const previousKey = direction === "rtl" ? "ArrowRight" : "ArrowLeft";

  if (key === nextKey || key === "ArrowDown") {
    return (currentIndex + 1) % tabCount;
  }

  if (key === previousKey || key === "ArrowUp") {
    return (currentIndex - 1 + tabCount) % tabCount;
  }

  return null;
}

export function handleHorizontalTabListKeyDown(
  event: TabKeyboardEvent,
  { activate = true, direction = "ltr" }: TabKeyboardOptions = {},
): boolean {
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(tabSelector),
  );
  if (tabs.length === 0) {
    return false;
  }

  const focusedIndex = tabs.findIndex((tab) => tab === document.activeElement);
  const selectedIndex = tabs.findIndex(
    (tab) => tab.getAttribute("aria-selected") === "true",
  );
  const currentIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex;
  const targetIndex = getTargetIndex(
    event.key,
    currentIndex >= 0 ? currentIndex : 0,
    tabs.length,
    direction,
  );

  if (targetIndex === null) {
    return false;
  }

  event.preventDefault();
  const targetTab = tabs[targetIndex];
  targetTab.focus();
  if (activate) {
    targetTab.click();
  }
  return true;
}
