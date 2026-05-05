export function confirmDestructiveAction(message: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false;
  }

  return window.confirm(message);
}
