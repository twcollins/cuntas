import { useEffect, useState } from "react";

/** Tailwind's `md` breakpoint: the sidebar and tables from here up, the tab bar and lists below. */
export const WIDE = "(min-width: 768px)";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    onChange();
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
