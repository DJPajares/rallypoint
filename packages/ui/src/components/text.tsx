import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";
/** The class list for secondary guidance text, for elements that aren't <p>. */
export const helpClass = "mt-1 mb-0 text-sm text-muted-foreground";
/** The short line above a page title. */
export function Kicker({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-sm font-semibold text-muted-foreground">
      {children}
    </span>
  );
}
/** The larger, muted paragraph under a page title. */
export function Lede({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("max-w-reading text-lg text-muted-foreground", className)}
      {...props}
    />
  );
}
/** Secondary guidance under a field or block. */
export function Help({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn(helpClass, className)} {...props} />;
}
