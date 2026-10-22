import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
/** The short line above a page title. */
export function Kicker({ children }: { children: ReactNode }) {
  return <span className="rp-kicker">{children}</span>;
}
/** The larger, muted paragraph under a page title. */
export function Lede({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx("rp-lede", className)} {...props} />;
}
/** Secondary guidance under a field or block. */
export function Help({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx("rp-help", className)} {...props} />;
}
