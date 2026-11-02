"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "../../lib/utils";

import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-check shrink-0 items-center justify-center rounded-xs border-2 border-input bg-card text-chrome-foreground transition-colors duration-150 ease-standard outline-none data-checked:border-chrome data-checked:bg-chrome disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none data-unchecked:hidden [&>svg]:size-4"
      >
        <CheckIcon weight="bold" aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
