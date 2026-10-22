"use client";
import { useSyncExternalStore } from "react";
/** Matches the phone breakpoint used across the CSS (max-width: 767px). */
export function useIsPhone() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(max-width: 767px)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}
