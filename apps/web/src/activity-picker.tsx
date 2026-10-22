"use client";
import { useEffect, useRef, useState } from "react";
import { BasketballIcon } from "@phosphor-icons/react/dist/csr/Basketball";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PingPongIcon } from "@phosphor-icons/react/dist/csr/PingPong";
import { RacquetIcon } from "@phosphor-icons/react/dist/csr/Racquet";
import { TennisBallIcon } from "@phosphor-icons/react/dist/csr/TennisBall";
import { ChoiceTiles } from "@rallypoint/ui";
import type { Tile } from "@rallypoint/ui";
import { presetFor } from "@rallypoint/domain/activities";
import type { PresetActivity } from "@rallypoint/domain/activities";
const icons: Record<PresetActivity, Tile["icon"]> = {
  Pickleball: <PingPongIcon size={30} />,
  Badminton: <RacquetIcon size={30} />,
  Tennis: <TennisBallIcon size={30} />,
  Basketball: <BasketballIcon size={30} />,
};
const OTHER = "other";
const tiles: Tile[] = [
  ...(Object.keys(icons) as PresetActivity[]).map((value) => ({
    value,
    label: value,
    icon: icons[value],
  })),
  {
    value: OTHER,
    label: "Something else",
    icon: <PencilSimpleIcon size={30} />,
    wide: true,
  },
];
/**
 * The session's activity as icon tiles. The value is still plain text: a
 * preset tile stores its name, and "Something else" opens a text box. Saved
 * text that names a preset (in any case) reopens on that preset's tile.
 */
export function ActivityPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [other, setOther] = useState(
    () => value.trim() !== "" && !presetFor(value),
  );
  const [focusOther, setFocusOther] = useState(false);
  const text = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOther) text.current?.focus();
  }, [focusOther]);
  return (
    <div className="rp-field">
      <span id="activity-label" className="rp-field__label">
        Activity
      </span>
      <ChoiceTiles
        name="activity"
        labelledBy="activity-label"
        value={other ? OTHER : presetFor(value)}
        onChange={(next) => {
          if (next === OTHER) {
            setOther(true);
            setFocusOther(true);
            // Start the typed activity fresh rather than editing a preset name.
            if (presetFor(value)) onChange("");
          } else {
            setOther(false);
            setFocusOther(false);
            onChange(next);
          }
        }}
        tiles={tiles}
        disabled={disabled}
      />
      {other ? (
        <input
          ref={text}
          id="activity"
          aria-label="Your activity"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setFocusOther(false)}
          maxLength={80}
          placeholder="Pottery, a walk, board games…"
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
