import { cx } from "./cx";
export type ButtonVariant = "primary" | "secondary" | "accent" | "link";
export interface ButtonStyle {
  /** primary is the orange call to action: use at most one per screen. */
  variant?: ButtonVariant;
  size?: "md" | "sm";
  wide?: boolean;
}
/**
 * The class list for a button look. Use it on links (Next's Link, <a>) that
 * should read as buttons, so links and buttons can never drift apart.
 */
export function buttonClass({
  variant = "secondary",
  size = "md",
  wide = false,
}: ButtonStyle = {}) {
  return cx(
    "rp-button",
    `rp-button--${variant}`,
    size === "sm" && "rp-button--sm",
    wide && "rp-button--wide",
  );
}
export function iconButtonClass(flat = false) {
  return cx("rp-icon-button", flat && "rp-icon-button--flat");
}
export function cardClass(tone: "default" | "accent" = "default") {
  return cx("rp-card", tone === "accent" && "rp-card--accent");
}
