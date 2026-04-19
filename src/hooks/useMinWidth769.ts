import { useEffect, useState } from "react";

const QUERY = "(min-width: 769px)";

export function useMinWidth769(): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return matches;
}

export default useMinWidth769;
