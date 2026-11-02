import { cva } from "class-variance-authority";

// shadcn's Button (base-nova), restyled to RallyPoint (D-15/D-21): pill
// shaped, 48px tall (44px small), and `default` is the one orange action per
// screen. Focus uses the app-wide outline from the base layer.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent font-semibold whitespace-nowrap no-underline transition-[background-color,border-color,transform] duration-150 ease-standard select-none active:scale-98 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 aria-invalid:border-danger-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:not-disabled:bg-primary-hover",
        outline:
          "border-input bg-card text-foreground hover:not-disabled:bg-muted aria-expanded:bg-muted",
        chrome: "bg-chrome text-chrome-foreground",
        ghost:
          "text-foreground hover:not-disabled:bg-muted aria-expanded:bg-muted",
        destructive:
          "bg-danger text-danger-foreground hover:not-disabled:bg-danger/70",
        link: "rounded-none border-0 text-link underline underline-offset-3 active:scale-100 disabled:text-muted-foreground disabled:opacity-100",
        /** Round icon chips: the floating menu, back and close. */
        floating:
          "border-border bg-card text-foreground shadow-sm hover:not-disabled:bg-muted",
        flat: "border-border bg-card text-foreground hover:not-disabled:bg-muted",
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

export { buttonVariants };
