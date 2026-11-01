import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

// shadcn's Button (base-nova), restyled to RallyPoint (D-15/D-21): pill
// shaped, 48px tall (44px small), and `default` is the one orange action per
// screen. Focus uses the app-wide outline from the base layer.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent font-semibold whitespace-nowrap no-underline transition-[background-color,border-color,transform] duration-150 ease-standard select-none active:scale-98 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-action text-on-action hover:not-disabled:bg-action-hover",
        outline:
          "border-border-strong bg-surface text-text hover:not-disabled:bg-surface-sunken aria-expanded:bg-surface-sunken",
        chrome: "bg-chrome text-on-chrome",
        ghost:
          "text-text hover:not-disabled:bg-surface-sunken aria-expanded:bg-surface-sunken",
        destructive:
          "bg-danger-bg text-danger hover:not-disabled:bg-danger-bg/70",
        link: "rounded-none border-0 text-link underline underline-offset-3 active:scale-100 disabled:text-text-muted disabled:opacity-100",
        /** Round icon chips: the floating menu, back and close. */
        floating:
          "border-border bg-surface text-text shadow-sm hover:not-disabled:bg-surface-sunken",
        flat: "border-border bg-surface text-text hover:not-disabled:bg-surface-sunken",
      },
      size: {
        default: "min-h-control px-5 text-base",
        sm: "min-h-touch px-4 text-sm",
        icon: "size-touch p-0",
      },
      wide: { true: "w-full", false: "" },
    },
    compoundVariants: [
      // A link button reads as text: no padding, small type, still a 44px target.
      { variant: "link", class: "min-h-touch px-0 text-sm" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
      wide: false,
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  wide = false,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, wide, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
