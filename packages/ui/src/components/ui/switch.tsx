"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../../lib/utils";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex h-6.5 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ease-standard outline-none data-checked:bg-chrome data-unchecked:bg-border-strong data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5.5 rounded-full bg-surface shadow-sm transition-transform duration-200 ease-standard data-checked:translate-x-4.5"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
