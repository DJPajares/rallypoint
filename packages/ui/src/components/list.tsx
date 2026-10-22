"use client";
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "../cx";
import type { Tone } from "./feedback";

// The quiet building blocks (PRD D-15/D-17): repeated things are rows in one
// inset group, not a card each.
export function ListGroup({
  label,
  children,
}: {
  /** Names the list for assistive technology when no heading precedes it. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <ul className="rp-list" aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * One row: a leading picture, a title and a subtitle, and a trailing control.
 * With `onSelect` the title area is a button of its own, so a trailing control
 * (a check, a toggle) stays a separate target.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onSelect,
  selectLabel,
  className,
  children,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onSelect?: () => void;
  selectLabel?: string;
  className?: string;
  /** Anything that belongs to the row but sits below it, like an error. */
  children?: ReactNode;
}) {
  const body = (
    <>
      {leading ? <span className="rp-row__lead">{leading}</span> : null}
      <span className="rp-row__text">
        <span className="rp-row__title">{title}</span>
        {subtitle ? <span className="rp-row__sub">{subtitle}</span> : null}
      </span>
    </>
  );
  return (
    <li className={cx("rp-row", className)}>
      <div className="rp-row__line">
        {onSelect ? (
          <button
            type="button"
            className="rp-row__main"
            aria-label={selectLabel}
            onClick={onSelect}
          >
            {body}
          </button>
        ) : (
          <div className="rp-row__main">{body}</div>
        )}
        {trailing ? <span className="rp-row__trail">{trailing}</span> : null}
      </div>
      {children}
    </li>
  );
}

/** A small status label: an icon and words, the colour only reinforces them. */
export function Pill({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`rp-pill rp-tone-${tone}`}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

/** A few big numbers in one row, each with its label underneath. */
export function StatRow({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="rp-stats">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Choose one view of the same list. A radio group: Tab reaches the chosen
 * option, arrow keys move between options.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKeyDown(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }
  return (
    <div className="rp-segmented" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className="rp-segmented__option"
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
