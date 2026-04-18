import { useEffect, useState } from "react";

/**
 * Resolve a DOM element by id that a section may use as a portal target for
 * header actions. Re-resolves when the id changes; returns null when no id
 * is provided or the element cannot be found.
 */
export function usePortalTarget(
  targetId: string | null | undefined,
): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!targetId) {
      setTarget(null);
      return;
    }
    setTarget(document.getElementById(targetId));
  }, [targetId]);

  return target;
}
