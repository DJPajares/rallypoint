import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { cardClass } from "../classes";
export function Card({
  as: Tag = "div",
  tone,
  className,
  ...props
}: {
  as?: "div" | "article" | "section" | "aside";
  tone?: "default" | "accent";
} & HTMLAttributes<HTMLElement>) {
  return <Tag className={cx(cardClass(tone), className)} {...props} />;
}
/** A small rounded label. `inherit` takes the colour of what it sits in. */
export function Badge({
  inherit,
  children,
}: {
  inherit?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cx("rp-badge", inherit && "rp-badge--inherit")}>
      {children}
    </span>
  );
}
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <span className="rp-icon-tile" aria-hidden="true">
      {children}
    </span>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span className="rp-avatar" aria-hidden="true">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
