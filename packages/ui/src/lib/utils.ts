import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the theme's own names, so text-display-sm reads as a
// size (not a colour) and shadow-lift as a shadow, and neither is dropped.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display-sm", "display-md", "display-lg"],
      shadow: ["lift", "lift-hover", "focus", "ring-chrome"],
      // Named sizes from theme.css, so size-control replaces size-touch.
      spacing: [
        "touch",
        "control",
        "control-sm",
        "icon-sm",
        "icon-md",
        "icon-lg",
        "icon-tile",
        "create",
        "stub",
        "dot",
        "check",
        "day",
        "popover-list",
        "brand-mark",
        "tab",
        "tile",
        "topbar",
        "bottombar",
      ],
    },
  },
});

/** Joins class names; later Tailwind classes win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
