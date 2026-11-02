import type { Tone } from "./feedback";

/** Class lists for screens that lay out their own rows (D-15/D-17). */
export const listClass =
  "m-0 list-none overflow-hidden rounded-lg bg-card p-0 shadow-sm";
export const rowClass = "border-t border-border first:border-t-0";
export const rowLineClass = "flex min-h-13 items-center gap-2 pr-3";
export const rowMainClass =
  "flex min-h-13 min-w-0 flex-1 items-center gap-3 border-0 bg-transparent py-2 pr-1 pl-3 text-left text-inherit no-underline [font:inherit] [a&]:hover:bg-muted [button&]:cursor-pointer [button&]:hover:bg-muted focus-visible:-outline-offset-3";
export const rowLeadClass = "inline-flex flex-none";
export const rowTextClass = "grid min-w-0";
export const rowTitleClass = "truncate font-semibold";
export const rowSubClass = "text-sm text-muted-foreground";
export const rowTrailClass = "inline-flex flex-none items-center gap-2";
/** A status colour pair; the words and icon carry the meaning. */
export const toneClass: Record<Tone, string> = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  neutral: "bg-neutral text-neutral-foreground",
  danger: "bg-danger text-danger-foreground",
};
