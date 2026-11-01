import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { Label } from "./ui/label";
import { helpClass } from "./text";
/** The class list for a label that names a group (radios, tiles), not one control. */
export const fieldLabelClass = "block text-sm font-semibold";
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
    <div data-slot="field" className={cn("mb-4", className)}>
      <Label
        id={`${id}-label`}
        htmlFor={id}
        className="block leading-normal font-semibold"
      >
        {label}
      </Label>
      {children}
      {help ? (
        <p id={`${id}-help`} className={helpClass}>
          {help}
        </p>
      ) : null}
    </div>
  );
}
/** A quiet "or" between alternatives, with hairlines either side. */
export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 mb-2 flex items-center gap-3 text-xs font-semibold text-text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
      <span>{children}</span>
    </div>
  );
}
