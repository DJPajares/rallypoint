import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/utils";
import { buttonClass, iconButtonClass } from "../classes";
import type { ButtonStyle } from "../classes";
/** A button in one of RallyPoint's looks (shadcn's Button styles). */
export function Button({
  variant,
  size,
  wide,
  className,
  ...props
}: ButtonStyle & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(buttonClass({ variant, size, wide }), className)}
      {...props}
    />
  );
}
/** A round, icon-only button. `label` is its accessible name. */
export function IconButton({
  label,
  flat,
  className,
  children,
  ...props
}: {
  label: string;
  flat?: boolean;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(iconButtonClass(flat), className)}
      {...props}
    >
      {children}
    </button>
  );
}
