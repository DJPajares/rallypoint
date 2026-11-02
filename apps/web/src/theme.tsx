"use client";
import { useSyncExternalStore } from "react";
import type { ComponentProps } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

/**
 * Light and dark mode, set up as shadcn/ui's Next.js guide does: next-themes
 * puts the `dark` class on <html> before paint, following the device unless
 * someone picks a theme. The storage key is the one RallyPoint already used,
 * so an earlier choice carries over.
 */
export function ThemeProvider(
  props: ComponentProps<typeof NextThemesProvider>,
) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="rallypoint.theme"
      {...props}
    />
  );
}

const subscribe = () => () => {};

/**
 * What the screen shows right now and a switch to the other one. Flipping the
 * resolved look (rather than cycling through "system") means every tap
 * visibly changes the theme. The server render can't know the theme, so it
 * says light until the browser takes over.
 */
export function useAppearance() {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const appearance: "light" | "dark" =
    hydrated && resolvedTheme === "dark" ? "dark" : "light";
  return {
    appearance,
    toggle: () => setTheme(appearance === "dark" ? "light" : "dark"),
  };
}
