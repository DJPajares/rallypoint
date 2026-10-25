"use client";
import { useEffect, useRef, useState } from "react";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { ActivityIcon, ChoiceTiles } from "@rallypoint/ui";
import type { Tile } from "@rallypoint/ui";
import { matchActivity } from "@rallypoint/domain/activities";
import type { Activity } from "@rallypoint/domain/activities";
const OTHER = "other";
/**
 * The session's activity as icon tiles from the shared catalog (D-23). The
 * value is still plain text: a tile stores the activity's name, and "Something
 * else" opens a text box. Saved text that names a catalog activity (in any
 * case) reopens on its tile. Without a catalog, the text box is all there is.
 */
export function ActivityPicker({
  value,
  onChange,
  catalog,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  catalog: readonly Activity[] | null;
  disabled?: boolean;
}) {
  const listed = (catalog ?? []).filter((a) => a.listed);
  const named = matchActivity(listed, value);
  // Chosen by tapping "Something else"; typed text the catalog doesn't name
  // also opens the box, including once a slow catalog arrives.
  const [other, setOther] = useState(false);
  const [focusOther, setFocusOther] = useState(false);
  const text = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOther) text.current?.focus();
  }, [focusOther]);
  const tiles: Tile[] = [
    ...listed.map((a) => ({
      value: a.name,
      label: a.name,
      icon: <ActivityIcon icon={a.icon} size={30} />,
    })),
    {
      value: OTHER,
      label: "Something else",
      icon: <PencilSimpleIcon size={30} />,
      wide: true,
    },
  ];
  const typing = other || (!named && value.trim() !== "") || !listed.length;
  return (
    <div className="rp-field">
      <span id="activity-label" className="rp-field__label">
        Activity
      </span>
      <ChoiceTiles
        name="activity"
        labelledBy="activity-label"
        value={typing ? OTHER : (named?.name ?? null)}
        onChange={(next) => {
          if (next === OTHER) {
            setOther(true);
            setFocusOther(true);
            // Start the typed activity fresh rather than editing a listed name.
            if (named) onChange("");
          } else {
            setOther(false);
            setFocusOther(false);
            onChange(next);
          }
        }}
        tiles={tiles}
        disabled={disabled}
      />
      {typing ? (
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
