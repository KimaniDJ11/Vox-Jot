import { describe, expect, it, vi } from "vitest";

import { handleHorizontalSegmentedControlKeyDown } from "./segmentedControlKeyboard";

function makeSegmentedControl() {
  const control = document.createElement("div");
  control.setAttribute("role", "group");

  ["Profiles", "Voice changer", "History"].forEach((label, index) => {
    const segment = document.createElement("button");
    segment.setAttribute("data-segmented-control-item", "true");
    segment.setAttribute("aria-pressed", index === 0 ? "true" : "false");
    segment.textContent = label;
    segment.addEventListener("click", () => {
      Array.from(
        control.querySelectorAll('[data-segmented-control-item="true"]'),
      ).forEach((node) => node.setAttribute("aria-pressed", "false"));
      segment.setAttribute("aria-pressed", "true");
    });
    control.append(segment);
  });

  document.body.append(control);
  return control;
}

function keyboardEvent(control: HTMLElement, key: string) {
  return {
    currentTarget: control,
    key,
    preventDefault: vi.fn(),
  };
}

describe("handleHorizontalSegmentedControlKeyDown", () => {
  it("moves focus and activates the next segment with ArrowRight", () => {
    const control = makeSegmentedControl();
    const segments = control.querySelectorAll<HTMLButtonElement>(
      '[data-segmented-control-item="true"]',
    );
    segments[0]?.focus();

    const event = keyboardEvent(control, "ArrowRight");
    const handled = handleHorizontalSegmentedControlKeyDown(event);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(segments[1]);
    expect(segments[1]?.getAttribute("aria-pressed")).toBe("true");

    control.remove();
  });

  it("wraps backward from the first segment", () => {
    const control = makeSegmentedControl();
    const segments = control.querySelectorAll<HTMLButtonElement>(
      '[data-segmented-control-item="true"]',
    );
    segments[0]?.focus();

    handleHorizontalSegmentedControlKeyDown(keyboardEvent(control, "ArrowLeft"));

    expect(document.activeElement).toBe(segments[2]);
    expect(segments[2]?.getAttribute("aria-pressed")).toBe("true");

    control.remove();
  });

  it("uses RTL horizontal arrow direction when requested", () => {
    const control = makeSegmentedControl();
    const segments = control.querySelectorAll<HTMLButtonElement>(
      '[data-segmented-control-item="true"]',
    );
    segments[0]?.focus();

    handleHorizontalSegmentedControlKeyDown(keyboardEvent(control, "ArrowRight"), {
      direction: "rtl",
    });

    expect(document.activeElement).toBe(segments[2]);

    control.remove();
  });

  it("supports Home and End without handling unrelated keys", () => {
    const control = makeSegmentedControl();
    const segments = control.querySelectorAll<HTMLButtonElement>(
      '[data-segmented-control-item="true"]',
    );
    segments[1]?.focus();

    handleHorizontalSegmentedControlKeyDown(keyboardEvent(control, "End"));
    expect(document.activeElement).toBe(segments[2]);

    handleHorizontalSegmentedControlKeyDown(keyboardEvent(control, "Home"));
    expect(document.activeElement).toBe(segments[0]);

    const event = keyboardEvent(control, "PageDown");
    expect(handleHorizontalSegmentedControlKeyDown(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();

    control.remove();
  });
});
