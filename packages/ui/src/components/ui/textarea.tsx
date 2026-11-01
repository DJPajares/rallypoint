import * as React from "react";
import { cn } from "../../lib/utils";
import { controlClass } from "../../control";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlClass, "block resize-y leading-normal", className)}
      {...props}
    />
  );
}

export { Textarea };
