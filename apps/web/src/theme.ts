"use client";
import { useSyncExternalStore } from "react";
export type ThemePreference = "system" | "light" | "dark";
const storageKey = "rallypoint.theme";
const listeners = new Set<() => void>();
// The pre-paint script in app/layout.tsx writes the attribute; it is the source
// of truth, so a blocked localStorage still leaves a working (session-only) choice.
function read(): ThemePreference {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "system";
}
export function setThemePreference(next: ThemePreference) {
  const root = document.documentElement;
  if (next === "system") delete root.dataset.theme;
  else root.dataset.theme = next;
  try {
    if (next === "system") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, next);
  } catch {
    // Private windows can refuse storage; the choice still holds for this visit.
  }
  listeners.forEach((listener) => listener());
}
export function useThemePreference() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    (): ThemePreference => "system",
  );
}
export const nextTheme: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};
