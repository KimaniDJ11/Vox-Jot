import type React from "react";

type HorizontalDirection = "ltr" | "rtl";

interface SegmentedControlKeyboardOptions {
  direction?: HorizontalDirection;
}

type SegmentedControlKeyboardEvent = Pick<
  React.KeyboardEvent<HTMLElement>,
  "currentTarget" | "key" | "preventDefault"
>;

const segmentSelector =
  '[data-segmented-control-item="true"]:not([aria-disabled="true"]):not(:disabled)';

function getTargetIndex(
  key: string,
  currentIndex: number,
  segmentCount: number,
  direction: HorizontalDirection,
): number | null {
  if (segmentCount === 0) {
    return null;
  }

  if (key === "Home") {
    return 0;
  }

  if (key === "End") {
    return segmentCount - 1;
  }

  const nextKey = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
  const previousKey = direction === "rtl" ? "ArrowRight" : "ArrowLeft";

  if (key === nextKey || key === "ArrowDown") {
    return (currentIndex + 1) % segmentCount;
  }

  if (key === previousKey || key === "ArrowUp") {
    return (currentIndex - 1 + segmentCount) % segmentCount;
  }

  return null;
}

export function handleHorizontalSegmentedControlKeyDown(
  event: SegmentedControlKeyboardEvent,
  { direction = "ltr" }: SegmentedControlKeyboardOptions = {},
): boolean {
  const segments = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(segmentSelector),
  );

  if (segments.length === 0) {
    return false;
  }

  const focusedIndex = segments.findIndex(
    (segment) => segment === document.activeElement,
  );
  const pressedIndex = segments.findIndex(
    (segment) => segment.getAttribute("aria-pressed") === "true",
  );
  const currentIndex = focusedIndex >= 0 ? focusedIndex : pressedIndex;
  const targetIndex = getTargetIndex(
    event.key,
    currentIndex >= 0 ? currentIndex : 0,
    segments.length,
    direction,
  );

  if (targetIndex === null) {
    return false;
  }

  event.preventDefault();
  const targetSegment = segments[targetIndex];
  targetSegment.focus();
  targetSegment.click();
  return true;
}
