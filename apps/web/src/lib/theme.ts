import { useSyncExternalStore } from "react";

// Light, dark, or follow the system. The choice is a per-device preference, so it lives in
// localStorage; index.html applies it before first paint to avoid a flash.

export type ThemePreference = "system" | "light" | "dark";
const KEY = "cuntas:theme";
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let preference = readPreference();

export function resolvedTheme(pref = preference): "light" | "dark" {
  return pref === "system" ? (media?.matches ? "dark" : "light") : pref;
}

function apply() {
  const dark = resolvedTheme() === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0c0a09" : "#0f766e");
  for (const l of listeners) l();
}

media?.addEventListener("change", () => preference === "system" && apply());

export function setTheme(pref: ThemePreference) {
  preference = pref;
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
  apply();
}

export function initTheme() {
  apply();
}

/** Calls back whenever the resolved theme may have changed (the apps restyle the status bar). */
export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The preference and the theme it resolves to; re-renders when either changes. */
export function useTheme(): { preference: ThemePreference; theme: "light" | "dark" } {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => `${preference}:${resolvedTheme()}`,
  );
  const [pref, resolved] = theme.split(":") as [ThemePreference, "light" | "dark"];
  return { preference: pref, theme: resolved };
}

/** Chart colours that read on the current background. */
export function useChartColors() {
  const { theme } = useTheme();
  return theme === "dark"
    ? { grid: "#292524", axis: "#a8a29e", primary: "#2dd4bf", primaryFill: "#14b8a6", secondary: "#fbbf24", tertiary: "#a78bfa", tooltipBg: "#1c1917", tooltipBorder: "#44403c" }
    : { grid: "#e7e5e4", axis: "#78716c", primary: "#0f766e", primaryFill: "#14917f", secondary: "#d97706", tertiary: "#7c3aed", tooltipBg: "#ffffff", tooltipBorder: "#e7e5e4" };
}
