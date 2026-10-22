import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
/** A label above its control, with optional help below. */
export function Field({
  id,
  label,
  help,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("rp-field", className)}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help ? <p className="rp-help">{help}</p> : null}
    </div>
  );
}
/** A checkbox with its label beside it; the whole row is the target. */
export function CheckField({
  children,
  ...props
}: { children: ReactNode } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
>) {
  return (
    <label className="rp-check">
      <input type="checkbox" {...props} />
      <span>{children}</span>
    </label>
  );
}
export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="rp-divider">
      <span>{children}</span>
    </div>
  );
}
