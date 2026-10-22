import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { buttonClass, iconButtonClass } from "../classes";
import type { ButtonStyle } from "../classes";
export function Button({
  variant,
  size,
  wide,
  className,
  ...props
}: ButtonStyle & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(buttonClass({ variant, size, wide }), className)}
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
      className={cx(iconButtonClass(flat), className)}
      {...props}
    >
      {children}
    </button>
  );
}
