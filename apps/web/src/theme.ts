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
const darkQuery = "(prefers-color-scheme: dark)";
/**
 * What the screen shows right now: an explicit choice, or the device setting
 * when there is none. The switch flips this, so every tap visibly changes the
 * theme (cycling through "system" could land on the look already showing).
 */
export function useAppearance() {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(darkQuery);
      listeners.add(listener);
      query.addEventListener("change", listener);
      return () => {
        listeners.delete(listener);
        query.removeEventListener("change", listener);
      };
    },
    (): "light" | "dark" => {
      const choice = read();
      if (choice !== "system") return choice;
      return window.matchMedia(darkQuery).matches ? "dark" : "light";
    },
    (): "light" | "dark" => "light",
  );
}
export function toggleAppearance(current: "light" | "dark") {
  setThemePreference(current === "dark" ? "light" : "dark");
}
