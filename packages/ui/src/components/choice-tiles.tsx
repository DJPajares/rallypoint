import type { ReactNode } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { cx } from "../cx";
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
    <div role="radiogroup" aria-labelledby={labelledBy} className="rp-tiles">
      {tiles.map((tile) => (
        <label
          key={tile.value}
          className={cx("rp-tile", tile.wide && "rp-tile--wide")}
        >
          <input
            type="radio"
            className="rp-tile__input"
            name={name}
            value={tile.value}
            checked={value === tile.value}
            onChange={() => onChange(tile.value)}
            disabled={disabled}
          />
          <span className="rp-tile__icon" aria-hidden="true">
            {tile.icon}
          </span>
          <span className="rp-tile__label">{tile.label}</span>
          <span className="rp-tile__check" aria-hidden="true">
            <CheckIcon size={12} weight="bold" />
          </span>
        </label>
      ))}
    </div>
  );
}
