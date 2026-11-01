import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";
import { cardClass } from "../classes";
import { Badge as BadgePrimitive } from "./ui/badge";
/** The default surface for grouped content; `accent` is the graphite block. */
export function Card({
  as: Tag = "div",
  tone,
  className,
  ...props
}: {
  as?: "div" | "article" | "section" | "aside";
  tone?: "default" | "accent";
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      data-slot="card"
      className={cn(cardClass(tone), className)}
      {...props}
    />
  );
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
    <BadgePrimitive
      variant={inherit ? "inherit" : "muted"}
      className="h-auto gap-1 px-3 py-0.5 font-semibold"
    >
      {children}
    </BadgePrimitive>
  );
}
/** A square icon on a sunken tile, beside a title. */
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex size-icon-tile flex-none items-center justify-center rounded-md bg-surface-sunken text-text"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
/** A person's initial on the action colour. */
export function Avatar({ name }: { name: string }) {
  return (
    <span
      className="inline-flex size-control flex-none items-center justify-center rounded-full bg-action font-heading text-xl font-bold text-on-action"
      aria-hidden="true"
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
