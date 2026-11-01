import { buttonVariants } from "./components/ui/button";
import { cn } from "./lib/utils";
export type ButtonVariant = "primary" | "secondary" | "accent" | "link";
export interface ButtonStyle {
  /** primary is the orange call to action: use at most one per screen. */
  variant?: ButtonVariant;
  size?: "md" | "sm";
  wide?: boolean;
}
const variants = {
  primary: "default",
  secondary: "outline",
  accent: "chrome",
  link: "link",
} as const;
/**
 * The class list for a button look. Use it on links (Next's Link, <a>) that
 * should read as buttons, so links and buttons can never drift apart. It is
 * shadcn's buttonVariants under RallyPoint's names.
 */
export function buttonClass({
  variant = "secondary",
  size = "md",
  wide = false,
}: ButtonStyle = {}) {
  return buttonVariants({
    variant: variants[variant],
    size: size === "sm" ? "sm" : "default",
    wide,
  });
}
/** A round icon-only button look; `flat` drops the floating shadow. */
export function iconButtonClass(flat = false) {
  return buttonVariants({ variant: flat ? "flat" : "floating", size: "icon" });
}
/** The default surface for grouped content; `accent` is the graphite block. */
export function cardClass(tone: "default" | "accent" = "default") {
  return cn(
    "rounded-lg border border-border bg-surface p-5",
    tone === "accent" && "border-transparent bg-stub text-on-stub",
  );
}
