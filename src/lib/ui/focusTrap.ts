import { useEffect, useRef } from "react";
import type React from "react";

export const focusableElementSelector = [
  "a[href]",
  "button:not(:disabled)",
  "textarea:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) {
    return [];
  }

  return Array.from(
    root.querySelectorAll<HTMLElement>(focusableElementSelector),
  )
    .filter((element) => !element.hasAttribute("disabled"))
    .filter((element) => element.getAttribute("aria-hidden") !== "true")
    .filter(
      (element) =>
        element.getClientRects().length > 0 ||
        element === document.activeElement,
    );
}

interface DialogFocusTrapOptions {
  enabled: boolean;
  containerRef: React.RefObject<HTMLElement>;
  initialFocusSelector?: string;
}

export function useDialogFocusTrap({
  enabled,
  containerRef,
  initialFocusSelector,
}: DialogFocusTrapOptions) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const preferred = initialFocusSelector
        ? container.querySelector<HTMLElement>(initialFocusSelector)
        : null;
      const firstFocusable = preferred ?? getFocusableElements(container)[0];
      firstFocusable?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      const previousFocus = previousFocusRef.current;
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
    };
  }, [containerRef, enabled, initialFocusSelector]);
}

interface DialogKeyDownOptions {
  escapeDisabled?: boolean;
}

export function handleDialogKeyDown(
  event: React.KeyboardEvent,
  container: HTMLElement | null,
  onEscape?: () => void,
  { escapeDisabled = false }: DialogKeyDownOptions = {},
) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (!escapeDisabled) {
      onEscape?.();
    }
    return;
  }

  if (event.key !== "Tab" || !container) {
    return;
  }

  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
