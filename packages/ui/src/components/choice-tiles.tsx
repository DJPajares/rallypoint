import type { ReactNode } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { cn } from "../lib/utils";
export interface Tile {
  value: string;
  label: string;
  icon: ReactNode;
  /** Spans the whole row on phones (a closing "something else" choice). */
  wide?: boolean;
}
/**
 * One choice from a few, shown as icon cards. Underneath they are native
 * radio buttons sharing a name, so arrow keys move between them and screen
 * readers announce a single group named by `labelledBy`.
 */
export function ChoiceTiles({
  name,
  labelledBy,
  value,
  onChange,
  tiles,
  disabled,
}: {
  name: string;
  labelledBy: string;
  value: string | null;
  onChange: (value: string) => void;
  tiles: Tile[];
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-5"
    >
      {tiles.map((tile) => (
        <label
          key={tile.value}
          className={cn(
            "group/tile relative flex min-h-tile cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface px-2 py-4 text-center text-text transition-[border-color,box-shadow] duration-150 ease-standard hover:border-border-strong has-checked:border-chrome has-checked:shadow-ring-chrome has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-focus has-disabled:cursor-default has-disabled:opacity-50",
            tile.wide &&
              "col-span-full min-h-control flex-row md:col-auto md:min-h-tile md:flex-col",
          )}
        >
          <input
            type="radio"
            className="pointer-events-none absolute opacity-0"
            name={name}
            value={tile.value}
            checked={value === tile.value}
            onChange={() => onChange(tile.value)}
            disabled={disabled}
          />
          <span
            className="inline-flex text-text-muted group-has-checked/tile:text-chrome"
            aria-hidden="true"
          >
            {tile.icon}
          </span>
          <span className="text-sm font-semibold">{tile.label}</span>
          <span
            className="absolute top-2 right-2 hidden size-check items-center justify-center rounded-full bg-chrome text-on-chrome group-has-checked/tile:inline-flex"
            aria-hidden="true"
          >
            <CheckIcon size={12} weight="bold" />
          </span>
        </label>
      ))}
    </div>
  );
}
