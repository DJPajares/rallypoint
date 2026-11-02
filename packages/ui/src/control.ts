/**
 * One look for every typed control (D-24): text inputs, textareas and the
 * triggers of pickers and selects. 48px tall, a soft focus halo instead of
 * the browser outline, sunken when disabled, red-edged when invalid.
 */
export const controlClass =
  "mt-2 flex min-h-control w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card px-4 py-2 text-left text-base text-foreground outline-none transition-[border-color,box-shadow,background-color] duration-150 ease-standard placeholder:text-muted-foreground/75 hover:border-muted-foreground focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none data-popup-open:border-ring data-popup-open:shadow-focus disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground data-disabled:cursor-not-allowed data-disabled:bg-muted data-disabled:text-muted-foreground aria-invalid:border-danger-foreground";
/** A control box holding its own input (stepper, prefix): the box shows focus. */
export const controlBoxClass =
  "cursor-text focus-within:border-ring focus-within:shadow-focus";
/** An input inside a control box: no frame of its own. */
export const bareInputClass =
  "m-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-base outline-none focus-visible:outline-none";
/** The floating panel of popovers and select lists. */
export const popupClass =
  "max-h-(--available-height) max-w-(--available-width) overflow-auto rounded-lg border border-border bg-card p-3 text-foreground shadow-lg outline-none origin-(--transform-origin) transition-[opacity,transform] duration-150 ease-standard data-ending-style:scale-97 data-ending-style:opacity-0 data-starting-style:scale-97 data-starting-style:opacity-0";
