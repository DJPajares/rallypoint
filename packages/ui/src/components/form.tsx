import type { ReactNode } from "react";
import { cx } from "../cx";
/**
 * A label above its control, with optional help below. The label gets the id
 * `${id}-label` and the help `${id}-help`; point the control's
 * aria-describedby at the help so screen readers announce it with the field.
 */
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
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      {children}
      {help ? (
        <p id={`${id}-help`} className="rp-help">
          {help}
        </p>
      ) : null}
    </div>
  );
}
export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="rp-divider">
      <span>{children}</span>
    </div>
  );
}
